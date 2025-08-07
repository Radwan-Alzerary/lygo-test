const express = require('express');
const router = express.Router();

/**
 * Chat API Routes
 * RESTful endpoints for chat functionality
 * 
 * @version 1.0.0
 */

/**
 * @route GET /api/chat/history/:rideId
 * @desc Get chat history for a specific ride
 * @access Private (authenticated users only)
 * @param {string} rideId - The ride ID
 * @param {number} limit - Number of messages to retrieve (default: 50)
 * @param {number} skip - Number of messages to skip (default: 0)
 */
router.get('/history/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params;
    const { limit = 50, skip = 0 } = req.query;
    const { userId, userType } = req.user; // Assuming authentication middleware provides this

    // Validate parameters
    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID is required'
      });
    }

    // Get chat service from request object (injected by middleware)
    const chatService = req.chatService;
    
    if (!chatService) {
      return res.status(500).json({
        success: false,
        message: 'Chat service not available'
      });
    }

    // Get chat history
    const messages = await chatService.getChatHistory(rideId, parseInt(limit), parseInt(skip));
    const unreadCount = await chatService.getUnreadCount(rideId, userType);

    res.json({
      success: true,
      data: {
        messages,
        unreadCount,
        pagination: {
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: messages.length === parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Error getting chat history:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get chat history'
    });
  }
});

/**
 * @route POST /api/chat/send
 * @desc Send a chat message
 * @access Private (authenticated users only)
 * @body {string} rideId - The ride ID
 * @body {string} text - Message text
 * @body {boolean} isQuick - Whether it's a quick message
 * @body {string} quickMessageType - Type of quick message
 */
router.post('/send', async (req, res) => {
  try {
    const { rideId, text, isQuick = false, quickMessageType = null } = req.body;
    const { userId, userType } = req.user; // From authentication middleware

    // Validate required fields
    if (!rideId || !text) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID and text are required'
      });
    }

    // Get chat service
    const chatService = req.chatService;
    
    if (!chatService) {
      return res.status(500).json({
        success: false,
        message: 'Chat service not available'
      });
    }

    // Send message
    const message = await chatService.sendMessage({
      rideId,
      senderId: userId,
      senderType: userType === 'customer' ? 'customer' : 'driver',
      text: text.trim(),
      isQuick,
      quickMessageType
    });

    res.status(201).json({
      success: true,
      data: {
        messageId: message._id,
        rideId: message.rideId,
        text: message.text,
        senderId: message.senderId,
        senderType: message.senderType,
        isQuick: message.isQuick,
        timestamp: message.createdAt,
        messageStatus: message.messageStatus
      }
    });

  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send message'
    });
  }
});

/**
 * @route PUT /api/chat/read
 * @desc Mark messages as read
 * @access Private (authenticated users only)
 * @body {string} rideId - The ride ID
 * @body {Array} messageIds - Array of message IDs to mark as read
 */
router.put('/read', async (req, res) => {
  try {
    const { rideId, messageIds } = req.body;
    const { userType } = req.user;

    // Validate required fields
    if (!rideId || !messageIds || !Array.isArray(messageIds)) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID and message IDs array are required'
      });
    }

    // Get chat service
    const chatService = req.chatService;
    
    if (!chatService) {
      return res.status(500).json({
        success: false,
        message: 'Chat service not available'
      });
    }

    // Mark messages as read
    const result = await chatService.markMessagesAsRead(
      rideId, 
      messageIds, 
      userType === 'customer' ? 'customer' : 'driver'
    );

    res.json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount
      }
    });

  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to mark messages as read'
    });
  }
});

/**
 * @route GET /api/chat/quick-messages/:userType
 * @desc Get quick messages for a user type
 * @access Private (authenticated users only)
 * @param {string} userType - Either 'customer' or 'driver'
 */
router.get('/quick-messages/:userType', (req, res) => {
  try {
    const { userType } = req.params;

    // Validate user type
    if (!['customer', 'driver'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'User type must be either "customer" or "driver"'
      });
    }

    // Get chat service
    const chatService = req.chatService;
    
    if (!chatService) {
      return res.status(500).json({
        success: false,
        message: 'Chat service not available'
      });
    }

    // Get quick messages
    const quickMessages = chatService.getQuickMessages(userType);

    res.json({
      success: true,
      data: {
        userType,
        messages: quickMessages
      }
    });

  } catch (error) {
    console.error('Error getting quick messages:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get quick messages'
    });
  }
});

/**
 * @route GET /api/chat/stats/:rideId
 * @desc Get chat statistics for a ride
 * @access Private (authenticated users only)
 * @param {string} rideId - The ride ID
 */
router.get('/stats/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params;

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID is required'
      });
    }

    // Get chat service
    const chatService = req.chatService;
    
    if (!chatService) {
      return res.status(500).json({
        success: false,
        message: 'Chat service not available'
      });
    }

    // Get chat statistics
    const stats = await chatService.getChatStats(rideId);

    res.json({
      success: true,
      data: {
        rideId,
        stats
      }
    });

  } catch (error) {
    console.error('Error getting chat stats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get chat statistics'
    });
  }
});

/**
 * @route GET /api/chat/unread/:rideId
 * @desc Get unread message count for a ride
 * @access Private (authenticated users only)
 * @param {string} rideId - The ride ID
 */
router.get('/unread/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params;
    const { userType } = req.user;

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID is required'
      });
    }

    // Get chat service
    const chatService = req.chatService;
    
    if (!chatService) {
      return res.status(500).json({
        success: false,
        message: 'Chat service not available'
      });
    }

    // Get unread count
    const unreadCount = await chatService.getUnreadCount(
      rideId, 
      userType === 'customer' ? 'customer' : 'driver'
    );

    res.json({
      success: true,
      data: {
        rideId,
        unreadCount
      }
    });

  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get unread count'
    });
  }
});

module.exports = router;
