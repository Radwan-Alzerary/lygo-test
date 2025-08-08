# 📱 دليل Socket.IO للموبايل - نظام الدردشة
# Mobile Socket.IO Guide - Chat System

## 🔌 الاتصال بالخادم / Server Connection

### 1. إعداد الاتصال الأساسي / Basic Connection Setup

```javascript
// React Native / Expo
import io from 'socket.io-client';

// Android Kotlin
// implementation 'io.socket:socket.io-client:2.0.1'

// iOS Swift  
// pod 'Socket.IO-Client-Swift', '~> 16.0.0'
```

### 2. إنشاء الاتصال / Create Connection

#### React Native / JavaScript
```javascript
class ChatSocketManager {
  constructor(userId, userType, token) {
    this.userId = userId;
    this.userType = userType; // 'customer' or 'driver'  
    this.token = token;
    this.socket = null;
    this.isConnected = false;
  }

  connect() {
    const serverUrl = 'https://your-server.com'; // أو http://localhost:5230 للتطوير
    
    // للزبون - الاتصال بالـ namespace الرئيسي
    const namespace = this.userType === 'customer' ? '' : '/captain';
    
    this.socket = io(`${serverUrl}${namespace}`, {
      transports: ['websocket'],
      query: {
        token: this.token
      },
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    this.setupEventListeners();
  }

  setupEventListeners() {
    // 🔗 أحداث الاتصال / Connection Events
    this.socket.on('connect', () => {
      console.log('✅ Connected to chat server');
      console.log('Socket ID:', this.socket.id);
      this.isConnected = true;
      this.onConnectionChange(true);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from chat server:', reason);
      this.isConnected = false;
      this.onConnectionChange(false);
    });

    this.socket.on('connect_error', (error) => {
      console.error('🚫 Connection error:', error);
      this.onConnectionError(error);
    });

    this.socket.on('connectionError', (error) => {
      console.error('🔒 Authentication error:', error);
      this.onAuthError(error);
    });

    // 💬 أحداث الدردشة / Chat Events
    this.socket.on('chatMessage', (data) => {
      console.log('📨 New message received:', data);
      this.onNewMessage(data);
    });

    this.socket.on('typingIndicator', (data) => {
      console.log('⌨️ Typing indicator:', data);
      this.onTypingIndicator(data);
    });

    this.socket.on('messageDelivered', (data) => {
      console.log('✅ Message delivered:', data);
      this.onMessageDelivered(data);
    });

    this.socket.on('messageRead', (data) => {
      console.log('👁️ Message read:', data);
      this.onMessageRead(data);
    });
  }

  // 📤 إرسال رسالة / Send Message
  sendMessage(rideId, text, isQuick = false, quickMessageType = null) {
    if (!this.isConnected) {
      throw new Error('Not connected to server');
    }

    const messageData = {
      rideId: rideId,
      text: text.trim(),
      isQuick: isQuick,
      quickMessageType: quickMessageType,
      tempId: `temp_${Date.now()}_${Math.random()}` // معرف مؤقت للرسالة
    };

    console.log('📤 Sending message:', messageData);

    return new Promise((resolve, reject) => {
      this.socket.emit('sendChatMessage', messageData, (response) => {
        if (response && response.success) {
          console.log('✅ Message sent successfully:', response.message);
          resolve(response.message);
        } else {
          console.error('❌ Failed to send message:', response);
          reject(new Error(response?.message || 'Failed to send message'));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Message send timeout'));
      }, 10000);
    });
  }

  // 📚 جلب تاريخ المحادثة / Get Chat History
  getChatHistory(rideId, limit = 50, skip = 0) {
    return new Promise((resolve, reject) => {
      const requestData = {
        rideId: rideId,
        limit: limit,
        skip: skip
      };

      this.socket.emit('getChatHistory', requestData, (response) => {
        if (response && response.success) {
          console.log(`📚 Chat history received: ${response.messages.length} messages`);
          resolve(response);
        } else {
          console.error('❌ Failed to get chat history:', response);
          reject(new Error(response?.message || 'Failed to get chat history'));
        }
      });

      setTimeout(() => {
        reject(new Error('Chat history request timeout'));
      }, 10000);
    });
  }

  // ✅ تحديد الرسائل كمقروءة / Mark Messages as Read
  markMessagesAsRead(rideId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return;
    }

    const readData = {
      rideId: rideId,
      messageIds: messageIds
    };

    console.log('👁️ Marking messages as read:', readData);
    
    this.socket.emit('markMessagesAsRead', readData);
  }

  // ⌨️ إرسال مؤشر الكتابة / Send Typing Indicator
  sendTypingIndicator(rideId, isTyping) {
    const typingData = {
      rideId: rideId,
      isTyping: isTyping
    };

    console.log('⌨️ Sending typing indicator:', typingData);
    this.socket.emit('typingIndicator', typingData);
  }

  // ⚡ جلب الرسائل السريعة / Get Quick Messages
  getQuickMessages() {
    return new Promise((resolve, reject) => {
      this.socket.emit('getQuickMessages', (response) => {
        if (response && response.success) {
          console.log(`⚡ Quick messages received: ${response.data.length} messages`);
          resolve(response.data);
        } else {
          console.error('❌ Failed to get quick messages:', response);
          reject(new Error('Failed to get quick messages'));
        }
      });

      setTimeout(() => {
        reject(new Error('Quick messages request timeout'));
      }, 5000);
    });
  }

  // 🔌 قطع الاتصال / Disconnect
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.isConnected = false;
    }
  }

  // 📞 Callbacks - يجب تنفيذها في التطبيق
  onConnectionChange(connected) {
    // تحديث UI بناءً على حالة الاتصال
  }

  onConnectionError(error) {
    // عرض رسالة خطأ للمستخدم
  }

  onAuthError(error) {
    // إعادة تسجيل الدخول أو تحديث التوكن
  }

  onNewMessage(message) {
    // إضافة الرسالة للمحادثة وتحديث UI
  }

  onTypingIndicator(data) {
    // عرض أو إخفاء مؤشر الكتابة
  }

  onMessageDelivered(data) {
    // تحديث حالة الرسالة إلى "تم التوصيل"
  }

  onMessageRead(data) {
    // تحديث حالة الرسالة إلى "تم القراءة"
  }
}
```

#### Android Kotlin
```kotlin
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import org.json.JSONObject

class ChatSocketManager(
    private val userId: String,
    private val userType: String, // "customer" or "driver"
    private val token: String
) {
    private var socket: Socket? = null
    private var isConnected = false

    fun connect() {
        try {
            val opts = IO.Options()
            opts.transports = arrayOf("websocket")
            opts.query = "token=$token"
            opts.timeout = 10000
            opts.reconnection = true

            val serverUrl = "https://your-server.com"
            val namespace = if (userType == "customer") "" else "/captain"
            
            socket = IO.socket("$serverUrl$namespace", opts)
            setupEventListeners()
            socket?.connect()
            
        } catch (e: Exception) {
            println("❌ Connection error: ${e.message}")
        }
    }

    private fun setupEventListeners() {
        socket?.on(Socket.EVENT_CONNECT) {
            println("✅ Connected to chat server")
            isConnected = true
            onConnectionChange(true)
        }

        socket?.on(Socket.EVENT_DISCONNECT) { args ->
            println("❌ Disconnected: ${args[0]}")
            isConnected = false
            onConnectionChange(false)
        }

        socket?.on("chatMessage") { args ->
            val message = args[0] as JSONObject
            println("📨 New message: $message")
            onNewMessage(message)
        }

        socket?.on("typingIndicator") { args ->
            val data = args[0] as JSONObject
            println("⌨️ Typing indicator: $data")
            onTypingIndicator(data)
        }
    }

    fun sendMessage(rideId: String, text: String, isQuick: Boolean = false) {
        if (!isConnected) {
            throw Exception("Not connected to server")
        }

        val messageData = JSONObject().apply {
            put("rideId", rideId)
            put("text", text.trim())
            put("isQuick", isQuick)
            put("tempId", "temp_${System.currentTimeMillis()}")
        }

        println("📤 Sending message: $messageData")

        socket?.emit("sendChatMessage", messageData) { args ->
            val response = args[0] as JSONObject
            if (response.getBoolean("success")) {
                println("✅ Message sent successfully")
            } else {
                println("❌ Failed to send message: $response")
            }
        }
    }

    fun getChatHistory(rideId: String, limit: Int = 50, skip: Int = 0) {
        val requestData = JSONObject().apply {
            put("rideId", rideId)
            put("limit", limit)
            put("skip", skip)
        }

        socket?.emit("getChatHistory", requestData) { args ->
            val response = args[0] as JSONObject
            if (response.getBoolean("success")) {
                println("📚 Chat history received")
                onChatHistoryReceived(response)
            }
        }
    }

    fun disconnect() {
        socket?.disconnect()
        isConnected = false
    }

    // Callbacks
    private fun onConnectionChange(connected: Boolean) {
        // تحديث UI
    }

    private fun onNewMessage(message: JSONObject) {
        // إضافة الرسالة للمحادثة
    }

    private fun onTypingIndicator(data: JSONObject) {
        // عرض مؤشر الكتابة
    }

    private fun onChatHistoryReceived(response: JSONObject) {
        // عرض تاريخ المحادثة
    }
}
```

#### iOS Swift
```swift
import SocketIO

class ChatSocketManager {
    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private let userId: String
    private let userType: String // "customer" or "driver"
    private let token: String
    private var isConnected = false

    init(userId: String, userType: String, token: String) {
        self.userId = userId
        self.userType = userType
        self.token = token
    }

    func connect() {
        let serverURL = URL(string: "https://your-server.com")!
        let namespace = userType == "customer" ? "" : "/captain"
        
        manager = SocketManager(socketURL: serverURL, config: [
            .log(true),
            .compress,
            .connectParams(["token": token]),
            .path("/socket.io/")
        ])

        socket = manager?.socket(forNamespace: namespace)
        setupEventListeners()
        socket?.connect()
    }

    private func setupEventListeners() {
        // Connection events
        socket?.on(clientEvent: .connect) { [weak self] data, ack in
            print("✅ Connected to chat server")
            self?.isConnected = true
            self?.onConnectionChange(connected: true)
        }

        socket?.on(clientEvent: .disconnect) { [weak self] data, ack in
            print("❌ Disconnected from chat server")
            self?.isConnected = false
            self?.onConnectionChange(connected: false)
        }

        // Chat events
        socket?.on("chatMessage") { [weak self] data, ack in
            if let messageData = data[0] as? [String: Any] {
                print("📨 New message received: \(messageData)")
                self?.onNewMessage(message: messageData)
            }
        }

        socket?.on("typingIndicator") { [weak self] data, ack in
            if let typingData = data[0] as? [String: Any] {
                print("⌨️ Typing indicator: \(typingData)")
                self?.onTypingIndicator(data: typingData)
            }
        }
    }

    func sendMessage(rideId: String, text: String, isQuick: Bool = false) {
        guard isConnected else {
            print("❌ Not connected to server")
            return
        }

        let messageData: [String: Any] = [
            "rideId": rideId,
            "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
            "isQuick": isQuick,
            "tempId": "temp_\(Date().timeIntervalSince1970)"
        ]

        print("📤 Sending message: \(messageData)")

        socket?.emitWithAck("sendChatMessage", messageData).timingOut(after: 10) { [weak self] data in
            if let response = data[0] as? [String: Any],
               let success = response["success"] as? Bool {
                if success {
                    print("✅ Message sent successfully")
                } else {
                    print("❌ Failed to send message: \(response)")
                }
            }
        }
    }

    func getChatHistory(rideId: String, limit: Int = 50, skip: Int = 0) {
        let requestData: [String: Any] = [
            "rideId": rideId,
            "limit": limit,
            "skip": skip
        ]

        socket?.emitWithAck("getChatHistory", requestData).timingOut(after: 10) { [weak self] data in
            if let response = data[0] as? [String: Any],
               let success = response["success"] as? Bool, success {
                print("📚 Chat history received")
                self?.onChatHistoryReceived(response: response)
            }
        }
    }

    func disconnect() {
        socket?.disconnect()
        isConnected = false
    }

    // Callbacks
    private func onConnectionChange(connected: Bool) {
        // تحديث UI
    }

    private func onNewMessage(message: [String: Any]) {
        // إضافة الرسالة للمحادثة
    }

    private func onTypingIndicator(data: [String: Any]) {
        // عرض مؤشر الكتابة
    }

    private func onChatHistoryReceived(response: [String: Any]) {
        // عرض تاريخ المحادثة
    }
}
```

## 🔄 تدفق البيانات / Data Flow

### 1. بدء المحادثة / Starting a Chat
```
1. المستخدم يبدأ رحلة / User starts a ride
2. الاتصال بـ Socket مع معرف الرحلة / Connect to Socket with ride ID
3. جلب تاريخ المحادثة (إن وجد) / Fetch chat history (if exists)
4. عرض واجهة الدردشة / Show chat interface
```

### 2. إرسال رسالة / Sending a Message
```
📱 Mobile App                    🖥️ Server                     📱 Other User
     |                              |                              |
     | sendChatMessage              |                              |
     |----------------------------->|                              |
     |                              | Save to database            |
     |                              | Send to other user          |
     |                              |----------------------------->|
     |                              |                              | chatMessage event
     | Response (success/failure)   |                              |
     |<-----------------------------|                              |
```

### 3. استقبال رسالة / Receiving a Message
```javascript
// عند استقبال رسالة جديدة
socket.on('chatMessage', (messageData) => {
  // التحقق من أن الرسالة للرحلة الصحيحة
  if (messageData.rideId === currentRideId) {
    // إضافة الرسالة للمحادثة
    addMessageToChat(messageData);
    
    // تشغيل صوت الإشعار
    playNotificationSound();
    
    // تحديث عداد الرسائل غير المقروءة
    updateUnreadCount();
    
    // إرسال إقرار بالاستلام (اختياري)
    markMessageAsDelivered(messageData.messageId);
  }
});
```

## 🔧 معالجة الأخطاء / Error Handling

```javascript
class ChatErrorHandler {
  static handleConnectionError(error) {
    console.error('Connection error:', error);
    
    switch(error.type) {
      case 'TransportError':
        // مشكلة في النقل - جرب مرة أخرى
        return 'فشل الاتصال. جاري المحاولة مرة أخرى...';
        
      case 'ParseError': 
        // خطأ في تحليل البيانات
        return 'خطأ في البيانات المرسلة';
        
      default:
        return 'خطأ في الاتصال بالخادم';
    }
  }

  static handleMessageError(error) {
    console.error('Message error:', error);
    
    if (error.message.includes('Rate limit')) {
      return 'تم إرسال رسائل كثيرة. انتظر قليلاً';
    } else if (error.message.includes('Unauthorized')) {
      return 'غير مسموح بإرسال رسائل لهذه الرحلة';
    } else {
      return 'فشل في إرسال الرسالة';
    }
  }
}
```

## 📱 أمثلة للتطبيق / App Examples

### React Native Screen
```javascript
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { ChatSocketManager } from './ChatSocketManager';

const ChatScreen = ({ rideId, userId, userType, token }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [socketManager, setSocketManager] = useState(null);

  useEffect(() => {
    // إنشاء مدير الدردشة
    const manager = new ChatSocketManager(userId, userType, token);
    
    // تعيين callbacks
    manager.onNewMessage = (message) => {
      setMessages(prev => [...prev, message]);
    };
    
    manager.onTypingIndicator = (data) => {
      setIsTyping(data.isTyping);
    };

    // الاتصال بالخادم
    manager.connect();
    
    // جلب تاريخ المحادثة
    manager.getChatHistory(rideId).then(response => {
      setMessages(response.messages);
    });

    setSocketManager(manager);

    return () => {
      manager.disconnect();
    };
  }, []);

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    try {
      await socketManager.sendMessage(rideId, inputText);
      setInputText('');
    } catch (error) {
      alert('فشل في إرسال الرسالة');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={messages}
        keyExtractor={item => item._id}
        renderItem={({ item }) => (
          <View style={{ 
            padding: 10, 
            alignSelf: item.senderType === userType ? 'flex-end' : 'flex-start',
            backgroundColor: item.senderType === userType ? '#007AFF' : '#E5E5EA',
            margin: 5,
            borderRadius: 10
          }}>
            <Text style={{ 
              color: item.senderType === userType ? 'white' : 'black' 
            }}>
              {item.text}
            </Text>
            <Text style={{ fontSize: 12, opacity: 0.7 }}>
              {new Date(item.createdAt).toLocaleTimeString()}
            </Text>
          </View>
        )}
      />
      
      {isTyping && (
        <Text style={{ padding: 10, fontStyle: 'italic' }}>
          الطرف الآخر يكتب...
        </Text>
      )}
      
      <View style={{ flexDirection: 'row', padding: 10 }}>
        <TextInput
          style={{ flex: 1, borderWidth: 1, padding: 10, borderRadius: 20 }}
          value={inputText}
          onChangeText={setInputText}
          placeholder="اكتب رسالتك..."
          onChangeText={(text) => {
            setInputText(text);
            // إرسال مؤشر الكتابة
            socketManager?.sendTypingIndicator(rideId, text.length > 0);
          }}
        />
        <TouchableOpacity 
          onPress={sendMessage}
          style={{ padding: 10, backgroundColor: '#007AFF', borderRadius: 20, marginLeft: 10 }}
        >
          <Text style={{ color: 'white' }}>إرسال</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
```

## 🔍 نصائح للتطوير / Development Tips

### 1. إدارة الاتصال
```javascript
// فحص الاتصال دورياً
setInterval(() => {
  if (socketManager && !socketManager.isConnected) {
    socketManager.connect();
  }
}, 30000); // كل 30 ثانية
```

### 2. تحسين الأداء
```javascript
// تجميع الرسائل لتقليل إعادة الرسم
const [messageQueue, setMessageQueue] = useState([]);

useEffect(() => {
  if (messageQueue.length > 0) {
    const timer = setTimeout(() => {
      setMessages(prev => [...prev, ...messageQueue]);
      setMessageQueue([]);
    }, 100);
    
    return () => clearTimeout(timer);
  }
}, [messageQueue]);
```

### 3. حفظ الرسائل محلياً
```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

const saveChatLocally = async (rideId, messages) => {
  try {
    await AsyncStorage.setItem(`chat_${rideId}`, JSON.stringify(messages));
  } catch (error) {
    console.error('Failed to save chat:', error);
  }
};

const loadChatLocally = async (rideId) => {
  try {
    const savedChat = await AsyncStorage.getItem(`chat_${rideId}`);
    return savedChat ? JSON.parse(savedChat) : [];
  } catch (error) {
    console.error('Failed to load chat:', error);
    return [];
  }
};
```

## 🚨 اختبار وتشخيص الأخطاء / Testing & Debugging

### 1. اختبار الاتصال
```javascript
// في الكونسول
socketManager.socket.emit('ping', Date.now());
socketManager.socket.on('pong', (timestamp) => {
  console.log('Latency:', Date.now() - timestamp, 'ms');
});
```

### 2. مراقبة الأحداث
```javascript
// تسجيل جميع الأحداث الواردة
const originalOn = socketManager.socket.on;
socketManager.socket.on = function(event, callback) {
  console.log(`🎧 Listening to event: ${event}`);
  return originalOn.call(this, event, (...args) => {
    console.log(`📨 Event received: ${event}`, args);
    callback(...args);
  });
};
```

---

## 📞 الدعم الفني / Technical Support

للحصول على المساعدة:
1. تحقق من سجلات المتصفح/التطبيق
2. تأكد من صحة التوكن والصلاحيات
3. تحقق من حالة الشبكة
4. راجع هذا الدليل للتأكد من التنفيذ الصحيح

**Happy Coding! 🚀**
