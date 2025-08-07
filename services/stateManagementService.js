const UserSavedState = require('../model/userSavedState');
const Ride = require('../model/ride');

/**
 * State Management Service
 * خدمة إدارة حفظ واستعادة الحالة للمستخدمين
 */
class StateManagementService {
  constructor(logger, redisClient = null) {
    this.logger = logger;
    this.redisClient = redisClient;
    
    // تشغيل تنظيف دوري للحالات المنتهية الصلاحية كل 6 ساعات
    this.startCleanupInterval();
    
    this.logger.info('[StateManagementService] State management service initialized');
  }

  /**
   * حفظ حالة المستخدم
   * @param {string} userId - معرف المستخدم
   * @param {Object} stateData - بيانات الحالة
   * @returns {Promise<Object>} - نتيجة الحفظ
   */
  async saveUserState(userId, stateData) {
    try {
      const { type, state, sessionInfo } = stateData;

      this.logger.info(`[StateManagement] Saving ${type} state for user ${userId}`);

      // التحقق من صحة البيانات
      if (!type || !state) {
        throw new Error('Type and state are required');
      }

      // حفظ في قاعدة البيانات
      const savedState = await UserSavedState.saveUserState(
        userId,
        type,
        state,
        sessionInfo
      );

      // حفظ في Redis إن كان متوفراً (للوصول السريع)
      if (this.redisClient) {
        try {
          const cacheKey = `user_state:${userId}:${type}`;
          await this.redisClient.setEx(
            cacheKey, 
            24 * 60 * 60, // 24 ساعة
            JSON.stringify({
              state,
              timestamp: savedState.timestamp,
              expiryDate: savedState.expiryDate
            })
          );
          this.logger.debug(`[StateManagement] Cached state in Redis: ${cacheKey}`);
        } catch (redisError) {
          this.logger.warn('[StateManagement] Redis cache failed, continuing without cache:', redisError.message);
        }
      }

      this.logger.info(`[StateManagement] Successfully saved ${type} state for user ${userId}`);

      return {
        success: true,
        message: 'تم حفظ الحالة بنجاح',
        data: {
          id: savedState._id,
          type: savedState.type,
          timestamp: savedState.timestamp,
          expiryDate: savedState.expiryDate
        }
      };

    } catch (error) {
      this.logger.error(`[StateManagement] Error saving state for user ${userId}:`, error);
      return {
        success: false,
        error: error.message,
        message: 'فشل في حفظ الحالة'
      };
    }
  }

  /**
   * استعادة حالة المستخدم
   * @param {string} userId - معرف المستخدم
   * @param {string} type - نوع الحالة (اختياري)
   * @returns {Promise<Object>} - الحالة المسترجعة
   */
  async restoreUserState(userId, type = null) {
    try {
      this.logger.info(`[StateManagement] Restoring ${type || 'any'} state for user ${userId}`);

      let savedState = null;

      // محاولة الاسترجاع من Redis أولاً إن كان متوفراً
      if (this.redisClient && type) {
        try {
          const cacheKey = `user_state:${userId}:${type}`;
          const cachedData = await this.redisClient.get(cacheKey);
          
          if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            this.logger.debug(`[StateManagement] Found cached state in Redis: ${cacheKey}`);
            
            return {
              success: true,
              data: {
                userId,
                type,
                state: parsedData.state,
                timestamp: parsedData.timestamp,
                source: 'redis_cache'
              }
            };
          }
        } catch (redisError) {
          this.logger.warn('[StateManagement] Redis retrieval failed, falling back to database:', redisError.message);
        }
      }

      // الاسترجاع من قاعدة البيانات
      if (type) {
        savedState = await UserSavedState.findOne({
          userId,
          type,
          expiryDate: { $gt: new Date() }
        }).sort({ timestamp: -1 });
      } else {
        const savedStates = await UserSavedState.findByUser(userId);
        savedState = savedStates.length > 0 ? savedStates[0] : null;
      }

      if (savedState) {
        this.logger.info(`[StateManagement] Found saved state: ${savedState.type} for user ${userId}`);
        
        // تحديث cache في Redis إن كان متوفراً
        if (this.redisClient) {
          try {
            const cacheKey = `user_state:${userId}:${savedState.type}`;
            await this.redisClient.setEx(
              cacheKey,
              24 * 60 * 60,
              JSON.stringify({
                state: savedState.state,
                timestamp: savedState.timestamp,
                expiryDate: savedState.expiryDate
              })
            );
          } catch (redisError) {
            this.logger.warn('[StateManagement] Redis cache update failed:', redisError.message);
          }
        }

        return {
          success: true,
          data: savedState.toClientJSON(),
          source: 'database'
        };
      } else {
        this.logger.info(`[StateManagement] No saved state found for user ${userId}`);
        return {
          success: false,
          message: 'لا توجد حالة محفوظة',
          reason: 'no_saved_state'
        };
      }

    } catch (error) {
      this.logger.error(`[StateManagement] Error restoring state for user ${userId}:`, error);
      return {
        success: false,
        error: error.message,
        message: 'فشل في استرجاع الحالة'
      };
    }
  }

  /**
   * مسح الحالات المحفوظة للمستخدم
   * @param {string} userId - معرف المستخدم
   * @param {string} type - نوع الحالة (اختياري)
   * @returns {Promise<Object>} - نتيجة المسح
   */
  async clearUserSavedState(userId, type = null) {
    try {
      this.logger.info(`[StateManagement] Clearing ${type || 'all'} saved state(s) for user ${userId}`);

      // مسح من قاعدة البيانات
      const result = await UserSavedState.clearUserStates(userId, type);

      // مسح من Redis إن كان متوفراً
      if (this.redisClient) {
        try {
          if (type) {
            const cacheKey = `user_state:${userId}:${type}`;
            await this.redisClient.del(cacheKey);
            this.logger.debug(`[StateManagement] Cleared Redis cache: ${cacheKey}`);
          } else {
            // مسح جميع أنواع الحالات
            const pattern = `user_state:${userId}:*`;
            const keys = await this.redisClient.keys(pattern);
            if (keys.length > 0) {
              await this.redisClient.del(keys);
              this.logger.debug(`[StateManagement] Cleared ${keys.length} Redis cache entries`);
            }
          }
        } catch (redisError) {
          this.logger.warn('[StateManagement] Redis cache clearing failed:', redisError.message);
        }
      }

      this.logger.info(`[StateManagement] Successfully cleared ${result.deletedCount} saved state(s) for user ${userId}`);

      return {
        success: true,
        message: 'تم مسح الحالة المحفوظة',
        deletedCount: result.deletedCount
      };

    } catch (error) {
      this.logger.error(`[StateManagement] Error clearing saved state for user ${userId}:`, error);
      return {
        success: false,
        error: error.message,
        message: 'فشل في مسح الحالة المحفوظة'
      };
    }
  }

  /**
   * استرجاع رحلة نشطة للمستخدم
   * @param {string} userId - معرف المستخدم
   * @returns {Promise<Object>} - الرحلة النشطة
   */
  async getActiveRide(userId) {
    try {
      const activeRide = await Ride.findOne({
        passenger: userId,
        status: { $in: ['requested', 'accepted', 'arrived', 'onRide'] }
      }).populate('driver', 'name phoneNumber carDetails imageUrl');

      return activeRide;
    } catch (error) {
      this.logger.error(`[StateManagement] Error getting active ride for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * التحقق من صحة أكواد الخصم
   * @param {Object} promoData - بيانات كود الخصم
   * @returns {Promise<Object>} - نتيجة التحقق
   */
  async validatePromoCode(promoData) {
    try {
      const { promoCode, userId, estimatedFare } = promoData;

      // هنا يمكن إضافة منطق التحقق من أكواد الخصم
      // للآن سنستخدم كود تجريبي بسيط
      
      const validPromoCodes = {
        'LYGO10': { discount: 10, type: 'percentage', maxUse: 100, usedCount: 0 },
        'WELCOME20': { discount: 20, type: 'percentage', maxUse: 1, usedCount: 0, firstTimeOnly: true },
        'SAVE5000': { discount: 5000, type: 'fixed', maxUse: 50, usedCount: 10 }
      };

      const promo = validPromoCodes[promoCode];

      if (!promo) {
        return {
          isValid: false,
          reason: 'كود الخصم غير صحيح'
        };
      }

      if (promo.usedCount >= promo.maxUse) {
        return {
          isValid: false,
          reason: 'انتهى عدد مرات استخدام هذا الكود'
        };
      }

      let discount = 0;
      let newFare = estimatedFare;

      if (promo.type === 'percentage') {
        discount = (estimatedFare * promo.discount) / 100;
        newFare = estimatedFare - discount;
      } else if (promo.type === 'fixed') {
        discount = Math.min(promo.discount, estimatedFare);
        newFare = estimatedFare - discount;
      }

      // تأكد من عدم جعل التكلفة سالبة
      newFare = Math.max(newFare, 0);

      return {
        isValid: true,
        discount: discount,
        newFare: newFare,
        promoType: promo.type,
        message: `تم تطبيق خصم ${promo.type === 'percentage' ? promo.discount + '%' : promo.discount + ' دينار'}`
      };

    } catch (error) {
      this.logger.error('[StateManagement] Error validating promo code:', error);
      return {
        isValid: false,
        reason: 'خطأ في النظام'
      };
    }
  }

  /**
   * تنظيف الحالات المنتهية الصلاحية
   * @returns {Promise<number>} - عدد الحالات المحذوفة
   */
  async cleanupExpiredStates() {
    try {
      this.logger.info('[StateManagement] Starting cleanup of expired states...');
      
      const result = await UserSavedState.cleanupExpired();
      
      if (result.deletedCount > 0) {
        this.logger.info(`[StateManagement] Cleaned up ${result.deletedCount} expired state(s)`);
      }

      return result.deletedCount;
    } catch (error) {
      this.logger.error('[StateManagement] Error during cleanup:', error);
      return 0;
    }
  }

  /**
   * بدء التنظيف الدوري
   */
  startCleanupInterval() {
    // تنظيف كل 6 ساعات
    const cleanupInterval = 6 * 60 * 60 * 1000; // 6 ساعات بالميلي ثانية

    setInterval(async () => {
      await this.cleanupExpiredStates();
    }, cleanupInterval);

    this.logger.info('[StateManagement] Cleanup interval started (every 6 hours)');
  }

  /**
   * الحصول على إحصائيات الحالات المحفوظة
   * @returns {Promise<Object>} - الإحصائيات
   */
  async getStateStatistics() {
    try {
      const stats = await UserSavedState.aggregate([
        {
          $match: {
            expiryDate: { $gt: new Date() }
          }
        },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            latestTimestamp: { $max: '$timestamp' }
          }
        },
        {
          $sort: { count: -1 }
        }
      ]);

      const totalStates = await UserSavedState.countDocuments({
        expiryDate: { $gt: new Date() }
      });

      const expiredStates = await UserSavedState.countDocuments({
        expiryDate: { $lte: new Date() }
      });

      return {
        totalActiveStates: totalStates,
        expiredStates,
        statesByType: stats,
        cacheStatus: this.redisClient ? 'enabled' : 'disabled'
      };
    } catch (error) {
      this.logger.error('[StateManagement] Error getting statistics:', error);
      return null;
    }
  }
}

module.exports = StateManagementService;
