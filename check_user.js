const mongoose = require('mongoose');
const User = require('./model/user');

async function checkUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ride-hailing');
    console.log('✅ تم الاتصال بقاعدة البيانات');

    const user = await User.findById('6895191c7ab6f95dd55e9e3a');
    
    if (user) {
      console.log('👤 المستخدم موجود:');
      console.log('   المعرف:', user._id);
      console.log('   الاسم:', user.userName);
      console.log('   البريد:', user.email);
      console.log('   الدور:', user.role);
    } else {
      console.log('❌ المستخدم غير موجود');
      
      // البحث عن أي مستخدمين مدراء
      const admins = await User.find({ role: 'admin' });
      console.log('\n📋 المدراء الموجودون:');
      admins.forEach(admin => {
        console.log(`   ${admin._id} - ${admin.userName} (${admin.role})`);
      });
    }

  } catch (error) {
    console.error('❌ خطأ:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
}

checkUser();
