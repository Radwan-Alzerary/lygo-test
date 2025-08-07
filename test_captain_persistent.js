const io = require('socket.io-client');

const CAPTAIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4OTUzMTdiNDlhN2EzNWQ3MTBiNDNlNCIsInVzZXJUeXBlIjoiY2FwdGFpbiIsImlhdCI6MTc1NDYwNzk5NiwiZXhwIjoxNzU1MjEyNzk2fQ.-vzezc0i8RpLjCl4vW8E_4rDBYOVeNLeBHltRZ61-o4';

console.log('🔄 Connecting captain to socket...');

const socket = io('http://localhost:5230/captain', {
  auth: {
    token: CAPTAIN_TOKEN
  },
  query: {
    token: CAPTAIN_TOKEN
  }
});

socket.on('connect', () => {
  console.log('✅ Captain connected:', socket.id);
  
  // إرسال موقع واحد والانتظار
  const location = {
    lat: 33.3152,
    lng: 44.3661,
    bearing: 45,
    speed: 30,
    accuracy: 10,
    timestamp: new Date().toISOString()
  };
  
  console.log('📍 Sending location:', location);
  socket.emit('updateLocation', location);
  
  // إبقاء الاتصال مفتوحاً لمدة 30 ثانية
  setTimeout(() => {
    console.log('🏁 Disconnecting after 30 seconds...');
    socket.disconnect();
  }, 30000);
});

socket.on('locationReceived', (data) => {
  console.log('✅ Location received confirmation:', data);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error);
});

socket.on('error', (error) => {
  console.error('❌ Socket error:', error);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Disconnected:', reason);
  process.exit(0);
});

// خروج نظيف عند Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  socket.disconnect();
  process.exit(0);
});
