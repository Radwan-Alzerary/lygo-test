const mongoose = require('mongoose');
const User = require('./model/user');
const bcrypt = require('bcrypt');

async function createTestAdmin() {
  try {
    // الاتصال بقاعدة البيانات
    require('dotenv').config();
    await mongoose.connect(process.env.DB_STRING);
    console.log('✅ تم الاتصال بقاعدة البيانات');

    // التحقق من وجود المستخدم
    const existingUser = await User.findOne({ email: 'admin_test@lygo.com' });
    
    if (existingUser) {
      console.log('👤 المدير الاختباري موجود بالفعل:');
      console.log(`   المعرف: ${existingUser._id}`);
      console.log(`   الاسم: ${existingUser.userName}`);
      console.log(`   الدور: ${existingUser.role}`);
      
      // تحديث البيانات إذا لزم الأمر
      existingUser.role = 'admin';
      await existingUser.save();
      
      console.log('✅ تم تحديث صلاحيات المدير');
      return existingUser._id;
    }

    // إنشاء مستخدم مدير جديد
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const testAdmin = new User({
      userName: 'مدير الاختبار',
      email: 'admin_test@lygo.com',
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date()
    });

    const savedUser = await testAdmin.save();
    console.log('✅ تم إنشاء مدير اختبار جديد:');
    console.log(`   المعرف: ${savedUser._id}`);
    console.log(`   الاسم: ${savedUser.userName}`);
    console.log(`   الدور: ${savedUser.role}`);

    return savedUser._id;

  } catch (error) {
    console.error('❌ خطأ في إنشاء المدير الاختباري:', error);
    throw error;
  } finally {
    mongoose.connection.close();
  }
}

// تشغيل الدالة
createTestAdmin()
  .then((userId) => {
    console.log(`\n🎯 معرف المدير للاختبار: ${userId}`);
    console.log('📋 يمكنك استخدام هذا المعرف في اختبارات نظام تتبع المواقع');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ فشل في إنشاء المدير:', error);
    process.exit(1);
  });
