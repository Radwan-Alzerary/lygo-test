// models/Advertisement.js
const mongoose = require('mongoose');

const advertisementSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'اسم الإعلان مطلوب'],
    trim: true,
    maxlength: [100, 'اسم الإعلان يجب أن يكون أقل من 100 حرف']
  },
  title: {
    type: String,
    required: [true, 'عنوان الإعلان مطلوب'],
    trim: true,
    maxlength: [200, 'العنوان يجب أن يكون أقل من 200 حرف']
  },
  subtitle: {
    type: String,
    required: [true, 'العنوان الفرعي مطلوب'],
    trim: true,
    maxlength: [300, 'العنوان الفرعي يجب أن يكون أقل من 300 حرف']
  },
  imageUrl: {
    type: String,
    required: [true, 'رابط الصورة مطلوب'],
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(v);
      },
      message: 'يرجى إدخال رابط صورة صحيح'
    }
  },
  redirectUrl: {
    type: String,
    required: [true, 'رابط التحويل مطلوب'],
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+/.test(v);
      },
      message: 'يرجى إدخال رابط صحيح'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  clickCount: {
    type: Number,
    default: 0,
    min: [0, 'عدد النقرات لا يمكن أن يكون سالب']
  },
  impressions: {
    type: Number,
    default: 0,
    min: [0, 'عدد المشاهدات لا يمكن أن يكون سالب']
  },
  ctr: {
    type: Number,
    default: 0,
    min: [0, 'معدل النقر لا يمكن أن يكون سالب'],
    max: [100, 'معدل النقر لا يمكن أن يزيد عن 100%']
  },
  tags: [{
    type: String,
    trim: true
  }],
  category: {
    type: String,
    trim: true,
    default: 'general',
    enum: {
      values: ['general', 'technology', 'food', 'travel', 'fashion', 'health', 'education', 'business', 'entertainment', 'sports'],
      message: 'الفئة المحددة غير صحيحة'
    }
  },
  priority: {
    type: Number,
    default: 0,
    min: [0, 'الأولوية لا يمكن أن تكون سالبة'],
    max: [10, 'الأولوية لا يمكن أن تزيد عن 10']
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    validate: {
      validator: function(v) {
        return !v || v > this.startDate;
      },
      message: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية'
    }
  },
  targetAudience: {
    age: {
      min: { 
        type: Number, 
        min: [13, 'الحد الأدنى للعمر هو 13 سنة'], 
        max: [100, 'الحد الأدنى للعمر لا يمكن أن يزيد عن 100 سنة'] 
      },
      max: { 
        type: Number, 
        min: [13, 'الحد الأقصى للعمر لا يمكن أن يقل عن 13 سنة'], 
        max: [100, 'الحد الأقصى للعمر لا يمكن أن يزيد عن 100 سنة'] 
      }
    },
    gender: {
      type: String,
      enum: {
        values: ['male', 'female', 'all'],
        message: 'الجنس يجب أن يكون: ذكر، أنثى، أو الجميع'
      },
      default: 'all'
    },
    location: [{
      type: String,
      trim: true
    }]
  },
  budget: {
    total: { 
      type: Number, 
      min: [0, 'الميزانية الإجمالية لا يمكن أن تكون سالبة'] 
    },
    spent: { 
      type: Number, 
      default: 0, 
      min: [0, 'المبلغ المنفق لا يمكن أن يكون سالب'] 
    },
    costPerClick: { 
      type: Number, 
      min: [0, 'تكلفة النقرة لا يمكن أن تكون سالبة'] 
    }
  },
  analytics: {
    dailyClicks: [{
      date: { type: Date, default: Date.now },
      count: { type: Number, default: 0, min: 0 }
    }],
    dailyImpressions: [{
      date: { type: Date, default: Date.now },
      count: { type: Number, default: 0, min: 0 }
    }],
    lastClick: { type: Date },
    lastImpression: { type: Date },
    peakHours: [{
      hour: { type: Number, min: 0, max: 23 },
      clicks: { type: Number, default: 0 },
      impressions: { type: Number, default: 0 }
    }],
    deviceStats: {
      mobile: { type: Number, default: 0 },
      desktop: { type: Number, default: 0 },
      tablet: { type: Number, default: 0 }
    },
    referrerStats: [{
      source: String,
      count: { type: Number, default: 0 }
    }]
  },
  metadata: {
    createdBy: { type: String },
    updatedBy: { type: String },
    version: { type: Number, default: 1 },
    notes: { type: String, maxlength: 500 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for CTR calculation
advertisementSchema.virtual('calculatedCtr').get(function() {
  if (this.impressions === 0) return 0;
  return Math.round((this.clickCount / this.impressions) * 100 * 100) / 100;
});

// Virtual for campaign status
advertisementSchema.virtual('campaignStatus').get(function() {
  const now = new Date();
  if (this.endDate && now > this.endDate) return 'expired';
  if (now < this.startDate) return 'scheduled';
  if (this.isActive) return 'active';
  return 'paused';
});

// Virtual for budget utilization
advertisementSchema.virtual('budgetUtilization').get(function() {
  if (!this.budget.total || this.budget.total === 0) return 0;
  return Math.round((this.budget.spent / this.budget.total) * 100 * 100) / 100;
});

// Virtual for performance score (basic algorithm)
advertisementSchema.virtual('performanceScore').get(function() {
  let score = 0;
  
  // CTR score (40% weight)
  const ctrScore = Math.min(this.ctr * 4, 40);
  score += ctrScore;
  
  // Engagement score (30% weight)
  const totalEngagement = this.clickCount + (this.impressions * 0.1);
  const engagementScore = Math.min(totalEngagement / 100, 30);
  score += engagementScore;
  
  // Recency score (20% weight)
  const daysSinceUpdate = (Date.now() - this.updatedAt) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(20 - daysSinceUpdate, 0);
  score += recencyScore;
  
  // Priority bonus (10% weight)
  score += this.priority;
  
  return Math.round(score);
});

// Update CTR and budget before saving
advertisementSchema.pre('save', function(next) {
  // Update CTR
  this.ctr = this.calculatedCtr;
  
  // Validate target audience age range
  if (this.targetAudience.age.min && this.targetAudience.age.max) {
    if (this.targetAudience.age.min > this.targetAudience.age.max) {
      const error = new Error('الحد الأدنى للعمر يجب أن يكون أقل من أو يساوي الحد الأقصى');
      return next(error);
    }
  }
  
  // Validate budget
  if (this.budget.spent > this.budget.total && this.budget.total > 0) {
    const error = new Error('المبلغ المنفق لا يمكن أن يزيد عن الميزانية الإجمالية');
    return next(error);
  }
  
  // Update version
  if (this.isModified() && !this.isNew) {
    this.metadata.version += 1;
  }
  
  next();
});

// Indexes for better performance
advertisementSchema.index({ isActive: 1, priority: -1 });
advertisementSchema.index({ name: 'text', title: 'text', subtitle: 'text' });
advertisementSchema.index({ category: 1, isActive: 1 });
advertisementSchema.index({ createdAt: -1 });
advertisementSchema.index({ startDate: 1, endDate: 1 });
advertisementSchema.index({ 'targetAudience.location': 1 });
advertisementSchema.index({ priority: -1, ctr: -1 });
advertisementSchema.index({ tags: 1 });

// Static methods
advertisementSchema.statics.getActiveAds = function(filters = {}) {
  return this.find({ isActive: true, ...filters })
    .sort({ priority: -1, ctr: -1 });
};

advertisementSchema.statics.getTopPerformers = function(limit = 10) {
  return this.find({ isActive: true })
    .sort({ ctr: -1, clickCount: -1 })
    .limit(limit);
};

advertisementSchema.statics.getByCategory = function(category) {
  return this.find({ category, isActive: true })
    .sort({ priority: -1 });
};

advertisementSchema.statics.getExpiringSoon = function(days = 7) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  return this.find({
    isActive: true,
    endDate: { $lte: futureDate, $gte: new Date() }
  }).sort({ endDate: 1 });
};

// Instance methods
advertisementSchema.methods.recordClick = async function(metadata = {}) {
  this.clickCount += 1;
  
  // Update daily analytics
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayEntry = this.analytics.dailyClicks
    .find(entry => entry.date.toDateString() === today.toDateString());
  
  if (todayEntry) {
    todayEntry.count += 1;
  } else {
    this.analytics.dailyClicks.push({
      date: today,
      count: 1
    });
  }
  
  // Update peak hours
  const currentHour = new Date().getHours();
  let hourEntry = this.analytics.peakHours.find(h => h.hour === currentHour);
  if (!hourEntry) {
    hourEntry = { hour: currentHour, clicks: 0, impressions: 0 };
    this.analytics.peakHours.push(hourEntry);
  }
  hourEntry.clicks += 1;
  
  // Update device stats if provided
  if (metadata.device) {
    this.analytics.deviceStats[metadata.device] = 
      (this.analytics.deviceStats[metadata.device] || 0) + 1;
  }
  
  // Update referrer stats if provided
  if (metadata.referrer) {
    let referrerEntry = this.analytics.referrerStats
      .find(r => r.source === metadata.referrer);
    if (!referrerEntry) {
      referrerEntry = { source: metadata.referrer, count: 0 };
      this.analytics.referrerStats.push(referrerEntry);
    }
    referrerEntry.count += 1;
  }
  
  // Update budget
  if (this.budget.costPerClick) {
    this.budget.spent += this.budget.costPerClick;
  }
  
  this.analytics.lastClick = new Date();
  
  // Keep only last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  this.analytics.dailyClicks = this.analytics.dailyClicks
    .filter(entry => entry.date >= thirtyDaysAgo);
  
  return this.save();
};

advertisementSchema.methods.recordImpression = async function(metadata = {}) {
  this.impressions += 1;
  
  // Update daily analytics
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayEntry = this.analytics.dailyImpressions
    .find(entry => entry.date.toDateString() === today.toDateString());
  
  if (todayEntry) {
    todayEntry.count += 1;
  } else {
    this.analytics.dailyImpressions.push({
      date: today,
      count: 1
    });
  }
  
  // Update peak hours
  const currentHour = new Date().getHours();
  let hourEntry = this.analytics.peakHours.find(h => h.hour === currentHour);
  if (!hourEntry) {
    hourEntry = { hour: currentHour, clicks: 0, impressions: 0 };
    this.analytics.peakHours.push(hourEntry);
  }
  hourEntry.impressions += 1;
  
  this.analytics.lastImpression = new Date();
  
  // Keep only last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  this.analytics.dailyImpressions = this.analytics.dailyImpressions
    .filter(entry => entry.date >= thirtyDaysAgo);
  
  return this.save();
};

advertisementSchema.methods.isExpired = function() {
  return this.endDate && new Date() > this.endDate;
};

advertisementSchema.methods.isScheduled = function() {
  return new Date() < this.startDate;
};

advertisementSchema.methods.canBeDisplayed = function() {
  return this.isActive && !this.isExpired() && !this.isScheduled();
};

// Export the model
module.exports = mongoose.model('Advertisement', advertisementSchema);