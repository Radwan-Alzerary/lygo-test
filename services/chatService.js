const { ChatMessage, TypingIndicator } = require("../model/chat");
const Ride = require("../model/ride");

/**
 * خدمة الدردشة الشاملة للركاب والكباتن
 * Chat Service for comprehensive messaging between customers and drivers
 * 
 * @class ChatService
 * @version 1.0.0
 */
class ChatService {
  constructor(logger, redisClient = null) {
    this.logger = logger;
    this.redisClient = redisClient;
    
    // الرسائل السريعة المحددة مسبقاً
    this.quickMessages = {
      customer: [
        "أين أنت الآن؟",
        "كم من الوقت ستستغرق؟", 
        "هل يمكنك الاتصال بي؟",
        "سأنتظرك في المكان المحدد",
        "شكراً لك"
      ],
      driver: [
        "أنا في الطريق إليك",
        "وصلت إلى الموقع", 
        "سأتأخر قليلاً بسبب الزحمة",
        "هل يمكنك الخروج؟",
        "سأتصل بك الآن",
        "أحتاج إلى تعديل نقطة الالتقاء"
      ]
    };
    
    // إعدادات الخدمة
    this.settings = {
      maxMessageLength: 1000,
      messageCacheTime: 3600, // ساعة واحدة في Redis
      typingTimeout: 10000, // 10 ثواني
      maxMessagesPerRide: 1000,
      rateLimitPerMinute: 30 // 30 رسالة في الدقيقة
    };
    
    // معالجة معدل الإرسال
    this.rateLimitMap = new Map();
    
    this.logger.info('[ChatService] Chat service initialized successfully');
  }

  /**
   * إرسال رسالة دردشة جديدة
   * @param {Object} messageData - بيانات الرسالة
   * @returns {Object} الرسالة المحفوظة
   */
  async sendMessage(messageData) {
    try {
      const { 
        rideId, 
        senderId, 
        senderType, 
        text, 
        tempId, 
        isQuick = false,
        quickMessageType = null 
      } = messageData;

      // التحقق من صحة البيانات
      if (!rideId || !senderId || !senderType || !text) {
        throw new Error('Missing required message data');
      }

      // التحقق من معدل الإرسال
      if (!this.checkRateLimit(senderId)) {
        throw new Error('Rate limit exceeded. Please slow down.');
      }

      // التحقق من وجود الرحلة وحالتها
      const ride = await Ride.findById(rideId);
      if (!ride) {
        throw new Error('Ride not found');
      }

      // التحقق من أن المرسل جزء من الرحلة
      const isAuthorized = (
        (senderType === 'customer' && ride.customerId.toString() === senderId.toString()) ||
        (senderType === 'driver' && ride.driverId && ride.driverId.toString() === senderId.toString())
      );

      if (!isAuthorized) {
        throw new Error('Unauthorized to send message for this ride');
      }

      // إنشاء الرسالة
      const message = new ChatMessage({
        rideId,
        senderId,
        senderType,
        text: text.trim(),
        tempId,
        isQuick,
        metadata: {
          quickMessageType: isQuick ? quickMessageType : null
        }
      });

      // حفظ الرسالة
      const savedMessage = await message.save();

      // تخزين في Redis للوصول السريع
      if (this.redisClient) {
        await this.cacheMessage(savedMessage);
      }

      // تحديث آخر نشاط للرحلة
      await Ride.findByIdAndUpdate(rideId, {
        lastChatActivity: new Date()
      });

      this.logger.info(`[ChatService] Message sent successfully: ${savedMessage._id}`);
      
      return savedMessage;

    } catch (error) {
      this.logger.error('[ChatService] Error sending message:', error);
      throw error;
    }
  }

  /**
   * جلب تاريخ المحادثة لرحلة معينة
   * @param {string} rideId - معرف الرحلة
   * @param {number} limit - عدد الرسائل المطلوبة
   * @param {number} skip - عدد الرسائل المتجاوزة
   * @returns {Array} قائمة الرسائل
   */
  async getChatHistory(rideId, limit = 50, skip = 0) {
    try {
      // محاولة الحصول على الرسائل من Redis أولاً
      if (this.redisClient && skip === 0) {
        const cachedMessages = await this.getCachedMessages(rideId, limit);
        if (cachedMessages && cachedMessages.length > 0) {
          this.logger.debug(`[ChatService] Retrieved ${cachedMessages.length} messages from cache`);
          return cachedMessages;
        }
      }

      // الحصول على الرسائل من قاعدة البيانات
      const messages = await ChatMessage.find({ rideId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean()
        .exec();

      // عكس الترتيب لعرض الأقدم أولاً
      const sortedMessages = messages.reverse();

      // تخزين في Redis
      if (this.redisClient && skip === 0) {
        await this.cacheMessages(rideId, sortedMessages);
      }

      this.logger.debug(`[ChatService] Retrieved ${sortedMessages.length} messages for ride ${rideId}`);
      
      return sortedMessages;

    } catch (error) {
      this.logger.error('[ChatService] Error getting chat history:', error);
      throw error;
    }
  }

  /**
   * تحديد الرسائل كمقروءة
   * @param {string} rideId - معرف الرحلة
   * @param {Array} messageIds - معرفات الرسائل
   * @param {string} readerType - نوع القارئ
   * @returns {Object} نتيجة التحديث
   */
  async markMessagesAsRead(rideId, messageIds, readerType) {
    try {
      const result = await ChatMessage.markAsRead(rideId, messageIds, readerType);
      
      // إزالة الرسائل المقروءة من الكاش
      if (this.redisClient) {
        await this.updateCachedMessagesReadStatus(rideId, messageIds);
      }

      this.logger.debug(`[ChatService] Marked ${result.modifiedCount} messages as read`);
      
      return {
        success: true,
        modifiedCount: result.modifiedCount
      };

    } catch (error) {
      this.logger.error('[ChatService] Error marking messages as read:', error);
      throw error;
    }
  }

  /**
   * الحصول على عدد الرسائل غير المقروءة
   * @param {string} rideId - معرف الرحلة
   * @param {string} readerType - نوع القارئ
   * @returns {number} عدد الرسائل غير المقروءة
   */
  async getUnreadCount(rideId, readerType) {
    try {
      const count = await ChatMessage.getUnreadCount(rideId, readerType);
      return count;
    } catch (error) {
      this.logger.error('[ChatService] Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * إدارة مؤشر الكتابة
   * @param {Object} typingData - بيانات الكتابة
   * @returns {Object} حالة مؤشر الكتابة
   */
  async updateTypingIndicator(typingData) {
    try {
      const { rideId, userId, userType, isTyping } = typingData;

      if (isTyping) {
        // إنشاء أو تحديث مؤشر الكتابة
        await TypingIndicator.findOneAndUpdate(
          { rideId, userId, userType },
          { 
            rideId, 
            userId, 
            userType, 
            isTyping: true, 
            lastActivity: new Date() 
          },
          { upsert: true, new: true }
        );
      } else {
        // إزالة مؤشر الكتابة
        await TypingIndicator.findOneAndDelete({ rideId, userId, userType });
      }

      return { success: true, isTyping };

    } catch (error) {
      this.logger.error('[ChatService] Error updating typing indicator:', error);
      throw error;
    }
  }

  /**
   * الحصول على الرسائل السريعة
   * @param {string} userType - نوع المستخدم
   * @returns {Array} قائمة الرسائل السريعة
   */
  getQuickMessages(userType) {
    return this.quickMessages[userType] || [];
  }

  /**
   * الحصول على إحصائيات الدردشة لرحلة
   * @param {string} rideId - معرف الرحلة
   * @returns {Object} إحصائيات الدردشة
   */
  async getChatStats(rideId) {
    try {
      const stats = await ChatMessage.getChatStats(rideId);
      return stats;
    } catch (error) {
      this.logger.error('[ChatService] Error getting chat stats:', error);
      throw error;
    }
  }

  /**
   * تنظيف الرسائل القديمة
   * @param {number} daysOld - عدد الأيام للحذف
   * @returns {Object} نتيجة التنظيف
   */
  async cleanOldMessages(daysOld = 30) {
    try {
      const result = await ChatMessage.cleanOldMessages(daysOld);
      this.logger.info(`[ChatService] Cleaned ${result.deletedCount} old messages`);
      return result;
    } catch (error) {
      this.logger.error('[ChatService] Error cleaning old messages:', error);
      throw error;
    }
  }

  // ===============================
  // دوال المساعدة الخاصة
  // ===============================

  /**
   * فحص معدل الإرسال
   * @param {string} senderId - معرف المرسل
   * @returns {boolean} هل الإرسال مسموح
   */
  checkRateLimit(senderId) {
    const now = Date.now();
    const windowStart = now - 60000; // دقيقة واحدة
    
    if (!this.rateLimitMap.has(senderId)) {
      this.rateLimitMap.set(senderId, [now]);
      return true;
    }
    
    const timestamps = this.rateLimitMap.get(senderId);
    
    // إزالة الطوابع الزمنية القديمة
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    
    if (validTimestamps.length >= this.settings.rateLimitPerMinute) {
      return false;
    }
    
    validTimestamps.push(now);
    this.rateLimitMap.set(senderId, validTimestamps);
    
    return true;
  }

  /**
   * تخزين رسالة في Redis
   * @param {Object} message - الرسالة
   */
  async cacheMessage(message) {
    if (!this.redisClient) return;
    
    try {
      const cacheKey = `chat:${message.rideId}`;
      const messageData = JSON.stringify({
        _id: message._id,
        text: message.text,
        senderId: message.senderId,
        senderType: message.senderType,
        isQuick: message.isQuick,
        messageStatus: message.messageStatus,
        createdAt: message.createdAt,
        tempId: message.tempId
      });
      
      await this.redisClient.lpush(cacheKey, messageData);
      await this.redisClient.ltrim(cacheKey, 0, 99); // الاحتفاظ بآخر 100 رسالة
      await this.redisClient.expire(cacheKey, this.settings.messageCacheTime);
      
    } catch (error) {
      this.logger.warn('[ChatService] Failed to cache message:', error);
    }
  }

  /**
   * تخزين عدة رسائل في Redis
   * @param {string} rideId - معرف الرحلة
   * @param {Array} messages - الرسائل
   */
  async cacheMessages(rideId, messages) {
    if (!this.redisClient) return;
    
    try {
      const cacheKey = `chat:${rideId}`;
      
      if (messages.length === 0) return;
      
      const messageStrings = messages.map(msg => JSON.stringify({
        _id: msg._id,
        text: msg.text,
        senderId: msg.senderId,
        senderType: msg.senderType,
        isQuick: msg.isQuick,
        messageStatus: msg.messageStatus,
        createdAt: msg.createdAt,
        tempId: msg.tempId
      }));
      
      await this.redisClient.del(cacheKey);
      if (messageStrings.length > 0) {
        await this.redisClient.rpush(cacheKey, ...messageStrings);
        await this.redisClient.expire(cacheKey, this.settings.messageCacheTime);
      }
      
    } catch (error) {
      this.logger.warn('[ChatService] Failed to cache messages:', error);
    }
  }

  /**
   * الحصول على الرسائل المخزنة من Redis
   * @param {string} rideId - معرف الرحلة
   * @param {number} limit - عدد الرسائل
   * @returns {Array} الرسائل المخزنة
   */
  async getCachedMessages(rideId, limit) {
    if (!this.redisClient) return null;
    
    try {
      const cacheKey = `chat:${rideId}`;
      const cachedData = await this.redisClient.lrange(cacheKey, 0, limit - 1);
      
      if (!cachedData || cachedData.length === 0) return null;
      
      return cachedData.map(data => JSON.parse(data));
      
    } catch (error) {
      this.logger.warn('[ChatService] Failed to get cached messages:', error);
      return null;
    }
  }

  /**
   * تحديث حالة القراءة في الكاش
   * @param {string} rideId - معرف الرحلة
   * @param {Array} messageIds - معرفات الرسائل
   */
  async updateCachedMessagesReadStatus(rideId, messageIds) {
    if (!this.redisClient) return;
    
    try {
      // إعادة تحميل الرسائل من قاعدة البيانات وتحديث الكاش
      const messages = await this.getChatHistory(rideId, 50, 0);
      await this.cacheMessages(rideId, messages);
      
    } catch (error) {
      this.logger.warn('[ChatService] Failed to update cached message read status:', error);
    }
  }
}

module.exports = ChatService;
