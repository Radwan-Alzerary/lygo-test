const mongoose = require('mongoose');
const User = require('./model/user');
require('dotenv').config();

/**
 * إنشاء مدير افتراضي للنظام
 * البيانات:
 * - البريد الإلكتروني: admin@admin.com  
 * - كلمة المرور: 11223344
 * - الدور: admin
 */

async function createDefaultAdmin() {
  try {
    console.log('🔄 بدء إنشاء المدير الافتراضي...\n');
    
    // الاتصال بقاعدة البيانات
    await mongoose.connect(process.env.DB_STRING);
    console.log('✅ تم الاتصال بقاعدة البيانات');

    // التحقق من وجود المدير
    const existingAdmin = await User.findOne({ email: 'admin@admin.com' });
    
    if (existingAdmin) {
      console.log('👤 المدير الافتراضي موجود بالفعل:');
      console.log(`   المعرف: ${existingAdmin._id}`);
      console.log(`   الاسم: ${existingAdmin.userName}`);
      console.log(`   البريد: ${existingAdmin.email}`);
      console.log(`   الدور: ${existingAdmin.role}`);
      
      // تحديث كلمة المرور إذا لزم الأمر
      if (process.argv.includes('--update-password')) {
        existingAdmin.password = '11223344'; // سيتم تشفيرها تلقائياً بواسطة pre-save hook
        await existingAdmin.save();
        console.log('🔑 تم تحديث كلمة المرور');
      }
      
      return existingAdmin._id;
    }

    // إنشاء مدير جديد
    console.log('👨‍💼 إنشاء مدير افتراضي جديد...');
    
    const defaultAdmin = new User({
      userName: 'مدير النظام',
      email: 'admin@admin.com',
      password: '11223344', // سيتم تشفيرها تلقائياً
      role: 'admin',
      totalCommissions: 0,
      totalSystemEarnings: 0,
      createdAt: new Date()
    });

    const savedAdmin = await defaultAdmin.save();
    
    // إنشاء الحساب المالي للمدير
    const FinancialAccount = require('./model/financialAccount');
    
    const adminFinancialAccount = new FinancialAccount({
      user: savedAdmin._id,
      accountType: 'admin',
      vault: 0,
      currency: 'IQD',
      isActive: true,
      metadata: {
        createdBy: 'system',
        purpose: 'admin_account',
        description: 'Default admin financial account'
      }
    });
    
    await adminFinancialAccount.save();
    
    // ربط الحساب المالي بالمدير
    savedAdmin.financialAccount = adminFinancialAccount._id;
    await savedAdmin.save();
    
    console.log('✅ تم إنشاء المدير الافتراضي بنجاح:');
    console.log(`   المعرف: ${savedAdmin._id}`);
    console.log(`   الاسم: ${savedAdmin.userName}`);
    console.log(`   البريد: ${savedAdmin.email}`);
    console.log(`   الدور: ${savedAdmin.role}`);
    console.log(`   الحساب المالي: ${adminFinancialAccount._id}`);
    
    console.log('\n🎯 معلومات تسجيل الدخول:');
    console.log('   البريد الإلكتروني: admin@admin.com');
    console.log('   كلمة المرور: 11223344');
    
    return savedAdmin._id;

  } catch (error) {
    console.error('❌ خطأ في إنشاء المدير الافتراضي:', error.message);
    
    if (error.code === 11000) {
      console.error('💡 المدير موجود بالفعل. استخدم --update-password لتحديث كلمة المرور');
    }
    
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('\n🔐 تم قطع الاتصال من قاعدة البيانات');
  }
}

// معالجة المعاملات من سطر الأوامر
const args = process.argv.slice(2);
const shouldUpdatePassword = args.includes('--update-password');
const shouldHelp = args.includes('--help') || args.includes('-h');

if (shouldHelp) {
  console.log(`
📋 استخدام الأداة:

node create_default_admin.js                 - إنشاء مدير افتراضي جديد
node create_default_admin.js --update-password - تحديث كلمة مرور المدير الموجود
node create_default_admin.js --help           - عرض هذه المساعدة

🔑 معلومات المدير الافتراضي:
   البريد الإلكتروني: admin@admin.com
   كلمة المرور: 11223344
   الدور: admin
  `);
  process.exit(0);
}

// تشغيل الدالة
createDefaultAdmin()
  .then((adminId) => {
    console.log(`\n🎉 تمت العملية بنجاح!`);
    console.log(`📋 معرف المدير: ${adminId}`);
    console.log('\n🚀 يمكنك الآن تسجيل الدخول باستخدام:');
    console.log('   admin@admin.com / 11223344');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 فشلت العملية:', error.message);
    process.exit(1);
  });
