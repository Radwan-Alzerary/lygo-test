const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

/**
 * اختبار نظام تتبع مواقع الكابتنية من الإدمن
 * يتضمن اختبار الاتصال والمصادقة وتلقي التحديثات
 */

// إعدادات الاختبار
const TEST_CONFIG = {
  serverUrl: 'http://localhost:5230',
  adminNamespace: '/admin',
  jwtSecret: 'kishan sheth super secret key',
  testUser: {
    _id: '6895191c7ab6f95dd55e9e3a',
    name: 'مدير الاختبار',
    role: 'admin',
    permissions: ['location_tracking']
  }
};

console.log('🔍 بدء اختبار نظام تتبع الكابتنية من الإدمن...\n');

async function testLocationTrackingSystem() {
  try {
    // إنتاج JWT token للاختبار
    const testToken = jwt.sign(
      { userId: TEST_CONFIG.testUser._id },
      TEST_CONFIG.jwtSecret,
      { expiresIn: '1h' }
    );

    console.log('🔐 تم إنتاج رمز المصادقة للاختبار');
    console.log('📡 محاولة الاتصال بـ namespace المدير...');

    // الاتصال بـ admin namespace
    const adminSocket = io(`${TEST_CONFIG.serverUrl}${TEST_CONFIG.adminNamespace}`, {
      auth: { token: testToken },
      transports: ['websocket']
    });

    // معالج الاتصال الناجح
    adminSocket.on('connect', () => {
      console.log('✅ تم الاتصال بنجاح بـ admin namespace');
      console.log(`📋 معرف الاتصال: ${adminSocket.id}`);
    });

    // معالج رسالة الترحيب
    adminSocket.on('admin_connected', (data) => {
      console.log('👨‍💼 تم تأكيد اتصال المدير:');
      console.log(`   الاسم: ${data.userInfo.name}`);
      console.log(`   الدور: ${data.userInfo.role}`);
      console.log(`   الصلاحيات: ${data.userInfo.permissions.join(', ')}`);
      console.log(`   إحصائيات النظام: ${JSON.stringify(data.stats, null, 2)}`);
      
      // بدء اختبار الوظائف
      setTimeout(() => {
        testLocationTrackingFeatures(adminSocket);
      }, 1000);
    });

    // معالج استجابة تتبع المواقع
    adminSocket.on('tracking_response', (data) => {
      console.log(`📍 استجابة تتبع المواقع: ${data.message}`);
      if (data.success) {
        console.log(`   معرف الجلسة: ${data.sessionId || 'غير محدد'}`);
        console.log(`   عدد الكباتن: ${data.captainCount || 0}`);
      }
    });

    // معالج المواقع الأولية
    adminSocket.on('captain_locations_initial', (data) => {
      console.log(`🗺️  تم استلام المواقع الأولية:`);
      console.log(`   عدد الكباتن: ${data.count}`);
      console.log(`   الوقت: ${data.timestamp}`);
      
      if (data.data && data.data.length > 0) {
        data.data.forEach((captain, index) => {
          console.log(`   كابتن ${index + 1}:`);
          console.log(`     المعرف: ${captain.captainId}`);
          console.log(`     الاسم: ${captain.captainName}`);
          console.log(`     الموقع: (${captain.latitude}, ${captain.longitude})`);
          console.log(`     متصل: ${captain.isOnline ? 'نعم' : 'لا'}`);
          console.log(`     الحالة: ${captain.status}`);
        });
      } else {
        console.log('   📭 لا يوجد كباتن متتبعين حالياً');
      }
    });

    // معالج تحديثات المواقع
    adminSocket.on('captain_location_update', (data) => {
      if (data.type === 'location_update') {
        console.log(`📍 تحديث موقع كابتن: ${data.data.captainName}`);
        console.log(`   الموقع الجديد: (${data.data.latitude}, ${data.data.longitude})`);
        console.log(`   السرعة: ${data.data.speed || 'غير محدد'} كم/ساعة`);
        console.log(`   وقت التحديث: ${data.data.timestamp}`);
      } else if (data.type === 'location_removed') {
        console.log(`❌ تم إزالة موقع كابتن: ${data.captainId}`);
      }
    });

    // معالج الإحصائيات
    adminSocket.on('tracking_stats', (data) => {
      console.log('📊 إحصائيات تتبع المواقع:');
      if (data.locationStats) {
        console.log(`   الجلسات النشطة: ${data.locationStats.activeSessions}`);
        console.log(`   الكباتن المتتبعين: ${data.locationStats.trackedCaptains}`);
      }
      if (data.adminStats) {
        console.log(`   المدراء المتصلين: ${data.adminStats.connectedAdmins}`);
        console.log(`   المدراء المتتبعين: ${data.adminStats.trackingAdmins}`);
      }
    });

    // معالج الأخطاء
    adminSocket.on('error', (error) => {
      console.log(`❌ خطأ: ${error.message}`);
    });

    // معالج انقطاع الاتصال
    adminSocket.on('disconnect', (reason) => {
      console.log(`🔌 انقطع الاتصال: ${reason}`);
    });

    // اختبار timeout
    setTimeout(() => {
      console.log('\n⏰ انتهت مدة الاختبار');
      adminSocket.disconnect();
      process.exit(0);
    }, 30000);

  } catch (error) {
    console.error('❌ خطأ في الاختبار:', error);
    process.exit(1);
  }
}

function testLocationTrackingFeatures(socket) {
  console.log('\n🧪 بدء اختبار وظائف تتبع المواقع...\n');

  // اختبار 1: بدء تتبع المواقع
  setTimeout(() => {
    console.log('🔍 اختبار 1: بدء تتبع المواقع');
    socket.emit('start_location_tracking');
  }, 1000);

  // اختبار 2: طلب المواقع الحالية
  setTimeout(() => {
    console.log('🔍 اختبار 2: طلب المواقع الحالية');
    socket.emit('get_current_locations');
  }, 3000);

  // اختبار 3: طلب الإحصائيات
  setTimeout(() => {
    console.log('🔍 اختبار 3: طلب إحصائيات التتبع');
    socket.emit('get_tracking_stats');
  }, 5000);

  // اختبار 4: التركيز على كابتن (إذا كان موجود)
  setTimeout(() => {
    console.log('🔍 اختبار 4: محاولة التركيز على كابتن وهمي');
    socket.emit('focus_captain', { captainId: 'test_captain_123' });
  }, 7000);

  // اختبار 5: إيقاف تتبع المواقع
  setTimeout(() => {
    console.log('🔍 اختبار 5: إيقاف تتبع المواقع');
    socket.emit('stop_location_tracking');
  }, 10000);
}

// بدء الاختبار
testLocationTrackingSystem();
