const amqp = require('amqplib/callback_api');

function sendMessageToQueue(message) {
  amqp.connect('amqp://localhost', (error0, connection) => {
    if (error0) {
      throw error0;
    }
    connection.createChannel((error1, channel) => {
      if (error1) {
        throw error1;
      }
      const queue = 'location_updates';
      channel.assertQueue(queue, {
        durable: true
      });
      channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true
      });
    });
    setTimeout(() => {
      connection.close();
    }, 500);
  });
}

module.exports = {
  sendMessageToQueue
};
