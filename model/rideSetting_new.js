const mongoose = require("mongoose");

/** ⚙️ إعدادات التسعير */
const FareSchema = new mongoose.Schema(
  {
    currency:           { type: String, default: "IQD" },   // العملة
    baseFare:           { type: Number, default: 3000 },    // فتح عدّاد
    pricePerKm:         { type: Number, default: 500 },     // دينار/كم
    pricePerMinute:     { type: Number, default: 0 },       // للمستقبل إن أردت حساب زمن الرحلة
    minRidePrice:       { type: Number, default: 2000 },
    maxRidePrice:       { type: Number, default: 7000 },
    nightMultiplier:    { type: Number, default: 1.2 },     // بعد 10 م مثلاً
    weekendMultiplier:  { type: Number, default: 1.15 },
    surge: {
      enabled:          { type: Boolean, default: false },
      multiplier:       { type: Number, default: 1.5 },     // يُضرب في السعر إن فُعّل
      activeFrom:       { type: Date },                     // نافذة زمنية اختيارية
      activeTo:         { type: Date }
    }
  },
  { _id: false }           // لا نحتاج _id فرعي لكل كتلة
);

/** ⚙️ إعدادات منطق التوزيع */
const DispatchSchema = new mongoose.Schema(
  {
    initialRadiusKm:     { type: Number, default: 2 },
    maxRadiusKm:         { type: Number, default: 10 },
    radiusIncrementKm:   { type: Number, default: 1 },
    notificationTimeout: { type: Number, default: 15 },     // بالثواني
    maxDispatchTime:     { type: Number, default: 300 },    // 5 دقائق = 300 ث
    graceAfterMaxRadius: { type: Number, default: 30 }      // بعد بلوغ أقصى نصف قطر
  },
  { _id: false }
);

/** 💰 إعدادات الخزنة الرئيسية */
const MainVaultSchema = new mongoose.Schema(
  {
    deductionRate:       { type: Number, default: 0.20, min: 0, max: 1 }, // نسبة الخصم (20% = 0.20)
    enabled:             { type: Boolean, default: true },                 // تفعيل/إلغاء نظام الخزنة الرئيسية
    description:         { type: String, default: "Main vault automatic deduction from captain earnings" }
  },
  { _id: false }
);

/** ⚙️ حدود وشروط للكابتن */
const CaptainRulesSchema = new mongoose.Schema(
  {
    maxTopUpLimit:       { type: Number, default: 1000 },   // شحن الرصيد
    minWalletBalance:    { type: Number, default: 0 },      // أقل رصيد لاستقبال رحلات
    minRating:           { type: Number, default: 3.5 },    // تقييم من 5
    maxActiveRides:      { type: Number, default: 1 }       // منع قبول أكثر من رحلة
  },
  { _id: false }
);

/** ⚙️ حدود وشروط للعميل */
const PassengerRulesSchema = new mongoose.Schema(
  {
    cancellationFee:     { type: Number, default: 1000 },
    freeCancelWindow:    { type: Number, default: 120 },    // ثانية قبل فرض الغرامة
    minRatingRequired:   { type: Number, default: 0 }       // لو تريد منع عملاء ذوي تقييم منخفض
  },
  { _id: false }
);

/** 🔗 المخطط الرئيسي */
const RideSettingSchema = new mongoose.Schema(
  {
    name:          { type: String, default: "default", unique: true }, // سُمٍّ إعداداتك
    fare:          FareSchema,
    dispatch:      DispatchSchema,
    mainVault:     MainVaultSchema,                                    // إعدادات الخزنة الرئيسية
    captainRules:  CaptainRulesSchema,
    passengerRules:PassengerRulesSchema,
    paymentMethods:{ type: [String], default: ["cash", "wallet"] },   // ["card"] لاحقاً
    allowShared:   { type: Boolean, default: false }                  // رحلات مشتركة
  },
  { timestamps: true }
);

module.exports = mongoose.model("RideSetting", RideSettingSchema);
