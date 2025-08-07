# نظام إدارة الرحلات - Lygo Test

## 🎯 الميزات المُتاحة

### 1. نظام الدردشة الشامل ✅
- **API Endpoints:**
  - `POST /api/chat/send` - إرسال رسالة
  - `GET /api/chat/history/:rideId` - تاريخ الرسائل
  - `GET /api/chat/quick-messages` - الرسائل السريعة
  - `POST /api/chat/typing` - مؤشر الكتابة
  - `POST /api/chat/read` - تأكيد القراءة

- **المميزات:**
  - الرسائل الفورية (Real-time messaging)
  - الرسائل السريعة (Customer: 5, Driver: 6)
  - مؤشرات الكتابة (Typing indicators)
  - تأكيدات القراءة (Message read receipts)
  - تخزين مؤقت بـ Redis
  - تحديد المعدل (30 رسالة/دقيقة)

### 2. نظام الدفعات الكامل ✅
- **API Endpoints:**
  - `POST /api/rides/payment/` - تسجيل الدفعة (Captain)
  - `GET /api/rides/payments/history` - تاريخ الدفعات
  - `GET /api/rides/payments/stats` - إحصائيات الدفع
  - `GET /api/rides/payments/analytics` - تحليلات الدفع (Admin)
  - `PUT /api/rides/payments/:id/process` - معالجة الدفعة (Admin)
  - `POST /api/rides/payments/:id/dispute` - إنشاء نزاع

- **المميزات:**
  - حساب العمولة التلقائي
  - تتبع أرباح الكابتن
  - معالجة النزاعات
  - إحصائيات مفصلة
  - دعم العملات المتعددة (IQD افتراضي)
  - حالات الدفع: full, partial

### 3. نظام إرسال الرحلات المتقدم ✅
- **المميزات:**
  - Hide Ride Feature (إخفاء الرحلات)
  - Queue management (إدارة الطوابير)
  - إشعارات مُحسنة
  - نطاق ديناميكي: 2-10 كم
  - معالجة الطوابير المُحسنة

### 4. نظام Socket.IO الكامل ✅
- **Customer namespace:** `/customer`
- **Captain namespace:** `/captain`
- أحداث Chat مُدمجة
- إدارة الاتصالات المُحسنة

## 🔧 إعداد النظام

### متطلبات التشغيل
- Node.js
- MongoDB
- Redis (اختياري - للتخزين المؤقت)

### تشغيل الخادم
```bash
npm start
# الخادم يعمل على: http://localhost:5230
```

### قاعدة البيانات المطلوبة
- MongoDB: `ride_hailing_db`
- Collections جديدة:
  - `chatmessages` - رسائل الدردشة
  - `typingindicators` - مؤشرات الكتابة
  - `payments` - سجلات الدفعات

## 📋 API Documentation

### مصادقة الطلبات
```
Authorization: Bearer <JWT_TOKEN>
```

### Captain Payment Submission
```http
POST /api/rides/payment/
Content-Type: application/json
Authorization: Bearer <captain_token>

{
  "rideId": "string",
  "receivedAmount": number,
  "expectedAmount": number,
  "currency": "IQD",
  "paymentStatus": "full" | "partial",
  "timestamp": "ISO_Date",
  "paymentMethod": "cash",
  "notes": "string",
  "reason": "string (required if partial)"
}
```

### Response Example
```json
{
  "success": true,
  "message": "Payment recorded successfully",
  "data": {
    "paymentId": "...",
    "rideId": "...",
    "rideCode": "...",
    "receivedAmount": 8000,
    "expectedAmount": 8000,
    "currency": "IQD",
    "paymentStatus": "full",
    "earnings": {
      "captainEarnings": 6400,
      "companyCommission": 1600,
      "processingFee": 0
    },
    "completionPercentage": 100,
    "amountShortage": 0
  }
}
```

## 🚀 حالة الخدمات

عند بدء التشغيل ستظهر الرسائل التالية:

```
✅ Chat System: ENABLED
  - Real-time messaging
  - Quick messages (Customer: 5, Driver: 6)
  - Typing indicators
  - Message read receipts
  - Chat history & Redis caching
  - Rate limiting (30 msg/min)

✅ Payment System: ENABLED
  - POST /api/rides/payment/ (Captain payment submission)
  - GET /api/rides/payments/history (Payment history)
  - GET /api/rides/payments/stats (Payment statistics)
  - Automatic commission calculation
  - Captain earnings tracking
  - Payment dispute handling

✅ Hide Ride Feature: ENABLED
✅ Dispatch Service: ENABLED
```

## 📊 المميزات المالية

### حساب العمولة
- العمولة الافتراضية: 20%
- رسوم المعالجة: 0%
- حد أدنى للعمولة: 500 IQD
- حد أقصى للعمولة: 5000 IQD

### أنواع الدفع المدعومة
- نقدي (cash)
- بطاقة (card)
- محفظة رقمية (wallet)
- تحويل بنكي (bank_transfer)

### حالات الدفع
- **full**: دفع كامل
- **partial**: دفع جزئي (مطلوب سبب)
- **pending**: في انتظار المعالجة
- **failed**: فشل الدفع

## 🛡️ الأمان

- JWT authentication مطلوب
- التحقق من صلاحيات Captain
- Rate limiting للرسائل
- التحقق من صحة البيانات
- حماية من CORS
- تشفير كلمات المرور

## 📝 ملاحظات هامة

1. **Redis**: النظام يعمل بدون Redis لكن الأداء أفضل معه
2. **المصادقة**: مطلوبة لجميع endpoints المحمية
3. **العملة**: IQD هي العملة الافتراضية
4. **الـ Logs**: تُحفظ في ملفات منفصلة
5. **WebSocket**: للرسائل الفورية والإشعارات

## 🔗 روابط مهمة

- **Chat Endpoints:** `/api/chat/*`
- **Payment Endpoints:** `/api/rides/payment*`
- **Customer WebSocket:** `ws://localhost:5230/customer`
- **Captain WebSocket:** `ws://localhost:5230/captain`

---

**✨ النظام جاهز للاستخدام!**

تم حل مشكلة 404 للـ Captain app وإضافة جميع الميزات المطلوبة.
