const io = require('socket.io-client');

/**
 * اختبار شامل لوصول الرسائل في الوقت الفعلي
 * هذا الملف يفحص بالتفصيل مشكلة عدم وصول الرسائل
 */
class RealtimeChatTester {
  constructor() {
    this.serverUrl = 'http://localhost:5230';
    this.captainSocket = null;
    this.customerSocket = null;
    
    // معرفات حقيقية من اللوجات المرفقة
    this.customerId = '6862f671db88db5431ccb7f8';
    this.captainId = '686721f1a69130ed4eefb4f6'; 
    this.rideId = '68961c3b84662ef6e24f6497';
    
    // متغيرات للتتبع
    this.messagesSent = 0;
    this.messagesReceived = 0;
    this.testResults = [];
    this.isListening = false;
  }

  /**
   * بدء الفحص الشامل
   */
  async runCompleteTest() {
    console.log('\n🔍 بدء فحص شامل لوصول الرسائل في الوقت الفعلي');
    console.log('=' .repeat(60));
    console.log(`📊 معرف العميل: ${this.customerId}`);
    console.log(`📊 معرف الكابتن: ${this.captainId}`);
    console.log(`📊 معرف الرحلة: ${this.rideId}`);
    console.log('=' .repeat(60));

    try {
      // خطوة 1: فحص الاتصالات
      await this.testConnections();
      
      // خطوة 2: فحص Authentication
      await this.testAuthentication();
      
      // خطوة 3: فحص Event Listeners
      await this.testEventListeners();
      
      // خطوة 4: فحص إرسال من العميل للكابتن
      await this.testCustomerToDriverMessage();
      
      // خطوة 5: فحص إرسال من الكابتن للعميل
      await this.testDriverToCustomerMessage();
      
      // خطوة 6: فحص الرسائل المتتالية
      await this.testMultipleMessages();
      
      // خطوة 7: فحص حالة Socket connections
      await this.testSocketStates();
      
      // عرض التقرير النهائي
      this.showFinalReport();
      
    } catch (error) {
      console.error('💥 خطأ في الفحص:', error);
    } finally {
      this.cleanup();
    }
  }

  /**
   * فحص الاتصالات الأساسية
   */
  async testConnections() {
    console.log('\n📡 [اختبار 1] فحص الاتصالات الأساسية...');
    
    return new Promise((resolve, reject) => {
      let connectionsEstablished = 0;
      const timeout = setTimeout(() => {
        reject(new Error('انتهت مهلة الاتصال'));
      }, 10000);

      // اتصال الكابتن
      this.captainSocket = io(`${this.serverUrl}/captain`, {
        auth: {
          token: 'test_captain_token',
          userId: this.captainId
        },
        transports: ['websocket', 'polling']
      });

      // اتصال العميل
      this.customerSocket = io(this.serverUrl, {
        auth: {
          token: 'test_customer_token', 
          userId: this.customerId
        },
        transports: ['websocket', 'polling']
      });

      // مراقبة اتصال الكابتن
      this.captainSocket.on('connect', () => {
        console.log(`✅ تم اتصال الكابتن - Socket ID: ${this.captainSocket.id}`);
        console.log(`📡 Transport: ${this.captainSocket.io.engine.transport.name}`);
        connectionsEstablished++;
        if (connectionsEstablished === 2) {
          clearTimeout(timeout);
          resolve();
        }
      });

      // مراقبة اتصال العميل
      this.customerSocket.on('connect', () => {
        console.log(`✅ تم اتصال العميل - Socket ID: ${this.customerSocket.id}`);
        console.log(`📡 Transport: ${this.customerSocket.io.engine.transport.name}`);
        connectionsEstablished++;
        if (connectionsEstablished === 2) {
          clearTimeout(timeout);
          resolve();
        }
      });

      // مراقبة أخطاء الاتصال
      this.captainSocket.on('connect_error', (error) => {
        console.error('❌ خطأ في اتصال الكابتن:', error.message);
      });

      this.customerSocket.on('connect_error', (error) => {
        console.error('❌ خطأ في اتصال العميل:', error.message);
      });

      // مراقبة قطع الاتصال
      this.captainSocket.on('disconnect', (reason) => {
        console.warn(`⚠️ انقطع اتصال الكابتن: ${reason}`);
      });

      this.customerSocket.on('disconnect', (reason) => {
        console.warn(`⚠️ انقطع اتصال العميل: ${reason}`);
      });
    });
  }

  /**
   * فحص المصادقة
   */
  async testAuthentication() {
    console.log('\n🔐 [اختبار 2] فحص المصادقة...');
    
    return new Promise((resolve) => {
      let authResponses = 0;
      
      // فحص استجابة المصادقة للكابتن
      this.captainSocket.on('authenticated', (data) => {
        console.log('✅ تم قبول مصادقة الكابتن:', data);
        authResponses++;
        if (authResponses === 2) resolve();
      });

      this.captainSocket.on('authentication_error', (error) => {
        console.error('❌ خطأ في مصادقة الكابتن:', error);
        authResponses++;
        if (authResponses === 2) resolve();
      });

      // فحص استجابة المصادقة للعميل
      this.customerSocket.on('authenticated', (data) => {
        console.log('✅ تم قبول مصادقة العميل:', data);
        authResponses++;
        if (authResponses === 2) resolve();
      });

      this.customerSocket.on('authentication_error', (error) => {
        console.error('❌ خطأ في مصادقة العميل:', error);
        authResponses++;
        if (authResponses === 2) resolve();
      });

      // في حال عدم وجود استجابة مصادقة، نكمل بعد ثانيتين
      setTimeout(() => {
        if (authResponses === 0) {
          console.log('ℹ️ لم يتم الحصول على استجابات مصادقة صريحة');
        }
        resolve();
      }, 2000);
    });
  }

  /**
   * إعداد وفحص Event Listeners
   */
  async testEventListeners() {
    console.log('\n👂 [اختبار 3] إعداد وفحص Event Listeners...');
    
    this.isListening = true;
    
    // إعداد مستمعي الأحداث للكابتن
    this.captainSocket.on('chatMessage', (message) => {
      console.log('📨 الكابتن استلم رسالة:', {
        messageId: message.messageId,
        text: message.text,
        senderType: message.senderType,
        timestamp: new Date().toISOString(),
        socketId: this.captainSocket.id
      });
      this.messagesReceived++;
      this.testResults.push({
        type: 'message_received_by_captain',
        success: true,
        messageId: message.messageId,
        timestamp: new Date()
      });
    });

    // إعداد مستمعي الأحداث للعميل
    this.customerSocket.on('chatMessage', (message) => {
      console.log('📨 العميل استلم رسالة:', {
        messageId: message.messageId,
        text: message.text,
        senderType: message.senderType,
        timestamp: new Date().toISOString(),
        socketId: this.customerSocket.id
      });
      this.messagesReceived++;
      this.testResults.push({
        type: 'message_received_by_customer',
        success: true,
        messageId: message.messageId,
        timestamp: new Date()
      });
    });

    // مراقبة أخطاء إضافية
    this.captainSocket.on('error', (error) => {
      console.error('❌ خطأ في socket الكابتن:', error);
    });

    this.customerSocket.on('error', (error) => {
      console.error('❌ خطأ في socket العميل:', error);
    });

    console.log('✅ تم إعداد جميع Event Listeners');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * فحص إرسال رسالة من العميل للكابتن
   */
  async testCustomerToDriverMessage() {
    console.log('\n📤 [اختبار 4] فحص إرسال رسالة من العميل للكابتن...');
    
    return new Promise((resolve, reject) => {
      const messageData = {
        rideId: this.rideId,
        text: `رسالة اختبار من العميل - ${Date.now()}`,
        tempId: `temp_customer_${Date.now()}`
      };

      const timeout = setTimeout(() => {
        console.error('⏰ انتهت مهلة انتظار استلام الرسالة من الكابتن');
        this.testResults.push({
          type: 'customer_to_driver_timeout',
          success: false,
          timestamp: new Date()
        });
        resolve();
      }, 5000);

      console.log('📤 العميل يرسل رسالة:', messageData);
      this.messagesSent++;

      this.customerSocket.emit('sendChatMessage', messageData, (response) => {
        console.log('📋 استجابة الخادم للعميل:', response);
        
        if (response.success) {
          console.log('✅ تم حفظ الرسالة في قاعدة البيانات');
          this.testResults.push({
            type: 'customer_message_sent',
            success: true,
            messageId: response.message?.messageId,
            timestamp: new Date()
          });
          
          // انتظار استلام الرسالة من الكابتن
          const originalReceived = this.messagesReceived;
          const checkReceived = setInterval(() => {
            if (this.messagesReceived > originalReceived) {
              console.log('🎉 الكابتن استلم الرسالة بنجاح!');
              clearTimeout(timeout);
              clearInterval(checkReceived);
              resolve();
            }
          }, 100);
          
        } else {
          console.error('❌ فشل في إرسال رسالة العميل:', response.message);
          clearTimeout(timeout);
          this.testResults.push({
            type: 'customer_message_failed',
            success: false,
            error: response.message,
            timestamp: new Date()
          });
          resolve();
        }
      });
    });
  }

  /**
   * فحص إرسال رسالة من الكابتن للعميل
   */
  async testDriverToCustomerMessage() {
    console.log('\n📤 [اختبار 5] فحص إرسال رسالة من الكابتن للعميل...');
    
    return new Promise((resolve, reject) => {
      const messageData = {
        rideId: this.rideId,
        text: `رسالة اختبار من الكابتن - ${Date.now()}`,
        tempId: `temp_driver_${Date.now()}`
      };

      const timeout = setTimeout(() => {
        console.error('⏰ انتهت مهلة انتظار استلام الرسالة من العميل');
        this.testResults.push({
          type: 'driver_to_customer_timeout',
          success: false,
          timestamp: new Date()
        });
        resolve();
      }, 5000);

      console.log('📤 الكابتن يرسل رسالة:', messageData);
      this.messagesSent++;

      this.captainSocket.emit('sendChatMessage', messageData, (response) => {
        console.log('📋 استجابة الخادم للكابتن:', response);
        
        if (response.success) {
          console.log('✅ تم حفظ الرسالة في قاعدة البيانات');
          this.testResults.push({
            type: 'driver_message_sent',
            success: true,
            messageId: response.message?.messageId,
            timestamp: new Date()
          });
          
          // انتظار استلام الرسالة من العميل
          const originalReceived = this.messagesReceived;
          const checkReceived = setInterval(() => {
            if (this.messagesReceived > originalReceived) {
              console.log('🎉 العميل استلم الرسالة بنجاح!');
              clearTimeout(timeout);
              clearInterval(checkReceived);
              resolve();
            }
          }, 100);
          
        } else {
          console.error('❌ فشل في إرسال رسالة الكابتن:', response.message);
          clearTimeout(timeout);
          this.testResults.push({
            type: 'driver_message_failed',
            success: false,
            error: response.message,
            timestamp: new Date()
          });
          resolve();
        }
      });
    });
  }

  /**
   * فحص الرسائل المتتالية
   */
  async testMultipleMessages() {
    console.log('\n🔄 [اختبار 6] فحص الرسائل المتتالية...');
    
    const promises = [];
    const messageCount = 3;
    
    for (let i = 1; i <= messageCount; i++) {
      promises.push(this.sendTestMessage(i));
      await new Promise(resolve => setTimeout(resolve, 1000)); // انتظار ثانية بين الرسائل
    }
    
    await Promise.all(promises);
    console.log(`✅ تم اختبار ${messageCount} رسائل متتالية`);
  }

  /**
   * إرسال رسالة اختبار
   */
  async sendTestMessage(messageNumber) {
    return new Promise((resolve) => {
      const messageData = {
        rideId: this.rideId,
        text: `رسالة متتالية رقم ${messageNumber} - ${Date.now()}`,
        tempId: `temp_multi_${Date.now()}_${messageNumber}`
      };

      const sender = messageNumber % 2 === 0 ? this.customerSocket : this.captainSocket;
      const senderName = messageNumber % 2 === 0 ? 'العميل' : 'الكابتن';

      console.log(`📤 ${senderName} يرسل رسالة متتالية #${messageNumber}`);
      this.messagesSent++;

      sender.emit('sendChatMessage', messageData, (response) => {
        if (response.success) {
          console.log(`✅ تم إرسال الرسالة المتتالية #${messageNumber}`);
        } else {
          console.error(`❌ فشل في الرسالة المتتالية #${messageNumber}:`, response.message);
        }
        resolve();
      });
    });
  }

  /**
   * فحص حالة Socket connections
   */
  async testSocketStates() {
    console.log('\n🔍 [اختبار 7] فحص حالة Socket connections...');
    
    console.log('📊 حالة الكابتن:', {
      connected: this.captainSocket.connected,
      id: this.captainSocket.id,
      transport: this.captainSocket.io.engine.transport.name,
      readyState: this.captainSocket.io.engine.readyState
    });
    
    console.log('📊 حالة العميل:', {
      connected: this.customerSocket.connected,
      id: this.customerSocket.id,
      transport: this.customerSocket.io.engine.transport.name,
      readyState: this.customerSocket.io.engine.readyState
    });

    // فحص ping/pong
    await this.testPingPong();
  }

  /**
   * فحص ping/pong للتأكد من الاتصال
   */
  async testPingPong() {
    console.log('\n🏓 فحص Ping/Pong...');
    
    return new Promise((resolve) => {
      let pongReceived = 0;
      
      const captainPingStart = Date.now();
      this.captainSocket.emit('ping', captainPingStart, (response) => {
        const latency = Date.now() - captainPingStart;
        console.log(`🏓 Pong من الكابتن - Latency: ${latency}ms`);
        pongReceived++;
        if (pongReceived === 2) resolve();
      });

      const customerPingStart = Date.now();
      this.customerSocket.emit('ping', customerPingStart, (response) => {
        const latency = Date.now() - customerPingStart;
        console.log(`🏓 Pong من العميل - Latency: ${latency}ms`);
        pongReceived++;
        if (pongReceived === 2) resolve();
      });

      // إذا لم نحصل على pong خلال 3 ثوان
      setTimeout(() => {
        if (pongReceived < 2) {
          console.warn('⚠️ لم يتم الحصول على جميع استجابات Ping/Pong');
        }
        resolve();
      }, 3000);
    });
  }

  /**
   * عرض التقرير النهائي
   */
  showFinalReport() {
    console.log('\n📋 التقرير النهائي');
    console.log('=' .repeat(50));
    
    console.log(`📤 الرسائل المرسلة: ${this.messagesSent}`);
    console.log(`📨 الرسائل المستلمة: ${this.messagesReceived}`);
    console.log(`📊 نسبة الوصول: ${this.messagesSent > 0 ? ((this.messagesReceived / this.messagesSent) * 100).toFixed(1) : 0}%`);
    
    console.log('\n📈 تفاصيل النتائج:');
    this.testResults.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      const timestamp = result.timestamp.toLocaleTimeString();
      console.log(`${index + 1}. ${status} ${result.type} - ${timestamp}`);
      if (result.error) {
        console.log(`   خطأ: ${result.error}`);
      }
      if (result.messageId) {
        console.log(`   معرف الرسالة: ${result.messageId}`);
      }
    });

    // تحليل المشاكل المحتملة
    this.analyzePotentialIssues();
  }

  /**
   * تحليل المشاكل المحتملة
   */
  analyzePotentialIssues() {
    console.log('\n🔍 تحليل المشاكل المحتملة:');
    
    const deliveryRate = this.messagesSent > 0 ? (this.messagesReceived / this.messagesSent) * 100 : 0;
    
    if (deliveryRate === 0) {
      console.log('🚨 مشكلة حرجة: لا توجد رسائل تصل نهائياً');
      console.log('   الأسباب المحتملة:');
      console.log('   - مشكلة في namespace routing');
      console.log('   - خطأ في معرفات المستخدمين');
      console.log('   - مشكلة في socket events');
    } else if (deliveryRate < 50) {
      console.log('⚠️ مشكلة في التوصيل: نسبة وصول منخفضة');
      console.log('   الأسباب المحتملة:');
      console.log('   - مشكلة في timing');
      console.log('   - قطع اتصال متقطع');
      console.log('   - مشكلة في event handling');
    } else if (deliveryRate < 100) {
      console.log('⚠️ مشكلة جزئية: بعض الرسائل لا تصل');
      console.log('   الأسباب المحتملة:');
      console.log('   - race conditions');
      console.log('   - buffer overflow');
      console.log('   - network latency');
    } else {
      console.log('✅ النظام يعمل بشكل جيد');
    }

    // فحص الأخطاء الشائعة
    console.log('\n🔧 توصيات الإصلاح:');
    console.log('1. تحقق من onlineCustomers و onlineCaptains في socket services');
    console.log('2. تأكد من صحة namespace routing (/captain vs /)');
    console.log('3. فحص socket room management');
    console.log('4. تحقق من معرفات الرحلة والمستخدمين');
    console.log('5. مراقبة memory leaks في socket connections');
  }

  /**
   * تنظيف الموارد
   */
  cleanup() {
    console.log('\n🧹 تنظيف الموارد...');
    
    if (this.captainSocket && this.captainSocket.connected) {
      this.captainSocket.disconnect();
      console.log('🔌 تم قطع اتصال الكابتن');
    }
    
    if (this.customerSocket && this.customerSocket.connected) {
      this.customerSocket.disconnect();
      console.log('🔌 تم قطع اتصال العميل');
    }
    
    console.log('✅ تم تنظيف جميع الموارد');
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }
}

// تشغيل الفحص
if (require.main === module) {
  const tester = new RealtimeChatTester();
  
  process.on('SIGINT', () => {
    console.log('\n⏹️ تم إيقاف الفحص بواسطة المستخدم');
    tester.cleanup();
  });
  
  tester.runCompleteTest().catch((error) => {
    console.error('💥 فشل في تشغيل الفحص:', error);
    tester.cleanup();
  });
}

module.exports = RealtimeChatTester;
