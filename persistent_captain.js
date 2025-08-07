const io = require('socket.io-client');

const CAPTAIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4OTUzMTdiNDlhN2EzNWQ3MTBiNDNlNCIsInVzZXJUeXBlIjoiY2FwdGFpbiIsImlhdCI6MTc1NDYwNzk5NiwiZXhwIjoxNzU1MjEyNzk2fQ.-vzezc0i8RpLjCl4vW8E_4rDBYOVeNLeBHltRZ61-o4';

console.log('🔄 Starting persistent captain for testing...');
console.log('ℹ️  Press Ctrl+C to stop');

const socket = io('http://localhost:5230/captain', {
  auth: {
    token: CAPTAIN_TOKEN
  },
  query: {
    token: CAPTAIN_TOKEN
  },
  transports: ['websocket', 'polling']
});

let locationCount = 0;

socket.on('connect', () => {
  console.log('✅ Captain connected:', socket.id);
  
  // إرسال موقع كل 10 ثوانٍ
  const locationInterval = setInterval(() => {
    locationCount++;
    
    const location = {
      latitude: 33.3152 + (Math.random() - 0.5) * 0.01,
      longitude: 44.3661 + (Math.random() - 0.5) * 0.01,
      bearing: Math.floor(Math.random() * 360),
      speed: Math.floor(Math.random() * 60),
      accuracy: Math.floor(Math.random() * 20) + 5,
      timestamp: new Date().toISOString()
    };
    
    console.log(`📍 [${locationCount}] Sending location: (${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)})`);
    socket.emit('updateLocation', location);
  }, 10000); // كل 10 ثوانٍ
  
  // حفظ interval للتنظيف لاحقاً
  socket.locationInterval = locationInterval;
});

socket.on('locationReceived', (data) => {
  console.log('✅ Location received confirmation');
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
  process.exit(1);
});

socket.on('error', (error) => {
  console.error('❌ Socket error:', error);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Disconnected:', reason);
  if (socket.locationInterval) {
    clearInterval(socket.locationInterval);
  }
  process.exit(0);
});

// خروج نظيف عند Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down captain...');
  if (socket.locationInterval) {
    clearInterval(socket.locationInterval);
  }
  socket.disconnect();
  process.exit(0);
});
