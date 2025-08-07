# نظام الدردشة - دليل الاستخدام

## نظرة عامة

تم تنفيذ نظام دردشة شامل يسمح للركاب والكباتن بالتواصل أثناء الرحلة. النظام يدعم الرسائل النصية والرسائل السريعة مع إمكانية تتبع حالة الرسائل.

## المكونات المضافة

### 1. نموذج البيانات
- `model/chat.js` - نموذج رسائل الدردشة ومؤشرات الكتابة

### 2. الخدمات
- `services/chatService.js` - خدمة الدردشة الرئيسية
- تحديثات على `services/customerSocketService.js`
- تحديثات على `services/captainSocketService.js`

### 3. API Routes
- `routes/chat.js` - نقاط API للدردشة
- تحديثات على `routes/api.js`

## أحداث Socket.IO

### للعملاء (Customers)

#### إرسال رسالة
```javascript
socket.emit('sendChatMessage', {
  rideId: 'ride_id_here',
  text: 'نص الرسالة',
  tempId: 'temp_id_for_optimistic_updates', // اختياري
  isQuick: false, // true للرسائل السريعة
  quickMessageType: null // نوع الرسالة السريعة
}, (response) => {
  if (response.success) {
    console.log('تم إرسال الرسالة:', response.message);
  } else {
    console.error('فشل في الإرسال:', response.message);
  }
});
```

#### الحصول على تاريخ المحادثة
```javascript
socket.emit('getChatHistory', {
  rideId: 'ride_id_here',
  limit: 50, // اختياري، افتراضي 50
  skip: 0    // اختياري، افتراضي 0
}, (response) => {
  if (response.success) {
    console.log('الرسائل:', response.messages);
    console.log('عدد الرسائل غير المقروءة:', response.unreadCount);
  }
});
```

#### تحديد رسائل كمقروءة
```javascript
socket.emit('markMessagesAsRead', {
  rideId: 'ride_id_here',
  messageIds: ['message_id_1', 'message_id_2']
});
```

#### مؤشر الكتابة
```javascript
// بدء الكتابة
socket.emit('typingIndicator', {
  rideId: 'ride_id_here',
  isTyping: true
});

// انتهاء الكتابة
socket.emit('typingIndicator', {
  rideId: 'ride_id_here',
  isTyping: false
});
```

#### الحصول على الرسائل السريعة
```javascript
socket.emit('getQuickMessages', (response) => {
  if (response.success) {
    console.log('الرسائل السريعة للعملاء:', response.messages);
  }
});
```

### للكباتن (Captains)

نفس الأحداث المذكورة أعلاه، مع اختلاف الرسائل السريعة:

```javascript
socket.emit('getQuickMessages', (response) => {
  if (response.success) {
    console.log('الرسائل السريعة للكباتن:', response.messages);
  }
});
```

## استقبال الأحداث

### رسالة جديدة
```javascript
socket.on('chatMessage', (data) => {
  console.log('رسالة جديدة:', {
    messageId: data.messageId,
    rideId: data.rideId,
    text: data.text,
    senderId: data.senderId,
    senderType: data.senderType, // 'customer' أو 'driver'
    isQuick: data.isQuick,
    timestamp: data.timestamp,
    tempId: data.tempId,
    messageStatus: data.messageStatus
  });
});
```

### تأكيد قراءة الرسائل
```javascript
socket.on('messageRead', (data) => {
  console.log('تم قراءة الرسائل:', {
    rideId: data.rideId,
    messageIds: data.messageIds,
    readBy: data.readBy, // 'customer' أو 'driver'
    readAt: data.readAt
  });
});
```

### مؤشر الكتابة
```javascript
socket.on('typingIndicator', (data) => {
  console.log('مؤشر الكتابة:', {
    rideId: data.rideId,
    senderType: data.senderType, // 'customer' أو 'driver'
    isTyping: data.isTyping
  });
});
```

## REST API

### الحصول على تاريخ المحادثة
```
GET /api/chat/history/:rideId?limit=50&skip=0
Authorization: Bearer <jwt_token>
```

### إرسال رسالة
```
POST /api/chat/send
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "rideId": "ride_id_here",
  "text": "نص الرسالة",
  "isQuick": false,
  "quickMessageType": null
}
```

### تحديد رسائل كمقروءة
```
PUT /api/chat/read
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "rideId": "ride_id_here",
  "messageIds": ["message_id_1", "message_id_2"]
}
```

### الحصول على الرسائل السريعة
```
GET /api/chat/quick-messages/:userType
Authorization: Bearer <jwt_token>
```

### الحصول على إحصائيات الدردشة
```
GET /api/chat/stats/:rideId
Authorization: Bearer <jwt_token>
```

### الحصول على عدد الرسائل غير المقروءة
```
GET /api/chat/unread/:rideId
Authorization: Bearer <jwt_token>
```

## الرسائل السريعة المحددة مسبقاً

### للعملاء:
- "أين أنت الآن؟"
- "كم من الوقت ستستغرق؟"
- "هل يمكنك الاتصال بي؟"
- "سأنتظرك في المكان المحدد"
- "شكراً لك"

### للكباتن:
- "أنا في الطريق إليك"
- "وصلت إلى الموقع"
- "سأتأخر قليلاً بسبب الزحمة"
- "هل يمكنك الخروج؟"
- "سأتصل بك الآن"
- "أحتاج إلى تعديل نقطة الالتقاء"

## مثال شامل للاستخدام

```javascript
class ChatManager {
  constructor(socket, rideId, userType) {
    this.socket = socket;
    this.rideId = rideId;
    this.userType = userType;
    this.messages = [];
    this.unreadCount = 0;
    this.isOtherTyping = false;
    
    this.setupEventListeners();
    this.loadChatHistory();
  }
  
  setupEventListeners() {
    // استقبال رسائل جديدة
    this.socket.on('chatMessage', (data) => {
      this.messages.push(data);
      if (data.senderType !== this.userType) {
        this.unreadCount++;
      }
      this.displayMessage(data);
    });
    
    // مؤشر الكتابة
    this.socket.on('typingIndicator', (data) => {
      if (data.senderType !== this.userType) {
        this.isOtherTyping = data.isTyping;
        this.updateTypingIndicator();
      }
    });
    
    // تأكيد قراءة الرسائل
    this.socket.on('messageRead', (data) => {
      if (data.readBy !== this.userType) {
        this.updateMessageStatus(data.messageIds, 'read');
      }
    });
  }
  
  async loadChatHistory() {
    this.socket.emit('getChatHistory', {
      rideId: this.rideId,
      limit: 50
    }, (response) => {
      if (response.success) {
        this.messages = response.messages;
        this.unreadCount = response.unreadCount;
        this.displayMessages();
      }
    });
  }
  
  sendMessage(text, isQuick = false) {
    const tempId = Date.now().toString();
    
    // إضافة مؤقتة للرسالة (Optimistic Update)
    const tempMessage = {
      tempId,
      text,
      senderId: 'current_user',
      senderType: this.userType,
      isQuick,
      timestamp: new Date(),
      messageStatus: { sent: false, delivered: false, read: false }
    };
    
    this.messages.push(tempMessage);
    this.displayMessage(tempMessage);
    
    this.socket.emit('sendChatMessage', {
      rideId: this.rideId,
      text,
      tempId,
      isQuick
    }, (response) => {
      // تحديث الرسالة المؤقتة
      const tempIndex = this.messages.findIndex(m => m.tempId === tempId);
      if (tempIndex !== -1) {
        if (response.success) {
          this.messages[tempIndex] = response.message;
        } else {
          this.messages[tempIndex].error = true;
          this.messages[tempIndex].errorMessage = response.message;
        }
        this.updateMessageDisplay(tempIndex);
      }
    });
  }
  
  markMessagesAsRead(messageIds) {
    this.socket.emit('markMessagesAsRead', {
      rideId: this.rideId,
      messageIds
    });
    
    this.unreadCount = Math.max(0, this.unreadCount - messageIds.length);
  }
  
  startTyping() {
    this.socket.emit('typingIndicator', {
      rideId: this.rideId,
      isTyping: true
    });
  }
  
  stopTyping() {
    this.socket.emit('typingIndicator', {
      rideId: this.rideId,
      isTyping: false
    });
  }
  
  // دوال العرض (يجب تنفيذها حسب UI Framework المستخدم)
  displayMessage(message) {
    // تنفيذ عرض الرسالة
  }
  
  displayMessages() {
    // تنفيذ عرض قائمة الرسائل
  }
  
  updateMessageDisplay(index) {
    // تحديث عرض رسالة معينة
  }
  
  updateTypingIndicator() {
    // تحديث مؤشر الكتابة
  }
  
  updateMessageStatus(messageIds, status) {
    // تحديث حالة الرسائل
  }
}

// الاستخدام
const chatManager = new ChatManager(socket, rideId, 'customer');
```

## ملاحظات مهمة

1. **الأمان**: جميع الأحداث تتحقق من صحة المستخدم وانتمائه للرحلة
2. **الأداء**: الرسائل تُخزن في Redis للوصول السريع
3. **التخزين**: الرسائل القديمة تُحذف تلقائياً بعد 30 يوماً
4. **معدل الإرسال**: محدود بـ 30 رسالة في الدقيقة لكل مستخدم
5. **مؤشر الكتابة**: ينتهي تلقائياً خلال 10 ثوانٍ
6. **دعم Offline**: الرسائل تُحفظ حتى لو كان أحد الأطراف غير متصل

## استكشاف الأخطاء

### مشاكل شائعة:

1. **"Chat service not available"**
   - تأكد من تهيئة خدمة الدردشة في `main.js`

2. **"Unauthorized access to chat history"**
   - تأكد من أن المستخدم جزء من الرحلة المطلوبة

3. **"Rate limit exceeded"**
   - قلل من معدل إرسال الرسائل (أقل من 30 رسالة/دقيقة)

4. **الرسائل لا تصل للطرف الآخر**
   - تأكد من أن الطرف الآخر متصل عبر Socket.IO
   - فحص logs للتأكد من إرسال الأحداث

هذا النظام جاهز للاستخدام ويوفر تجربة دردشة شاملة ومتقدمة!
