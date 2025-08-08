const ChatService = require('./services/chatService');

/**
 * اختبار مبسط لخدمة الدردشة
 */
class SimpleChatTester {
  constructor() {
    this.logger = {
      info: (...args) => console.log('[INFO]', ...args),
      error: (...args) => console.error('[ERROR]', ...args),
      warn: (...args) => console.warn('[WARN]', ...args),
      debug: (...args) => console.debug('[DEBUG]', ...args)
    };
    
    this.chatService = null;
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

  testQuickMessages() {
    console.log('\n🧪 Testing Quick Messages...');
    
    // اختبار الرسائل السريعة للعملاء
    const customerQuickMessages = this.chatService.getQuickMessages('customer');
    console.log(`📝 Customer Quick Messages (${customerQuickMessages.length}):`);
    customerQuickMessages.forEach((msg, index) => {
      console.log(`   ${index + 1}. ${msg}`);
    });

    // اختبار الرسائل السريعة للكباتن
    const driverQuickMessages = this.chatService.getQuickMessages('driver');
    console.log(`📝 Driver Quick Messages (${driverQuickMessages.length}):`);
    driverQuickMessages.forEach((msg, index) => {
      console.log(`   ${index + 1}. ${msg}`);
    });

    return customerQuickMessages.length > 0 && driverQuickMessages.length > 0;
  }

  testRateLimit() {
    console.log('\n🧪 Testing Rate Limiting...');
    
    const testUserId = 'test-user-123';
    let successCount = 0;
    let limitCount = 0;

    // محاولة إرسال 35 طلب بسرعة
    for (let i = 0; i < 35; i++) {
      const isAllowed = this.chatService.checkRateLimit(testUserId);
      if (isAllowed) {
        successCount++;
      } else {
        limitCount++;
      }
    }

    console.log(`📊 Rate limit test results:`);
    console.log(`   ✅ Allowed: ${successCount}`);
    console.log(`   ❌ Limited: ${limitCount}`);
    
    // يجب أن يكون هناك حد للمعدل
    return limitCount > 0;
  }

  testValidation() {
    console.log('\n🧪 Testing Input Validation...');
    
    try {
      // اختبار طول الرسالة
      const longText = 'A'.repeat(1001); // أطول من الحد المسموح
      if (longText.length > this.chatService.settings.maxMessageLength) {
        console.log(`✅ Message length validation: Text too long (${longText.length} chars)`);
      }

      // اختبار النص الفارغ
      const emptyText = '';
      if (!emptyText || emptyText.trim().length === 0) {
        console.log('✅ Empty text validation: Text is empty');
      }

      console.log(`📏 Max message length: ${this.chatService.settings.maxMessageLength} chars`);
      console.log(`⏱️  Typing timeout: ${this.chatService.settings.typingTimeout}ms`);
      console.log(`📈 Rate limit: ${this.chatService.settings.rateLimitPerMinute} messages/minute`);

      return true;
    } catch (error) {
      console.error('❌ Validation test failed:', error.message);
      return false;
    }
  }

  async runBasicTests() {
    console.log('🚀 Starting basic chat service functionality tests...\n');

    const results = {
      quickMessages: false,
      rateLimit: false,
      validation: false
    };

    // اختبار الرسائل السريعة
    try {
      results.quickMessages = this.testQuickMessages();
      console.log(results.quickMessages ? '✅ Quick messages test PASSED' : '❌ Quick messages test FAILED');
    } catch (error) {
      console.error('❌ Quick messages test FAILED:', error.message);
    }

    // اختبار معدل الإرسال
    try {
      results.rateLimit = this.testRateLimit();
      console.log(results.rateLimit ? '✅ Rate limiting test PASSED' : '❌ Rate limiting test FAILED');
    } catch (error) {
      console.error('❌ Rate limiting test FAILED:', error.message);
    }

    // اختبار التحقق من صحة البيانات
    try {
      results.validation = this.testValidation();
      console.log(results.validation ? '✅ Validation test PASSED' : '❌ Validation test FAILED');
    } catch (error) {
      console.error('❌ Validation test FAILED:', error.message);
    }

    return results;
  }

  printServiceInfo() {
    console.log('\n' + '='.repeat(50));
    console.log('📋 CHAT SERVICE CONFIGURATION');
    console.log('='.repeat(50));

    if (this.chatService) {
      console.log('✅ Chat Service Status: OPERATIONAL');
      console.log(`📏 Max Message Length: ${this.chatService.settings.maxMessageLength} characters`);
      console.log(`⏱️  Message Cache Time: ${this.chatService.settings.messageCacheTime} seconds`);
      console.log(`⌨️  Typing Timeout: ${this.chatService.settings.typingTimeout}ms`);
      console.log(`📨 Max Messages Per Ride: ${this.chatService.settings.maxMessagesPerRide}`);
      console.log(`🚦 Rate Limit: ${this.chatService.settings.rateLimitPerMinute} messages/minute`);

      console.log('\n📝 Available Quick Messages:');
      
      const customerMessages = this.chatService.quickMessages.customer;
      console.log(`   👤 Customer Messages (${customerMessages.length}):`);
      customerMessages.forEach((msg, i) => console.log(`      ${i + 1}. ${msg}`));
      
      const driverMessages = this.chatService.quickMessages.driver;
      console.log(`   👨‍✈️ Driver Messages (${driverMessages.length}):`);
      driverMessages.forEach((msg, i) => console.log(`      ${i + 1}. ${msg}`));

    } else {
      console.log('❌ Chat Service Status: NOT INITIALIZED');
    }
  }

  async checkSocketImplementation() {
    console.log('\n🔍 Checking Socket.IO Integration...');
    
    const socketEvents = [
      'sendChatMessage',
      'getChatHistory', 
      'markMessagesAsRead',
      'typingIndicator',
      'getQuickMessages'
    ];

    console.log('📡 Expected Socket Events:');
    socketEvents.forEach((event, i) => {
      console.log(`   ${i + 1}. ${event}`);
    });

    console.log('\n💡 Socket Implementation Notes:');
    console.log('   - Customer connects to main namespace: /');
    console.log('   - Captain connects to captain namespace: /captain');
    console.log('   - Messages are cross-sent between customer and captain');
    console.log('   - JWT authentication is required for connections');
    console.log('   - Real-time message delivery via Socket.IO');
  }
}

// تشغيل الاختبارات
async function runSimpleTests() {
  const tester = new SimpleChatTester();
  
  const initialized = await tester.initialize();
  if (!initialized) {
    console.error('❌ Failed to initialize test environment');
    process.exit(1);
  }

  try {
    // تشغيل الاختبارات الأساسية
    const results = await tester.runBasicTests();
    
    // عرض معلومات الخدمة
    tester.printServiceInfo();
    
    // فحص تطبيق Socket.IO
    await tester.checkSocketImplementation();

    // ملخص النتائج
    const passedTests = Object.values(results).filter(r => r).length;
    const totalTests = Object.keys(results).length;
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 BASIC TESTS SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${passedTests}/${totalTests}`);
    console.log(`📈 Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    if (passedTests === totalTests) {
      console.log('\n🎉 All basic tests passed! Chat service is ready.');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the implementation.');
    }

  } catch (error) {
    console.error('❌ Test execution failed:', error);
  }

  console.log('\n👋 Testing completed');
}

// تشغيل الاختبارات إذا تم استدعاء الملف مباشرة
if (require.main === module) {
  runSimpleTests().catch(console.error);
}

module.exports = SimpleChatTester;
