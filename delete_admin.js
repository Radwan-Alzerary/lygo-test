const mongoose = require('mongoose');
const User = require('./model/user');
const FinancialAccount = require('./model/financialAccount');
require('dotenv').config();

async function deleteExistingAdmin() {
  try {
    await mongoose.connect(process.env.DB_STRING);
    console.log('✅ تم الاتصال بقاعدة البيانات');

    // البحث عن المدير الحالي
    const existingAdmin = await User.findOne({ email: 'admin@admin.com' });
    
    if (existingAdmin) {
      console.log(`🗑️  إزالة المدير الحالي: ${existingAdmin._id}`);
      
      // حذف الحساب المالي إذا كان موجوداً
      if (existingAdmin.financialAccount) {
        await FinancialAccount.findByIdAndDelete(existingAdmin.financialAccount);
        console.log('🗑️  تم حذف الحساب المالي');
      }
      
      // حذف المدير
      await User.findByIdAndDelete(existingAdmin._id);
      console.log('✅ تم حذف المدير السابق');
    } else {
      console.log('ℹ️  لا يوجد مدير سابق للحذف');
    }

  } catch (error) {
    console.error('❌ خطأ في حذف المدير:', error);
  } finally {
    await mongoose.connection.close();
  }
}

deleteExistingAdmin();
