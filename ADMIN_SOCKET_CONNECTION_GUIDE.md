# 🔍 دليل الاتصال بنظام تتبع الكباتن للأدمن

## 📋 نظرة عامة

هذا الدليل يوضح كيفية اتصال المدراء (Admin) بنظام تتبع مواقع الكباتن في الوقت الفعلي باستخدام Socket.IO.

## 🌐 معلومات الخادم

### الخادم الحالي:
- **البورت:** `5230`
- **الرابط المحلي:** `http://localhost:5230`
- **حالة النظام:** نشط ومفعل ✅
- **Admin Socket System:** مُفعل ✅

### إعدادات Socket.IO:
- **Transport:** WebSocket
- **CORS:** مُفعل لجميع المصادر
- **Authentication:** JWT Token مطلوب

## 🔐 معلومات المصادقة

### حساب الأدمن الافتراضي:
```json
{
  "email": "admin@admin.com",
  "password": "11223344"
}
```

### الحصول على JWT Token:
```javascript
// 1. تسجيل الدخول للحصول على Token
const response = await fetch('http://localhost:5230/users/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'admin@admin.com',
    password: '11223344'
  })
});

const data = await response.json();
const token = data.token; // استخدم هذا Token للاتصال
```

## 🔌 الاتصال بـ Socket

### 📍 Socket Namespace للأدمن:
```
/admin
```

### 🌐 الرابط الكامل:
```javascript
const socket = io('http://localhost:5230/admin', {
  auth: {
    token: 'YOUR_JWT_TOKEN_HERE'
  },
  transports: ['websocket']
});
```

### مثال كامل للاتصال:
```javascript
// تضمين Socket.IO Client
<script src="/socket.io/socket.io.js"></script>

<script>
let socket;
let currentToken;

// دالة تسجيل الدخول والحصول على Token
async function loginAndConnect() {
  try {
    // تسجيل الدخول
    const response = await fetch('http://localhost:5230/users/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'admin@admin.com',
        password: '11223344'
      })
    });

    if (!response.ok) {
      throw new Error('فشل في تسجيل الدخول');
    }

    const data = await response.json();
    currentToken = data.token;

    // الاتصال بـ Admin Socket
    socket = io('http://localhost:5230/admin', {
      auth: {
        token: currentToken
      },
      transports: ['websocket']
    });

    setupSocketEvents();

  } catch (error) {
    console.error('خطأ في الاتصال:', error);
  }
}

// إعداد أحداث Socket
function setupSocketEvents() {
  // الاتصال الناجح
  socket.on('connect', () => {
    console.log('✅ متصل بنظام تتبع الكباتن');
    console.log('Socket ID:', socket.id);
  });

  // تحديثات المواقع
  socket.on('locationUpdate', (data) => {
    console.log('📍 تحديث موقع الكابتن:', data);
    updateCaptainLocation(data);
  });

  // إحصائيات التتبع
  socket.on('trackingStats', (stats) => {
    console.log('📊 إحصائيات التتبع:', stats);
    updateTrackingStats(stats);
  });

  // معلومات الاتصال
  socket.on('adminConnected', (info) => {
    console.log('👨‍💼 أدمن جديد متصل:', info);
  });

  // أخطاء الاتصال
  socket.on('connect_error', (error) => {
    console.error('❌ خطأ في الاتصال:', error.message);
  });

  // انقطاع الاتصال
  socket.on('disconnect', (reason) => {
    console.log('⚠️ انقطع الاتصال:', reason);
  });
}

// بدء تسجيل الدخول والاتصال
loginAndConnect();
</script>
```

## 📡 الأحداث المتاحة

### 📤 الأحداث للإرسال (emit):

1. **بدء التتبع:**
```javascript
socket.emit('startLocationTracking');
```

2. **إيقاف التتبع:**
```javascript
socket.emit('stopLocationTracking');
```

3. **جلب المواقع الحالية:**
```javascript
socket.emit('getCurrentLocations');
```

4. **جلب الإحصائيات:**
```javascript
socket.emit('getTrackingStats');
```

### 📥 الأحداث للاستقبال (on):

1. **تحديثات المواقع:**
```javascript
socket.on('locationUpdate', (data) => {
  // data يحتوي على:
  // - captainId: معرف الكابتن
  // - location: { lat, lng }
  // - timestamp: وقت التحديث
  // - status: online/offline
  console.log('موقع جديد:', data);
});
```

2. **إحصائيات التتبع:**
```javascript
socket.on('trackingStats', (stats) => {
  // stats يحتوي على:
  // - trackedCaptains: عدد الكباتن المتتبعين
  // - activeSessions: الجلسات النشطة
  // - connectedAdmins: المدراء المتصلين
  console.log('إحصائيات:', stats);
});
```

3. **معلومات الاتصال:**
```javascript
socket.on('adminConnected', (info) => {
  // معلومات الأدمن الجديد المتصل
  console.log('أدمن جديد:', info);
});
```

## 🎯 مثال شامل للاستخدام

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>نظام تتبع الكباتن</title>
</head>
<body>
    <h1>🔍 لوحة مراقبة الكباتن</h1>
    
    <div id="status">غير متصل</div>
    <div id="stats"></div>
    
    <button onclick="startTracking()">🎯 بدء التتبع</button>
    <button onclick="stopTracking()">⏹️ إيقاف التتبع</button>
    <button onclick="getCurrentLocations()">🔄 تحديث المواقع</button>
    
    <div id="captains-list"></div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
    let socket;
    let isTracking = false;

    // تسجيل الدخول والاتصال
    async function initializeSystem() {
      try {
        // تسجيل الدخول
        const response = await fetch('http://localhost:5230/users/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'admin@admin.com',
            password: '11223344'
          })
        });

        const data = await response.json();
        
        // الاتصال بـ Socket
        socket = io('http://localhost:5230/admin', {
          auth: { token: data.token },
          transports: ['websocket']
        });

        setupEvents();

      } catch (error) {
        document.getElementById('status').innerText = 'خطأ في الاتصال: ' + error.message;
      }
    }

    function setupEvents() {
      socket.on('connect', () => {
        document.getElementById('status').innerText = '✅ متصل';
        document.getElementById('status').style.color = 'green';
      });

      socket.on('locationUpdate', (data) => {
        updateCaptainsList(data);
      });

      socket.on('trackingStats', (stats) => {
        document.getElementById('stats').innerHTML = `
          📊 الإحصائيات:<br>
          - الكباتن المتتبعين: ${stats.trackedCaptains || 0}<br>
          - الجلسات النشطة: ${stats.activeSessions || 0}<br>
          - المدراء المتصلين: ${stats.connectedAdmins || 0}
        `;
      });

      socket.on('disconnect', () => {
        document.getElementById('status').innerText = '❌ منقطع';
        document.getElementById('status').style.color = 'red';
      });
    }

    function startTracking() {
      if (socket && socket.connected) {
        socket.emit('startLocationTracking');
        isTracking = true;
        console.log('🎯 بدء التتبع');
      }
    }

    function stopTracking() {
      if (socket && socket.connected) {
        socket.emit('stopLocationTracking');
        isTracking = false;
        console.log('⏹️ إيقاف التتبع');
      }
    }

    function getCurrentLocations() {
      if (socket && socket.connected) {
        socket.emit('getCurrentLocations');
        console.log('🔄 طلب تحديث المواقع');
      }
    }

    function updateCaptainsList(data) {
      const list = document.getElementById('captains-list');
      // تحديث قائمة الكباتن بالمواقع الجديدة
      const captainDiv = document.createElement('div');
      captainDiv.innerHTML = `
        <p>🚗 الكابتن: ${data.captainId}</p>
        <p>📍 الموقع: ${data.location?.lat}, ${data.location?.lng}</p>
        <p>⏰ التحديث: ${new Date(data.timestamp).toLocaleString()}</p>
        <hr>
      `;
      list.appendChild(captainDiv);
    }

    // بدء النظام عند تحميل الصفحة
    window.onload = initializeSystem;
    </script>
</body>
</html>
```

## 🔧 API Endpoints إضافية

### REST APIs للمواقع:
```javascript
// جلب جميع المواقع الحالية
GET http://localhost:5230/api/admin/locations/current
Authorization: Bearer YOUR_JWT_TOKEN

// جلب موقع كابتن محدد
GET http://localhost:5230/api/admin/locations/captain/:driverId
Authorization: Bearer YOUR_JWT_TOKEN

// إحصائيات التتبع
GET http://localhost:5230/api/admin/tracking/stats
Authorization: Bearer YOUR_JWT_TOKEN
```

## 🛠️ استكشاف الأخطاء

### المشاكل الشائعة:

1. **"Authentication token required"**
   - تأكد من تمرير JWT token في `auth.token`
   - تأكد من صحة token عبر تسجيل الدخول أولاً

2. **"Connection failed"**
   - تأكد من تشغيل الخادم على port 5230
   - تأكد من استخدام النطاق الصحيح `/admin`

3. **"Forbidden access"**
   - تأكد من أن المستخدم لديه صلاحيات admin
   - تحقق من صحة بيانات تسجيل الدخول

### تحقق من حالة الخادم:
```bash
# تحقق من تشغيل الخادم
curl http://localhost:5230/health

# تحقق من تسجيل الدخول
curl -X POST http://localhost:5230/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@admin.com","password":"11223344"}'
```

## 📊 معلومات النظام الحالي

حسب آخر logs من الخادم:
- ✅ **Server Status:** يعمل على port 5230
- ✅ **Admin Socket System:** مُفعل
- ✅ **Location Tracking System:** مُفعل
- ✅ **JWT Authentication:** يعمل بشكل صحيح
- 📊 **Connected Admins:** 0 (لا يوجد مدراء متصلين حالياً)
- 📊 **Active Tracking Sessions:** 0
- 📊 **Tracked Captains:** 0

## 🎯 الخطوات السريعة للبدء

1. **تأكد من تشغيل الخادم:**
   ```bash
   node main.js
   ```

2. **افتح متصفح وانتقل إلى:**
   ```
   http://localhost:5230
   ```

3. **استخدم كود JavaScript المذكور أعلاه للاتصال**

4. **ابدأ التتبع عبر:**
   ```javascript
   socket.emit('startLocationTracking');
   ```

## 📞 الدعم

إذا واجهت أي مشاكل:
1. تحقق من console logs في المتصفح
2. راجع logs الخادم
3. تأكد من صحة JWT token
4. تأكد من تشغيل الخادم على البورت الصحيح

---
**تم إنشاؤه بواسطة:** GitHub Copilot  
**التاريخ:** 8 أغسطس 2025  
**الإصدار:** 1.0
