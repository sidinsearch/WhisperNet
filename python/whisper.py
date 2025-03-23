import socket
import threading
import time
import json
import uuid
import os
import sys
import signal
import hashlib
import base64
from datetime import datetime

# You'll need to install these packages:
# pip install cryptography pynacl requests
from cryptography.hazmat.primitives.asymmetric import x25519
from cryptography.hazmat.primitives import serialization
from nacl.public import PublicKey, PrivateKey, Box
import requests

class InternetP2PMessenger:
    def __init__(self, stun_servers=None, bootstrap_nodes=None):
        # Default STUN servers if none provided
        self.stun_servers = stun_servers or [
            "stun.l.google.com:19302",
            "stun1.l.google.com:19302",
            "stun2.l.google.com:19302",
            "stun3.l.google.com:19302",
            "stun4.l.google.com:19302",
            "stun.services.mozilla.com:3478"
        ]
        
        # Default bootstrap nodes for peer discovery
        self.bootstrap_nodes = bootstrap_nodes or [
            "https://xnodehost.netlify.app/api/bootstrap",  # Replace with a real bootstrap node
        ]
        
        # Generate a unique user ID
        self.user_id = str(uuid.uuid4())[:8]
        self.username = None
        self.public_ip = None
        self.public_port = None
        self.online_peers = {}  # {user_id: {"username": str, "ip": str, "port": int, "pubkey": str, "last_seen": timestamp}}
        self.running = True
        self.lock = threading.Lock()
        self.message_queue = []
        
        # Generate encryption keys
        self.private_key = PrivateKey.generate()
        self.public_key = self.private_key.public_key
        self.peer_boxes = {}  # Encrypted boxes for communicating with peers
        
        # Set up UDP socket for messaging
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.bind(('0.0.0.0', 0))  # Bind to any available port
        self.local_port = self.socket.getsockname()[1]
        
        # Set up signal handler
        signal.signal(signal.SIGINT, self.signal_handler)
    
    def signal_handler(self, sig, frame):
        print("\nShutting down...")
        self.running = False
        # Notify peers that we're going offline
        self.broadcast_presence(status="offline")
        time.sleep(0.5)
        sys.exit(0)
    
    def set_username(self):
        while True:
            username = input("Enter your username for this session: ").strip()
            if username and ' ' not in username:
                self.username = username
                print(f"Welcome, {self.username}!")
                return
            else:
                print("Username cannot be empty or contain spaces. Please try again.")
    
    def discover_public_address(self, max_retries=3):
        """Discover public IP and port using STUN protocol."""
        print("Discovering your public internet address...")
        
        retries = 0
        while retries < max_retries:
            for stun_server in self.stun_servers:
                try:
                    server_host, server_port = stun_server.split(':')
                    server_port = int(server_port)
                    
                    # Create a socket for STUN
                    stun_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    stun_socket.settimeout(2)
                    
                    # STUN request (simplified)
                    stun_request = bytes.fromhex("0001000800000000")
                    stun_socket.sendto(stun_request, (server_host, server_port))
                    
                    # Get response
                    response, addr = stun_socket.recvfrom(1024)
                    
                    # Parse response to extract mapped address (simplified)
                    if len(response) >= 20:
                        xor_mapped_addr_start = 28
                        port_bytes = response[xor_mapped_addr_start:xor_mapped_addr_start+2]
                        ip_bytes = response[xor_mapped_addr_start+2:xor_mapped_addr_start+6]
                        
                        xor_port = int.from_bytes(port_bytes, byteorder='big') ^ 0x2112
                        
                        ip_parts = []
                        for i in range(4):
                            ip_parts.append(str(ip_bytes[i] ^ 0x21))
                        
                        self.public_ip = ".".join(ip_parts)
                        self.public_port = xor_port
                        
                        print(f"Public address discovered: {self.public_ip}:{self.public_port}")
                        stun_socket.close()
                        return True
                    
                    stun_socket.close()
                except Exception as e:
                    print(f"STUN request to {stun_server} failed: {e}")
                    continue
            
            retries += 1
            print(f"Retrying STUN request ({retries}/{max_retries})...")
        
        # Fallback: Use an external service to get just the IP
        try:
            response = requests.get("https://api.ipify.org")
            if response.status_code == 200:
                self.public_ip = response.text
                self.public_port = self.local_port  # Hope for the best
                print(f"Public IP discovered (port unknown): {self.public_ip}")
                print("Warning: NAT traversal may not work properly")
                return True
        except Exception as e:
            print(f"IP discovery failed: {e}")
        
        print("Failed to discover public address. Internet connectivity may be limited.")
        return False
    
    def register_with_bootstrap(self):
        """Register this node with bootstrap nodes for discovery."""
        data = {
            "user_id": self.user_id,
            "username": self.username,
            "ip": self.public_ip,
            "port": self.public_port,
            "pubkey": base64.b64encode(bytes(self.public_key)).decode('utf-8')
        }
        
        success = False
        for bootstrap_url in self.bootstrap_nodes:
            try:
                response = requests.post(bootstrap_url, json=data)
                if response.status_code == 200:
                    success = True
                    peer_list = response.json().get("peers", [])
                    self.update_peer_list(peer_list)
                    print(f"Registered with bootstrap node: {bootstrap_url}")
                else:
                    print(f"Failed to register with bootstrap node {bootstrap_url}: HTTP {response.status_code}")
            except Exception as e:
                print(f"Failed to register with bootstrap node {bootstrap_url}: {e}")
        
        return success
    
    def update_peer_list(self, peer_list):
        """Update the peer list from bootstrap nodes."""
        with self.lock:
            for peer in peer_list:
                if peer["user_id"] != self.user_id:
                    self.online_peers[peer["user_id"]] = {
                        "username": peer["username"],
                        "ip": peer["ip"],
                        "port": peer["port"],
                        "pubkey": peer["pubkey"],
                        "last_seen": time.time()
                    }
                    try:
                        peer_public_key = PublicKey(base64.b64decode(peer["pubkey"]))
                        self.peer_boxes[peer["user_id"]] = Box(self.private_key, peer_public_key)
                    except Exception as e:
                        print(f"Failed to create encryption box for peer {peer['username']}: {e}")
    
    def broadcast_presence(self, status="online"):
        """Broadcast presence to known peers."""
        message = {
            "type": "presence",
            "user_id": self.user_id,
            "username": self.username,
            "status": status,
            "pubkey": base64.b64encode(bytes(self.public_key)).decode('utf-8')
        }
        
        encoded_message = json.dumps(message).encode('utf-8')
        
        with self.lock:
            for peer_id, peer_info in list(self.online_peers.items()):
                try:
                    self.socket.sendto(encoded_message, (peer_info["ip"], peer_info["port"]))
                except Exception as e:
                    print(f"Failed to send presence to {peer_info['username']}: {e}")
    
    def listen_for_messages(self):
        """Listen for incoming messages from other users."""
        self.socket.settimeout(1)  # Set timeout for clean shutdown
        
        while self.running:
            try:
                data, addr = self.socket.recvfrom(4096)
                try:
                    message = json.loads(data.decode('utf-8'))
                    if message["type"] == "presence":
                        self.handle_presence_message(message, addr)
                    elif message["type"] == "ping":
                        self.socket.sendto(json.dumps({"type": "pong"}).encode('utf-8'), addr)
                except json.JSONDecodeError:
                    self.handle_encrypted_message(data, addr)
                except Exception as e:
                    print(f"Error processing message: {e}")
            except socket.timeout:
                continue
            except Exception as e:
                print(f"Socket error: {e}")
    
    def handle_presence_message(self, message, addr):
        """Handle presence messages from peers."""
        if message["user_id"] == self.user_id:
            return  # Ignore our own messages
        
        with self.lock:
            if message["status"] == "online":
                if (message["user_id"] not in self.online_peers or
                    self.online_peers[message["user_id"]]["ip"] != addr[0] or
                    self.online_peers[message["user_id"]]["port"] != addr[1]):
                    
                    self.online_peers[message["user_id"]] = {
                        "username": message["username"],
                        "ip": addr[0],
                        "port": addr[1],
                        "pubkey": message["pubkey"],
                        "last_seen": time.time()
                    }
                    
                    try:
                        peer_public_key = PublicKey(base64.b64decode(message["pubkey"]))
                        self.peer_boxes[message["user_id"]] = Box(self.private_key, peer_public_key)
                        
                        response = {
                            "type": "presence",
                            "user_id": self.user_id,
                            "username": self.username,
                            "status": "online",
                            "pubkey": base64.b64encode(bytes(self.public_key)).decode('utf-8')
                        }
                        self.socket.sendto(json.dumps(response).encode('utf-8'), (addr[0], addr[1]))
                        
                        print(f"\nNew user online: {message['username']}")
                        print("Enter username to message (or 'list' to see online users): ", end='', flush=True)
                    except Exception as e:
                        print(f"Failed to set up encryption for {message['username']}: {e}")
                else:
                    self.online_peers[message["user_id"]]["last_seen"] = time.time()
            
            elif message["status"] == "offline" and message["user_id"] in self.online_peers:
                username = self.online_peers[message["user_id"]]["username"]
                del self.online_peers[message["user_id"]]
                if message["user_id"] in self.peer_boxes:
                    del self.peer_boxes[message["user_id"]]
                
                print(f"\nUser offline: {username}")
                print("Enter username to message (or 'list' to see online users): ", end='', flush=True)
    
    def handle_encrypted_message(self, encrypted_data, addr):
        """Handle encrypted messages from peers."""
        sender_id = None
        with self.lock:
            for peer_id, peer_info in self.online_peers.items():
                if peer_info["ip"] == addr[0] and peer_info["port"] == addr[1]:
                    sender_id = peer_id
                    break
        
        if not sender_id or sender_id not in self.peer_boxes:
            return
        
        try:
            decrypted_data = self.peer_boxes[sender_id].decrypt(encrypted_data)
            message = json.loads(decrypted_data.decode('utf-8'))
            
            if message["type"] == "message" and message["to_user_id"] == self.user_id:
                timestamp = datetime.fromtimestamp(message["timestamp"]).strftime('%H:%M:%S')
                print(f"\n[{timestamp}] Message from {message['from_username']}: {message['content']}")
                print("Enter username to message (or 'list' to see online users): ", end='', flush=True)
                
                receipt = {
                    "type": "receipt",
                    "message_id": message["message_id"],
                    "status": "delivered"
                }
                encrypted_receipt = self.peer_boxes[sender_id].encrypt(json.dumps(receipt).encode('utf-8'))
                self.socket.sendto(encrypted_receipt, (addr[0], addr[1]))
            
            elif message["type"] == "receipt":
                for i, queued_msg in enumerate(self.message_queue):
                    if queued_msg["message_id"] == message["message_id"]:
                        print(f"\nMessage to {queued_msg['to_username']} was delivered.")
                        self.message_queue.pop(i)
                        break
        except Exception as e:
            print(f"Failed to process encrypted message: {e}")
    
    def send_message(self, to_username, content):
        """Send an encrypted message to another user."""
        recipient_id = None
        recipient_ip = None
        recipient_port = None
        
        with self.lock:
            for user_id, user_info in self.online_peers.items():
                if user_info["username"].lower() == to_username.lower():
                    recipient_id = user_id
                    recipient_ip = user_info["ip"]
                    recipient_port = user_info["port"]
                    break
        
        if not recipient_id or recipient_id not in self.peer_boxes:
            print(f"User '{to_username}' not found or offline.")
            return False
        
        message_id = str(uuid.uuid4())
        message = {
            "type": "message",
            "message_id": message_id,
            "from_user_id": self.user_id,
            "from_username": self.username,
            "to_user_id": recipient_id,
            "to_username": to_username,
            "content": content,
            "timestamp": time.time()
        }
        
        self.message_queue.append(message)
        
        try:
            encrypted_message = self.peer_boxes[recipient_id].encrypt(json.dumps(message).encode('utf-8'))
            self.socket.sendto(encrypted_message, (recipient_ip, recipient_port))
            return True
        except Exception as e:
            print(f"Failed to send message: {e}")
            return False
    
    def maintain_connections(self):
        """Periodically send pings to maintain NAT mappings."""
        while self.running:
            try:
                with self.lock:
                    for peer_id, peer_info in list(self.online_peers.items()):
                        try:
                            ping_message = {"type": "ping", "user_id": self.user_id}
                            self.socket.sendto(json.dumps(ping_message).encode('utf-8'), (peer_info["ip"], peer_info["port"]))
                        except Exception:
                            pass
                
                self.broadcast_presence()
                
                self.cleanup_peers()
                
                if time.time() % 300 < 10:  # Every ~5 minutes
                    self.register_with_bootstrap()
            except Exception as e:
                print(f"Error in connection maintenance: {e}")
            
            time.sleep(30)  # Run every 30 seconds
    
    def cleanup_peers(self):
        """Remove peers that haven't been seen for a while."""
        current_time = time.time()
        with self.lock:
            to_remove = []
            for peer_id, peer_info in self.online_peers.items():
                if current_time - peer_info["last_seen"] > 300:  # 5 minutes
                    to_remove.append(peer_id)
            
            for peer_id in to_remove:
                if peer_id in self.peer_boxes:
                    del self.peer_boxes[peer_id]
                del self.online_peers[peer_id]
    
    def display_online_users(self):
        """Display a list of currently online users."""
        with self.lock:
            if not self.online_peers:
                print("No users online.")
                return
            
            print("\nOnline users:")
            for peer_id, peer_info in self.online_peers.items():
                last_seen = int(time.time() - peer_info["last_seen"])
                print(f"  - {peer_info['username']} (last seen {last_seen} seconds ago)")
    
    def run(self):
        """Run the messenger application."""
        self.set_username()
        
        if not self.discover_public_address():
            print("Warning: Failed to determine public address, functionality may be limited.")
        
        self.register_with_bootstrap()
        
        threads = [
            threading.Thread(target=self.listen_for_messages, daemon=True),
            threading.Thread(target=self.maintain_connections, daemon=True)
        ]
        
        for thread in threads:
            thread.start()
        
        self.broadcast_presence()
        time.sleep(1)  # Give time for initial peer discovery
        
        try:
            while self.running:
                try:
                    command = input("\nEnter username to message (or 'list' to see online users): ").strip()
                    
                    if not command:
                        continue
                    
                    if command.lower() == 'list':
                        self.display_online_users()
                        continue
                    
                    if command.lower() == 'exit':
                        self.running = False
                        break
                    
                    recipient_exists = False
                    with self.lock:
                        for user_info in self.online_peers.values():
                            if user_info["username"].lower() == command.lower():
                                recipient_exists = True
                                break
                    
                    if not recipient_exists:
                        print(f"User '{command}' not found or offline. Use 'list' to see online users.")
                        continue
                    
                    message_content = input(f"Message to {command}: ").strip()
                    if not message_content:
                        print("Message cannot be empty.")
                        continue
                    
                    success = self.send_message(command, message_content)
                    if success:
                        timestamp = datetime.now().strftime('%H:%M:%S')
                        print(f"[{timestamp}] Message sent to {command}")
                
                except KeyboardInterrupt:
                    self.running = False
                    break
        
        finally:
            self.broadcast_presence(status="offline")
            print("Goodbye!")

if __name__ == "__main__":
    os.system('cls' if os.name == 'nt' else 'clear')
    
    print("=" * 60)
    print("    Internet-Ready P2P Encrypted Messaging Application")
    print("=" * 60)
    print("\nCommands:")
    print("  'list' - View online users")
    print("  'exit' - Exit the application")
    print("  <username> - Start messaging a user\n")
    
    messenger = InternetP2PMessenger()
    messenger.run()