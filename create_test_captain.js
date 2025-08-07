const mongoose = require('mongoose');
require('dotenv').config();
require('./config/database');
const Driver = require('./model/Driver');
const jwt = require('jsonwebtoken');

async function createTestCaptain() {
  try {
    console.log('🔌 الاتصال بقاعدة البيانات...');
    
    // حذف الكابتن التجريبي إن كان موجوداً
    await Driver.deleteOne({ email: 'test.captain@example.com' });
    
    // إنشاء كابتن تجريبي
    const testCaptain = new Driver({
      name: 'كابتن تجريبي',
      email: 'test.captain@example.com',
      phoneNumber: '+964123456789',
      whatsAppPhoneNumber: '+964123456789',
      password: '123456',
      currentLocation: {
        type: 'Point',
        coordinates: [44.3661, 33.3152] // بغداد
      },
      isAvailable: true,
      active: true,
      carDetails: {
        make: 'Toyota',
        model: 'Corolla',
        licensePlate: 'بغداد 12345',
        color: 'أبيض'
      },
      age: 30,
      address: 'بغداد، العراق'
    });
    
    const savedCaptain = await testCaptain.save();
    console.log('✅ تم إنشاء الكابتن التجريبي:', savedCaptain._id);
    
    // إنشاء JWT token للكابتن
    const token = jwt.sign(
      { 
        id: savedCaptain._id,
        userType: 'captain'
      }, 
      process.env.JWT_SECRET || "kishan sheth super secret key",
      { expiresIn: '7d' }
    );
    
    console.log('✅ JWT Token للكابتن:');
    console.log(token);
    console.log('\n📋 معلومات الكابتن:');
    console.log('ID:', savedCaptain._id);
    console.log('Name:', savedCaptain.name);
    console.log('Email:', savedCaptain.email);
    console.log('Phone:', savedCaptain.phone);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ خطأ في إنشاء الكابتن:', error);
    process.exit(1);
  }
}

createTestCaptain();
