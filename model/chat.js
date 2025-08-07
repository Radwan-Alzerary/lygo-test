const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      index: true
    },
    text: {
      type: String,
      required: true,
      maxlength: 1000,
      trim: true
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    senderType: {
      type: String,
      enum: ["customer", "driver"],
      required: true
    },
    isQuick: {
      type: Boolean,
      default: false
    },
    tempId: {
      type: String,
      sparse: true // للرسائل المؤقتة قبل الحفظ
    },
    messageStatus: {
      sent: {
        type: Boolean,
        default: true
      },
      delivered: {
        type: Boolean,
        default: false
      },
      read: {
        type: Boolean,
        default: false
      },
      deliveredAt: {
        type: Date
      },
      readAt: {
        type: Date
      }
    },
    metadata: {
      quickMessageType: String, // نوع الرسالة السريعة
      editedAt: Date,
      isEdited: { type: Boolean, default: false }
    }
  },
  {
    timestamps: true,
    collection: "chatMessages"
  }
);

// الفهارس لتحسين الأداء
ChatMessageSchema.index({ rideId: 1, createdAt: -1 });
ChatMessageSchema.index({ senderId: 1, createdAt: -1 });
ChatMessageSchema.index({ "messageStatus.read": 1, senderType: 1 });

// Virtual للحصول على الرسائل غير المقروءة
ChatMessageSchema.virtual('isUnread').get(function() {
  return !this.messageStatus.read;
});

// دالة للحصول على إحصائيات الرسائل لرحلة معينة
ChatMessageSchema.statics.getChatStats = async function(rideId) {
  const stats = await this.aggregate([
    { $match: { rideId: new mongoose.Types.ObjectId(rideId) } },
    {
      $group: {
        _id: "$senderType",
        totalMessages: { $sum: 1 },
        unreadMessages: {
          $sum: { $cond: [{ $eq: ["$messageStatus.read", false] }, 1, 0] }
        },
        quickMessages: {
          $sum: { $cond: [{ $eq: ["$isQuick", true] }, 1, 0] }
        }
      }
    }
  ]);
  
  return stats;
};

// دالة لتحديد الرسائل كمقروءة
ChatMessageSchema.statics.markAsRead = async function(rideId, messageIds, readerType) {
  const oppositeType = readerType === 'customer' ? 'driver' : 'customer';
  
  const result = await this.updateMany(
    {
      rideId: new mongoose.Types.ObjectId(rideId),
      _id: { $in: messageIds.map(id => new mongoose.Types.ObjectId(id)) },
      senderType: oppositeType, // تحديد رسائل الطرف الآخر فقط
      "messageStatus.read": false
    },
    {
      $set: {
        "messageStatus.read": true,
        "messageStatus.readAt": new Date()
      }
    }
  );
  
  return result;
};

// دالة للحصول على عدد الرسائل غير المقروءة
ChatMessageSchema.statics.getUnreadCount = async function(rideId, readerType) {
  const oppositeType = readerType === 'customer' ? 'driver' : 'customer';
  
  const count = await this.countDocuments({
    rideId: new mongoose.Types.ObjectId(rideId),
    senderType: oppositeType,
    "messageStatus.read": false
  });
  
  return count;
};

// دالة لتنظيف الرسائل القديمة (يمكن استخدامها في مهمة مجدولة)
ChatMessageSchema.statics.cleanOldMessages = async function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const result = await this.deleteMany({
    createdAt: { $lt: cutoffDate }
  });
  
  return result;
};

// Middleware قبل الحفظ
ChatMessageSchema.pre('save', function(next) {
  // تحديد حالة التسليم عند الإنشاء
  if (this.isNew) {
    this.messageStatus.delivered = true;
    this.messageStatus.deliveredAt = new Date();
  }
  next();
});

// نموذج مؤشر الكتابة (في الذاكرة فقط)
const TypingIndicatorSchema = new mongoose.Schema({
  rideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Ride",
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  userType: {
    type: String,
    enum: ["customer", "driver"],
    required: true
  },
  isTyping: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now,
    expires: 10 // ينتهي خلال 10 ثواني
  }
});

const ChatMessage = mongoose.model("ChatMessage", ChatMessageSchema);
const TypingIndicator = mongoose.model("TypingIndicator", TypingIndicatorSchema);

module.exports = {
  ChatMessage,
  TypingIndicator
};
