const { WebSocket } = require('ws');

const socket = new WebSocket('ws://localhost:8083');

socket.addEventListener('open', () => {
  const data = { type: 'message', content: 'Hello from Node.js!' };
  socket.send(JSON.stringify(data));
});

socket.addEventListener('message', event => {
  try {
    const receivedData = JSON.parse(event.data);
    console.log('Received JSON:', receivedData);
  } catch (error) {
    console.error('Error parsing JSON:', error);
    console.log('Received data was:', event.data);
  }
});
