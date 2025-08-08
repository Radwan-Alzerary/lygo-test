const io = require('socket.io-client');

/**
 * فحص مركز لمشكلة عدم وصول الرسائل
 * يركز على السبب وراء ظهور اللوج ولكن عدم وصول الرسالة
 */
class RealTimeDeliveryInspector {
  constructor() {
    this.serverUrl = 'http://localhost:5230';
    
    // المعرفات من اللوجات المرفقة
    this.customerId = '6862f671db88db5431ccb7f8';
    this.captainId = '686721f1a69130ed4eefb4f6'; 
    this.rideId = '68961c3b84662ef6e24f6497';
    
    this.captainSocket = null;
    this.customerSocket = null;
    this.results = [];
  }

  /**
   * تشغيل الفحص المركز
   */
  async inspect() {
    console.log('\n🎯 فحص مركز لمشكلة عدم وصول الرسائل');
    console.log('=' .repeat(55));
    console.log('📋 المشكلة: اللوجات تظهر إرسال ناجح لكن الرسالة لا تصل');
    console.log('🔍 الهدف: معرفة السبب الحقيقي وراء هذه المشكلة');
    console.log('=' .repeat(55));

    try {
      await this.setupConnections();
      await this.inspectSocketMaps();
      await this.testMessageDelivery();
      await this.checkNamespaces();
      await this.inspectEventHandlers();
      
      this.generateDiagnosis();
      
    } catch (error) {
      console.error('💥 خطأ في الفحص:', error);
    } finally {
      this.cleanup();
    }
  }

  /**
   * إعداد الاتصالات مع مراقبة مفصلة
   */
  async setupConnections() {
    console.log('\n🔗 إعداد الاتصالات مع المراقبة المفصلة...');
    
    return new Promise((resolve, reject) => {
      let connectionsReady = 0;

      // اتصال الكابتن على namespace /captain
      this.captainSocket = io(`${this.serverUrl}/captain`, {
        auth: {
          token: 'test_token',
          userId: this.captainId
        },
        transports: ['websocket']
      });

      // اتصال العميل على namespace الافتراضي /
      this.customerSocket = io(this.serverUrl, {
        auth: {
          token: 'test_token',
          userId: this.customerId
        },
        transports: ['websocket']
      });

      // مراقبة اتصال الكابتن
      this.captainSocket.on('connect', () => {
        console.log(`✅ كابتن متصل: ${this.captainSocket.id} على namespace: /captain`);
        console.log(`📊 Transport: ${this.captainSocket.io.engine.transport.name}`);
        connectionsReady++;
        if (connectionsReady === 2) resolve();
      });

      // مراقبة اتصال العميل
      this.customerSocket.on('connect', () => {
        console.log(`✅ عميل متصل: ${this.customerSocket.id} على namespace: /`);
        console.log(`📊 Transport: ${this.customerSocket.io.engine.transport.name}`);
        connectionsReady++;
        if (connectionsReady === 2) resolve();
      });

      // مراقبة الأخطاء
      this.captainSocket.on('connect_error', (error) => {
        console.error('❌ خطأ اتصال الكابتن:', error.message);
        this.results.push({ issue: 'Captain connection failed', details: error.message });
      });

      this.customerSocket.on('connect_error', (error) => {
        console.error('❌ خطأ اتصال العميل:', error.message);
        this.results.push({ issue: 'Customer connection failed', details: error.message });
      });

      setTimeout(() => {
        if (connectionsReady < 2) {
          reject(new Error('فشل في إعداد الاتصالات خلال المهلة المحددة'));
        }
      }, 10000);
    });
  }

  /**
   * فحص خرائط Socket (onlineCustomers, onlineCaptains)
   */
  async inspectSocketMaps() {
    console.log('\n🗺️ فحص خرائط Socket (المشكلة المحتملة الأولى)...');
    
    // محاولة الحصول على معلومات من الخادم
    console.log('📡 طلب معلومات الاتصالات النشطة من الخادم...');
    
    // إرسال event خاص للحصول على معلومات debug
    this.captainSocket.emit('debug_get_online_users', {}, (response) => {
      if (response) {
        console.log('📊 معلومات المستخدمين المتصلين:', response);
        this.results.push({ 
          type: 'online_users_info', 
          data: response 
        });
      } else {
        console.log('⚠️ لم يتم الحصول على معلومات المستخدمين المتصلين');
        this.results.push({ 
          issue: 'No online users info available',
          suggestion: 'Server may not be tracking connections properly'
        });
      }
    });

    this.customerSocket.emit('debug_get_online_users', {}, (response) => {
      if (response) {
        console.log('📊 معلومات المستخدمين من جانب العميل:', response);
      }
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * اختبار توصيل الرسائل مع تتبع مفصل
   */
  async testMessageDelivery() {
    console.log('\n📨 اختبار توصيل الرسائل مع التتبع المفصل...');
    
    // إعداد listeners مع timestamps مفصلة
    let customerMessageReceived = false;
    let captainMessageReceived = false;

    this.customerSocket.on('chatMessage', (message) => {
      console.log(`🎯 [${new Date().toISOString()}] العميل استلم رسالة:`, {
        messageId: message.messageId,
        senderType: message.senderType,
        text: message.text,
        socketId: this.customerSocket.id,
        receivedAt: new Date().toISOString()
      });
      customerMessageReceived = true;
      this.results.push({
        type: 'message_received',
        recipient: 'customer',
        success: true,
        messageId: message.messageId,
        timestamp: new Date()
      });
    });

    this.captainSocket.on('chatMessage', (message) => {
      console.log(`🎯 [${new Date().toISOString()}] الكابتن استلم رسالة:`, {
        messageId: message.messageId,
        senderType: message.senderType,
        text: message.text,
        socketId: this.captainSocket.id,
        receivedAt: new Date().toISOString()
      });
      captainMessageReceived = true;
      this.results.push({
        type: 'message_received',
        recipient: 'captain',
        success: true,
        messageId: message.messageId,
        timestamp: new Date()
      });
    });

    // اختبار 1: رسالة من العميل للكابتن
    console.log('\n📤 اختبار 1: رسالة من العميل للكابتن...');
    await this.sendAndWaitForDelivery('customer', captainMessageReceived);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // اختبار 2: رسالة من الكابتن للعميل
    console.log('\n📤 اختبار 2: رسالة من الكابتن للعميل...');
    await this.sendAndWaitForDelivery('captain', customerMessageReceived);
  }

  /**
   * إرسال رسالة وانتظار التوصيل
   */
  async sendAndWaitForDelivery(senderType, receivedFlag) {
    return new Promise((resolve) => {
      const isFromCustomer = senderType === 'customer';
      const socket = isFromCustomer ? this.customerSocket : this.captainSocket;
      const senderName = isFromCustomer ? 'العميل' : 'الكابتن';

      const messageData = {
        rideId: this.rideId,
        text: `رسالة اختبار من ${senderName} - ${new Date().toISOString()}`,
        tempId: `temp_${senderType}_${Date.now()}`
      };

      console.log(`📡 [${new Date().toISOString()}] ${senderName} يرسل رسالة:`, messageData);

      const sendStartTime = Date.now();
      
      socket.emit('sendChatMessage', messageData, (response) => {
        const sendEndTime = Date.now();
        const sendDuration = sendEndTime - sendStartTime;

        console.log(`📋 [${new Date().toISOString()}] استجابة الخادم لـ ${senderName}:`, {
          ...response,
          sendDuration: `${sendDuration}ms`,
          timestamp: new Date().toISOString()
        });

        if (response.success) {
          console.log(`✅ تم حفظ الرسالة في قاعدة البيانات (${sendDuration}ms)`);
          
          // انتظار التوصيل لمدة 5 ثوان
          let deliveryTimeout = setTimeout(() => {
            console.log(`⏰ انتهت مهلة انتظار توصيل رسالة ${senderName}`);
            this.results.push({
              type: 'delivery_timeout',
              sender: senderType,
              messageId: response.message?.messageId,
              timestamp: new Date()
            });
            resolve();
          }, 5000);

          // مراقبة التوصيل
          const checkDelivery = setInterval(() => {
            if (receivedFlag) {
              clearTimeout(deliveryTimeout);
              clearInterval(checkDelivery);
              const deliveryTime = Date.now() - sendStartTime;
              console.log(`🎉 تم توصيل رسالة ${senderName} بنجاح خلال ${deliveryTime}ms`);
              resolve();
            }
          }, 100);

        } else {
          console.error(`❌ فشل في إرسال رسالة ${senderName}:`, response.message);
          this.results.push({
            type: 'send_failed',
            sender: senderType,
            error: response.message,
            timestamp: new Date()
          });
          resolve();
        }
      });
    });
  }

  /**
   * فحص Namespaces
   */
  async checkNamespaces() {
    console.log('\n🏷️ فحص Namespaces (مشكلة محتملة)...');
    
    console.log(`📍 الكابتن على namespace: ${this.captainSocket.nsp}`);
    console.log(`📍 العميل على namespace: ${this.customerSocket.nsp}`);
    
    // فحص إذا كان namespace routing يعمل بشكل صحيح
    if (this.captainSocket.nsp !== '/captain') {
      console.error('⚠️ مشكلة: الكابتن ليس على namespace /captain');
      this.results.push({
        issue: 'Captain namespace mismatch',
        expected: '/captain',
        actual: this.captainSocket.nsp
      });
    }

    if (this.customerSocket.nsp !== '/') {
      console.error('⚠️ مشكلة: العميل ليس على namespace /');
      this.results.push({
        issue: 'Customer namespace mismatch',
        expected: '/',
        actual: this.customerSocket.nsp
      });
    }
  }

  /**
   * فحص Event Handlers
   */
  async inspectEventHandlers() {
    console.log('\n👂 فحص Event Handlers...');
    
    // فحص إذا كان chatMessage handler مسجل
    console.log('🔍 فحص تسجيل event handlers...');
    
    const captainEvents = this.captainSocket._callbacks || {};
    const customerEvents = this.customerSocket._callbacks || {};
    
    console.log('📊 أحداث الكابتن المسجلة:', Object.keys(captainEvents));
    console.log('📊 أحداث العميل المسجلة:', Object.keys(customerEvents));
    
    if (!captainEvents['chatMessage']) {
      console.warn('⚠️ لا يوجد chatMessage handler مسجل للكابتن');
      this.results.push({ issue: 'No chatMessage handler for captain' });
    }
    
    if (!customerEvents['chatMessage']) {
      console.warn('⚠️ لا يوجد chatMessage handler مسجل للعميل');
      this.results.push({ issue: 'No chatMessage handler for customer' });
    }
  }

  /**
   * توليد التشخيص النهائي
   */
  generateDiagnosis() {
    console.log('\n🔬 التشخيص النهائي');
    console.log('=' .repeat(50));
    
    // تحليل النتائج
    const deliveryFailures = this.results.filter(r => r.type === 'delivery_timeout');
    const connectionIssues = this.results.filter(r => r.issue && r.issue.includes('connection'));
    const namespaceIssues = this.results.filter(r => r.issue && r.issue.includes('namespace'));
    const handlerIssues = this.results.filter(r => r.issue && r.issue.includes('handler'));

    console.log(`📊 مشاكل التوصيل: ${deliveryFailures.length}`);
    console.log(`📊 مشاكل الاتصال: ${connectionIssues.length}`);
    console.log(`📊 مشاكل Namespace: ${namespaceIssues.length}`);
    console.log(`📊 مشاكل Event Handler: ${handlerIssues.length}`);

    console.log('\n🎯 الأسباب المحتملة لعدم وصول الرسائل:');
    
    if (deliveryFailures.length > 0) {
      console.log('\n🚨 مشكلة رئيسية: فشل في توصيل الرسائل');
      console.log('   الأسباب المحتملة:');
      console.log('   1. خريطة onlineCustomers/onlineCaptains غير محدثة');
      console.log('   2. Socket ID غير صحيح في الخريطة');
      console.log('   3. مشكلة في io.to(socketId).emit()');
      console.log('   4. Namespace routing خاطئ');
    }

    if (namespaceIssues.length > 0) {
      console.log('\n⚠️ مشكلة Namespace:');
      namespaceIssues.forEach(issue => {
        console.log(`   - ${issue.issue}: توقع ${issue.expected} لكن حصل على ${issue.actual}`);
      });
    }

    if (handlerIssues.length > 0) {
      console.log('\n⚠️ مشكلة Event Handlers:');
      handlerIssues.forEach(issue => {
        console.log(`   - ${issue.issue}`);
      });
    }

    console.log('\n🔧 خطوات الإصلاح المقترحة:');
    console.log('1. فحص تحديث onlineCustomers في customerSocketService');
    console.log('2. فحص تحديث onlineCaptains في captainSocketService');
    console.log('3. التأكد من استخدام Socket ID الصحيح في io.to()');
    console.log('4. فحص cross-namespace communication');
    console.log('5. إضافة logging للخرائط عند كل اتصال/انقطاع');
    
    // اقتراحات محددة
    console.log('\n💡 كود للفحص:');
    console.log('// في captainSocketService.js');
    console.log('console.log("Online customers:", Object.keys(this.onlineCustomers));');
    console.log('console.log("Customer socket for ID:", ride.passenger, "->", this.onlineCustomers[ride.passenger]);');
    console.log('');
    console.log('// في customerSocketService.js');
    console.log('console.log("Online captains:", Object.keys(this.onlineCaptains));');
    console.log('console.log("Captain socket for ID:", ride.driver, "->", this.onlineCaptains[ride.driver]);');
  }

  /**
   * تنظيف الموارد
   */
  cleanup() {
    console.log('\n🧹 تنظيف الموارد...');
    
    if (this.captainSocket) {
      this.captainSocket.disconnect();
    }
    
    if (this.customerSocket) {
      this.customerSocket.disconnect();
    }
    
    console.log('✅ تم الانتهاء من الفحص');
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }
}

// تشغيل الفحص
if (require.main === module) {
  const inspector = new RealTimeDeliveryInspector();
  
  process.on('SIGINT', () => {
    console.log('\n⏹️ تم إيقاف الفحص');
    inspector.cleanup();
  });
  
  inspector.inspect().catch((error) => {
    console.error('💥 فشل الفحص:', error);
    inspector.cleanup();
  });
}

module.exports = RealTimeDeliveryInspector;
