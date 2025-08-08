const io = require('socket.io-client');

/**
 * اختبار Debug Logging لنظام الدردشة
 * هذا الملف يختبر التحسينات الجديدة في تسجيل Debug logs
 */

class ChatDebugTester {
  constructor() {
    this.serverUrl = 'http://localhost:5230';
    this.captainSocket = null;
    this.customerSocket = null;
    this.testRideId = null;
    this.captainId = null;
    this.customerId = null;
  }

  /**
   * اختبار إرسال رسالة من الكابتن
   */
  async testCaptainMessage() {
    console.log('\n=== اختبار إرسال رسالة من الكابتن ===');
    
    return new Promise((resolve, reject) => {
      const testMessage = {
        rideId: this.testRideId,
        text: 'مرحباً، هذه رسالة تجريبية من الكابتن مع Debug logs',
        tempId: `temp_captain_${Date.now()}`,
        isQuick: false
      };

      console.log('📤 إرسال رسالة من الكابتن:', testMessage);

      this.captainSocket.emit('sendChatMessage', testMessage, (response) => {
        console.log('✅ استجابة الكابتن:', response);
        
        if (response.success) {
          console.log(`📨 تم إرسال الرسالة بنجاح - معرف الرسالة: ${response.message.messageId}`);
          resolve(response);
        } else {
          console.error('❌ فشل في إرسال رسالة الكابتن:', response.message);
          reject(new Error(response.message));
        }
      });

      // انتظار استقبال الرسالة على جانب العميل
      setTimeout(() => {
        console.log('⏱️  انتهت مهلة انتظار استقبال الرسالة على جانب العميل');
      }, 3000);
    });
  }

  /**
   * اختبار إرسال رسالة من العميل
   */
  async testCustomerMessage() {
    console.log('\n=== اختبار إرسال رسالة من العميل ===');
    
    return new Promise((resolve, reject) => {
      const testMessage = {
        rideId: this.testRideId,
        text: 'مرحباً، هذه رسالة تجريبية من العميل مع Debug logs',
        tempId: `temp_customer_${Date.now()}`,
        isQuick: false
      };

      console.log('📤 إرسال رسالة من العميل:', testMessage);

      this.customerSocket.emit('sendChatMessage', testMessage, (response) => {
        console.log('✅ استجابة العميل:', response);
        
        if (response.success) {
          console.log(`📨 تم إرسال الرسالة بنجاح - معرف الرسالة: ${response.message.messageId}`);
          resolve(response);
        } else {
          console.error('❌ فشل في إرسال رسالة العميل:', response.message);
          reject(new Error(response.message));
        }
      });

      // انتظار استقبال الرسالة على جانب الكابتن
      setTimeout(() => {
        console.log('⏱️  انتهت مهلة انتظار استقبال الرسالة على جانب الكابتن');
      }, 3000);
    });
  }

  /**
   * اختبار رسالة سريعة
   */
  async testQuickMessage() {
    console.log('\n=== اختبار الرسالة السريعة ===');
    
    return new Promise((resolve, reject) => {
      const quickMessage = {
        rideId: this.testRideId,
        text: 'في الطريق إليك',
        tempId: `temp_quick_${Date.now()}`,
        isQuick: true,
        quickMessageType: 'on_the_way'
      };

      console.log('⚡ إرسال رسالة سريعة من الكابتن:', quickMessage);

      this.captainSocket.emit('sendChatMessage', quickMessage, (response) => {
        console.log('✅ استجابة الرسالة السريعة:', response);
        
        if (response.success) {
          console.log(`⚡ تم إرسال الرسالة السريعة بنجاح - معرف الرسالة: ${response.message.messageId}`);
          resolve(response);
        } else {
          console.error('❌ فشل في إرسال الرسالة السريعة:', response.message);
          reject(new Error(response.message));
        }
      });
    });
  }

  /**
   * اختبار رسالة بمعايير خاطئة
   */
  async testInvalidMessage() {
    console.log('\n=== اختبار رسالة بمعايير خاطئة ===');
    
    return new Promise((resolve, reject) => {
      const invalidMessage = {
        rideId: '', // معرف رحلة فارغ
        text: '', // نص فارغ
        tempId: `temp_invalid_${Date.now()}`
      };

      console.log('❌ إرسال رسالة خاطئة:', invalidMessage);

      this.captainSocket.emit('sendChatMessage', invalidMessage, (response) => {
        console.log('📝 استجابة الرسالة الخاطئة:', response);
        
        if (!response.success) {
          console.log('✅ تم رفض الرسالة الخاطئة كما هو متوقع:', response.message);
          resolve(response);
        } else {
          console.error('⚠️  تم قبول رسالة خاطئة - هذا غير متوقع!');
          reject(new Error('Invalid message was accepted'));
        }
      });
    });
  }

  /**
   * إعداد الاتصال
   */
  async setupConnections() {
    console.log('🔗 بدء إعداد اتصالات Socket...');
    
    // معرفات تجريبية
    this.captainId = '507f1f77bcf86cd799439013';
    this.customerId = '507f1f77bcf86cd799439014';
    this.testRideId = '507f1f77bcf86cd799439015';

    // إعداد socket للكابتن
    this.captainSocket = io(`${this.serverUrl}/captain`, {
      auth: {
        token: 'captain_test_token', // يجب استبدال هذا بـ token صحيح
        userId: this.captainId
      }
    });

    // إعداد socket للعميل
    this.customerSocket = io(this.serverUrl, {
      auth: {
        token: 'customer_test_token', // يجب استبدال هذا بـ token صحيح
        userId: this.customerId
      }
    });

    // معالج استقبال الرسائل للعميل
    this.customerSocket.on('chatMessage', (message) => {
      console.log('📨 العميل استلم رسالة:', {
        messageId: message.messageId,
        text: message.text,
        senderType: message.senderType,
        timestamp: message.timestamp
      });
    });

    // معالج استقبال الرسائل للكابتن
    this.captainSocket.on('chatMessage', (message) => {
      console.log('📨 الكابتن استلم رسالة:', {
        messageId: message.messageId,
        text: message.text,
        senderType: message.senderType,
        timestamp: message.timestamp
      });
    });

    // انتظار الاتصال
    await new Promise((resolve) => {
      let connectionsReady = 0;
      
      this.captainSocket.on('connect', () => {
        console.log('✅ تم اتصال الكابتن');
        connectionsReady++;
        if (connectionsReady === 2) resolve();
      });
      
      this.customerSocket.on('connect', () => {
        console.log('✅ تم اتصال العميل');
        connectionsReady++;
        if (connectionsReady === 2) resolve();
      });
    });
  }

  /**
   * تشغيل جميع الاختبارات
   */
  async runAllTests() {
    console.log('🚀 بدء اختبار Debug Logging لنظام الدردشة');
    console.log('=' .repeat(50));
    
    try {
      await this.setupConnections();
      
      console.log('\n📋 تشغيل الاختبارات...');
      
      // اختبار رسالة من الكابتن
      await this.testCaptainMessage();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // اختبار رسالة من العميل
      await this.testCustomerMessage();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // اختبار الرسالة السريعة
      await this.testQuickMessage();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // اختبار الرسالة الخاطئة
      await this.testInvalidMessage();
      
      console.log('\n🎉 تم إكمال جميع الاختبارات بنجاح!');
      console.log('📊 راجع ملفات اللوجات لمشاهدة Debug logs المفصلة');
      
    } catch (error) {
      console.error('💥 خطأ في تشغيل الاختبارات:', error);
    } finally {
      this.cleanup();
    }
  }

  /**
   * تنظيف الاتصالات
   */
  cleanup() {
    console.log('\n🧹 تنظيف الاتصالات...');
    
    if (this.captainSocket) {
      this.captainSocket.disconnect();
      console.log('🔌 تم قطع اتصال الكابتن');
    }
    
    if (this.customerSocket) {
      this.customerSocket.disconnect();
      console.log('🔌 تم قطع اتصال العميل');
    }
    
    console.log('✅ تم تنظيف جميع الاتصالات');
  }
}

// تشغيل الاختبار
if (require.main === module) {
  const tester = new ChatDebugTester();
  tester.runAllTests().then(() => {
    console.log('\n👋 انتهاء اختبار Debug Logging');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 فشل في تشغيل الاختبار:', error);
    process.exit(1);
  });
}

module.exports = ChatDebugTester;
