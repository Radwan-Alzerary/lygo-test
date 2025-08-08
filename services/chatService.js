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
    const startTime = Date.now();
    const debugId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
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

      // تسجيل بداية معالجة الرسالة
      this.logger.info(`[ChatService] [${debugId}] Starting message processing`, {
        rideId,
        senderId,
        senderType,
        messageLength: text?.length || 0,
        tempId,
        isQuick,
        quickMessageType,
        timestamp: new Date().toISOString()
      });

      // التحقق من صحة البيانات
      if (!rideId || !senderId || !senderType || !text) {
        this.logger.error(`[ChatService] [${debugId}] Missing required data`, {
          hasRideId: !!rideId,
          hasSenderId: !!senderId,
          hasSenderType: !!senderType,
          hasText: !!text
        });
        throw new Error('Missing required message data');
      }

      // التحقق من معدل الإرسال
      const rateLimitCheck = this.checkRateLimit(senderId);
      this.logger.debug(`[ChatService] [${debugId}] Rate limit check`, {
        senderId,
        passed: rateLimitCheck,
        currentRate: this.getUserMessageCount(senderId)
      });

      if (!rateLimitCheck) {
        this.logger.warn(`[ChatService] [${debugId}] Rate limit exceeded for sender`, {
          senderId,
          senderType,
          currentRate: this.getUserMessageCount(senderId)
        });
        throw new Error('Rate limit exceeded. Please slow down.');
      }

      // التحقق من وجود الرحلة وحالتها
      this.logger.debug(`[ChatService] [${debugId}] Checking ride existence`, { rideId });
      const ride = await Ride.findById(rideId);
      
      if (!ride) {
        this.logger.error(`[ChatService] [${debugId}] Ride not found`, { rideId });
        throw new Error('Ride not found');
      }

      this.logger.debug(`[ChatService] [${debugId}] Ride found`, {
        rideId,
        rideStatus: ride.status,
        passenger: ride.passenger?.toString(),
        driver: ride.driver?.toString(),
        createdAt: ride.createdAt
      });

      // التحقق من أن المرسل جزء من الرحلة
      const isAuthorized = (
        (senderType === 'customer' && ride.passenger && ride.passenger.toString() === senderId.toString()) ||
        (senderType === 'driver' && ride.driver && ride.driver.toString() === senderId.toString())
      );

      this.logger.debug(`[ChatService] [${debugId}] Authorization check`, {
        senderId,
        senderType,
        isAuthorized,
        ridePassenger: ride.passenger?.toString(),
        rideDriver: ride.driver?.toString(),
        isCustomerMatch: senderType === 'customer' && ride.passenger && ride.passenger.toString() === senderId.toString(),
        isDriverMatch: senderType === 'driver' && ride.driver && ride.driver.toString() === senderId.toString()
      });

      if (!isAuthorized) {
        this.logger.error(`[ChatService] [${debugId}] Unauthorized message attempt`, {
          senderId,
          senderType,
          rideId,
          ridePassenger: ride.passenger?.toString(),
          rideDriver: ride.driver?.toString()
        });
        throw new Error('Unauthorized to send message for this ride');
      }

      // إنشاء الرسالة
      this.logger.debug(`[ChatService] [${debugId}] Creating message object`, {
        rideId,
        senderId,
        senderType,
        textLength: text.trim().length,
        tempId,
        isQuick
      });

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
      this.logger.debug(`[ChatService] [${debugId}] Saving message to database`);
      const savedMessage = await message.save();
      
      this.logger.info(`[ChatService] [${debugId}] Message saved successfully`, {
        messageId: savedMessage._id.toString(),
        rideId,
        senderId,
        senderType,
        createdAt: savedMessage.createdAt,
        processingTime: Date.now() - startTime + 'ms'
      });

      // تخزين في Redis للوصول السريع
      if (this.redisClient && typeof this.redisClient.lpush === 'function') {
        try {
          this.logger.debug(`[ChatService] [${debugId}] Caching message in Redis`);
          await this.cacheMessage(savedMessage);
          this.logger.debug(`[ChatService] [${debugId}] Message cached successfully`);
        } catch (redisError) {
          this.logger.warn(`[ChatService] [${debugId}] Redis caching failed`, {
            error: redisError.message,
            messageId: savedMessage._id.toString()
          });
        }
      } else {
        this.logger.debug(`[ChatService] [${debugId}] Redis client not available, skipping cache`);
      }

      // تحديث آخر نشاط للرحلة
      this.logger.debug(`[ChatService] [${debugId}] Updating ride last activity`);
      await Ride.findByIdAndUpdate(rideId, {
        lastChatActivity: new Date()
      });

      const finalProcessingTime = Date.now() - startTime;
      this.logger.info(`[ChatService] [${debugId}] Message processing completed successfully`, {
        messageId: savedMessage._id.toString(),
        totalTime: finalProcessingTime + 'ms',
        rideId,
        senderId,
        senderType,
        success: true
      });
      
      return savedMessage;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`[ChatService] [${debugId}] Error sending message`, {
        error: error.message,
        stack: error.stack,
        processingTime: processingTime + 'ms',
        messageData: {
          rideId: messageData.rideId,
          senderId: messageData.senderId,
          senderType: messageData.senderType,
          textLength: messageData.text?.length || 0,
          tempId: messageData.tempId,
          isQuick: messageData.isQuick
        },
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Helper method to get user message count for rate limiting
   * @private
   */
  getUserMessageCount(senderId) {
    const userKey = `rate_limit_${senderId}`;
    return this.rateLimitMap.get(userKey) || 0;
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
    // التحقق من وجود Redis client والدوال المطلوبة
    if (!this.redisClient || typeof this.redisClient.lpush !== 'function') {
      this.logger.debug('[ChatService] Redis client not available or lpush function missing, skipping cache');
      return;
    }
    
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
    // التحقق من وجود Redis client والدوال المطلوبة
    if (!this.redisClient || typeof this.redisClient.lpush !== 'function') {
      this.logger.debug('[ChatService] Redis client not available for batch caching, skipping cache');
      return;
    }
    
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
    // التحقق من وجود Redis client والدوال المطلوبة
    if (!this.redisClient || typeof this.redisClient.lrange !== 'function') {
      this.logger.debug('[ChatService] Redis client not available for message retrieval');
      return null;
    }
    
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
