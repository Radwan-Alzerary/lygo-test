# 📡 دليل API نظام تتبع الكباتن للأدمن

## 🔐 المصادقة

جميع endpoints تتطلب JWT token في header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### الحصول على Token:
```bash
curl -X POST http://localhost:5230/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@admin.com","password":"11223344"}'
```

## 📍 API Endpoints

### 1. جلب جميع المواقع الحالية
```
GET /api/admin/locations/current
```

**الوصف:** جلب مواقع جميع الكباتن المتتبعين حالياً

**الاستجابة:**
```json
{
  "success": true,
  "message": "Current locations retrieved successfully",
  "data": {
    "locations": [
      {
        "captainId": "captain123",
        "location": {
          "lat": 33.3152,
          "lng": 44.3661
        },
        "captainInfo": {
          "name": "أحمد محمد",
          "phone": "+964123456789",
          "email": "captain@example.com",
          "isOnline": true
        },
        "timestamp": "2025-08-08T12:00:00.000Z",
        "status": "online",
        "accuracy": 10,
        "speed": 25,
        "heading": 180
      }
    ],
    "stats": {
      "totalTrackedCaptains": 5,
      "activeSessions": 2,
      "trackedCaptains": 5,
      "onlineCaptains": 4,
      "offlineCaptains": 1
    },
    "timestamp": "2025-08-08T12:00:00.000Z",
    "requestedBy": {
      "userId": "admin123",
      "role": "admin"
    }
  }
}
```

**مثال الاستخدام:**
```bash
curl -X GET "http://localhost:5230/api/admin/locations/current" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 2. جلب موقع كابتن محدد
```
GET /api/admin/locations/captain/:driverId
```

**المعاملات:**
- `driverId` (required): معرف الكابتن

**الوصف:** جلب الموقع الحالي وتاريخ المواقع لكابتن محدد

**الاستجابة:**
```json
{
  "success": true,
  "message": "Captain location retrieved successfully",
  "data": {
    "currentLocation": {
      "captainId": "captain123",
      "location": {
        "lat": 33.3152,
        "lng": 44.3661
      },
      "captainInfo": {
        "name": "أحمد محمد",
        "phone": "+964123456789",
        "email": "captain@example.com",
        "isOnline": true
      },
      "timestamp": "2025-08-08T12:00:00.000Z",
      "status": "online",
      "accuracy": 10,
      "speed": 25,
      "heading": 180
    },
    "locationHistory": [
      {
        "location": {
          "lat": 33.3150,
          "lng": 44.3660
        },
        "timestamp": "2025-08-08T11:58:00.000Z",
        "captainId": "captain123"
      }
    ],
    "captainId": "captain123",
    "trackingInfo": {
      "isBeingTracked": true,
      "lastUpdate": "2025-08-08T12:00:00.000Z",
      "status": "online",
      "accuracy": 10,
      "speed": 25
    },
    "requestedBy": {
      "userId": "admin123",
      "role": "admin"
    }
  }
}
```

**مثال الاستخدام:**
```bash
curl -X GET "http://localhost:5230/api/admin/locations/captain/CAPTAIN_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 3. إحصائيات التتبع
```
GET /api/admin/tracking/stats
```

**الوصف:** جلب إحصائيات مفصلة عن نظام التتبع

**الاستجابة:**
```json
{
  "success": true,
  "message": "Tracking statistics retrieved successfully",
  "data": {
    "tracking": {
      "activeSessions": 2,
      "maxSessions": 10,
      "trackedCaptains": 5,
      "sessionDetails": [],
      "totalLocations": 5,
      "onlineCaptains": 4,
      "offlineCaptains": 1,
      "recentlyUpdated": 3
    },
    "admin": {
      "totalConnected": 1,
      "tracking": 2,
      "byRole": {
        "admin": 1,
        "dispatcher": 0
      },
      "sessions": [],
      "requestingAdmin": {
        "userId": "admin123",
        "role": "admin",
        "userName": "مدير النظام"
      }
    },
    "system": {
      "timestamp": "2025-08-08T12:00:00.000Z",
      "timezone": "Asia/Baghdad",
      "performance": {
        "avgResponseTime": "< 100ms",
        "systemHealth": "operational",
        "uptime": 3600,
        "memoryUsage": {
          "rss": 100450304,
          "heapTotal": 38502400,
          "heapUsed": 35089456,
          "external": 21793377,
          "arrayBuffers": 18372889
        }
      }
    },
    "breakdown": {
      "captainsByStatus": {
        "online": 4,
        "offline": 1,
        "unknown": 0
      },
      "updateFrequency": {
        "recent": 3,
        "total": 5,
        "percentage": "60%"
      }
    }
  }
}
```

**مثال الاستخدام:**
```bash
curl -X GET "http://localhost:5230/api/admin/tracking/stats" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 4. بدء التتبع
```
POST /api/admin/tracking/start
```

**الوصف:** بدء جلسة تتبع جديدة للأدمن

**الاستجابة:**
```json
{
  "success": true,
  "message": "Location tracking started successfully",
  "data": {
    "sessionId": "track_admin123_1691496000000",
    "startedBy": "مدير النظام",
    "timestamp": "2025-08-08T12:00:00.000Z"
  }
}
```

**مثال الاستخدام:**
```bash
curl -X POST "http://localhost:5230/api/admin/tracking/start" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 5. إيقاف التتبع
```
POST /api/admin/tracking/stop
```

**الوصف:** إيقاف جلسة التتبع للأدمن

**الاستجابة:**
```json
{
  "success": true,
  "message": "Location tracking stopped successfully",
  "data": {
    "stoppedBy": "مدير النظام",
    "timestamp": "2025-08-08T12:30:00.000Z",
    "sessionDuration": "30 minutes"
  }
}
```

**مثال الاستخدام:**
```bash
curl -X POST "http://localhost:5230/api/admin/tracking/stop" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 6. قائمة الكباتن المتاحين
```
GET /api/admin/captains/available
```

**الوصف:** جلب قائمة جميع الكباتن المتاحين للتتبع

**الاستجابة:**
```json
{
  "success": true,
  "message": "Available captains retrieved successfully",
  "data": {
    "captains": [
      {
        "id": "captain123",
        "name": "أحمد محمد",
        "phone": "+964123456789",
        "email": "captain@example.com",
        "isOnline": true,
        "isBeingTracked": true,
        "lastKnownLocation": {
          "lat": 33.3152,
          "lng": 44.3661
        },
        "lastUpdate": "2025-08-08T12:00:00.000Z",
        "status": "online",
        "registeredAt": "2025-01-01T00:00:00.000Z"
      }
    ],
    "summary": {
      "total": 10,
      "online": 7,
      "beingTracked": 5,
      "available": 2
    },
    "requestedBy": {
      "userId": "admin123",
      "role": "admin"
    }
  }
}
```

**مثال الاستخدام:**
```bash
curl -X GET "http://localhost:5230/api/admin/captains/available" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 7. فحص صحة النظام
```
GET /api/admin/health
```

**الوصف:** فحص حالة وصحة أنظمة التتبع

**الاستجابة:**
```json
{
  "success": true,
  "message": "System health check completed",
  "data": {
    "status": "operational",
    "timestamp": "2025-08-08T12:00:00.000Z",
    "services": {
      "locationTracking": {
        "status": "available",
        "stats": {
          "activeSessions": 2,
          "trackedCaptains": 5
        }
      },
      "adminSocket": {
        "status": "available",
        "stats": {
          "totalConnected": 1,
          "tracking": 2
        }
      },
      "database": {
        "status": "connected",
        "connection": "mongodb"
      }
    },
    "system": {
      "uptime": 3600,
      "memory": {
        "rss": 100450304,
        "heapTotal": 38502400,
        "heapUsed": 35089456
      },
      "version": "v18.17.0"
    },
    "checkedBy": {
      "userId": "admin123",
      "role": "admin"
    }
  }
}
```

**مثال الاستخدام:**
```bash
curl -X GET "http://localhost:5230/api/admin/health" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 🔒 صلاحيات الوصول

الأدوار المسموحة للوصول لهذه APIs:
- `admin` - مدير النظام
- `dispatcher` - موزع الطلبات
- `manager` - مدير
- `support` - دعم فني

## ⚠️ رموز الاستجابة

- `200` - نجحت العملية
- `401` - غير مصرح (token مفقود أو خاطئ)
- `403` - ممنوع (لا توجد صلاحيات كافية)
- `404` - غير موجود (الكابتن غير موجود)
- `500` - خطأ في الخادم
- `503` - الخدمة غير متاحة

## 📝 أمثلة JavaScript

### استخدام fetch:
```javascript
const API_BASE = 'http://localhost:5230/api/admin';
const token = 'YOUR_JWT_TOKEN';

// جلب المواقع الحالية
async function getCurrentLocations() {
  try {
    const response = await fetch(`${API_BASE}/locations/current`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    console.log('Current locations:', data);
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
}

// جلب إحصائيات التتبع
async function getTrackingStats() {
  try {
    const response = await fetch(`${API_BASE}/tracking/stats`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    console.log('Tracking stats:', data);
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
}

// بدء التتبع
async function startTracking() {
  try {
    const response = await fetch(`${API_BASE}/tracking/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    console.log('Tracking started:', data);
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
}
```

### استخدام axios:
```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:5230/api/admin',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// جلب المواقع الحالية
const locations = await api.get('/locations/current');

// جلب موقع كابتن محدد
const captainLocation = await api.get('/locations/captain/CAPTAIN_ID');

// إحصائيات التتبع
const stats = await api.get('/tracking/stats');

// بدء التتبع
const startResult = await api.post('/tracking/start');

// إيقاف التتبع
const stopResult = await api.post('/tracking/stop');
```

---

## 🔄 تحديثات مستقبلية

سيتم إضافة المزيد من endpoints لاحقاً:
- فلترة المواقع حسب المنطقة
- تصدير بيانات المواقع
- إشعارات مخصصة للكباتن
- تحليلات متقدمة للمسارات

---
**آخر تحديث:** 8 أغسطس 2025  
**الإصدار:** 1.0.0
