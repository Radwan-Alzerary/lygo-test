# 🏦 نظام الخزنة الرئيسية - دليل المطور الأمامي (Frontend Developer Guide)

## 📋 نظرة عامة (Overview)

تم تطوير نظام خزنة رئيسية متقدم يخصم تلقائياً نسبة مئوية قابلة للتخصيص من أرباح الكابتن عند قبول الرحلات. النظام يدعم إعدادات مرنة ويمكن التحكم فيه بالكامل.

## 🚀 الميزات الجديدة (New Features)

### ✅ تم تطوير الميزات التالية:

1. **خزنة رئيسية تلقائية** - تنشأ تلقائياً إذا لم تكن موجودة
2. **خصم تلقائي قابل للتخصيص** - النسبة تأتي من إعدادات الرحلة (RideSetting)
3. **نسبة افتراضية 20%** - إذا لم تكن الإعدادات موجودة
4. **إمكانية تفعيل/إلغاء النظام** كاملاً
5. **إحصائيات شاملة** عن الخزنة والعمليات
6. **تتبع كامل للعمليات المالية**

---

## 🔧 API Endpoints للواجهة الأمامية

### 1. 📊 الحصول على إحصائيات الخزنة الرئيسية
```http
GET /api/vault/stats
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 45000,
    "totalDeductions": 45000,
    "totalTransactions": 15,
    "dailyDeductions": 8000,
    "dailyTransactions": 3,
    "deductionRate": 0.20,
    "enabled": true,
    "currency": "IQD",
    "lastUpdated": "2025-08-07T20:30:00.000Z"
  }
}
```

### 2. 💰 الحصول على رصيد الخزنة
```http
GET /api/vault/balance
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 45000,
    "currency": "IQD",
    "formatted": "45,000 IQD"
  }
}
```

### 3. ⚙️ الحصول على إعدادات الخزنة
```http
GET /api/settings/vault
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "deductionRate": 0.20,
    "enabled": true,
    "description": "Main vault automatic deduction from captain earnings"
  }
}
```

### 4. 🔧 تحديث إعدادات الخزنة
```http
PUT /api/settings/vault
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "deductionRate": 0.25,
  "enabled": true,
  "description": "Updated deduction rate to 25%"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Vault settings updated successfully",
  "data": {
    "deductionRate": 0.25,
    "enabled": true,
    "description": "Updated deduction rate to 25%"
  }
}
```

---

## 🔌 Socket Events للتحديثات المباشرة

### 1. 📢 إشعار خصم الخزنة للكابتن
```javascript
socket.on('vault_deduction', (data) => {
  /*
  data = {
    captainId: "captain123",
    rideId: "ride456", 
    amount: 1000,
    deductionRate: 0.20,
    rideAmount: 5000,
    newBalance: 15000,
    vaultBalance: 25000,
    timestamp: "2025-08-07T20:30:00.000Z"
  }
  */
  
  // عرض إشعار للكابتن
  showNotification({
    type: 'vault_deduction',
    title: 'خصم الخزنة الرئيسية',
    message: `تم خصم ${data.amount} دينار (${data.deductionRate * 100}%) من الرحلة`,
    newBalance: data.newBalance
  });
});
```

### 2. 📈 تحديثات إحصائيات الخزنة (للأدمن)
```javascript
socket.on('vault_stats_update', (data) => {
  /*
  data = {
    balance: 45000,
    totalDeductions: 45000,
    totalTransactions: 15,
    dailyDeductions: 8000,
    dailyTransactions: 3,
    lastUpdate: "2025-08-07T20:30:00.000Z"
  }
  */
  
  // تحديث واجهة الإحصائيات
  updateVaultStats(data);
});
```

---

## 🗄️ نموذج قاعدة البيانات (Database Schema)

### RideSetting Collection
```javascript
{
  name: "default",
  mainVault: {
    deductionRate: 0.20,    // النسبة المئوية (20% = 0.20)
    enabled: true,          // تفعيل/إلغاء النظام
    description: "Main vault automatic deduction from captain earnings"
  },
  // باقي إعدادات الرحلة...
  createdAt: "2025-08-07T20:00:00.000Z",
  updatedAt: "2025-08-07T20:30:00.000Z"
}
```

### FinancialAccount Collection (الخزنة الرئيسية)
```javascript
{
  _id: "vault_account_id",
  user: "system_user_id",
  accountType: "main_vault",
  vault: 45000,           // الرصيد بالدينار العراقي
  isActive: true,
  metadata: {
    totalDeductions: 45000,
    totalTransactions: 15,
    createdBy: "system",
    purpose: "main_vault"
  },
  createdAt: "2025-08-07T18:00:00.000Z",
  updatedAt: "2025-08-07T20:30:00.000Z"
}
```

---

## 💻 أمثلة كود الواجهة الأمامية

### 1. عرض إحصائيات الخزنة
```javascript
// React Component مثال
import React, { useState, useEffect } from 'react';

const VaultStatsComponent = () => {
  const [vaultStats, setVaultStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVaultStats();
  }, []);

  const fetchVaultStats = async () => {
    try {
      const response = await fetch('/api/vault/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setVaultStats(data.data);
      }
    } catch (error) {
      console.error('Error fetching vault stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>جاري التحميل...</div>;

  return (
    <div className="vault-stats-container">
      <h2>🏦 إحصائيات الخزنة الرئيسية</h2>
      
      <div className="stats-grid">
        <div className="stat-card">
          <h3>الرصيد الحالي</h3>
          <p className="stat-value">
            {vaultStats.balance.toLocaleString()} {vaultStats.currency}
          </p>
        </div>

        <div className="stat-card">
          <h3>نسبة الخصم</h3>
          <p className="stat-value">
            {(vaultStats.deductionRate * 100).toFixed(1)}%
          </p>
          <span className={vaultStats.enabled ? 'enabled' : 'disabled'}>
            {vaultStats.enabled ? 'مفعل' : 'معطل'}
          </span>
        </div>

        <div className="stat-card">
          <h3>إجمالي الخصومات</h3>
          <p className="stat-value">
            {vaultStats.totalDeductions.toLocaleString()} {vaultStats.currency}
          </p>
          <small>{vaultStats.totalTransactions} عملية</small>
        </div>

        <div className="stat-card">
          <h3>خصومات اليوم</h3>
          <p className="stat-value">
            {vaultStats.dailyDeductions.toLocaleString()} {vaultStats.currency}
          </p>
          <small>{vaultStats.dailyTransactions} عملية</small>
        </div>
      </div>
    </div>
  );
};
```

### 2. إعدادات الخزنة (للأدمن)
```javascript
const VaultSettingsComponent = () => {
  const [settings, setSettings] = useState({
    deductionRate: 0.20,
    enabled: true,
    description: ''
  });

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/vault', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify(settings)
      });

      const data = await response.json();
      
      if (data.success) {
        alert('تم حفظ الإعدادات بنجاح!');
      }
    } catch (error) {
      alert('خطأ في حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vault-settings">
      <h2>⚙️ إعدادات الخزنة الرئيسية</h2>
      
      <div className="setting-group">
        <label>نسبة الخصم (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          value={(settings.deductionRate * 100).toFixed(0)}
          onChange={(e) => 
            setSettings({
              ...settings, 
              deductionRate: parseFloat(e.target.value) / 100
            })
          }
        />
        <small>النسبة المئوية التي تُخصم من أرباح الكابتن</small>
      </div>

      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => 
              setSettings({...settings, enabled: e.target.checked})
            }
          />
          تفعيل نظام الخزنة الرئيسية
        </label>
      </div>

      <div className="setting-group">
        <label>الوصف</label>
        <textarea
          value={settings.description}
          onChange={(e) => 
            setSettings({...settings, description: e.target.value})
          }
          placeholder="وصف الإعداد..."
        />
      </div>

      <button 
        onClick={handleSave} 
        disabled={saving}
        className="save-button"
      >
        {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
      </button>
    </div>
  );
};
```

### 3. إشعارات الكابتن
```javascript
const CaptainNotification = () => {
  useEffect(() => {
    // الاتصال بـ Socket.IO
    const socket = io();
    
    socket.on('vault_deduction', (data) => {
      // عرض إشعار للكابتن
      showToast({
        type: 'info',
        title: 'تم خصم رسوم الخزنة',
        message: `تم خصم ${data.amount} دينار (${(data.deductionRate * 100).toFixed(1)}%) من رحلتك`,
        details: `الرصيد المتبقي: ${data.newBalance.toLocaleString()} دينار`,
        duration: 5000
      });
    });

    return () => socket.disconnect();
  }, []);

  return null; // هذا مكون للإشعارات فقط
};
```

---

## 🎯 سيناريوهات الاستخدام

### 1. سيناريو الكابتن العادي
```
1. الكابتن يقبل رحلة بقيمة 10,000 دينار
2. النظام يخصم 20% تلقائياً = 2,000 دينار
3. الكابتن يحصل على 8,000 دينار
4. الخزنة الرئيسية تستلم 2,000 دينار
5. الكابتن يتلقى إشعار بالخصم
```

### 2. سيناريو الأدمن
```
1. الأدمن يريد تغيير النسبة من 20% إلى 25%
2. يدخل إلى لوحة الإعدادات
3. يحدث النسبة ويحفظ
4. جميع الرحلات الجديدة ستطبق 25%
5. الإحصائيات تتحدث تلقائياً
```

---

## 🔧 النظام التقني

### كيفية عمل النظام:
1. **عند قبول الرحلة:** يتم استدعاء `processRideDeduction()`
2. **قراءة الإعدادات:** من `RideSetting.mainVault.deductionRate`
3. **حساب الخصم:** `rideAmount * deductionRate`
4. **تحويل الأموال:** من حساب الكابتن إلى الخزنة
5. **إرسال الإشعار:** للكابتن عبر Socket
6. **تحديث الإحصائيات:** تلقائياً

### ملفات النظام المطورة:
```
model/rideSetting.js         - إعدادات الرحلة مع الخزنة
services/paymentService.js   - خدمة المدفوعات والخزنة
services/financialAccountService.js - إدارة الحسابات المالية
routes/api.js               - API endpoints للواجهة
main.js                     - تهيئة النظام
```

---

## ⚠️ ملاحظات هامة للمطور الأمامي

### 1. التأكد من الصلاحيات
```javascript
// تأكد من وجود صلاحيات الأدمن قبل عرض إعدادات الخزنة
const hasVaultPermission = user.role === 'admin' || user.permissions.includes('vault_manage');
```

### 2. معالجة الأخطاء
```javascript
// اعرض رسائل خطأ واضحة للمستخدم
try {
  const response = await fetch('/api/vault/stats');
  // ...
} catch (error) {
  showError('فشل في تحميل بيانات الخزنة. حاول مرة أخرى.');
}
```

### 3. التحديثات المباشرة
```javascript
// استخدم Socket.IO للحصول على تحديثات مباشرة
socket.on('vault_stats_update', (data) => {
  setVaultStats(data);
});
```

### 4. تنسيق العملة
```javascript
// استخدم تنسيق صحيح للعملة العراقية
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('ar-IQ', {
    style: 'currency',
    currency: 'IQD',
    minimumFractionDigits: 0
  }).format(amount);
};
```

---

## 🧪 اختبار النظام

### أوامر الاختبار المتاحة:
```bash
# اختبار إعدادات الخزنة
node test_vault_settings.js

# اختبار نظام الخصم الكامل
node test_ride_deduction.js

# اختبار نسب خصم مختلفة
node test_final_vault_system.js
```

### حالات الاختبار:
1. ✅ إنشاء خزنة تلقائياً
2. ✅ خصم 20% من الرحلات
3. ✅ تغيير النسبة (15%, 25%, 30%)
4. ✅ تعطيل النظام كاملاً
5. ✅ إحصائيات دقيقة
6. ✅ إشعارات مباشرة

---

## 📞 الدعم والتطوير

إذا كنت بحاجة إلى:
- **إضافة ميزات جديدة**
- **تعديل واجهة المستخدم**
- **حل مشاكل تقنية**
- **تحسين الأداء**

يرجى الرجوع إلى:
- الكود المصدري في `/services/paymentService.js`
- نماذج قاعدة البيانات في `/model/`
- اختبارات النظام في ملفات `test_*.js`

---

## ✅ خلاصة التطوير

تم تطوير نظام خزنة رئيسية متكامل يشمل:

1. **🏦 خزنة تلقائية** تنشأ عند الحاجة
2. **⚙️ إعدادات مرنة** من قاعدة البيانات
3. **📊 إحصائيات شاملة** للمتابعة
4. **🔔 إشعارات مباشرة** للكابتن والأدمن
5. **🛡️ نظام أمان** محكم
6. **📱 واجهات API** للتطبيق الأمامي

**النظام جاهز للإنتاج ومتوافق مع جميع المتطلبات! 🚀**
