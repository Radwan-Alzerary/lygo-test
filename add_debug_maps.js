const fs = require('fs');
const path = require('path');

/**
 * إضافة debug logging مؤقت للخرائط المتصلة
 * هذا الملف يضيف كود debug للتحقق من onlineCustomers و onlineCaptains
 */

class SocketMapDebugger {
  constructor() {
    this.captainServicePath = path.join(__dirname, 'services', 'captainSocketService.js');
    this.customerServicePath = path.join(__dirname, 'services', 'customerSocketService.js');
    this.backupSuffix = '.backup_before_debug';
  }

  /**
   * إضافة debug logging للـ socket services
   */
  async addDebugLogging() {
    console.log('🔧 إضافة debug logging لـ Socket Maps...');
    
    try {
      // إنشاء نسخ احتياطية
      await this.createBackups();
      
      // إضافة debug logging للكابتن service
      await this.addCaptainDebugLogging();
      
      // إضافة debug logging للعميل service
      await this.addCustomerDebugLogging();
      
      console.log('✅ تم إضافة debug logging بنجاح');
      console.log('📋 لإزالة التعديلات لاحقاً، استخدم: node remove_debug_logging.js');
      
    } catch (error) {
      console.error('❌ خطأ في إضافة debug logging:', error);
      await this.restoreBackups();
    }
  }

  /**
   * إنشاء نسخ احتياطية
   */
  async createBackups() {
    console.log('📋 إنشاء نسخ احتياطية...');
    
    if (fs.existsSync(this.captainServicePath)) {
      fs.copyFileSync(this.captainServicePath, this.captainServicePath + this.backupSuffix);
      console.log('✅ تم إنشاء نسخة احتياطية لـ captainSocketService.js');
    }
    
    if (fs.existsSync(this.customerServicePath)) {
      fs.copyFileSync(this.customerServicePath, this.customerServicePath + this.backupSuffix);
      console.log('✅ تم إنشاء نسخة احتياطية لـ customerSocketService.js');
    }
  }

  /**
   * إضافة debug logging للكابتن service
   */
  async addCaptainDebugLogging() {
    console.log('🔧 إضافة debug logging للكابتن service...');
    
    let content = fs.readFileSync(this.captainServicePath, 'utf8');
    
    // إضافة debug logging في handleSendChatMessage بعد العثور على العميل
    const searchString = `const customerSocketId = this.onlineCustomers[ride.passenger.toString()];`;
    const replaceString = `const customerSocketId = this.onlineCustomers[ride.passenger.toString()];
        
        // DEBUG LOGGING - مؤقت للفحص
        this.logger.debug(\`[DEBUG] [CaptainSocket] [\\${debugId}] Online customers map check\`, {
          totalOnlineCustomers: Object.keys(this.onlineCustomers).length,
          onlineCustomerIds: Object.keys(this.onlineCustomers),
          targetCustomerId: ride.passenger.toString(),
          foundSocketId: customerSocketId,
          allOnlineCustomers: this.onlineCustomers
        });`;

    if (content.includes(searchString) && !content.includes('DEBUG LOGGING - مؤقت للفحص')) {
      content = content.replace(searchString, replaceString);
    }

    // إضافة debug logging عند اتصال جديد
    const connectSearchString = `this.onlineCustomers[customerId] = socket.id;`;
    const connectReplaceString = `this.onlineCustomers[customerId] = socket.id;
        
        // DEBUG LOGGING - مؤقت للفحص  
        this.logger.debug('[DEBUG] [CaptainSocket] Customer connected to map', {
          customerId,
          socketId: socket.id,
          totalOnlineCustomers: Object.keys(this.onlineCustomers).length,
          allOnlineCustomers: this.onlineCustomers
        });`;

    if (content.includes(connectSearchString) && !content.includes('Customer connected to map')) {
      content = content.replace(connectSearchString, connectReplaceString);
    }

    // إضافة debug logging عند انقطاع الاتصال
    const disconnectSearchString = `delete this.onlineCustomers[customerId];`;
    const disconnectReplaceString = `delete this.onlineCustomers[customerId];
        
        // DEBUG LOGGING - مؤقت للفحص
        this.logger.debug('[DEBUG] [CaptainSocket] Customer disconnected from map', {
          customerId,
          socketId: socket.id,
          remainingCustomers: Object.keys(this.onlineCustomers).length,
          allOnlineCustomers: this.onlineCustomers
        });`;

    if (content.includes(disconnectSearchString) && !content.includes('Customer disconnected from map')) {
      content = content.replace(disconnectSearchString, disconnectReplaceString);
    }

    fs.writeFileSync(this.captainServicePath, content);
    console.log('✅ تم إضافة debug logging للكابتن service');
  }

  /**
   * إضافة debug logging للعميل service
   */
  async addCustomerDebugLogging() {
    console.log('🔧 إضافة debug logging للعميل service...');
    
    let content = fs.readFileSync(this.customerServicePath, 'utf8');
    
    // إضافة debug logging في handleSendChatMessage بعد العثور على الكابتن
    const searchString = `const driverSocketId = this.onlineCaptains[ride.driver.toString()];`;
    const replaceString = `const driverSocketId = this.onlineCaptains[ride.driver.toString()];
        
        // DEBUG LOGGING - مؤقت للفحص
        this.logger.debug(\`[DEBUG] [CustomerSocket] [\\${debugId}] Online captains map check\`, {
          totalOnlineCaptains: Object.keys(this.onlineCaptains).length,
          onlineCaptainIds: Object.keys(this.onlineCaptains),
          targetCaptainId: ride.driver.toString(),
          foundSocketId: driverSocketId,
          allOnlineCaptains: this.onlineCaptains
        });`;

    if (content.includes(searchString) && !content.includes('DEBUG LOGGING - مؤقت للفحص')) {
      content = content.replace(searchString, replaceString);
    }

    // إضافة debug logging عند اتصال جديد
    const connectSearchString = `this.onlineCaptains[captainId] = socket.id;`;
    const connectReplaceString = `this.onlineCaptains[captainId] = socket.id;
        
        // DEBUG LOGGING - مؤقت للفحص  
        this.logger.debug('[DEBUG] [CustomerSocket] Captain connected to map', {
          captainId,
          socketId: socket.id,
          totalOnlineCaptains: Object.keys(this.onlineCaptains).length,
          allOnlineCaptains: this.onlineCaptains
        });`;

    if (content.includes(connectSearchString) && !content.includes('Captain connected to map')) {
      content = content.replace(connectSearchString, connectReplaceString);
    }

    // إضافة debug logging عند انقطاع الاتصال
    const disconnectSearchString = `delete this.onlineCaptains[captainId];`;
    const disconnectReplaceString = `delete this.onlineCaptains[captainId];
        
        // DEBUG LOGGING - مؤقت للفحص
        this.logger.debug('[DEBUG] [CustomerSocket] Captain disconnected from map', {
          captainId,
          socketId: socket.id,
          remainingCaptains: Object.keys(this.onlineCaptains).length,
          allOnlineCaptains: this.onlineCaptains
        });`;

    if (content.includes(disconnectSearchString) && !content.includes('Captain disconnected from map')) {
      content = content.replace(disconnectSearchString, disconnectReplaceString);
    }

    fs.writeFileSync(this.customerServicePath, content);
    console.log('✅ تم إضافة debug logging للعميل service');
  }

  /**
   * استعادة النسخ الاحتياطية
   */
  async restoreBackups() {
    console.log('🔄 استعادة النسخ الاحتياطية...');
    
    if (fs.existsSync(this.captainServicePath + this.backupSuffix)) {
      fs.copyFileSync(this.captainServicePath + this.backupSuffix, this.captainServicePath);
      fs.unlinkSync(this.captainServicePath + this.backupSuffix);
      console.log('✅ تم استعادة captainSocketService.js');
    }
    
    if (fs.existsSync(this.customerServicePath + this.backupSuffix)) {
      fs.copyFileSync(this.customerServicePath + this.backupSuffix, this.customerServicePath);
      fs.unlinkSync(this.customerServicePath + this.backupSuffix);
      console.log('✅ تم استعادة customerSocketService.js');
    }
  }

  /**
   * إزالة debug logging
   */
  async removeDebugLogging() {
    console.log('🧹 إزالة debug logging...');
    
    try {
      await this.restoreBackups();
      console.log('✅ تم إزالة debug logging وإستعادة الملفات الأصلية');
    } catch (error) {
      console.error('❌ خطأ في إزالة debug logging:', error);
    }
  }
}

// إنشاء ملف script لإزالة التعديلات
const removeScript = `const SocketMapDebugger = require('./add_debug_maps');

const debugger = new SocketMapDebugger();
debugger.removeDebugLogging().then(() => {
  console.log('✅ تم إزالة جميع التعديلات');
  process.exit(0);
}).catch((error) => {
  console.error('❌ خطأ في إزالة التعديلات:', error);
  process.exit(1);
});`;

fs.writeFileSync(path.join(__dirname, 'remove_debug_logging.js'), removeScript);

// تشغيل الإضافة
if (require.main === module) {
  const debugger = new SocketMapDebugger();
  
  console.log('🔧 أداة إضافة Debug Logging للخرائط المتصلة');
  console.log('=' .repeat(50));
  console.log('هذه الأداة ستضيف debug logging مؤقت للتحقق من:');
  console.log('- خريطة onlineCustomers في captainSocketService');
  console.log('- خريطة onlineCaptains في customerSocketService');
  console.log('- عمليات الاتصال والانقطاع');
  console.log('=' .repeat(50));
  
  debugger.addDebugLogging().then(() => {
    console.log('\n🎉 تم الإكمال بنجاح!');
    console.log('🔄 أعد تشغيل الخادم لرؤية debug logs الجديدة');
    console.log('🧹 لإزالة التعديلات لاحقاً: node remove_debug_logging.js');
  }).catch((error) => {
    console.error('💥 فشل:', error);
    process.exit(1);
  });
}

module.exports = SocketMapDebugger;
