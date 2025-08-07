const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

console.log('🔍 اختبار الاتصال بنظام تتبع المواقع...\n');

// إنشاء JWT token
const testUserId = '68951ba247b6301bd85dcbf4';
const jwtSecret = 'kishan sheth super secret key';

const testToken = jwt.sign(
  { userId: testUserId },
  jwtSecret,
  { expiresIn: '1h' }
);

console.log('🔐 JWT Token created:', testToken.substring(0, 20) + '...');

// محاولة الاتصال بـ admin namespace
const socket = io('http://localhost:5230/admin', {
  auth: { token: testToken },
  transports: ['websocket'],
  forceNew: true
});

console.log('📡 محاولة الاتصال...');

socket.on('connect', () => {
  console.log('✅ تم الاتصال بنجاح!');
  console.log('📋 معرف الاتصال:', socket.id);
});

socket.on('connect_error', (error) => {
  console.log('❌ خطأ في الاتصال:', error.message);
});

socket.on('admin_connected', (data) => {
  console.log('👨‍💼 تم تأكيد اتصال المدير');
  console.log('📊 البيانات المستلمة:', data);
  
  // اختبار بدء التتبع
  console.log('\n🔄 بدء اختبار التتبع...');
  socket.emit('start_location_tracking');
});

socket.on('tracking_response', (data) => {
  console.log('📍 رد تتبع المواقع:', data);
});

socket.on('error', (error) => {
  console.log('❌ خطأ Socket:', error);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 انقطع الاتصال:', reason);
});

// انتظار 10 ثوان ثم إنهاء الاختبار
setTimeout(() => {
  console.log('\n⏰ إنهاء الاختبار...');
  socket.disconnect();
  process.exit(0);
}, 10000);
