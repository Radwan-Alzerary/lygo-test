const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const axios = require('axios');

// إعدادات الاختبار
const SERVER_URL = 'http://localhost:5230';
const JWT_SECRET = process.env.JWT_SECRET || "kishan sheth super secret key";
const TEST_RIDE_ID = '507f1f77bcf86cd799439011'; // معرف رحلة تجريبي

// إنشاء رموز JWT للاختبار
const customerToken = jwt.sign(
  { 
    id: '507f1f77bcf86cd799439012',
    userType: 'customer'
  }, 
  JWT_SECRET,
  { expiresIn: '24h' }
);

const driverToken = jwt.sign(
  { 
    id: '507f1f77bcf86cd799439013',
    userType: 'driver'
  }, 
  JWT_SECRET,
  { expiresIn: '24h' }
);

class ChatSystemTester {
  constructor() {
    this.customerSocket = null;
    this.driverSocket = null;
    this.testResults = {
      connection: false,
      authentication: false,
      sendMessage: false,
      receiveMessage: false,
      quickMessages: false,
      typingIndicator: false,
      markAsRead: false,
      chatHistory: false,
      apiEndpoints: false
    };
  }

  async runAllTests() {
    console.log('🚀 بدء اختبار نظام الدردشة...\n');

    try {
      // 1. اختبار الاتصال والمصادقة
      await this.testConnection();
      
      // 2. اختبار الرسائل السريعة
      await this.testQuickMessages();
      
      // 3. اختبار إرسال واستقبال الرسائل
      await this.testMessageSending();
      
      // 4. اختبار مؤشر الكتابة
      await this.testTypingIndicator();
      
      // 5. اختبار تحديد الرسائل كمقروءة
      await this.testMarkAsRead();
      
      // 6. اختبار تاريخ المحادثة
      await this.testChatHistory();
      
      // 7. اختبار نقاط API
      await this.testApiEndpoints();
      
      // عرض النتائج
      this.displayResults();
      
    } catch (error) {
      console.error('❌ خطأ أثناء تشغيل الاختبارات:', error);
    } finally {
      // إغلاق الاتصالات
      this.cleanup();
    }
  }

  async testConnection() {
    console.log('🔌 اختبار الاتصال والمصادقة...');
    
    return new Promise((resolve, reject) => {
      let customerConnected = false;
      let driverConnected = false;
      
      // اتصال العميل
      this.customerSocket = io(`${SERVER_URL}/customer`, {
        auth: { token: customerToken },
        transports: ['websocket']
      });
      
      // اتصال الكابتن
      this.driverSocket = io(`${SERVER_URL}/captain`, {
        auth: { token: driverToken },
        transports: ['websocket']
      });
      
      this.customerSocket.on('connect', () => {
        console.log('✅ العميل متصل بنجاح');
        customerConnected = true;
        if (driverConnected) {
          this.testResults.connection = true;
          this.testResults.authentication = true;
          resolve();
        }
      });
      
      this.driverSocket.on('connect', () => {
        console.log('✅ الكابتن متصل بنجاح');
        driverConnected = true;
        if (customerConnected) {
          this.testResults.connection = true;
          this.testResults.authentication = true;
          resolve();
        }
      });
      
      this.customerSocket.on('authError', (error) => {
        console.log('❌ خطأ مصادقة العميل:', error);
        reject(error);
      });
      
      this.driverSocket.on('authError', (error) => {
        console.log('❌ خطأ مصادقة الكابتن:', error);
        reject(error);
      });
      
      // timeout
      setTimeout(() => {
        if (!customerConnected || !driverConnected) {
          reject(new Error('فشل الاتصال خلال الوقت المحدد'));
        }
      }, 10000);
    });
  }

  async testQuickMessages() {
    console.log('\n💬 اختبار الرسائل السريعة...');
    
    return new Promise((resolve) => {
      let customerMessages = null;
      let driverMessages = null;
      
      this.customerSocket.emit('getQuickMessages', (response) => {
        if (response.success && response.messages.length > 0) {
          console.log('✅ الرسائل السريعة للعميل:', response.messages.length);
          customerMessages = response.messages;
        } else {
          console.log('❌ فشل الحصول على الرسائل السريعة للعميل');
        }
        
        if (driverMessages !== null) {
          this.testResults.quickMessages = customerMessages && driverMessages;
          resolve();
        }
      });
      
      this.driverSocket.emit('getQuickMessages', (response) => {
        if (response.success && response.messages.length > 0) {
          console.log('✅ الرسائل السريعة للكابتن:', response.messages.length);
          driverMessages = response.messages;
        } else {
          console.log('❌ فشل الحصول على الرسائل السريعة للكابتن');
        }
        
        if (customerMessages !== null) {
          this.testResults.quickMessages = customerMessages && driverMessages;
          resolve();
        }
      });
    });
  }

  async testMessageSending() {
    console.log('\n📤 اختبار إرسال واستقبال الرسائل...');
    
    return new Promise((resolve) => {
      let messageSent = false;
      let messageReceived = false;
      
      // الكابتن يستمع للرسائل
      this.driverSocket.on('chatMessage', (data) => {
        if (data.senderType === 'customer' && data.text === 'رسالة اختبارية من العميل') {
          console.log('✅ الكابتن استلم الرسالة بنجاح');
          messageReceived = true;
          
          if (messageSent) {
            this.testResults.sendMessage = true;
            this.testResults.receiveMessage = true;
            resolve();
          }
        }
      });
      
      // العميل يرسل رسالة
      this.customerSocket.emit('sendChatMessage', {
        rideId: TEST_RIDE_ID,
        text: 'رسالة اختبارية من العميل',
        isQuick: false
      }, (response) => {
        if (response.success) {
          console.log('✅ تم إرسال الرسالة بنجاح');
          messageSent = true;
          
          if (messageReceived) {
            this.testResults.sendMessage = true;
            this.testResults.receiveMessage = true;
            resolve();
          }
        } else {
          console.log('❌ فشل إرسال الرسالة:', response.message);
          resolve();
        }
      });
      
      setTimeout(() => {
        if (!messageSent || !messageReceived) {
          console.log('❌ انتهت مهلة اختبار الرسائل');
          resolve();
        }
      }, 5000);
    });
  }

  async testTypingIndicator() {
    console.log('\n⌨️ اختبار مؤشر الكتابة...');
    
    return new Promise((resolve) => {
      let typingReceived = false;
      
      // الكابتن يستمع لمؤشر الكتابة
      this.driverSocket.on('typingIndicator', (data) => {
        if (data.senderType === 'customer' && data.isTyping === true) {
          console.log('✅ مؤشر الكتابة يعمل بنجاح');
          typingReceived = true;
          this.testResults.typingIndicator = true;
          resolve();
        }
      });
      
      // العميل يبدأ الكتابة
      this.customerSocket.emit('typingIndicator', {
        rideId: TEST_RIDE_ID,
        isTyping: true
      });
      
      setTimeout(() => {
        if (!typingReceived) {
          console.log('❌ لم يتم استلام مؤشر الكتابة');
          resolve();
        }
      }, 3000);
    });
  }

  async testMarkAsRead() {
    console.log('\n✓ اختبار تحديد الرسائل كمقروءة...');
    
    return new Promise((resolve) => {
      let readStatusReceived = false;
      
      // العميل يستمع لتأكيد القراءة
      this.customerSocket.on('messageRead', (data) => {
        if (data.readBy === 'driver') {
          console.log('✅ تأكيد قراءة الرسائل يعمل بنجاح');
          readStatusReceived = true;
          this.testResults.markAsRead = true;
          resolve();
        }
      });
      
      // الكابتن يحدد الرسائل كمقروءة
      this.driverSocket.emit('markMessagesAsRead', {
        rideId: TEST_RIDE_ID,
        messageIds: ['dummy_message_id'] // معرف وهمي للاختبار
      });
      
      setTimeout(() => {
        if (!readStatusReceived) {
          console.log('❌ لم يتم استلام تأكيد قراءة الرسائل');
          resolve();
        }
      }, 3000);
    });
  }

  async testChatHistory() {
    console.log('\n📜 اختبار تاريخ المحادثة...');
    
    return new Promise((resolve) => {
      this.customerSocket.emit('getChatHistory', {
        rideId: TEST_RIDE_ID,
        limit: 10
      }, (response) => {
        if (response.success) {
          console.log('✅ تم الحصول على تاريخ المحادثة بنجاح');
          console.log(`   - عدد الرسائل: ${response.messages ? response.messages.length : 0}`);
          console.log(`   - الرسائل غير المقروءة: ${response.unreadCount || 0}`);
          this.testResults.chatHistory = true;
        } else {
          console.log('❌ فشل الحصول على تاريخ المحادثة:', response.message);
        }
        resolve();
      });
    });
  }

  async testApiEndpoints() {
    console.log('\n🌐 اختبار نقاط API...');
    
    try {
      // اختبار الرسائل السريعة API
      const quickMessagesResponse = await axios.get(
        `${SERVER_URL}/api/chat/quick-messages/customer`,
        {
          headers: {
            'Authorization': `Bearer ${customerToken}`
          }
        }
      );
      
      if (quickMessagesResponse.data.success) {
        console.log('✅ API الرسائل السريعة يعمل بنجاح');
        this.testResults.apiEndpoints = true;
      } else {
        console.log('❌ فشل API الرسائل السريعة');
      }
      
    } catch (error) {
      console.log('❌ خطأ في اختبار API:', error.message);
    }
  }

  displayResults() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 نتائج اختبار نظام الدردشة');
    console.log('='.repeat(50));
    
    const tests = [
      { name: 'الاتصال', key: 'connection' },
      { name: 'المصادقة', key: 'authentication' },
      { name: 'إرسال الرسائل', key: 'sendMessage' },
      { name: 'استقبال الرسائل', key: 'receiveMessage' },
      { name: 'الرسائل السريعة', key: 'quickMessages' },
      { name: 'مؤشر الكتابة', key: 'typingIndicator' },
      { name: 'تحديد كمقروء', key: 'markAsRead' },
      { name: 'تاريخ المحادثة', key: 'chatHistory' },
      { name: 'نقاط API', key: 'apiEndpoints' }
    ];
    
    let passedTests = 0;
    
    tests.forEach(test => {
      const status = this.testResults[test.key] ? '✅ نجح' : '❌ فشل';
      console.log(`${test.name}: ${status}`);
      if (this.testResults[test.key]) passedTests++;
    });
    
    console.log('\n' + '-'.repeat(30));
    console.log(`النتيجة النهائية: ${passedTests}/${tests.length} نجح`);
    
    if (passedTests === tests.length) {
      console.log('🎉 جميع الاختبارات نجحت! نظام الدردشة جاهز للاستخدام.');
    } else {
      console.log('⚠️ بعض الاختبارات فشلت. يُرجى مراجعة الأخطاء أعلاه.');
    }
  }

  cleanup() {
    if (this.customerSocket) {
      this.customerSocket.disconnect();
    }
    if (this.driverSocket) {
      this.driverSocket.disconnect();
    }
    console.log('\n🧹 تم إغلاق جميع الاتصالات.');
  }
}

// تشغيل الاختبار
if (require.main === module) {
  const tester = new ChatSystemTester();
  tester.runAllTests().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('فشل تشغيل الاختبارات:', error);
    process.exit(1);
  });
}

module.exports = ChatSystemTester;
