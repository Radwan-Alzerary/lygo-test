const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

/**
 * اختبار تكامل Socket.IO لنظام الدردشة
 */
class ChatSocketTester {
  constructor() {
    this.serverUrl = 'http://localhost:5230';
    this.jwtSecret = process.env.JWT_SECRET || "kishan sheth super secret key";
    
    this.customerSocket = null;
    this.captainSocket = null;
    
    this.testResults = {
      passed: 0,
      failed: 0,
      details: []
    };

    // معرفات تجريبية (يجب أن تكون موجودة في قاعدة البيانات)
    this.testData = {
      customerId: '67853c8b0c5ea4d9f8f7b123', // يجب استبدالها بمعرف حقيقي
      captainId: '67853c8b0c5ea4d9f8f7b456',  // يجب استبدالها بمعرف حقيقي
      rideId: '67853c8b0c5ea4d9f8f7b789'     // يجب استبدالها بمعرف رحلة حقيقية
    };
  }

  generateToken(userId, role) {
    return jwt.sign(
      { 
        id: userId, 
        role: role,
        iat: Math.floor(Date.now() / 1000)
      },
      this.jwtSecret,
      { expiresIn: '1h' }
    );
  }

  async connectCustomer() {
    return new Promise((resolve, reject) => {
      const token = this.generateToken(this.testData.customerId, 'customer');
      
      this.customerSocket = io(this.serverUrl, {
        transports: ['websocket'],
        query: { token }
      });

      this.customerSocket.on('connect', () => {
        console.log('✅ Customer connected to server');
        resolve();
      });

      this.customerSocket.on('connect_error', (error) => {
        console.error('❌ Customer connection failed:', error.message);
        reject(error);
      });

      this.customerSocket.on('connectionError', (error) => {
        console.error('❌ Customer authentication failed:', error);
        reject(new Error(error.message));
      });

      // مستمعات الدردشة
      this.customerSocket.on('chatMessage', (data) => {
        console.log(`📨 Customer received message: ${data.text} from ${data.senderType}`);
      });

      // انتظار لمدة 5 ثواني قبل الفشل
      setTimeout(() => {
        if (!this.customerSocket.connected) {
          reject(new Error('Customer connection timeout'));
        }
      }, 5000);
    });
  }

  async connectCaptain() {
    return new Promise((resolve, reject) => {
      const token = this.generateToken(this.testData.captainId, 'captain');
      
      this.captainSocket = io(`${this.serverUrl}/captain`, {
        transports: ['websocket'],
        query: { token }
      });

      this.captainSocket.on('connect', () => {
        console.log('✅ Captain connected to server');
        resolve();
      });

      this.captainSocket.on('connect_error', (error) => {
        console.error('❌ Captain connection failed:', error.message);
        reject(error);
      });

      this.captainSocket.on('connectionError', (error) => {
        console.error('❌ Captain authentication failed:', error);
        reject(new Error(error.message));
      });

      // مستمعات الدردشة
      this.captainSocket.on('chatMessage', (data) => {
        console.log(`📨 Captain received message: ${data.text} from ${data.senderType}`);
      });

      setTimeout(() => {
        if (!this.captainSocket.connected) {
          reject(new Error('Captain connection timeout'));
        }
      }, 5000);
    });
  }

  async testCustomerSendMessage() {
    return new Promise((resolve, reject) => {
      if (!this.customerSocket || !this.customerSocket.connected) {
        reject(new Error('Customer not connected'));
        return;
      }

      const messageData = {
        rideId: this.testData.rideId,
        text: 'TEST: Hello from customer!',
        tempId: `temp_${Date.now()}`
      };

      this.customerSocket.emit('sendChatMessage', messageData, (response) => {
        if (response.success) {
          console.log('✅ Customer message sent successfully');
          console.log(`📨 Message ID: ${response.message.messageId}`);
          resolve(response);
        } else {
          console.error('❌ Customer message failed:', response.message);
          reject(new Error(response.message));
        }
      });

      // انتظار لمدة 10 ثواني للرد
      setTimeout(() => {
        reject(new Error('Customer message timeout'));
      }, 10000);
    });
  }

  async testCaptainSendMessage() {
    return new Promise((resolve, reject) => {
      if (!this.captainSocket || !this.captainSocket.connected) {
        reject(new Error('Captain not connected'));
        return;
      }

      const messageData = {
        rideId: this.testData.rideId,
        text: 'TEST: Hello from captain!',
        tempId: `temp_${Date.now()}`
      };

      this.captainSocket.emit('sendChatMessage', messageData, (response) => {
        if (response.success) {
          console.log('✅ Captain message sent successfully');
          console.log(`📨 Message ID: ${response.message.messageId}`);
          resolve(response);
        } else {
          console.error('❌ Captain message failed:', response.message);
          reject(new Error(response.message));
        }
      });

      setTimeout(() => {
        reject(new Error('Captain message timeout'));
      }, 10000);
    });
  }

  async testGetChatHistory() {
    return new Promise((resolve, reject) => {
      if (!this.customerSocket || !this.customerSocket.connected) {
        reject(new Error('Customer not connected'));
        return;
      }

      const requestData = {
        rideId: this.testData.rideId,
        limit: 20,
        skip: 0
      };

      this.customerSocket.emit('getChatHistory', requestData, (response) => {
        if (response.success) {
          console.log(`✅ Chat history retrieved: ${response.messages.length} messages`);
          response.messages.forEach((msg, index) => {
            console.log(`   ${index + 1}. [${msg.senderType}]: ${msg.text}`);
          });
          resolve(response);
        } else {
          console.error('❌ Chat history failed:', response.message);
          reject(new Error(response.message));
        }
      });

      setTimeout(() => {
        reject(new Error('Chat history timeout'));
      }, 10000);
    });
  }

  async testQuickMessages() {
    return new Promise((resolve, reject) => {
      if (!this.customerSocket || !this.customerSocket.connected) {
        reject(new Error('Customer not connected'));
        return;
      }

      this.customerSocket.emit('getQuickMessages', (response) => {
        if (response && response.success && Array.isArray(response.messages)) {
          console.log(`✅ Quick messages retrieved: ${response.messages.length} messages`);
          response.messages.forEach((msg, index) => {
            console.log(`   ${index + 1}. ${msg}`);
          });
          resolve(response);
        } else {
          console.error('❌ Quick messages failed:', response);
          reject(new Error('Failed to get quick messages'));
        }
      });

      setTimeout(() => {
        reject(new Error('Quick messages timeout'));
      }, 5000);
    });
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

  async runAllTests() {
    console.log('🚀 Starting Socket.IO Chat Integration Tests...\n');
    console.log(`📡 Server URL: ${this.serverUrl}`);
    console.log(`🔑 Test Customer ID: ${this.testData.customerId}`);
    console.log(`👨‍✈️ Test Captain ID: ${this.testData.captainId}`);
    console.log(`🚗 Test Ride ID: ${this.testData.rideId}`);

    try {
      // اختبار الاتصالات
      await this.runTest('Customer Connection', () => this.connectCustomer());
      await this.runTest('Captain Connection', () => this.connectCaptain());

      // انتظار قليل للتأكد من الاتصال
      await new Promise(resolve => setTimeout(resolve, 2000));

      // اختبار الوظائف
      await this.runTest('Customer Send Message', () => this.testCustomerSendMessage());
      await this.runTest('Captain Send Message', () => this.testCaptainSendMessage());
      await this.runTest('Get Chat History', () => this.testGetChatHistory());
      await this.runTest('Get Quick Messages', () => this.testQuickMessages());

    } finally {
      // إغلاق الاتصالات
      if (this.customerSocket) {
        this.customerSocket.disconnect();
        console.log('🔌 Customer disconnected');
      }
      if (this.captainSocket) {
        this.captainSocket.disconnect();
        console.log('🔌 Captain disconnected');
      }
    }
  }

  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SOCKET.IO CHAT INTEGRATION TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${this.testResults.passed}`);
    console.log(`❌ Failed: ${this.testResults.failed}`);
    
    if (this.testResults.passed + this.testResults.failed > 0) {
      console.log(`📈 Success Rate: ${((this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100).toFixed(1)}%`);
    }
    
    console.log('\n📋 Detailed Results:');
    this.testResults.details.forEach(result => {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      console.log(`${status} ${result.test}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    console.log('\n🔍 Integration Status:');
    console.log('Socket.IO Features:');
    this.testResults.details.forEach(result => {
      const status = result.status === 'PASSED' ? '✅' : '❌';
      console.log(`${status} ${result.test}`);
    });
  }

  // تعديل معرفات الاختبار
  setTestData(customerId, captainId, rideId) {
    this.testData = { customerId, captainId, rideId };
    console.log('📝 Test data updated:', this.testData);
  }
}

// تشغيل الاختبارات
async function runSocketTests() {
  const tester = new ChatSocketTester();
  
  console.log('⚠️  Note: Make sure the server is running and test IDs exist in database');
  console.log('💡 You can update test IDs by calling: tester.setTestData(customerId, captainId, rideId)');
  
  try {
    await tester.runAllTests();
    tester.printResults();
  } catch (error) {
    console.error('❌ Socket test execution failed:', error);
  }
}

// تشغيل الاختبارات إذا تم استدعاء الملف مباشرة
if (require.main === module) {
  runSocketTests().catch(console.error);
}

module.exports = ChatSocketTester;
