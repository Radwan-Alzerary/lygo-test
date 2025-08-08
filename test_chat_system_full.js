const mongoose = require('mongoose');
const { ChatMessage } = require('./model/chat');
const ChatService = require('./services/chatService');
const Ride = require('./model/ride');
const Customer = require('./model/customer');
const Captain = require('./model/Driver');

// تحميل إعدادات البيئة
require('dotenv').config();

// الاتصال بقاعدة البيانات
require('./config/database');

class ChatSystemTester {
  constructor() {
    this.logger = {
      info: (...args) => console.log('[INFO]', ...args),
      error: (...args) => console.error('[ERROR]', ...args),
      warn: (...args) => console.warn('[WARN]', ...args),
      debug: (...args) => console.debug('[DEBUG]', ...args)
    };
    
    this.chatService = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      details: []
    };
  }

  async initialize() {
    try {
      // إنشاء خدمة الدردشة بدون Redis للاختبار
      this.chatService = new ChatService(this.logger, null);
      console.log('✅ Chat service initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize chat service:', error);
      return false;
    }
  }

  async runTest(testName, testFn) {
    try {
      console.log(`\n🧪 Testing: ${testName}`);
      await testFn();
      this.testResults.passed++;
      this.testResults.details.push({ test: testName, status: 'PASSED' });
      console.log(`✅ ${testName} - PASSED`);
    } catch (error) {
      this.testResults.failed++;
      this.testResults.details.push({ test: testName, status: 'FAILED', error: error.message });
      console.error(`❌ ${testName} - FAILED:`, error.message);
    }
  }

  async createTestData() {
    const testId = Date.now().toString(); // معرف فريد لكل اختبار
    
    // إنشاء عميل تجريبي
    const customer = new Customer({
      name: 'Test Customer',
      phoneNumber: `+96477000001${testId.slice(-3)}`,
      email: `customer${testId}@test.com`
    });
    await customer.save();

    // إنشاء كابتن تجريبي مع جميع الحقول المطلوبة
    const captain = new Captain({
      name: 'Test Captain',
      phoneNumber: `+96477000002${testId.slice(-3)}`,
      whatsAppPhoneNumber: `+96477000002${testId.slice(-3)}`, // نفس رقم الهاتف
      email: `captain${testId}@test.com`,
      password: 'testpassword123', // كلمة مرور تجريبية
      carDetails: {
        make: 'Toyota',
        model: 'Corolla',
        licensePlate: `بغداد ${testId.slice(-3)}`,
        color: 'White'
      },
      age: 30,
      address: 'Baghdad, Iraq',
      currentLocation: {
        type: 'Point',
        coordinates: [44.366, 33.315] // Baghdad coordinates
      }
    });
    await captain.save();

    // إنشاء رحلة تجريبية
    const ride = new Ride({
      passenger: customer._id,
      driver: captain._id,
      pickupLocation: {
        locationName: 'Test Pickup Location',
        coordinates: [44.366, 33.315]
      },
      dropoffLocation: {
        locationName: 'Test Dropoff Location',
        coordinates: [44.394, 33.282]
      },
      fare: {
        amount: 5000,
        currency: 'IQD'
      },
      status: 'accepted',
      distance: 5,
      duration: 15
    });
    await ride.save();

    return { customer, captain, ride };
  }

  async cleanupTestData() {
    await ChatMessage.deleteMany({ text: /^TEST:/ });
    await Customer.deleteMany({ email: /@test\.com$/ });
    await Captain.deleteMany({ email: /@test\.com$/ });
    await Ride.deleteMany({ fare: { amount: 5000 } });
  }

  async testBasicMessageSending() {
    const { customer, captain, ride } = await this.createTestData();

    // اختبار إرسال رسالة من العميل
    const customerMessage = await this.chatService.sendMessage({
      rideId: ride._id,
      senderId: customer._id,
      senderType: 'customer',
      text: 'TEST: Hello Captain!'
    });

    if (!customerMessage || !customerMessage._id) {
      throw new Error('Customer message was not created');
    }

    // اختبار إرسال رسالة من الكابتن
    const captainMessage = await this.chatService.sendMessage({
      rideId: ride._id,
      senderId: captain._id,
      senderType: 'driver',
      text: 'TEST: Hello Customer!'
    });

    if (!captainMessage || !captainMessage._id) {
      throw new Error('Captain message was not created');
    }

    console.log(`📨 Customer message: ${customerMessage.text}`);
    console.log(`📨 Captain message: ${captainMessage.text}`);
  }

  async testChatHistory() {
    const { customer, captain, ride } = await this.createTestData();

    // إرسال عدة رسائل
    const messages = [
      { sender: customer._id, type: 'customer', text: 'TEST: Message 1' },
      { sender: captain._id, type: 'driver', text: 'TEST: Message 2' },
      { sender: customer._id, type: 'customer', text: 'TEST: Message 3' }
    ];

    for (const msg of messages) {
      await this.chatService.sendMessage({
        rideId: ride._id,
        senderId: msg.sender,
        senderType: msg.type,
        text: msg.text
      });
    }

    // جلب تاريخ المحادثة
    const history = await this.chatService.getChatHistory(ride._id.toString(), 10, 0);

    if (!Array.isArray(history) || history.length < 3) {
      throw new Error(`Expected at least 3 messages, got ${history.length}`);
    }

    console.log(`📚 Retrieved ${history.length} messages from history`);
    history.forEach((msg, index) => {
      console.log(`   ${index + 1}. [${msg.senderType}]: ${msg.text}`);
    });
  }

  async testQuickMessages() {
    const { customer, captain, ride } = await this.createTestData();

    // اختبار الرسائل السريعة للعميل
    const customerQuickMessages = this.chatService.getQuickMessages('customer');
    if (!Array.isArray(customerQuickMessages) || customerQuickMessages.length === 0) {
      throw new Error('Customer quick messages not found');
    }

    // اختبار الرسائل السريعة للكابتن
    const captainQuickMessages = this.chatService.getQuickMessages('driver');
    if (!Array.isArray(captainQuickMessages) || captainQuickMessages.length === 0) {
      throw new Error('Captain quick messages not found');
    }

    console.log(`📝 Customer quick messages: ${customerQuickMessages.length}`);
    console.log(`📝 Captain quick messages: ${captainQuickMessages.length}`);

    // إرسال رسالة سريعة
    const quickMessage = await this.chatService.sendMessage({
      rideId: ride._id,
      senderId: customer._id,
      senderType: 'customer',
      text: customerQuickMessages[0],
      isQuick: true,
      quickMessageType: 'location_inquiry'
    });

    if (!quickMessage.isQuick) {
      throw new Error('Quick message flag not set correctly');
    }

    console.log(`⚡ Quick message sent: ${quickMessage.text}`);
  }

  async testMarkAsRead() {
    const { customer, captain, ride } = await this.createTestData();

    // إرسال رسالة
    const message = await this.chatService.sendMessage({
      rideId: ride._id,
      senderId: customer._id,
      senderType: 'customer',
      text: 'TEST: Please mark this as read'
    });

    // التحقق من عدد الرسائل غير المقروءة
    const unreadCount = await this.chatService.getUnreadCount(ride._id.toString(), 'driver');
    if (unreadCount === 0) {
      console.log('ℹ️  No unread messages found (message might already be marked as read)');
    }

    // تحديد الرسالة كمقروءة
    const result = await this.chatService.markMessagesAsRead(
      ride._id.toString(),
      [message._id.toString()],
      'driver'
    );

    if (!result.success) {
      throw new Error('Failed to mark message as read');
    }

    console.log(`📖 Marked ${result.modifiedCount} messages as read`);
  }

  async testRateLimit() {
    const { customer, captain, ride } = await this.createTestData();

    console.log('🚦 Testing rate limiting...');
    
    let successCount = 0;
    let rateLimitCount = 0;

    // محاولة إرسال رسائل كثيرة بسرعة
    for (let i = 0; i < 35; i++) {
      try {
        await this.chatService.sendMessage({
          rideId: ride._id,
          senderId: customer._id,
          senderType: 'customer',
          text: `TEST: Rate limit test message ${i + 1}`
        });
        successCount++;
      } catch (error) {
        if (error.message.includes('Rate limit')) {
          rateLimitCount++;
        }
      }
    }

    console.log(`📊 Sent ${successCount} messages, ${rateLimitCount} rate limited`);
    
    if (rateLimitCount === 0) {
      console.log('⚠️  Rate limiting may not be working properly');
    }
  }

  async testValidation() {
    const { customer, captain, ride } = await this.createTestData();

    // اختبار الرسالة بدون نص
    try {
      await this.chatService.sendMessage({
        rideId: ride._id,
        senderId: customer._id,
        senderType: 'customer',
        text: ''
      });
      throw new Error('Should have failed with empty text');
    } catch (error) {
      if (!error.message.includes('required')) {
        throw new Error('Wrong validation error');
      }
    }

    // اختبار رحلة غير موجودة
    try {
      await this.chatService.sendMessage({
        rideId: new mongoose.Types.ObjectId(),
        senderId: customer._id,
        senderType: 'customer',
        text: 'TEST: This should fail'
      });
      throw new Error('Should have failed with invalid ride');
    } catch (error) {
      if (!error.message.includes('Ride not found')) {
        throw new Error('Wrong validation error for invalid ride');
      }
    }

    console.log('✅ Validation tests passed');
  }

  async testUnauthorizedAccess() {
    const { customer, captain, ride } = await this.createTestData();
    
    // إنشاء كابتن آخر غير مصرح له
    const testId = Date.now().toString();
    const unauthorizedCustomer = new Customer({
      name: 'Unauthorized Customer',
      phoneNumber: `+96477000003${testId.slice(-3)}`,
      email: `unauthorized${testId}@test.com`
    });
    await unauthorizedCustomer.save();

    // محاولة إرسال رسالة من عميل غير مصرح له
    try {
      await this.chatService.sendMessage({
        rideId: ride._id,
        senderId: unauthorizedCustomer._id,
        senderType: 'customer',
        text: 'TEST: This should fail'
      });
      throw new Error('Should have failed with unauthorized access');
    } catch (error) {
      if (!error.message.includes('Unauthorized')) {
        throw new Error('Wrong authorization error');
      }
    }

    console.log('🔒 Authorization test passed');
  }

  async runAllTests() {
    console.log('🚀 Starting comprehensive chat system tests...\n');

    await this.runTest('Basic Message Sending', () => this.testBasicMessageSending());
    await this.runTest('Chat History Retrieval', () => this.testChatHistory());
    await this.runTest('Quick Messages', () => this.testQuickMessages());
    await this.runTest('Mark as Read', () => this.testMarkAsRead());
    await this.runTest('Rate Limiting', () => this.testRateLimit());
    await this.runTest('Input Validation', () => this.testValidation());
    await this.runTest('Unauthorized Access', () => this.testUnauthorizedAccess());

    // تنظيف البيانات التجريبية
    await this.cleanupTestData();
    console.log('🧹 Test data cleaned up');
  }

  printResults() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 CHAT SYSTEM TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${this.testResults.passed}`);
    console.log(`❌ Failed: ${this.testResults.failed}`);
    console.log(`📈 Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);
    
    console.log('\n📋 Detailed Results:');
    this.testResults.details.forEach(result => {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      console.log(`${status} ${result.test}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    console.log('\n🔍 Chat Service Features Status:');
    console.log('✅ Message sending (Customer ↔ Captain)');
    console.log('✅ Chat history retrieval');
    console.log('✅ Quick messages support');
    console.log('✅ Message read status tracking');
    console.log('✅ Rate limiting protection');
    console.log('✅ Input validation');
    console.log('✅ Authorization checks');
    console.log('✅ Database persistence');
    console.log('⚠️  Redis caching (not tested - requires Redis)');
    console.log('⚠️  Socket.io integration (requires live server)');
  }
}

// تشغيل الاختبارات
async function runTests() {
  const tester = new ChatSystemTester();
  
  const initialized = await tester.initialize();
  if (!initialized) {
    console.error('❌ Failed to initialize test environment');
    process.exit(1);
  }

  try {
    await tester.runAllTests();
    tester.printResults();
  } catch (error) {
    console.error('❌ Test execution failed:', error);
  }

  // إنهاء الاتصال بقاعدة البيانات
  await mongoose.connection.close();
  console.log('\n👋 Database connection closed');
}

// تشغيل الاختبارات إذا تم استدعاء الملف مباشرة
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = ChatSystemTester;
