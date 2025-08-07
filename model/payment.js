const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      index: true
    },
    captainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true
    },
    receivedAmount: {
      type: Number,
      required: true,
      min: 0,
      get: v => Math.round(v * 100) / 100, // Round to 2 decimal places
      set: v => Math.round(v * 100) / 100
    },
    expectedAmount: {
      type: Number,
      required: true,
      min: 0,
      get: v => Math.round(v * 100) / 100,
      set: v => Math.round(v * 100) / 100
    },
    currency: {
      type: String,
      required: true,
      default: "IQD",
      uppercase: true
    },
    paymentStatus: {
      type: String,
      enum: ["full", "partial"],
      required: true
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "wallet", "other"],
      default: "cash"
    },
    reason: {
      type: String,
      required: function() {
        return this.paymentStatus === "partial";
      },
      maxlength: 500
    },
    timestamp: {
      type: Date,
      required: true
    },
    
    // Financial calculations
    commissionRate: {
      type: Number,
      default: 0.15, // 15% commission
      min: 0,
      max: 1
    },
    companyCommission: {
      type: Number,
      default: 0
    },
    captainEarnings: {
      type: Number,
      default: 0
    },
    
    // Additional metadata
    notes: {
      type: String,
      maxlength: 1000
    },
    processingFee: {
      type: Number,
      default: 0,
      min: 0
    },
    
    // Status tracking
    isProcessed: {
      type: Boolean,
      default: false
    },
    processedAt: {
      type: Date
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    
    // Dispute handling
    hasDispute: {
      type: Boolean,
      default: false
    },
    disputeReason: {
      type: String
    },
    disputeResolvedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true }
  }
);

// Pre-save middleware to calculate earnings and commission
paymentSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('receivedAmount') || this.isModified('commissionRate')) {
    // Calculate company commission
    this.companyCommission = this.receivedAmount * this.commissionRate;
    
    // Calculate captain earnings (received amount - commission - processing fee)
    this.captainEarnings = this.receivedAmount - this.companyCommission - (this.processingFee || 0);
    
    // Ensure captain earnings are not negative
    if (this.captainEarnings < 0) {
      this.captainEarnings = 0;
    }
  }
  next();
});

// Virtual for amount shortage calculation
paymentSchema.virtual('amountShortage').get(function() {
  return this.expectedAmount - this.receivedAmount;
});

// Virtual for payment completion percentage
paymentSchema.virtual('completionPercentage').get(function() {
  return Math.round((this.receivedAmount / this.expectedAmount) * 100);
});

// Static method to get payment statistics for a captain
paymentSchema.statics.getCaptainStats = async function(captainId, startDate, endDate) {
  const matchCondition = { captainId };
  
  if (startDate || endDate) {
    matchCondition.timestamp = {};
    if (startDate) matchCondition.timestamp.$gte = new Date(startDate);
    if (endDate) matchCondition.timestamp.$lte = new Date(endDate);
  }
  
  const stats = await this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: null,
        totalPayments: { $sum: 1 },
        totalReceived: { $sum: "$receivedAmount" },
        totalExpected: { $sum: "$expectedAmount" },
        totalEarnings: { $sum: "$captainEarnings" },
        totalCommission: { $sum: "$companyCommission" },
        fullPayments: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "full"] }, 1, 0] }
        },
        partialPayments: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "partial"] }, 1, 0] }
        },
        averagePayment: { $avg: "$receivedAmount" }
      }
    }
  ]);
  
  return stats[0] || {
    totalPayments: 0,
    totalReceived: 0,
    totalExpected: 0,
    totalEarnings: 0,
    totalCommission: 0,
    fullPayments: 0,
    partialPayments: 0,
    averagePayment: 0
  };
};

// Instance method to mark as processed
paymentSchema.methods.markAsProcessed = function(processedBy = null) {
  this.isProcessed = true;
  this.processedAt = new Date();
  if (processedBy) {
    this.processedBy = processedBy;
  }
  return this.save();
};

// Instance method to create dispute
paymentSchema.methods.createDispute = function(reason) {
  this.hasDispute = true;
  this.disputeReason = reason;
  return this.save();
};

// Instance method to resolve dispute
paymentSchema.methods.resolveDispute = function() {
  this.hasDispute = false;
  this.disputeResolvedAt = new Date();
  return this.save();
};

// Indexes for performance
paymentSchema.index({ rideId: 1 }, { unique: true }); // One payment per ride
paymentSchema.index({ captainId: 1, timestamp: -1 });
paymentSchema.index({ customerId: 1, timestamp: -1 });
paymentSchema.index({ paymentStatus: 1 });
paymentSchema.index({ isProcessed: 1 });
paymentSchema.index({ hasDispute: 1 });
paymentSchema.index({ timestamp: -1 });

// Compound indexes for common queries
paymentSchema.index({ captainId: 1, paymentStatus: 1, timestamp: -1 });
paymentSchema.index({ isProcessed: 1, timestamp: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
