// netlify/functions/bootstrap.js

// In-memory peer storage (note: this will reset whenever the function cold-starts)
// For production, you'd want to use a database like FaunaDB, DynamoDB, etc.
// Netlify has integrations with several database providers
let peers = {};

// Function to clean up old peers
function cleanupPeers() {
  const currentTime = Date.now() / 1000;
  const peersToKeep = {};
  
  Object.entries(peers).forEach(([userId, peerInfo]) => {
    // Keep peers seen in the last 10 minutes
    if (currentTime - peerInfo.lastSeen < 600) {
      peersToKeep[userId] = peerInfo;
    }
  });
  
  peers = peersToKeep;
}

exports.handler = async function(event, context) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  try {
    // Parse the request body
    const peerData = JSON.parse(event.body);
    
    // Validate required fields
    if (!peerData.user_id || !peerData.username || !peerData.ip || !peerData.port || !peerData.pubkey) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required peer information' })
      };
    }
    
    // Add/update peer information
    peers[peerData.user_id] = {
      username: peerData.username,
      ip: peerData.ip,
      port: peerData.port,
      pubkey: peerData.pubkey,
      lastSeen: Date.now() / 1000
    };
    
    // Clean up old peers
    cleanupPeers();
    
    // Return the list of known peers
    const peerList = Object.entries(peers).map(([userId, info]) => ({
      user_id: userId,
      username: info.username,
      ip: info.ip,
      port: info.port,
      pubkey: info.pubkey
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'  // CORS header to allow requests from any domain
      },
      body: JSON.stringify({ peers: peerList })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};