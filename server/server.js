const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const FormData = require('form-data');
const { Server } = require('socket.io');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Patient, CallLog, AuditTrail, Counselor } = require('./models');

// JWT authentication middleware placeholder
// TODO: Replace with real JWT verification when auth is implemented
const authenticateJWT = (req, res, next) => {
  // Pass-through for now — no JWT validation configured
  next();
};

const app = express();

// Security middleware to block sensitive files
app.use((req, res, next) => {
  const url = req.url.toLowerCase();
  if (url.includes('.env') || url.startsWith('/server') || url.startsWith('/node_modules') || url.startsWith('/.git')) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// Serve the main application frontend directly from this server
app.use(express.static(path.join(__dirname, '../')));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow any origin since front-end might run on file:// or another port
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Rate limiting setup
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Limit each IP to 10000 requests per windowMs to prevent testing blockages
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);

// Add ngrok bypass header to all responses so ngrok doesn't intercept
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', '1');
  next();
});

// CSRF Protection Middleware
// Require a custom header 'X-Requested-With' for state-changing endpoints
// Exempt /api/ai/* routes — they authenticate via API key and break with CSRF + ngrok free tier
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // Skip CSRF for AI proxy endpoints (they use API key auth)
    if (req.path.startsWith('/api/ai/')) {
      return next();
    }
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'CSRF token missing or invalid (missing X-Requested-With header)' });
    }
  }
  next();
});
// ==========================================
// ICE / TURN SERVER CONFIG
// ==========================================

/**
 * GET /api/ice-servers
 * Returns ICE server config including free TURN relay servers.
 * TURN servers relay audio when both peers are on different networks/NAT.
 * 
 * Free TURN via Open Relay (Metered.ca) — works globally, no account needed.
 * For production, set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL in .env
 */
app.get('/api/ice-servers', (req, res) => {
  const iceServers = [
    // STUN servers (help discover public IP, no relaying)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  // Custom TURN from .env (production override), else fallback to free OpenRelay
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
    console.log('[ICE] Using custom TURN server from .env');
  } else {
    iceServers.push({
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
    console.log('[ICE] No custom TURN configured, using default openrelay.metered.ca');
  }

  res.json({ iceServers, iceCandidatePoolSize: 10 });
});



// Connect to MongoDB
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/counselflow';
mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 }).then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    console.warn('⚠️ Server will continue running to allow frontend offline mode.');
  });

// ==========================================
// PATIENTS API
// ==========================================

app.get('/api/patients', authenticateJWT, async (req, res) => {
  try {
    const patients = await Patient.find({});
    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seed endpoint: clears all patients and replaces with provided seed data
app.post('/api/seed', async (req, res) => {
  try {
    const { patients } = req.body;
    if (!Array.isArray(patients)) {
      return res.status(400).json({ error: 'Expected { patients: [...] }' });
    }
    await Patient.deleteMany({});
    await CallLog.deleteMany({}); // Wipe call logs as well during seed
    if (patients.length > 0) {
      await Patient.insertMany(patients);
    }
    console.log(`✅ DB reseeded with ${patients.length} patients`);
    res.json({ success: true, count: patients.length });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ error: error.message });
  }
});


app.post('/api/patients', authenticateJWT, async (req, res) => {
  try {
    const patients = req.body;
    if (!Array.isArray(patients)) {
      return res.status(400).json({ error: 'Expected an array of patients' });
    }
    // Basic validation
    for (const p of patients) {
      if (!p || typeof p !== 'object' || !p.id) {
         return res.status(400).json({ error: 'Invalid patient object. Missing id field.' });
      }
    }
    const operations = patients.map(p => {
      const updateData = { ...p };
      delete updateData._id; // Remove the immutable _id field to prevent update errors
      return {
        updateOne: {
          filter: { id: p.id },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await Patient.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Patients saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/patients/:id', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Patient.deleteOne({ id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json({ success: true, message: 'Patient deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/counselors/:id', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Counselor.deleteOne({ id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Counselor not found' });
    }
    res.json({ success: true, message: 'Counselor deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// COUNSELORS API
// ==========================================

app.get('/api/counselors', authenticateJWT, async (req, res) => {
  try {
    const counselors = await Counselor.find({});
    res.json(counselors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/counselors', authenticateJWT, async (req, res) => {
  try {
    const counselors = req.body;
    if (!Array.isArray(counselors)) {
      return res.status(400).json({ error: 'Expected an array of counselors' });
    }
    const operations = counselors.map(c => {
      const updateData = { ...c };
      delete updateData._id; // Remove the immutable _id field
      return {
        updateOne: {
          filter: { id: c.id },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await Counselor.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Counselors saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CALL LOGS API
// ==========================================

app.get('/api/call-logs', authenticateJWT, async (req, res) => {
  try {
    const logs = await CallLog.find({});
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/call-logs', authenticateJWT, async (req, res) => {
  try {
    const logs = req.body;
    if (!Array.isArray(logs)) {
      return res.status(400).json({ error: 'Expected an array of logs' });
    }
    // Basic validation
    for (const l of logs) {
      if (!l || typeof l !== 'object' || !l.logId) {
         return res.status(400).json({ error: 'Invalid log object. Missing logId field.' });
      }
    }
    const operations = logs.map(l => {
      const updateData = { ...l };
      delete updateData._id; // Remove the immutable _id field to prevent update errors
      return {
        updateOne: {
          filter: { logId: l.logId },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await CallLog.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Call logs saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk delete call logs by logId array
app.delete('/api/call-logs', authenticateJWT, async (req, res) => {
  try {
    const { logIds } = req.body;
    if (!Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({ error: 'Expected { logIds: [...] }' });
    }
    const result = await CallLog.deleteMany({ logId: { $in: logIds } });
    console.log(`🗑️ Deleted ${result.deletedCount} call log(s)`);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// AUDIT TRAIL API
// ==========================================

app.get('/api/audit-trail', authenticateJWT, async (req, res) => {
  try {
    const auditEvents = await AuditTrail.find({});
    res.json(auditEvents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/audit-trail', authenticateJWT, async (req, res) => {
  try {
    const auditEvents = req.body;
    if (!Array.isArray(auditEvents)) {
      return res.status(400).json({ error: 'Expected an array of audit events' });
    }
    // Basic validation
    for (const e of auditEvents) {
      if (!e || typeof e !== 'object' || !e.eventId) {
         return res.status(400).json({ error: 'Invalid event object. Missing eventId field.' });
      }
    }
    const operations = auditEvents.map(e => {
      const updateData = { ...e };
      delete updateData._id; // Remove the immutable _id field to prevent update errors
      return {
        updateOne: {
          filter: { eventId: e.eventId },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await AuditTrail.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Audit trail saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// AI PROXY ENDPOINTS (GROQ)
// ==========================================
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/ai/chat/completions', async (req, res) => {
  try {
    let apiKey = process.env.GROQ_API_KEY;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const headerKey = req.headers.authorization.split(' ')[1];
      if (headerKey && headerKey.trim() !== '') {
        apiKey = headerKey;
      }
    }
    
    if (!apiKey || apiKey === 'your_groq_api_key_here') {
      return res.status(401).json({ error: { message: "GROQ_API_KEY not configured or provided" } });
    }
    
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', req.body, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error("AI Proxy Error (chat):", error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: { message: error.message } });
  }
});

app.post('/api/ai/audio/transcriptions', upload.single('file'), async (req, res) => {
  try {
    let apiKey = process.env.GROQ_API_KEY;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const headerKey = req.headers.authorization.split(' ')[1];
      if (headerKey && headerKey.trim() !== '') {
        apiKey = headerKey;
      }
    }
    
    if (!apiKey || apiKey === 'your_groq_api_key_here') {
      return res.status(401).json({ error: { message: "GROQ_API_KEY not configured or provided" } });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: { message: "No file provided" } });
    }

    const form = new FormData();
    form.append('file', req.file.buffer, req.file.originalname || 'chunk.webm');
    
    // Append all other fields from the frontend request
    Object.keys(req.body).forEach(key => {
      form.append(key, req.body[key]);
    });

    const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error("AI Proxy Error (audio):", error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: { message: error.message } });
  }
});

// ==========================================
// GEMINI AI PROXY ENDPOINT
// ==========================================

app.post('/api/ai/gemini/chat', async (req, res) => {
  try {
    let apiKey = process.env.GEMINI_API_KEY;
    // Allow frontend to pass the key via Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const headerKey = req.headers.authorization.split(' ')[1];
      if (headerKey && headerKey.trim() !== '') {
        apiKey = headerKey;
      }
    }

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(401).json({ error: { message: "GEMINI_API_KEY not configured or provided" } });
    }

    // Transform OpenAI-style messages to Gemini's contents format
    const messages = req.body.messages || [];
    const geminiContents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        geminiContents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    }

    const model = req.body.geminiModel || 'gemini-2.0-flash';
    const geminiPayload = {
      contents: geminiContents,
      generationConfig: {
        temperature: req.body.temperature ?? 0.2,
        maxOutputTokens: req.body.max_tokens || 4096
      }
    };

    // Add system instruction if present
    if (systemInstruction) {
      geminiPayload.systemInstruction = systemInstruction;
    }

    // If response_format is json_object, ask Gemini to return JSON
    if (req.body.response_format && req.body.response_format.type === 'json_object') {
      geminiPayload.generationConfig.responseMimeType = 'application/json';
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await axios.post(geminiUrl, geminiPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    // Transform Gemini response back to OpenAI-compatible format
    const geminiData = response.data;
    const textContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const openaiResponse = {
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent
        },
        finish_reason: geminiData.candidates?.[0]?.finishReason || 'stop'
      }],
      model: model,
      provider: 'gemini'
    };

    res.json(openaiResponse);
  } catch (error) {
    console.error("Gemini Proxy Error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json(
      error.response?.data || { error: { message: error.message } }
    );
  }
});

// ==========================================
// SOCKET.IO SIGNALING FOR WEBRTC IN-APP CALLS
// ==========================================
// A simple mapping to keep track of connected users
const connectedUsers = {}; // socketId -> { role: 'counselor' | 'patient', id: string }
const patientSockets = {}; // patientId -> socketId
const counselorSockets = {}; // counselorId (or 'counselor') -> socketId

// Audio relay sessions: when WebRTC P2P fails, audio is relayed through server
// relayPairs[socketIdA] = socketIdB  and  relayPairs[socketIdB] = socketIdA
const relayPairs = {};

io.on('connection', (socket) => {
  console.log(`⚡ Socket connected: ${socket.id}`);

  // 1. Register a user (Counselor or Patient)
  socket.on('register', (data) => {
    // data = { role: 'counselor' | 'patient', id: 'someId' }
    if (data.role === 'patient') {
      patientSockets[data.id] = socket.id;
      connectedUsers[socket.id] = { role: 'patient', id: data.id };
      console.log(`👤 Patient registered: ${data.id} on socket ${socket.id}`);
    } else if (data.role === 'counselor') {
      counselorSockets[data.id || 'counselor'] = socket.id;
      connectedUsers[socket.id] = { role: 'counselor', id: data.id || 'counselor' };
      console.log(`👨‍⚕️ Counselor registered on socket ${socket.id}`);
    }
  });

  // 2. Counselor initiates a call to a patient (sends WebRTC Offer)
  socket.on('call-user', (data) => {
    // data = { to: 'patientId', offer: RTCSessionDescriptionInit, callerInfo: { name, avatar } }
    const targetSocket = patientSockets[data.to];
    if (targetSocket) {
      console.log(`📞 Counselor calling patient ${data.to}`);
      io.to(targetSocket).emit('call-made', {
        offer: data.offer,
        socket: socket.id,
        callerInfo: data.callerInfo || { name: 'Counselor' }
      });
    } else {
      console.log(`⚠️ Patient ${data.to} is not online.`);
      socket.emit('call-failed', { reason: 'patient-offline' });
    }
  });

  // 3. Patient answers the call (sends WebRTC Answer)
  socket.on('make-answer', (data) => {
    // data = { to: 'counselorSocketId', answer: RTCSessionDescriptionInit }
    console.log(`✅ Patient answered call, sending answer to counselor ${data.to}`);
    io.to(data.to).emit('answer-made', {
      socket: socket.id,
      answer: data.answer
    });
  });

  // 4. Exchange ICE Candidates
  socket.on('ice-candidate', (data) => {
    // data = { to: 'targetSocketId', candidate: RTCIceCandidateInit, source: string }
    io.to(data.to).emit('ice-candidate-received', {
      socket: socket.id,
      candidate: data.candidate,
      source: data.source
    });
  });

  // 5. Patient rejects the call
  socket.on('reject-call', (data) => {
    // data = { to: 'counselorSocketId' }
    console.log(`❌ Patient rejected call from counselor ${data.to}`);
    io.to(data.to).emit('call-rejected', {
      socket: socket.id
    });
  });

  // 6. Either party ends the call
  socket.on('end-call', (data) => {
    // data = { to: 'targetSocketId' }
    if (data.to) {
      console.log(`🛑 Call ended. Notifying ${data.to}`);
      io.to(data.to).emit('call-ended');
    }
    // Cleanup relay pair if exists
    if (relayPairs[socket.id]) {
      delete relayPairs[relayPairs[socket.id]];
      delete relayPairs[socket.id];
    }
  });

  // ==========================================
  // SOCKET AUDIO RELAY — Fallback when WebRTC P2P fails
  // Both peers send their audio as binary chunks; server forwards to the other peer.
  // This guarantees audio works regardless of NAT / TURN availability.
  // ==========================================

  // 7. Start audio relay session (called by whichever side detects WebRTC failure first)
  socket.on('audio-relay-start', (data) => {
    // data = { to: 'otherSocketId' }
    relayPairs[socket.id] = data.to;
    relayPairs[data.to] = socket.id;
    // Notify the other party to switch to relay mode too
    io.to(data.to).emit('audio-relay-start', { from: socket.id });
    console.log(`🔊 Audio relay started between ${socket.id} ↔ ${data.to}`);
  });

  // 8. Transcript Relay
  socket.on('transcript-update', (data) => {
    if (data.to) {
      io.to(data.to).emit('transcript-update', { text: data.text, sender: data.sender });
    }
  });

  // 8. Relay incoming audio chunk to the other party (binary data pass-through)
  socket.on('audio-chunk', (data) => {
    // data = Buffer (binary)  — emitted as binary from client
    const peerSocket = relayPairs[socket.id];
    if (peerSocket) {
      io.to(peerSocket).emit('audio-chunk', data);
    }
  });

  // 9. Stop audio relay
  socket.on('audio-relay-stop', () => {
    if (relayPairs[socket.id]) {
      io.to(relayPairs[socket.id]).emit('audio-relay-stop');
      delete relayPairs[relayPairs[socket.id]];
      delete relayPairs[socket.id];
    }
    console.log(`🔇 Audio relay stopped for ${socket.id}`);
  });

  // 10. Relay mute state
  socket.on('mute-state-change', (data) => {
    // data = { to: 'targetSocketId', isMuted: boolean }
    if (data.to) {
      io.to(data.to).emit('mute-state-change', {
        isMuted: data.isMuted
      });
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`🔴 Socket disconnected: ${socket.id}`);
    // Cleanup relay pair
    if (relayPairs[socket.id]) {
      io.to(relayPairs[socket.id]).emit('audio-relay-stop');
      delete relayPairs[relayPairs[socket.id]];
      delete relayPairs[socket.id];
    }
    const user = connectedUsers[socket.id];
    if (user) {
      if (user.role === 'patient') {
        delete patientSockets[user.id];
      } else if (user.role === 'counselor') {
        delete counselorSockets[user.id];
      }
      delete connectedUsers[socket.id];
    }
  });
});



// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 CounselFlow Backend with WebRTC Signaling running on port ${PORT}`);
});
