const { io } = require('socket.io-client');

// The active ngrok server URL
const SERVER_URL = 'https://altitude-quintuple-compile.ngrok-free.dev';
const PATIENT_ID = 'PT-LAMA-01'; // Matches 'Daljit Singh' in the dashboard

console.log(`Connecting to signaling server at: ${SERVER_URL} as ${PATIENT_ID}...`);
const socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  console.log('✅ Connected to signaling server! Socket ID:', socket.id);
  socket.emit('register', { role: 'patient', id: PATIENT_ID });
  console.log(`👤 Registered as patient: ${PATIENT_ID}`);

  // Heartbeat registration every 10 seconds to maintain online status
  setInterval(() => {
    if (socket.connected) {
      console.log('💓 Sending heartbeat registration...');
      socket.emit('register', { role: 'patient', id: PATIENT_ID });
    }
  }, 10000);
});

socket.on('disconnect', () => {
  console.log('🔴 Disconnected from signaling server.');
});

socket.on('call-made', (data) => {
  console.log('📞 Incoming call received from counselor socket:', data.socket);
  console.log('Caller Info:', data.callerInfo);
  
  // Auto accept the call after 1 second
  setTimeout(() => {
    console.log('🙋 Answering the call...');
    socket.emit('make-answer', {
      to: data.socket,
      answer: {
        type: 'answer',
        sdp: data.offer ? data.offer.sdp : 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      }
    });
    console.log('✅ Answer emitted.');
  }, 1000);
});

socket.on('ice-candidate-received', (data) => {
  console.log('🧊 Received ICE Candidate from counselor:', data.candidate ? 'yes' : 'no');
});

socket.on('call-ended', () => {
  console.log('🛑 Call ended by counselor.');
});
