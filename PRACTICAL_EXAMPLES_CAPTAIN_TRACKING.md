# 📱 أمثلة عملية لاستخدام نظام تتبع الكباتن

## 🎯 مثال 1: صفحة إدارية بسيطة

### HTML + JavaScript كامل:

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔍 نظام تتبع الكباتن - الإدارة</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background: #f5f5f5;
            direction: rtl;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .status {
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
            font-weight: bold;
        }
        .connected { background: #d4edda; color: #155724; }
        .disconnected { background: #f8d7da; color: #721c24; }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .stat-card {
            background: #e9ecef;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        .controls {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin: 20px 0;
        }
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
        }
        .btn-start { background: #28a745; color: white; }
        .btn-stop { background: #dc3545; color: white; }
        .btn-info { background: #17a2b8; color: white; }
        .captains-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .captain-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border-right: 4px solid #007bff;
        }
        .captain-card.online {
            border-right-color: #28a745;
        }
        .captain-card.offline {
            border-right-color: #dc3545;
            opacity: 0.7;
        }
        .log {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            padding: 15px;
            max-height: 300px;
            overflow-y: auto;
            font-family: monospace;
            font-size: 12px;
        }
        .log-entry {
            margin: 5px 0;
            padding: 5px 0;
            border-bottom: 1px solid #eee;
        }
        .log-entry:last-child {
            border-bottom: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 نظام تتبع الكباتن - لوحة الإدارة</h1>
        
        <!-- حالة الاتصال -->
        <div id="connectionStatus" class="status disconnected">
            ❌ غير متصل - جاري المحاولة...
        </div>
        
        <!-- الإحصائيات -->
        <div class="stats">
            <div class="stat-card">
                <h3>🚗 الكباتن المتتبعين</h3>
                <div id="trackedCaptains" style="font-size: 2em; color: #007bff;">0</div>
            </div>
            <div class="stat-card">
                <h3>🔄 الجلسات النشطة</h3>
                <div id="activeSessions" style="font-size: 2em; color: #28a745;">0</div>
            </div>
            <div class="stat-card">
                <h3>👨‍💼 المدراء المتصلين</h3>
                <div id="connectedAdmins" style="font-size: 2em; color: #17a2b8;">0</div>
            </div>
            <div class="stat-card">
                <h3>📊 جلسات التتبع</h3>
                <div id="trackingSessions" style="font-size: 2em; color: #ffc107;">0</div>
            </div>
        </div>
        
        <!-- أزرار التحكم -->
        <div class="controls">
            <button id="startBtn" class="btn-start" onclick="startTracking()">
                🎯 بدء التتبع
            </button>
            <button id="stopBtn" class="btn-stop" onclick="stopTracking()" disabled>
                ⏹️ إيقاف التتبع
            </button>
            <button class="btn-info" onclick="getCurrentLocations()">
                📍 تحديث المواقع
            </button>
            <button class="btn-info" onclick="getTrackingStats()">
                📊 إحصائيات مفصلة
            </button>
        </div>
        
        <!-- قائمة الكباتن -->
        <h2>📋 قائمة الكباتن النشطين</h2>
        <div id="captainsList" class="captains-grid">
            <p style="text-align: center; color: #6c757d;">لا يوجد كباتن متتبعين حالياً</p>
        </div>
        
        <!-- سجل الأحداث -->
        <h2>📝 سجل الأحداث المباشر</h2>
        <div id="eventLog" class="log">
            <div class="log-entry">[--:--:--] النظام جاهز للاتصال...</div>
        </div>
    </div>

    <!-- Socket.IO Client -->
    <script src="/socket.io/socket.io.js"></script>
    
    <script>
        // متغيرات النظام
        let socket = null;
        let isConnected = false;
        let isTracking = false;
        let captainsData = new Map();

        // إعدادات الخادم
        const SERVER_URL = 'http://localhost:5230';
        const ADMIN_CREDENTIALS = {
            email: 'admin@admin.com',
            password: '11223344'
        };

        // بدء النظام
        async function initializeSystem() {
            logEvent('🚀 بدء تهيئة النظام...');
            
            try {
                await loginAndConnect();
            } catch (error) {
                logEvent('❌ خطأ في التهيئة: ' + error.message, 'error');
            }
        }

        // تسجيل الدخول والاتصال
        async function loginAndConnect() {
            logEvent('🔑 تسجيل الدخول...');
            
            try {
                const response = await fetch(`${SERVER_URL}/users/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(ADMIN_CREDENTIALS)
                });

                if (!response.ok) {
                    throw new Error(`خطأ في تسجيل الدخول: ${response.status}`);
                }

                const data = await response.json();
                logEvent('✅ تم تسجيل الدخول بنجاح');

                // الاتصال بـ Admin Socket
                connectToSocket(data.token);

            } catch (error) {
                logEvent('❌ فشل تسجيل الدخول: ' + error.message, 'error');
                updateConnectionStatus(false, 'فشل تسجيل الدخول');
            }
        }

        // الاتصال بـ Socket
        function connectToSocket(token) {
            logEvent('🔌 الاتصال بـ Admin Socket...');

            socket = io(`${SERVER_URL}/admin`, {
                auth: {
                    token: token
                },
                transports: ['websocket']
            });

            setupSocketEvents();
        }

        // إعداد أحداث Socket
        function setupSocketEvents() {
            // الاتصال الناجح
            socket.on('connect', () => {
                isConnected = true;
                logEvent('✅ تم الاتصال بنجاح - Socket ID: ' + socket.id);
                updateConnectionStatus(true);
                
                // طلب الإحصائيات عند الاتصال
                setTimeout(() => {
                    getTrackingStats();
                }, 1000);
            });

            // تحديثات المواقع
            socket.on('locationUpdate', (data) => {
                logEvent(`📍 تحديث موقع الكابتن: ${data.captainId}`);
                updateCaptainLocation(data);
            });

            // إحصائيات التتبع
            socket.on('trackingStats', (stats) => {
                logEvent('📊 تحديث الإحصائيات');
                updateTrackingStats(stats);
            });

            // أدمن جديد متصل
            socket.on('adminConnected', (info) => {
                logEvent(`👨‍💼 أدمن جديد متصل: ${info.userId}`);
            });

            // أدمن منقطع
            socket.on('adminDisconnected', (info) => {
                logEvent(`👨‍💼 أدمن منقطع: ${info.userId}`);
            });

            // أخطاء الاتصال
            socket.on('connect_error', (error) => {
                logEvent('❌ خطأ في الاتصال: ' + error.message, 'error');
                updateConnectionStatus(false, 'خطأ في الاتصال');
            });

            // انقطاع الاتصال
            socket.on('disconnect', (reason) => {
                isConnected = false;
                logEvent('⚠️ انقطع الاتصال: ' + reason, 'warning');
                updateConnectionStatus(false, 'منقطع');
            });

            // إعادة الاتصال
            socket.on('reconnect', () => {
                logEvent('🔄 تم إعادة الاتصال');
                updateConnectionStatus(true);
            });
        }

        // تحديث حالة الاتصال
        function updateConnectionStatus(connected, message = '') {
            const statusEl = document.getElementById('connectionStatus');
            
            if (connected) {
                statusEl.className = 'status connected';
                statusEl.innerHTML = '✅ متصل بنجاح' + (message ? ` - ${message}` : '');
            } else {
                statusEl.className = 'status disconnected';
                statusEl.innerHTML = '❌ غير متصل' + (message ? ` - ${message}` : '');
            }
        }

        // بدء التتبع
        function startTracking() {
            if (!socket || !isConnected) {
                logEvent('❌ غير متصل - لا يمكن بدء التتبع', 'error');
                return;
            }

            socket.emit('startLocationTracking');
            isTracking = true;
            
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            
            logEvent('🎯 تم بدء التتبع');
        }

        // إيقاف التتبع
        function stopTracking() {
            if (!socket || !isConnected) {
                logEvent('❌ غير متصل', 'error');
                return;
            }

            socket.emit('stopLocationTracking');
            isTracking = false;
            
            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
            
            logEvent('⏹️ تم إيقاف التتبع');
        }

        // جلب المواقع الحالية
        function getCurrentLocations() {
            if (!socket || !isConnected) {
                logEvent('❌ غير متصل', 'error');
                return;
            }

            socket.emit('getCurrentLocations');
            logEvent('🔄 طلب تحديث المواقع');
        }

        // جلب الإحصائيات
        function getTrackingStats() {
            if (!socket || !isConnected) {
                logEvent('❌ غير متصل', 'error');
                return;
            }

            socket.emit('getTrackingStats');
            logEvent('📊 طلب الإحصائيات');
        }

        // تحديث إحصائيات التتبع
        function updateTrackingStats(stats) {
            document.getElementById('trackedCaptains').textContent = stats.trackedCaptains || 0;
            document.getElementById('activeSessions').textContent = stats.activeSessions || 0;
            document.getElementById('connectedAdmins').textContent = stats.connectedAdmins || 0;
            document.getElementById('trackingSessions').textContent = stats.trackingSessions || 0;
        }

        // تحديث موقع الكابتن
        function updateCaptainLocation(data) {
            captainsData.set(data.captainId, data);
            updateCaptainsList();
        }

        // تحديث قائمة الكباتن
        function updateCaptainsList() {
            const container = document.getElementById('captainsList');
            
            if (captainsData.size === 0) {
                container.innerHTML = '<p style="text-align: center; color: #6c757d;">لا يوجد كباتن متتبعين حالياً</p>';
                return;
            }

            let html = '';
            captainsData.forEach((captain, captainId) => {
                const statusClass = captain.status === 'online' ? 'online' : 'offline';
                const statusIcon = captain.status === 'online' ? '🟢' : '🔴';
                
                html += `
                    <div class="captain-card ${statusClass}">
                        <h4>${statusIcon} الكابتن: ${captainId}</h4>
                        <p><strong>📍 الموقع:</strong> ${captain.location?.lat?.toFixed(6)}, ${captain.location?.lng?.toFixed(6)}</p>
                        <p><strong>⏰ آخر تحديث:</strong> ${new Date(captain.timestamp).toLocaleString('ar-IQ')}</p>
                        <p><strong>📱 الحالة:</strong> ${captain.status === 'online' ? 'متصل' : 'غير متصل'}</p>
                        ${captain.speed ? `<p><strong>🚗 السرعة:</strong> ${captain.speed} كم/س</p>` : ''}
                    </div>
                `;
            });

            container.innerHTML = html;
        }

        // تسجيل الأحداث
        function logEvent(message, type = 'info') {
            const logEl = document.getElementById('eventLog');
            const timestamp = new Date().toLocaleTimeString('ar-IQ');
            
            let icon = '📝';
            if (type === 'error') icon = '❌';
            else if (type === 'warning') icon = '⚠️';
            else if (type === 'success') icon = '✅';
            
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = `[${timestamp}] ${icon} ${message}`;
            
            logEl.appendChild(entry);
            logEl.scrollTop = logEl.scrollHeight;

            // الاحتفاظ بآخر 50 سجل فقط
            const entries = logEl.querySelectorAll('.log-entry');
            if (entries.length > 50) {
                entries[0].remove();
            }
        }

        // بدء النظام عند تحميل الصفحة
        window.addEventListener('load', initializeSystem);

        // تحديث دوري للإحصائيات كل 30 ثانية
        setInterval(() => {
            if (isConnected && isTracking) {
                getTrackingStats();
            }
        }, 30000);

        // إضافة تأثيرات بصرية للأزرار
        document.addEventListener('DOMContentLoaded', () => {
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
                btn.addEventListener('click', function() {
                    this.style.transform = 'scale(0.98)';
                    setTimeout(() => {
                        this.style.transform = 'scale(1)';
                    }, 100);
                });
            });
        });
    </script>
</body>
</html>
```

## 🎯 مثال 2: React Component

```jsx
import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const CaptainTrackingDashboard = () => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [stats, setStats] = useState({
    trackedCaptains: 0,
    activeSessions: 0,
    connectedAdmins: 0
  });
  const [captains, setCaptains] = useState([]);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    initializeConnection();
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  const initializeConnection = async () => {
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
      const newSocket = io('http://localhost:5230/admin', {
        auth: { token: data.token },
        transports: ['websocket']
      });

      setupSocketEvents(newSocket);
      setSocket(newSocket);

    } catch (error) {
      addLog('خطأ في الاتصال: ' + error.message, 'error');
    }
  };

  const setupSocketEvents = (socket) => {
    socket.on('connect', () => {
      setIsConnected(true);
      addLog('تم الاتصال بنجاح');
    });

    socket.on('locationUpdate', (data) => {
      setCaptains(prev => {
        const updated = [...prev];
        const index = updated.findIndex(c => c.captainId === data.captainId);
        
        if (index >= 0) {
          updated[index] = data;
        } else {
          updated.push(data);
        }
        
        return updated;
      });
      addLog(`تحديث موقع: ${data.captainId}`);
    });

    socket.on('trackingStats', (newStats) => {
      setStats(newStats);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      addLog('انقطع الاتصال', 'warning');
    });
  };

  const addLog = (message, type = 'info') => {
    const newLog = {
      id: Date.now(),
      message,
      type,
      timestamp: new Date().toLocaleTimeString()
    };
    
    setLogs(prev => [...prev.slice(-49), newLog]);
  };

  const startTracking = () => {
    if (socket && isConnected) {
      socket.emit('startLocationTracking');
      setIsTracking(true);
      addLog('بدء التتبع');
    }
  };

  const stopTracking = () => {
    if (socket && isConnected) {
      socket.emit('stopLocationTracking');
      setIsTracking(false);
      addLog('إيقاف التتبع');
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', direction: 'rtl' }}>
      <h1>🔍 نظام تتبع الكباتن</h1>
      
      {/* حالة الاتصال */}
      <div style={{
        padding: '10px',
        borderRadius: '5px',
        background: isConnected ? '#d4edda' : '#f8d7da',
        color: isConnected ? '#155724' : '#721c24',
        marginBottom: '20px'
      }}>
        {isConnected ? '✅ متصل' : '❌ غير متصل'}
      </div>

      {/* الإحصائيات */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '20px' }}>
        <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
          <h3>🚗 الكباتن المتتبعين</h3>
          <div style={{ fontSize: '2em', color: '#007bff' }}>{stats.trackedCaptains}</div>
        </div>
        <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
          <h3>🔄 الجلسات النشطة</h3>
          <div style={{ fontSize: '2em', color: '#28a745' }}>{stats.activeSessions}</div>
        </div>
        <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
          <h3>👨‍💼 المدراء المتصلين</h3>
          <div style={{ fontSize: '2em', color: '#17a2b8' }}>{stats.connectedAdmins}</div>
        </div>
      </div>

      {/* أزرار التحكم */}
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={startTracking}
          disabled={!isConnected || isTracking}
          style={{
            padding: '10px 20px',
            marginLeft: '10px',
            background: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          🎯 بدء التتبع
        </button>
        <button
          onClick={stopTracking}
          disabled={!isConnected || !isTracking}
          style={{
            padding: '10px 20px',
            background: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          ⏹️ إيقاف التتبع
        </button>
      </div>

      {/* قائمة الكباتن */}
      <h2>📋 الكباتن النشطين</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px', marginBottom: '20px' }}>
        {captains.length === 0 ? (
          <p>لا يوجد كباتن متتبعين حالياً</p>
        ) : (
          captains.map(captain => (
            <div key={captain.captainId} style={{
              background: '#f8f9fa',
              padding: '15px',
              borderRadius: '8px',
              borderRight: `4px solid ${captain.status === 'online' ? '#28a745' : '#dc3545'}`
            }}>
              <h4>{captain.status === 'online' ? '🟢' : '🔴'} {captain.captainId}</h4>
              <p>📍 {captain.location?.lat?.toFixed(6)}, {captain.location?.lng?.toFixed(6)}</p>
              <p>⏰ {new Date(captain.timestamp).toLocaleString()}</p>
            </div>
          ))
        )}
      </div>

      {/* سجل الأحداث */}
      <h2>📝 سجل الأحداث</h2>
      <div style={{
        background: '#f8f9fa',
        border: '1px solid #dee2e6',
        borderRadius: '5px',
        padding: '15px',
        maxHeight: '300px',
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px'
      }}>
        {logs.map(log => (
          <div key={log.id} style={{ marginBottom: '5px', paddingBottom: '5px', borderBottom: '1px solid #eee' }}>
            [{log.timestamp}] {log.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CaptainTrackingDashboard;
```

## 🎯 مثال 3: Vue.js Component

```vue
<template>
  <div class="captain-tracking" dir="rtl">
    <h1>🔍 نظام تتبع الكباتن</h1>
    
    <!-- حالة الاتصال -->
    <div :class="['status', isConnected ? 'connected' : 'disconnected']">
      {{ isConnected ? '✅ متصل' : '❌ غير متصل' }}
    </div>

    <!-- الإحصائيات -->
    <div class="stats-grid">
      <div class="stat-card">
        <h3>🚗 الكباتن المتتبعين</h3>
        <div class="stat-value">{{ stats.trackedCaptains }}</div>
      </div>
      <div class="stat-card">
        <h3>🔄 الجلسات النشطة</h3>
        <div class="stat-value">{{ stats.activeSessions }}</div>
      </div>
      <div class="stat-card">
        <h3>👨‍💼 المدراء المتصلين</h3>
        <div class="stat-value">{{ stats.connectedAdmins }}</div>
      </div>
    </div>

    <!-- أزرار التحكم -->
    <div class="controls">
      <button 
        @click="startTracking" 
        :disabled="!isConnected || isTracking"
        class="btn btn-start"
      >
        🎯 بدء التتبع
      </button>
      <button 
        @click="stopTracking" 
        :disabled="!isConnected || !isTracking"
        class="btn btn-stop"
      >
        ⏹️ إيقاف التتبع
      </button>
    </div>

    <!-- قائمة الكباتن -->
    <h2>📋 الكباتن النشطين</h2>
    <div class="captains-grid">
      <div v-if="captains.length === 0" class="no-captains">
        لا يوجد كباتن متتبعين حالياً
      </div>
      <div 
        v-else 
        v-for="captain in captains" 
        :key="captain.captainId"
        :class="['captain-card', captain.status]"
      >
        <h4>
          {{ captain.status === 'online' ? '🟢' : '🔴' }} 
          {{ captain.captainId }}
        </h4>
        <p>📍 {{ captain.location?.lat?.toFixed(6) }}, {{ captain.location?.lng?.toFixed(6) }}</p>
        <p>⏰ {{ formatDate(captain.timestamp) }}</p>
      </div>
    </div>

    <!-- سجل الأحداث -->
    <h2>📝 سجل الأحداث</h2>
    <div class="log-container">
      <div v-for="log in logs" :key="log.id" class="log-entry">
        [{{ log.timestamp }}] {{ log.message }}
      </div>
    </div>
  </div>
</template>

<script>
import io from 'socket.io-client';

export default {
  name: 'CaptainTracking',
  data() {
    return {
      socket: null,
      isConnected: false,
      isTracking: false,
      stats: {
        trackedCaptains: 0,
        activeSessions: 0,
        connectedAdmins: 0
      },
      captains: [],
      logs: []
    };
  },
  async mounted() {
    await this.initializeConnection();
  },
  beforeUnmount() {
    if (this.socket) {
      this.socket.disconnect();
    }
  },
  methods: {
    async initializeConnection() {
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
        this.socket = io('http://localhost:5230/admin', {
          auth: { token: data.token },
          transports: ['websocket']
        });

        this.setupSocketEvents();

      } catch (error) {
        this.addLog('خطأ في الاتصال: ' + error.message, 'error');
      }
    },

    setupSocketEvents() {
      this.socket.on('connect', () => {
        this.isConnected = true;
        this.addLog('تم الاتصال بنجاح');
      });

      this.socket.on('locationUpdate', (data) => {
        const index = this.captains.findIndex(c => c.captainId === data.captainId);
        
        if (index >= 0) {
          this.captains[index] = data;
        } else {
          this.captains.push(data);
        }
        
        this.addLog(`تحديث موقع: ${data.captainId}`);
      });

      this.socket.on('trackingStats', (stats) => {
        this.stats = stats;
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.addLog('انقطع الاتصال', 'warning');
      });
    },

    startTracking() {
      if (this.socket && this.isConnected) {
        this.socket.emit('startLocationTracking');
        this.isTracking = true;
        this.addLog('بدء التتبع');
      }
    },

    stopTracking() {
      if (this.socket && this.isConnected) {
        this.socket.emit('stopLocationTracking');
        this.isTracking = false;
        this.addLog('إيقاف التتبع');
      }
    },

    addLog(message, type = 'info') {
      const newLog = {
        id: Date.now(),
        message,
        type,
        timestamp: new Date().toLocaleTimeString()
      };
      
      this.logs.push(newLog);
      
      // الاحتفاظ بآخر 50 سجل
      if (this.logs.length > 50) {
        this.logs.shift();
      }
    },

    formatDate(timestamp) {
      return new Date(timestamp).toLocaleString('ar-IQ');
    }
  }
};
</script>

<style scoped>
.captain-tracking {
  padding: 20px;
  font-family: Arial, sans-serif;
}

.status {
  padding: 10px;
  border-radius: 5px;
  margin: 10px 0;
  font-weight: bold;
}

.connected {
  background: #d4edda;
  color: #155724;
}

.disconnected {
  background: #f8d7da;
  color: #721c24;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin: 20px 0;
}

.stat-card {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.stat-value {
  font-size: 2em;
  color: #007bff;
  font-weight: bold;
}

.controls {
  display: flex;
  gap: 10px;
  margin: 20px 0;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-weight: bold;
}

.btn-start {
  background: #28a745;
  color: white;
}

.btn-stop {
  background: #dc3545;
  color: white;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.captains-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 15px;
  margin: 20px 0;
}

.captain-card {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  border-right: 4px solid #007bff;
}

.captain-card.online {
  border-right-color: #28a745;
}

.captain-card.offline {
  border-right-color: #dc3545;
  opacity: 0.7;
}

.no-captains {
  text-align: center;
  color: #6c757d;
  font-style: italic;
}

.log-container {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 5px;
  padding: 15px;
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
}

.log-entry {
  margin: 5px 0;
  padding: 5px 0;
  border-bottom: 1px solid #eee;
}

.log-entry:last-child {
  border-bottom: none;
}
</style>
```

---

هذه الأمثلة تعطي طرق مختلفة لتطبيق نظام تتبع الكباتن باستخدام تقنيات مختلفة، وجميعها تستخدم نفس الـ Socket namespace `/admin` مع المصادقة المطلوبة.
