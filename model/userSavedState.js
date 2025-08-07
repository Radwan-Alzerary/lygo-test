const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * User Saved State Schema
 * لحفظ حالة المستخدم المؤقتة (تخطيط رحلة، حالة رحلة نشطة)
 */
const UserSavedStateSchema = new Schema(
  {
    // معرف المستخدم الفريد
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // نوع الحالة المحفوظة
    type: {
      type: String,
      enum: ["ride_state_backup", "trip_planning_backup"],
      required: true,
      index: true
    },

    // بيانات الحالة المحفوظة (JSON مرن)
    state: {
      // معرف الرحلة (إن وجد)
      rideId: {
        type: Schema.Types.ObjectId,
        ref: "Ride"
      },
      
      // حالة الرحلة
      rideStatus: {
        type: String,
        enum: ["requested", "accepted", "arrived", "onRide", "completed", "cancelled", "notApprove"]
      },

      // نقطة الانطلاق
      origin: {
        latitude: Number,
        longitude: Number,
        locationName: String
      },

      // نقطة الوصول
      destination: {
        latitude: Number,
        longitude: Number,
        locationName: String
      },

      // النقاط المتوسطة
      waypoints: [{
        latitude: Number,
        longitude: Number,
        locationName: String,
        order: Number
      }],

      // نوع السيارة المحدد
      selectedCarType: {
        type: String,
        default: "standard"
      },

      // تقدير التكلفة
      estimatedFare: {
        amount: Number,
        currency: String,
        breakdown: Schema.Types.Mixed
      },

      // معلومات الكابتن (إن وجد)
      captainInfo: {
        id: Schema.Types.ObjectId,
        name: String,
        phoneNumber: String,
        imageUrl: String,
        vehicle: {
          model: String,
          color: String,
          licensePlate: String
        }
      },

      // الوقت المجدول
      scheduledTime: Date,

      // رحلة ذهاب وعودة
      roundTrip: {
        type: Boolean,
        default: false
      },

      // كود الخصم
      promoCode: String,

      // مقدار الخصم
      discount: {
        amount: Number,
        percentage: Number
      },

      // اختيار موقع السفر
      travelLocationSelect: String,

      // طريقة الدفع
      paymentMethod: {
        type: String,
        enum: ["cash", "wallet", "card"],
        default: "cash"
      },

      // المسافة والمدة
      distance: Number,
      duration: Number,

      // بيانات إضافية مرنة
      additionalData: Schema.Types.Mixed
    },

    // تاريخ الحفظ
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },

    // تاريخ انتهاء الصلاحية (24 ساعة افتراضياً)
    expiryDate: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 ساعة
      index: { expireAfterSeconds: 0 } // MongoDB TTL index
    },

    // معلومات الجلسة
    sessionInfo: {
      socketId: String,
      userAgent: String,
      ipAddress: String,
      lastActivity: Date
    }
  },
  {
    timestamps: true,
    collection: "userSavedStates"
  }
);

// Compound indexes لتحسين الأداء
UserSavedStateSchema.index({ userId: 1, type: 1 }, { unique: true }); // مستخدم واحد لكل نوع
UserSavedStateSchema.index({ expiryDate: 1 }); // للتنظيف التلقائي
UserSavedStateSchema.index({ "state.rideId": 1 }); // للبحث بمعرف الرحلة
UserSavedStateSchema.index({ timestamp: -1 }); // للترتيب حسب التاريخ

// Virtual للتحقق من انتهاء الصلاحية
UserSavedStateSchema.virtual('isExpired').get(function() {
  return this.expiryDate < new Date();
});

// Method لتحديث تاريخ انتهاء الصلاحية
UserSavedStateSchema.methods.extendExpiry = function(hours = 24) {
  this.expiryDate = new Date(Date.now() + hours * 60 * 60 * 1000);
  return this.save();
};

// Static method للعثور على الحالات المحفوظة للمستخدم
UserSavedStateSchema.statics.findByUser = function(userId, type = null) {
  const query = { 
    userId,
    expiryDate: { $gt: new Date() }
  };
  
  if (type) {
    query.type = type;
  }
  
  return this.find(query).sort({ timestamp: -1 });
};

// Static method لحفظ أو تحديث الحالة
UserSavedStateSchema.statics.saveUserState = function(userId, type, state, sessionInfo = null) {
  const expiryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  
  return this.findOneAndUpdate(
    { userId, type },
    {
      $set: {
        state,
        timestamp: new Date(),
        expiryDate,
        ...(sessionInfo && { sessionInfo })
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

// Static method لحذف الحالات المحفوظة
UserSavedStateSchema.statics.clearUserStates = function(userId, type = null) {
  const query = { userId };
  
  if (type) {
    query.type = type;
  }
  
  return this.deleteMany(query);
};

// Static method لتنظيف الحالات المنتهية الصلاحية
UserSavedStateSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiryDate: { $lt: new Date() }
  });
};

// Pre-save middleware لضمان صحة البيانات
UserSavedStateSchema.pre('save', function(next) {
  // التأكد من وجود بيانات الحالة
  if (!this.state || Object.keys(this.state).length === 0) {
    return next(new Error('State data is required'));
  }

  // التأكد من صحة معرف المستخدم
  if (!this.userId) {
    return next(new Error('User ID is required'));
  }

  next();
});

// Pre-validate middleware
UserSavedStateSchema.pre('validate', function(next) {
  // إذا كانت الحالة من نوع ride_state_backup، يجب أن تحتوي على rideId
  if (this.type === 'ride_state_backup' && !this.state.rideId) {
    return next(new Error('Ride state backup requires rideId in state'));
  }

  // إذا كانت الحالة من نوع trip_planning_backup، يجب أن تحتوي على origin و destination
  if (this.type === 'trip_planning_backup') {
    if (!this.state.origin || !this.state.destination) {
      return next(new Error('Trip planning backup requires origin and destination in state'));
    }
  }

  next();
});

// Instance method للتحويل إلى JSON مع تصفية الحقول
UserSavedStateSchema.methods.toClientJSON = function() {
  const obj = this.toObject();
  
  // حذف الحقول الحساسة
  delete obj.__v;
  delete obj.sessionInfo;
  
  return {
    userId: obj.userId,
    type: obj.type,
    state: obj.state,
    timestamp: obj.timestamp,
    expiryDate: obj.expiryDate,
    isExpired: this.isExpired
  };
};

module.exports = mongoose.model("UserSavedState", UserSavedStateSchema);
