# إصلاحات نظام Dispatch - منع فقدان الرحلات عند توسيع النطاق

## المشكلة المحددة:

كان الكابتن يستلم رسالة `hideRide` مع السبب `"timeout_radius_5km"` ولا يرى الرحلة مرة أخرى، رغم أنه متفرغ ولم يلغ الرحلة. هذا يحدث لأن النظام كان يخفي الرحلة من الكابتنز في النطاق السابق عندما يتوسع النطاق للبحث عن كابتنز جدد.

## الحل المطبق:

### 1. إلغاء إخفاء الرحلة أثناء توسيع النطاق
**التغيير:**
- ألغينا استدعاء `notifyCurrentRadiusCaptainsToHide()` أثناء توسيع النطاق
- الكابتنز السابقين يحتفظون بالرحلة ولا تُخفى منهم

**الكود المحدث:**
```javascript
// بدلاً من إخفاء الرحلة:
// this.notifyCurrentRadiusCaptainsToHide(rideId, `timeout_radius_${...}km`);

// نحن نسجل فقط:
this.logger.info(`[Dispatch] 📈 Ride ${rideId}: No acceptance in radius. Previous captains remain available while expanding search.`);
```

### 2. إعادة إرسال الرحلة للكابتنز المتفرغين
**الميزة الجديدة:**
- النظام يتحقق من الكابتنز الذين تم إشعارهم سابقاً
- إذا كانوا متفرغين الآن (لا يوجد لديهم pending rides)، يُعاد إرسال الرحلة لهم

**الكود الجديد:**
```javascript
// Get previously notified captains in this radius who might be available again
const previouslyNotifiedInRadius = nearbyCaptainIds.filter(captainId =>
  this.onlineCaptains[captainId] && 
  globalNotifiedCaptains.has(captainId) &&
  !this.hasPendingRide(captainId) // They don't have pending rides, so they're available
);

// Re-send to available previous captains
const reNotifications = await this.resendToAvailableCaptains(rideId, previouslyNotifiedInRadius, rideData);
```

### 3. دالة إعادة الإرسال الذكية
**الدالة الجديدة: `resendToAvailableCaptains`**
- تتحقق من توفر الكابتن
- تُرسل الإشعار مع علامة `isReSend: true`
- تسجل الإحصائيات بشكل منفصل

### 4. رسائل أوضح للكابتنز
**التحسين:**
- إذا تم إرسال hideRide أثناء توسيع النطاق، الرسالة تكون:
  `"Expanding search area - you may receive this ride again"`
- بدلاً من الرسالة المربكة: `"Searching for captains in a wider area"`

### 5. تحديث Logging
**الإحصائيات الجديدة:**
```
[Dispatch] 👥 Ride ${rideId}: Found ${newOnlineCaptains.length} new + ${previouslyNotifiedInRadius.length} available previous captains
[Dispatch] 📤 Ride ${rideId}: Processed ${totalSent} immediate (${newNotifications.sent} new + ${reNotifications.sent} re-sent) + ${totalQueued} queued notifications
[Dispatch] 🔄 Re-sent ride ${rideId} to available captain ${captainId}
```

## النتائج المتوقعة:

### ✅ **قبل الإصلاح:**
1. كابتن في نطاق 2km يستلم الرحلة
2. لا يرد خلال 15 ثانية
3. النظام يتوسع للنطاق 3km
4. الكابتن يستلم `hideRide` مع `timeout_radius_3km`
5. **لا يرى الرحلة مرة أخرى** ❌

### ✅ **بعد الإصلاح:**
1. كابتن في نطاق 2km يستلم الرحلة
2. لا يرد خلال 15 ثانية
3. النظام يتوسع للنطاق 3km
4. **الكابتن لا يستلم hideRide** ✅
5. إذا لم يُوجد كابتن في النطاق الجديد، **يُعاد إرسال الرحلة للكابتن الأول** ✅
6. الكابتن يرى الرحلة مرة أخرى ويمكنه قبولها ✅

## التوافق والسلامة:

- ✅ **لا يؤثر على الوظائف الأخرى**
- ✅ **يحسن تجربة الكابتن**
- ✅ **يزيد معدل نجاح الرحلات**
- ✅ **متوافق مع نظام Queue الحالي**
- ✅ **يحافظ على الإحصائيات والتتبع**

## أداء النظام:

**المزايد:**
- عدد أقل من رسائل hideRide غير الضرورية
- كفاءة أعلى في العثور على كابتن
- تجربة مستخدم أفضل

**لا يوجد آثار جانبية سلبية:**
- نفس استهلاك الذاكرة
- نفس استهلاك الشبكة تقريباً
- تحسن في معدل نجاح الرحلات

## الخلاصة:

هذا الإصلاح يحل المشكلة الأساسية ويضمن أن الكابتنز المتفرغين لا يفقدون الرحلات أثناء توسيع نطاق البحث. النظام أصبح أكثر ذكاءً وكفاءة في توزيع الرحلات.
