const io = require('socket.io-client');

// محاكاة كابتن يرسل موقعه
async function testCaptainLocation() {
  try {
    console.log('🔌 محاولة اتصال كابتن وهمي...');
    
    // أولاً، نحتاج للحصول على JWT token للكابتن
    // token الكابتن التجريبي الذي تم إنشاؤه
    const captainToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4OTUzMTdiNDlhN2EzNWQ3MTBiNDNlNCIsInVzZXJUeXBlIjoiY2FwdGFpbiIsImlhdCI6MTc1NDYwNzk5NiwiZXhwIjoxNzU1MjEyNzk2fQ.-vzezc0i8RpLjCl4vW8E_4rDBYOVeNLeBHltRZ61-o4';
    
    // الاتصال بـ captain namespace مع token
    const socket = io('http://localhost:5230/captain', {
      transports: ['websocket'],
      forceNew: true,
      query: {
        token: captainToken
      }
    });

    socket.on('connect', () => {
      console.log('✅ الكابتن متصل - Socket ID:', socket.id);
      
      // إرسال موقع كل 3 ثوان بدون حاجة لتسجيل دخول إضافي
      let locationCount = 0;
      const locationInterval = setInterval(() => {
        locationCount++;
        
        // إحداثيات بغداد مع تنويع بسيط
        const baseLocation = {
          latitude: 33.3152 + (Math.random() - 0.5) * 0.01,
          longitude: 44.3661 + (Math.random() - 0.5) * 0.01
        };
        
        const locationData = {
          latitude: baseLocation.latitude,
          longitude: baseLocation.longitude,
          accuracy: Math.floor(Math.random() * 20) + 5,
          speed: Math.floor(Math.random() * 50),
          heading: Math.floor(Math.random() * 360),
          timestamp: Date.now()
        };
        
        console.log(`📍 إرسال موقع #${locationCount}:`, 
          `(${locationData.latitude.toFixed(6)}, ${locationData.longitude.toFixed(6)})`);
        
        socket.emit('updateLocation', locationData);
        
        // إيقاف بعد 10 مواقع
        if (locationCount >= 10) {
          clearInterval(locationInterval);
          console.log('⏹️ تم إرسال 10 مواقع، انتهاء الاختبار');
          
          setTimeout(() => {
            socket.disconnect();
            process.exit(0);
          }, 2000);
        }
      }, 3000);
    });

    socket.on('locationUpdateSuccess', (data) => {
      console.log('✅ تم تحديث الموقع بنجاح');
    });

    socket.on('locationError', (error) => {
      console.log('❌ خطأ في تحديث الموقع:', error);
    });

    socket.on('connect_error', (error) => {
      console.error('❌ خطأ في الاتصال:', error.message);
      process.exit(1);
    });

    socket.on('disconnect', (reason) => {
      console.log('⚠️ انقطع الاتصال:', reason);
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ خطأ في الاختبار:', error);
    process.exit(1);
  }
}

// بدء الاختبار
testCaptainLocation();
