// 🚀 كود جاهز لتطبيق نظام متابعة الكابتنية - Frontend
// نسخ هذا الكود مباشرة إلى مشروع الفرونت اند

/* ====================================
   1. متغيرات النظام
   ==================================== */
let adminSocket = null;
let isTracking = false;
let captainsList = new Map();
let captainMarkers = new Map();
let map = null;

/* ====================================
   2. تسجيل الدخول والمصادقة
   ==================================== */
async function loginAdmin(email, password) {
    try {
        const response = await fetch('/users/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        if (data.status) {
            localStorage.setItem('adminToken', data.token);
            localStorage.setItem('userId', data.user);
            return true;
        } else {
            throw new Error('فشل تسجيل الدخول');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('خطأ في تسجيل الدخول: ' + error.message);
        return false;
    }
}

/* ====================================
   3. اتصال Socket.IO
   ==================================== */
function connectAdminSocket() {
    const token = localStorage.getItem('adminToken');
    if (!token) {
        showError('لم يتم العثور على رمز المصادقة');
        return false;
    }

    adminSocket = io('/admin', {
        auth: { token: token },
        transports: ['websocket']
    });

    // معالجة الأحداث
    adminSocket.on('connect', () => {
        console.log('✅ متصل بنظام المراقبة');
        updateConnectionStatus(true);
        showSuccess('تم الاتصال بنظام المراقبة');
    });

    adminSocket.on('connect_error', (error) => {
        console.error('❌ خطأ الاتصال:', error.message);
        updateConnectionStatus(false);
        showError('فشل الاتصال: ' + error.message);
    });

    adminSocket.on('admin_connected', (data) => {
        console.log('👨‍💼 أهلاً', data.userInfo.name);
        updateStatsDisplay(data.stats);
        showInfo(`مرحباً ${data.userInfo.name} (${data.userInfo.role})`);
    });

    adminSocket.on('disconnect', (reason) => {
        console.log('🔌 انقطع الاتصال:', reason);
        updateConnectionStatus(false);
        isTracking = false;
    });

    adminSocket.on('tracking_response', (data) => {
        if (data.success) {
            isTracking = data.sessionId ? true : false;
            showSuccess(data.message);
            updateTrackingControls();
        } else {
            showError(data.message);
        }
    });

    adminSocket.on('captain_locations_initial', (data) => {
        console.log(`📍 تم استلام ${data.count} موقع كابتن`);
        updateCaptainsList(data.data);
        updateMapMarkers(data.data);
        showInfo(`تم استلام ${data.count} موقع`);
    });

    adminSocket.on('captain_location_update', (data) => {
        if (data.type === 'location_update') {
            updateCaptainLocation(data.data);
            updateMapMarker(data.data);
        } else if (data.type === 'location_removed') {
            removeCaptain(data.captainId);
        }
    });

    adminSocket.on('tracking_stats', (data) => {
        updateStatsDisplay(data);
    });

    return true;
}

/* ====================================
   4. وظائف تتبع المواقع
   ==================================== */
function startLocationTracking() {
    if (!adminSocket || !adminSocket.connected) {
        showError('غير متصل بالنظام');
        return;
    }

    if (isTracking) {
        showInfo('التتبع نشط بالفعل');
        return;
    }

    console.log('🎯 بدء تتبع المواقع...');
    adminSocket.emit('start_location_tracking');
    updateTrackingStatus('جاري بدء التتبع...');
}

function stopLocationTracking() {
    if (!adminSocket || !adminSocket.connected) {
        showError('غير متصل بالنظام');
        return;
    }

    if (!isTracking) {
        showInfo('التتبع متوقف بالفعل');
        return;
    }

    console.log('⏹️ إيقاف تتبع المواقع...');
    adminSocket.emit('stop_location_tracking');
    updateTrackingStatus('جاري إيقاف التتبع...');
}

function getCurrentLocations() {
    if (!adminSocket || !adminSocket.connected) {
        showError('غير متصل بالنظام');
        return;
    }

    adminSocket.emit('get_current_locations');
    showInfo('جاري تحديث المواقع...');
}

function getTrackingStats() {
    if (!adminSocket || !adminSocket.connected) {
        showError('غير متصل بالنظام');
        return;
    }

    adminSocket.emit('get_tracking_stats');
}

function focusOnCaptain(captainId) {
    if (!adminSocket || !adminSocket.connected) {
        showError('غير متصل بالنظام');
        return;
    }

    adminSocket.emit('focus_captain', { captainId });
}

/* ====================================
   5. إدارة قائمة الكباتن
   ==================================== */
function updateCaptainsList(locations) {
    const container = document.getElementById('captainsList');
    if (!container) return;
    
    if (!locations || locations.length === 0) {
        container.innerHTML = '<p class="no-captains">لا يوجد كباتن متتبعين حالياً</p>';
        return;
    }

    let html = '';
    locations.forEach(captain => {
        captainsList.set(captain.captainId, captain);
        html += createCaptainCard(captain);
    });

    container.innerHTML = html;
    updateCaptainsCount(locations.length);
}

function createCaptainCard(captain) {
    const lastUpdate = new Date(captain.timestamp).toLocaleTimeString('ar');
    const statusClass = captain.isOnline ? 'online' : 'offline';
    const statusText = captain.isOnline ? 'متصل' : 'غير متصل';
    
    return `
        <div class="captain-card ${statusClass}" id="captain_${captain.captainId}">
            <div class="captain-header">
                <h4>${captain.captainName}</h4>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="captain-info">
                <p>📞 ${captain.captainPhone}</p>
                <p>📍 (${captain.latitude.toFixed(4)}, ${captain.longitude.toFixed(4)})</p>
                <p>⏰ آخر تحديث: ${lastUpdate}</p>
                ${captain.speed ? `<p>🏃‍♂️ السرعة: ${Math.round(captain.speed)} كم/ساعة</p>` : ''}
                ${captain.status ? `<p>📊 الحالة: ${captain.status}</p>` : ''}
            </div>
            <div class="captain-actions">
                <button onclick="focusOnCaptain('${captain.captainId}')" class="btn-focus">
                    🎯 تتبع
                </button>
                <button onclick="showCaptainDetails('${captain.captainId}')" class="btn-details">
                    📋 التفاصيل
                </button>
            </div>
        </div>
    `;
}

function updateCaptainLocation(captain) {
    captainsList.set(captain.captainId, captain);
    
    const existingCard = document.getElementById(`captain_${captain.captainId}`);
    if (existingCard) {
        existingCard.outerHTML = createCaptainCard(captain);
    } else {
        // إضافة كابتن جديد
        addNewCaptainToList(captain);
    }
    
    logLocationUpdate(captain);
}

function removeCaptain(captainId) {
    captainsList.delete(captainId);
    
    const card = document.getElementById(`captain_${captainId}`);
    if (card) {
        card.remove();
    }
    
    removeMapMarker(captainId);
    updateCaptainsCount(captainsList.size);
    
    const captain = captainsList.get(captainId);
    if (captain) {
        addLogEntry(`❌ الكابتن ${captain.captainName} غير متصل`, 'warning');
    }
}

/* ====================================
   6. إدارة الخريطة (Google Maps)
   ==================================== */
function initMap() {
    if (typeof google === 'undefined') {
        console.warn('Google Maps API غير محملة');
        return;
    }

    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 10,
        center: { lat: 36.3350, lng: 43.1189 }, // الموصل
        mapTypeId: 'roadmap'
    });
    
    console.log('🗺️ تم تهيئة الخريطة');
}

function updateMapMarkers(locations) {
    if (!map) return;
    
    // مسح العلامات القديمة
    captainMarkers.forEach(marker => marker.setMap(null));
    captainMarkers.clear();

    // إضافة علامات جديدة
    locations.forEach(captain => {
        addCaptainMarker(captain);
    });
}

function addCaptainMarker(captain) {
    if (!map) return;
    
    const marker = new google.maps.Marker({
        position: { lat: captain.latitude, lng: captain.longitude },
        map: map,
        title: captain.captainName,
        icon: {
            url: captain.isOnline ? '/img/captain-online.png' : '/img/captain-offline.png',
            scaledSize: new google.maps.Size(32, 32)
        }
    });

    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div class="marker-info">
                <h4>${captain.captainName}</h4>
                <p>📞 ${captain.captainPhone}</p>
                <p>📍 ${captain.latitude.toFixed(4)}, ${captain.longitude.toFixed(4)}</p>
                <p>⏰ ${new Date(captain.timestamp).toLocaleTimeString('ar')}</p>
                ${captain.speed ? `<p>🏃‍♂️ ${Math.round(captain.speed)} كم/ساعة</p>` : ''}
            </div>
        `
    });

    marker.addListener('click', () => {
        infoWindow.open(map, marker);
    });

    captainMarkers.set(captain.captainId, marker);
}

function updateMapMarker(captain) {
    if (!map) return;
    
    const marker = captainMarkers.get(captain.captainId);
    if (marker) {
        marker.setPosition({ lat: captain.latitude, lng: captain.longitude });
        marker.setIcon({
            url: captain.isOnline ? '/img/captain-online.png' : '/img/captain-offline.png',
            scaledSize: new google.maps.Size(32, 32)
        });
    } else {
        addCaptainMarker(captain);
    }
}

function removeMapMarker(captainId) {
    const marker = captainMarkers.get(captainId);
    if (marker) {
        marker.setMap(null);
        captainMarkers.delete(captainId);
    }
}

/* ====================================
   7. وظائف واجهة المستخدم
   ==================================== */
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connectionStatus');
    if (!statusElement) return;
    
    const indicator = statusElement.querySelector('.status-indicator');
    const text = statusElement.querySelector('.status-text');
    
    if (connected) {
        if (indicator) indicator.classList.add('connected');
        if (text) text.textContent = 'متصل';
    } else {
        if (indicator) indicator.classList.remove('connected');
        if (text) text.textContent = 'غير متصل';
    }
}

function updateStatsDisplay(data) {
    if (data.locationStats || data.stats) {
        const stats = data.locationStats || data.stats;
        updateStatValue('trackedCaptains', stats.trackedCaptains || 0);
        updateStatValue('activeSessions', stats.activeSessions || 0);
    }

    if (data.adminStats) {
        updateStatValue('connectedAdmins', data.adminStats.connectedAdmins || 0);
        updateStatValue('trackingAdmins', data.adminStats.trackingAdmins || 0);
    }
}

function updateStatValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
    }
}

function updateCaptainsCount(count) {
    updateStatValue('trackedCaptains', count);
}

function updateTrackingStatus(status) {
    addLogEntry(status, 'info');
}

function updateTrackingControls() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    if (startBtn && stopBtn) {
        if (isTracking) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            startBtn.textContent = '✅ التتبع نشط';
            stopBtn.textContent = '⏹️ إيقاف التتبع';
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
            startBtn.textContent = '🎯 بدء التتبع';
            stopBtn.textContent = '⏹️ متوقف';
        }
    }
}

/* ====================================
   8. النوافذ المنبثقة والإشعارات
   ==================================== */
function showSuccess(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}

function showInfo(message) {
    showNotification(message, 'info');
}

function showNotification(message, type) {
    // إنشاء إشعار
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${getNotificationIcon(type)}</span>
        <span class="notification-text">${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    // إضافة للصفحة
    let container = document.getElementById('notifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notifications';
        container.className = 'notifications-container';
        document.body.appendChild(container);
    }
    
    container.appendChild(notification);
    
    // إزالة تلقائية بعد 5 ثوان
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

function getNotificationIcon(type) {
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };
    return icons[type] || 'ℹ️';
}

/* ====================================
   9. سجل الأنشطة
   ==================================== */
function addLogEntry(message, type = 'info') {
    const log = document.getElementById('activityLog');
    if (!log) return;
    
    const timestamp = new Date().toLocaleTimeString('ar');
    
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `
        <span class="log-timestamp">[${timestamp}]</span>
        <span class="log-message">${message}</span>
    `;
    
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    
    // الاحتفاظ بآخر 50 إدخال فقط
    while (log.children.length > 50) {
        log.removeChild(log.firstChild);
    }
}

function logLocationUpdate(captain) {
    addLogEntry(
        `📍 تحديث موقع: ${captain.captainName} - (${captain.latitude.toFixed(4)}, ${captain.longitude.toFixed(4)})`,
        'info'
    );
}

/* ====================================
   10. وظائف مساعدة إضافية
   ==================================== */
function showCaptainDetails(captainId) {
    const captain = captainsList.get(captainId);
    if (!captain) return;
    
    const details = `
        <div class="captain-details">
            <h3>تفاصيل الكابتن: ${captain.captainName}</h3>
            <p><strong>الهاتف:</strong> ${captain.captainPhone}</p>
            <p><strong>الموقع:</strong> ${captain.latitude.toFixed(6)}, ${captain.longitude.toFixed(6)}</p>
            <p><strong>الدقة:</strong> ${captain.accuracy || 'غير محدد'} متر</p>
            <p><strong>السرعة:</strong> ${captain.speed ? Math.round(captain.speed) + ' كم/ساعة' : 'غير محدد'}</p>
            <p><strong>الاتجاه:</strong> ${captain.heading || 'غير محدد'} درجة</p>
            <p><strong>الارتفاع:</strong> ${captain.altitude || 'غير محدد'} متر</p>
            <p><strong>الحالة:</strong> ${captain.isOnline ? 'متصل' : 'غير متصل'}</p>
            <p><strong>حالة العمل:</strong> ${captain.status || 'غير محدد'}</p>
            <p><strong>آخر تحديث:</strong> ${new Date(captain.timestamp).toLocaleString('ar')}</p>
        </div>
    `;
    
    showModal('تفاصيل الكابتن', details);
}

function showModal(title, content) {
    // إنشاء نافذة منبثقة
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // إغلاق بالنقر خارج النافذة
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function refreshAllData() {
    getCurrentLocations();
    getTrackingStats();
    showInfo('تم تحديث جميع البيانات');
}

/* ====================================
   11. تهيئة التطبيق
   ==================================== */
function initApp() {
    console.log('🚀 بدء تطبيق مراقبة الكابتن...');
    
    // تحقق من وجود الرمز المميز
    const token = localStorage.getItem('adminToken');
    if (!token) {
        showError('يرجى تسجيل الدخول أولاً');
        // إعادة توجيه لصفحة تسجيل الدخول
        // window.location.href = '/login';
        return;
    }
    
    // اتصال Socket
    if (connectAdminSocket()) {
        console.log('✅ تم الاتصال بالنظام');
    } else {
        showError('فشل في الاتصال بالنظام');
        return;
    }
    
    // تهيئة الخريطة
    setTimeout(() => {
        initMap();
    }, 1000);
    
    // تحديث دوري للإحصائيات
    setInterval(() => {
        if (adminSocket && adminSocket.connected) {
            getTrackingStats();
        }
    }, 30000); // كل 30 ثانية
    
    console.log('✅ تم تهيئة التطبيق بنجاح');
    addLogEntry('تم تهيئة نظام مراقبة الكابتن', 'success');
}

/* ====================================
   12. بدء التطبيق عند تحميل الصفحة
   ==================================== */
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// تصدير الوظائف للاستخدام العام
window.LocationTracker = {
    startTracking: startLocationTracking,
    stopTracking: stopLocationTracking,
    refreshData: refreshAllData,
    focusCaptain: focusOnCaptain,
    showDetails: showCaptainDetails
};

console.log('📍 نظام مراقبة الكابتن جاهز للاستخدام!');

/* ====================================
   ملاحظات للمطور:
   
   1. تأكد من تضمين Socket.IO Client:
      <script src="/socket.io/socket.io.js"></script>
   
   2. تأكد من تضمين Google Maps API:
      <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_KEY&callback=initMap"></script>
   
   3. أضف الـ HTML المطلوب:
      - عنصر بمعرف 'captainsList' لقائمة الكباتن
      - عنصر بمعرف 'map' للخريطة  
      - عنصر بمعرف 'activityLog' لسجل الأنشطة
      - عناصر الإحصائيات: 'trackedCaptains', 'activeSessions', 'connectedAdmins'
      - عنصر حالة الاتصال: 'connectionStatus'
   
   4. أضف ملف CSS للتصميم
   
   5. اختبر النظام مع:
      - البريد: admin@admin.com
      - كلمة المرور: 11223344
   
   ==================================== */
