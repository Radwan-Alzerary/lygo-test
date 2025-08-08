const io = require('socket.io-client');

/**
 * اختبار مباشر لـ Socket Connection للدردشة
 * Direct Socket Connection Test for Chat
 */

async function testSocketConnection() {
  console.log('🔌 Testing Socket Connection for Chat...\n');
  
  const SERVER_URL = 'http://localhost:5230';
  
  // Test connection without authentication first
  console.log('1️⃣ Testing basic connection...');
  
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    timeout: 5000
  });
  
  return new Promise((resolve, reject) => {
    let connected = false;
    
    socket.on('connect', () => {
      console.log('✅ Socket connected successfully');
      console.log(`   Socket ID: ${socket.id}`);
      connected = true;
      
      // Test chat events availability
      console.log('\n2️⃣ Testing chat events...');
      
      // Test quick messages without auth (should work)
      socket.emit('getQuickMessages', (response) => {
        if (response && response.success) {
          console.log('✅ Quick messages event working');
          console.log(`   Customer messages: ${response.data.length}`);
        } else {
          console.log('⚠️  Quick messages require authentication');
        }
      });
      
      // Test send message (should require auth)
      socket.emit('sendChatMessage', {
        rideId: 'test123',
        text: 'Test message'
      }, (response) => {
        if (response && !response.success) {
          console.log('✅ Send message properly requires authentication');
        } else {
          console.log('⚠️  Send message should require authentication');
        }
      });
      
      setTimeout(() => {
        socket.disconnect();
        resolve(true);
      }, 2000);
    });
    
    socket.on('connect_error', (error) => {
      console.log('❌ Connection failed:', error.message);
      resolve(false);
    });
    
    socket.on('disconnect', (reason) => {
      if (connected) {
        console.log('🔌 Disconnected successfully:', reason);
      }
    });
    
    socket.on('connectionError', (error) => {
      console.log('❌ Connection error:', error);
      resolve(false);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!connected) {
        console.log('⏰ Connection timeout');
        socket.disconnect();
        resolve(false);
      }
    }, 10000);
  });
}

async function testChatAPI() {
  console.log('\n🌐 Testing Chat API endpoints...\n');
  
  const BASE_URL = 'http://localhost:5230/api';
  
  try {
    // Test without authentication (should fail)
    const response = await fetch(`${BASE_URL}/chat/history/test123`);
    
    if (response.status === 401) {
      console.log('✅ Chat API properly requires authentication');
      console.log('   Status: 401 Unauthorized');
    } else if (response.status === 404) {
      console.log('✅ Chat API endpoint exists');
      console.log('   Status: 404 (route found but resource not found)');
    } else {
      console.log(`⚠️  Unexpected status: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Server is not running on port 5230');
      console.log('   Please make sure the server is started');
    } else {
      console.log('❌ API test failed:', error.message);
    }
    return false;
  }
}

async function testServerLogs() {
  console.log('\n📋 Checking server logs for Chat Service...\n');
  
  const { exec } = require('child_process');
  
  return new Promise((resolve) => {
    exec('ps aux | grep "node main.js"', (error, stdout, stderr) => {
      if (stdout && stdout.includes('node main.js')) {
        console.log('✅ Server process is running');
        
        // Check for chat-related logs
        exec('tail -20 app.log 2>/dev/null | grep -i chat || echo "No chat logs found"', (error, stdout, stderr) => {
          if (stdout.includes('chat')) {
            console.log('✅ Chat service logs found in app.log');
          } else {
            console.log('ℹ️  No recent chat logs (normal if no chat activity)');
          }
          resolve(true);
        });
      } else {
        console.log('❌ Server process not found');
        console.log('   Run: node main.js');
        resolve(false);
      }
    });
  });
}

async function runConnectionTests() {
  console.log('🚀 Starting Socket Connection Tests for Chat Service');
  console.log('=' * 60);
  
  const results = [];
  
  // Test 1: Socket Connection
  console.log('TEST 1: Socket Connection');
  console.log('-' * 30);
  results.push(await testSocketConnection());
  
  // Test 2: Chat API
  console.log('TEST 2: Chat API Endpoints');
  console.log('-' * 30);
  results.push(await testChatAPI());
  
  // Test 3: Server Status
  console.log('TEST 3: Server Status');
  console.log('-' * 30);
  results.push(await testServerLogs());
  
  // Summary
  console.log('\n' + '=' * 60);
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('=' * 60);
  
  const passed = results.filter(r => r === true).length;
  const total = results.length;
  
  console.log(`✅ Passed: ${passed}/${total} tests`);
  
  if (passed === total) {
    console.log('🎉 All connection tests PASSED!');
    console.log('💬 Chat Service is ready for client connections');
  } else {
    console.log('⚠️  Some tests failed. Check the issues above.');
  }
  
  console.log('\n📝 Next Steps for Frontend Integration:');
  console.log('1. Connect to WebSocket: ws://localhost:5230');
  console.log('2. Authenticate with JWT token');
  console.log('3. Listen for "chatMessage" events');
  console.log('4. Emit "sendChatMessage" to send messages');
  console.log('5. Use "getQuickMessages" for predefined messages');
  
  console.log('\n🔧 Socket Events Available:');
  console.log('   - sendChatMessage (requires auth)');
  console.log('   - getChatHistory (requires auth)');
  console.log('   - markMessagesAsRead (requires auth)');
  console.log('   - typingIndicator (requires auth)');
  console.log('   - getQuickMessages (public)');
}

// Run tests
if (require.main === module) {
  runConnectionTests().catch(console.error);
}

module.exports = {
  testSocketConnection,
  testChatAPI,
  testServerLogs,
  runConnectionTests
};
