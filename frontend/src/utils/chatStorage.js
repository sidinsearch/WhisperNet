// Chat history storage utilities

// Save chat history for a specific user
export const saveChatHistory = (currentUser, recipient, messages) => {
  try {
    // Create a unique key for this chat
    const chatKey = `whispernetChat_${currentUser}_${recipient}`;
    
    // Save only the last 100 messages to prevent localStorage from getting too large
    const messagesToSave = messages.slice(-100);
    
    // Store the messages
    localStorage.setItem(chatKey, JSON.stringify(messagesToSave));
    
    // Update the list of active chats for this user
    updateActiveChats(currentUser, recipient);
    
    return true;
  } catch (error) {
    console.error('Error saving chat history:', error);
    return false;
  }
};

// Load chat history for a specific user
export const loadChatHistory = (currentUser, recipient) => {
  try {
    // Create a unique key for this chat
    const chatKey = `whispernetChat_${currentUser}_${recipient}`;
    
    // Get the stored messages
    const storedMessages = localStorage.getItem(chatKey);
    
    if (storedMessages) {
      return JSON.parse(storedMessages);
    }
    
    return [];
  } catch (error) {
    console.error('Error loading chat history:', error);
    return [];
  }
};

// Get all active chats for the current user
export const getActiveChats = (currentUser) => {
  try {
    const activeChatsKey = `whispernetActiveChats_${currentUser}`;
    const storedChats = localStorage.getItem(activeChatsKey);
    
    if (storedChats) {
      return JSON.parse(storedChats);
    }
    
    return [];
  } catch (error) {
    console.error('Error getting active chats:', error);
    return [];
  }
};

// Update the list of active chats for the current user
export const updateActiveChats = (currentUser, recipient) => {
  try {
    const activeChatsKey = `whispernetActiveChats_${currentUser}`;
    let activeChats = getActiveChats(currentUser);
    
    // Add the recipient if not already in the list
    if (!activeChats.includes(recipient)) {
      activeChats.push(recipient);
      localStorage.setItem(activeChatsKey, JSON.stringify(activeChats));
    }
    
    return true;
  } catch (error) {
    console.error('Error updating active chats:', error);
    return false;
  }
};

// Clear chat history for a specific user
export const clearChatHistory = (currentUser, recipient) => {
  try {
    // Create a unique key for this chat
    const chatKey = `whispernetChat_${currentUser}_${recipient}`;
    
    // Remove the stored messages
    localStorage.removeItem(chatKey);
    
    return true;
  } catch (error) {
    console.error('Error clearing chat history:', error);
    return false;
  }
};

// Clear all chat history for the current user
export const clearAllChatHistory = (currentUser) => {
  try {
    // Get all active chats
    const activeChats = getActiveChats(currentUser);
    
    // Clear each chat
    activeChats.forEach(recipient => {
      clearChatHistory(currentUser, recipient);
    });
    
    // Clear the active chats list
    localStorage.removeItem(`whispernetActiveChats_${currentUser}`);
    
    // Clear unread counts
    localStorage.removeItem(`whispernetUnreadCounts_${currentUser}`);
    
    return true;
  } catch (error) {
    console.error('Error clearing all chat history:', error);
    return false;
  }
};

// Save unread message counts
export const saveUnreadCounts = (currentUser, unreadCounts) => {
  try {
    const unreadCountsKey = `whispernetUnreadCounts_${currentUser}`;
    localStorage.setItem(unreadCountsKey, JSON.stringify(unreadCounts));
    return true;
  } catch (error) {
    console.error('Error saving unread counts:', error);
    return false;
  }
};

// Load unread message counts
export const loadUnreadCounts = (currentUser) => {
  try {
    const unreadCountsKey = `whispernetUnreadCounts_${currentUser}`;
    const storedCounts = localStorage.getItem(unreadCountsKey);
    
    if (storedCounts) {
      return JSON.parse(storedCounts);
    }
    
    return {};
  } catch (error) {
    console.error('Error loading unread counts:', error);
    return {};
  }
};

// Reset unread count for a specific user
export const resetUnreadCount = (currentUser, recipient) => {
  try {
    const unreadCountsKey = `whispernetUnreadCounts_${currentUser}`;
    const unreadCounts = loadUnreadCounts(currentUser);
    
    // Reset the count for this recipient
    unreadCounts[recipient] = 0;
    
    // Save the updated counts
    localStorage.setItem(unreadCountsKey, JSON.stringify(unreadCounts));
    
    return true;
  } catch (error) {
    console.error('Error resetting unread count:', error);
    return false;
  }
};

// Increment unread count for a specific user
export const incrementUnreadCount = (currentUser, sender) => {
  try {
    const unreadCountsKey = `whispernetUnreadCounts_${currentUser}`;
    const unreadCounts = loadUnreadCounts(currentUser);
    
    // Increment the count for this sender
    unreadCounts[sender] = (unreadCounts[sender] || 0) + 1;
    
    // Save the updated counts
    localStorage.setItem(unreadCountsKey, JSON.stringify(unreadCounts));
    
    return true;
  } catch (error) {
    console.error('Error incrementing unread count:', error);
    return false;
  }
};