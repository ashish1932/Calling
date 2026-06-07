const crypto = require('crypto');
if (!global.crypto) {
  global.crypto = crypto;
}
const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const { Server } = require('socket.io');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Validate environment variables on boot
const REQUIRED_ENV = ['GEMINI_API_KEY', 'MONGODB_URI', 'JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter(key => {
  const val = process.env[key];
  return !val || val === 'your_groq_api_key_here' || val === 'your_gemini_api_key_here';
});
if (missingEnv.length > 0) {
  console.error(`🚨 CRITICAL: Missing or unconfigured required environment variables: ${missingEnv.join(', ')}`);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const { Patient, CallLog, AuditTrail, Counselor } = require('./models');

// JWT Secret and Helpers (HMAC-SHA256 Pure JS implementation)
const JWT_SECRET = process.env.JWT_SECRET || 'counsel-flow-super-secret-key-2026';

function base64url(str, encoding = 'utf8') {
  return Buffer.from(str, encoding).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

function signJWT(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours expiration
  }));
  
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
    
  return `${signatureInput}.${signature}`;
}

function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [header, payload, signature] = parts;
    const signatureInput = `${header}.${payload}`;
    
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET)
      .update(signatureInput)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
      
    if (signature !== expectedSignature) {
      return null;
    }
    
    const decodedPayload = JSON.parse(base64urlDecode(payload));
    if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    
    return decodedPayload;
  } catch (e) {
    return null;
  }
}

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const user = verifyJWT(token);
    if (user) {
      req.user = user;
      return next();
    }
  }
  return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' });
};

const app = express();
app.set('trust proxy', 1);

// Security middleware to block sensitive files
app.use((req, res, next) => {
  const url = req.url.toLowerCase();
  if (url.includes('.env') || url.startsWith('/server') || url.startsWith('/node_modules') || url.startsWith('/.git')) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// CORS origin safety check
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [];

const isOriginAllowed = (origin) => {
  if (!origin) return true; // Allow non-browser agents (mobile app, curl, same-origin static assets)
  if (allowedOriginsEnv.length > 0) {
    return allowedOriginsEnv.includes(origin);
  }
  try {
    const parsedUrl = new URL(origin);
    const hostname = parsedUrl.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.ngrok-free.dev') ||
      hostname.endsWith('.ngrok.io')
    );
  } catch (e) {
    return false;
  }
};

// Serve the main application frontend directly from this server
app.use(express.static(path.join(__dirname, '../')));
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));

// Rate limiting setup
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600, // Reduced from 10000 to defend against basic denial-of-service
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);

// Add ngrok bypass header dynamically
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || req.headers.host?.includes('ngrok')) {
    res.setHeader('ngrok-skip-browser-warning', '1');
  }
  next();
});

// CSRF Protection Middleware
// Require a custom header 'X-Requested-With' for state-changing endpoints
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
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



// ==========================================
// AUTHENTICATION API
// ==========================================

const DEMO_CREDENTIALS = [
  { roleKey: 'spo', username: 'spo@cbm.gov.in', password: 'CBM@SPOwner24', name: 'Sh. Gurinder Bhullar IAS', staffId: 'STAFF-001' },
  { roleKey: 'supervisor', username: 'supervisor@cbm.gov.in', password: 'CBM@Supervisor24', name: 'Dr. Rajdeep Singh', staffId: 'STAFF-002' },
  { roleKey: 'counsellor', username: 'counsellor_amritsar@cbm.gov.in', password: 'CBM@Counsellor24', name: 'Dr. Amanpreet Kaur', staffId: 'STAFF-003', district: 'Amritsar' },
  { roleKey: 'counsellor', username: 'counselor-1', password: 'CBM@Counsellor24', name: 'Dr. Amanpreet Kaur', staffId: 'STAFF-003', district: 'Amritsar' },
  { roleKey: 'counsellor', username: 'counsellor_jalandhar@cbm.gov.in', password: 'CBM@Counsellor24', name: 'Dr. Manpreet Sodhi', staffId: 'STAFF-004', district: 'Jalandhar' },
  { roleKey: 'counsellor', username: 'counsellor_ludhiana@cbm.gov.in', password: 'CBM@Counsellor24', name: 'Dr. Harinder Gill', staffId: 'STAFF-005', district: 'Ludhiana' },
  { roleKey: 'counsellor', username: 'counsellor_patiala@cbm.gov.in', password: 'CBM@Counsellor24', name: 'Dr. Gurbaksh Singh', staffId: 'STAFF-006', district: 'Patiala' },
  { roleKey: 'ddrc', username: 'ddrc_amritsar@cbm.gov.in', password: 'CBM@DDRC24', name: 'Dr. Harpreet Grewal', staffId: 'STAFF-007', district: 'Amritsar' },
  { roleKey: 'ddrc', username: 'ddrc_jalandhar@cbm.gov.in', password: 'CBM@DDRC24', name: 'Dr. Balwinder Singh', staffId: 'STAFF-009', district: 'Jalandhar' },
  { roleKey: 'ddrc', username: 'ddrc_ludhiana@cbm.gov.in', password: 'CBM@DDRC24', name: 'Dr. Simranjeet Kaur', staffId: 'STAFF-010', district: 'Ludhiana' },
  { roleKey: 'ddrc', username: 'ddrc_patiala@cbm.gov.in', password: 'CBM@DDRC24', name: 'Dr. Gurdeep Singh', staffId: 'STAFF-011', district: 'Patiala' },
  { roleKey: 'ditsu', username: 'ditsu@cbm.gov.in', password: 'CBM@DITSU24', name: 'Er. Navneet Sharma', staffId: 'STAFF-008' }
];

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const match = DEMO_CREDENTIALS.find(
    c => c.username.toLowerCase() === username.trim().toLowerCase() &&
         c.password === password.trim()
  );
  if (match) {
    const token = signJWT({
      username: match.username,
      roleKey: match.roleKey,
      name: match.name,
      staffId: match.staffId,
      district: match.district
    });
    return res.json({
      token,
      user: {
        roleKey: match.roleKey,
        name: match.name,
        staffId: match.staffId,
        district: match.district
      }
    });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/auth/patient-login', async (req, res) => {
  const { patientId, name, preferredLanguage } = req.body;
  if (!patientId) {
    return res.status(400).json({ error: 'patientId is required' });
  }
  let patientName = name || 'Anonymous Patient';
  try {
    const patientObj = await Patient.findOne({ id: patientId });
    if (patientObj) {
      patientName = patientObj.name;
      if (preferredLanguage) {
        patientObj.preferredLanguage = preferredLanguage;
        await patientObj.save();
      }
    } else {
      const newPt = new Patient({ 
        id: patientId, 
        name: patientName, 
        preferredLanguage: preferredLanguage || 'pa-IN' 
      });
      await newPt.save();
    }
  } catch (err) {
    console.warn('[AUTH] Patient DB lookup failed, proceeding with fallback:', err.message);
  }

  const token = signJWT({
    patientId: patientId,
    roleKey: 'patient',
    name: patientName
  });
  return res.json({ token, patientId, name: patientName });
});

// Connect to MongoDB
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/punjabvoice';
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
    let query = {};
    if (req.user && req.user.roleKey === 'counsellor') {
      if (req.user.district) {
        query = { district: req.user.district };
      } else {
        query = { id: '__nonexistent__' };
      }
    }
    const patients = await Patient.find(query);
    res.json(patients);
  } catch (error) {
    console.error("Error in GET /api/patients:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/patients/online', authenticateJWT, (req, res) => {
  try {
    const onlineIds = Object.keys(patientSockets);
    res.json({ onlinePatientIds: onlineIds });
  } catch (error) {
    console.error("Error in GET /api/patients/online:", error);
    res.status(500).json({ error: error.message });
  }
});

// Seed endpoint: clears all patients and replaces with provided seed data
app.post('/api/seed', authenticateJWT, async (req, res) => {
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

app.post('/api/ai/chat/completions', authenticateJWT, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: { message: "GEMINI_API_KEY not configured on the server" } });
    }
    
    // Map request model to gemini-1.5-flash
    const body = {
      ...req.body,
      model: 'gemini-1.5-flash'
    };

    const response = await axios.post('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', body, {
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

app.post('/api/ai/audio/transcriptions', authenticateJWT, upload.single('file'), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(401).json({ error: { message: "GEMINI_API_KEY not configured on the server" } });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: { message: "No file provided" } });
    }

    console.debug(`[ASR Proxy] Received chunk: ${req.file.size} bytes, name: ${req.file.originalname}`);

    const originalName = req.file.originalname || 'chunk.m4a';

    // Resolve language hint: prioritize request body, fallback to patient preferredLanguage in DB
    let resolvedLanguage = req.body.language;
    if ((!resolvedLanguage || resolvedLanguage === 'null' || resolvedLanguage === 'undefined') && req.user) {
      if (req.user.roleKey === 'patient') {
        try {
          const patient = await Patient.findOne({ id: req.user.patientId });
          if (patient && patient.preferredLanguage) {
            const langMap = { 'pa-IN': 'pa', 'hi-IN': 'hi', 'en-US': 'en' };
            resolvedLanguage = langMap[patient.preferredLanguage] || null;
          }
        } catch (dbErr) {
          console.warn('[ASR Proxy] Failed to lookup patient language:', dbErr.message);
        }
      }
    }

    // Convert audio buffer to base64
    const base64Audio = req.file.buffer.toString('base64');
    let mimeType = req.file.mimetype || 'audio/m4a';
    if (originalName.endsWith('.m4a')) mimeType = 'audio/m4a';
    else if (originalName.endsWith('.webm')) mimeType = 'audio/webm';
    else if (originalName.endsWith('.wav')) mimeType = 'audio/wav';

    // ── Step 1: Call Gemini 1.5 Flash multimodal transcription ──
    let rawText = '';
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const requestBody = {
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Audio
              }
            },
            {
              text: `Transcribe this audio recording exactly as spoken in its original script and language.
The speakers freely mix English (Latin script), Hindi (Devanagari script), and Punjabi (Gurmukhi script).
CRITICAL:
1. Do NOT translate or summarize. Keep each word in its spoken script.
2. If the audio is silence, background noise, or unintelligible, output an empty string.
3. Clean up stutters and filler words.`
            }
          ]
        }]
      };

      const geminiResp = await axios.post(geminiUrl, requestBody, { timeout: 25000 });
      rawText = (geminiResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      console.debug(`[ASR Proxy] Gemini audio transcription result (${rawText.length} chars): "${rawText.substring(0, 80)}"`);
    } catch (fullModelErr) {
      console.warn('[ASR Proxy] Gemini audio transcription failed:', fullModelErr.message);
    }

    // ── Server-side hallucination guard ───────────────────────────────────
    const cleanRawLower = rawText.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?।\s]+/g, " ").trim();
    
    // Short phrases/words that should only be blocked if they are the EXACT transcript
    const EXACT_HALLUCINATIONS = [
      'do not', "don't", 'do not track', 'pata', 'pata ne',
      'thank you', 'bye bye', 'goodbye', 'see you',
      'you', 'so', 'the', 'and', 'is', 'it',
      '...', '. . .', '.   .', 'okay okay okay'
    ];
    
    // Long unique phrases that can be blocked if they appear anywhere
    const SUBSTRING_HALLUCINATIONS = [
      "hello. i'm a 12-year-old", "hello. i'm a 12-year-old.", "i'm a 12-year-old", "i'm a 12-year-old.",
      "hello i'm a 12 year old", "i'm a 12 year old",
      "thank you for watching", "thanks for watching", "please subscribe",
      "like and subscribe", "subscribe to my channel", "don't forget to subscribe",
      "see you in the next video", "see you next time",
      "लेकिन मेरे में क्यों नहीं होना चाहिए",
      "तुक बोले गया तब ना बोल तो रहा है",
      "तो डेस्पोर्ट check करना",
      "सब्सक्राइब करो", "लाइक करो", "चैनल सब्सक्राइब",
      "अंग्रेजी में लैटिन लिपि", "मैं अनुवाद नहीं करूंगा",
      "मित्रों नमस्ते", "मेरे चैनल पर स्वागत है",
      "आपको इसकी आवश्यकता क्यों है", "आपको क्या चाहिए",
      "वह यहाँ आया और अब वह आपके हाथ साफ कर रहा है"
    ];
    
    const isHallucination = 
      EXACT_HALLUCINATIONS.includes(cleanRawLower) || 
      SUBSTRING_HALLUCINATIONS.some(h => cleanRawLower.includes(h.toLowerCase()));

    if (isHallucination) {
      console.debug('[ASR Proxy] Server-side hallucination filtered:', rawText);
      rawText = '';
    }

    // ── Step 2: Gemini post-processing — clean up glitches and filter hallucinations ──
    if (rawText.length > 2) {
      try {
        const systemPrompt =
          'You are a transcript corrector for a telemedicine counseling session in Punjab.\n' +
          'The transcript contains speech in English, Hindi (Devanagari), and Punjabi (Gurmukhi).\n' +
          'Your only task is to clean up transcription glitches, stutters, and silence artifacts while retaining every spoken word.\n' +
          'CRITICAL RULES:\n' +
          (resolvedLanguage === 'hi'
            ? '1. HINDI ONLY: The preferred language is Hindi. You MUST translate or convert all spoken words (English, Punjabi, etc.) into Hindi Devanagari script. Do NOT output any Latin (English) letters or Gurmukhi (Punjabi) script. The entire output must be in Devanagari script (Hindi) only.\n'
            : '1. DO NOT translate or summarize. Retain all English, Hindi, and Punjabi words exactly in their respective scripts as transcribed.\n') +
          '2. Remove filler words (like "um", "uh", "like") and stuttered repetitions (e.g., "i i went" -> "i went").\n' +
          '3. Remove obvious Whisper silence hallucinations (e.g. "Hello. I\'m a 12-year-old", "Thank you for watching", "Please subscribe", "like and subscribe").\n' +
          '4. Do NOT drop short replies or conversational responses (like "ji", "haan", "yes", "okay", "सत श्री अकाल", "ਠੀਕ ਹੈ").\n' +
          '5. Do NOT guess or add information. If the input is empty or unintelligible noise, return empty string.\n' +
          'Return ONLY the cleaned transcript, nothing else.';

        const correctionUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const correctionBody = {
          contents: [{
            parts: [
              { text: systemPrompt },
              { text: `Transcript to clean:\n"${rawText}"` }
            ]
          }],
          generationConfig: {
            temperature: 0
          }
        };

        const llmResp = await axios.post(correctionUrl, correctionBody, { timeout: 15000 });
        const cleaned = llmResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (cleaned) {
          rawText = cleaned.trim().replace(/^["']|["']$/g, '');
        }
      } catch (llmErr) {
        console.warn('[ASR Proxy] Gemini post-processing failed, using raw ASR output:', llmErr.message);
      }
    }

    res.json({ text: rawText });

  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: { message: error.message } };
    console.error(`[ASR Proxy] Error (HTTP ${status}):`, data);
    res.status(status).json(data);
  }
});

// ==========================================
// GEMINI AI PROXY ENDPOINT
// ==========================================

app.post('/api/ai/gemini/chat', authenticateJWT, async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(401).json({ error: { message: "GEMINI_API_KEY not configured on the server" } });
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

// Active call pairs: tracks bidirectional mapping between counselor and patient sockets
const activeCallPairs = {};

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
  socket.on('call-user', async (data) => {
    // data = { to: 'patientId', offer: RTCSessionDescriptionInit, callerInfo: { name, avatar } }
    const sender = connectedUsers[socket.id];
    if (sender && sender.role === 'counselor') {
      const counselorObj = DEMO_CREDENTIALS.find(c => c.username.toLowerCase() === sender.id.toLowerCase());
      if (counselorObj && counselorObj.district) {
        try {
          const patientObj = await Patient.findOne({ id: data.to });
          if (!patientObj || patientObj.district !== counselorObj.district) {
            console.log(`❌ Call blocked: Counselor ${sender.id} (${counselorObj.district}) tried to call patient ${data.to} (${patientObj ? patientObj.district : 'No district'})`);
            socket.emit('call-failed', { reason: 'district-mismatch' });
            return;
          }
        } catch (dbErr) {
          console.error('[SOCKET] Patient lookup failed during call validation:', dbErr);
        }
      }
    }

    const targetSocket = patientSockets[data.to];
    if (targetSocket) {
      console.log(`📞 Counselor calling patient ${data.to}`);
      
      // Store the active call mapping
      activeCallPairs[socket.id] = targetSocket;
      activeCallPairs[targetSocket] = socket.id;

      io.to(targetSocket).emit('call-made', {
        offer: data.offer,
        socket: socket.id,
        callerInfo: data.callerInfo || { name: 'Counselor' }
      });

      // Notify all counselor web dashboards that a call has started
      Object.keys(connectedUsers).forEach(sid => {
        const user = connectedUsers[sid];
        if (user.role === 'counselor' && sid !== socket.id) {
          io.to(sid).emit('counselor-call-started', {
            patientId: data.to,
            callerSocketId: socket.id
          });
        }
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

    // Notify all counselor web dashboards that the call connected
    Object.keys(connectedUsers).forEach(sid => {
      const user = connectedUsers[sid];
      if (user.role === 'counselor' && sid !== data.to) {
        io.to(sid).emit('counselor-call-connected', {
          patientSocketId: socket.id
        });
      }
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
    
    // Cleanup active call pairing
    const peer = activeCallPairs[socket.id] || data.to;
    if (peer) {
      delete activeCallPairs[peer];
    }
    delete activeCallPairs[socket.id];

    io.to(data.to).emit('call-rejected', {
      socket: socket.id
    });

    // Notify all counselor web dashboards that the call was rejected
    Object.keys(connectedUsers).forEach(sid => {
      const user = connectedUsers[sid];
      if (user.role === 'counselor' && sid !== data.to) {
        io.to(sid).emit('counselor-call-ended');
      }
    });
  });

  // 6. Either party ends the call
  socket.on('end-call', (data) => {
    // data = { to: 'targetSocketId', toPatientId: 'patientId' }
    let target = data.to;
    if (!target && data.toPatientId) {
      target = patientSockets[data.toPatientId];
    }
    // Fallback lookup using activeCallPairs
    if (!target || !connectedUsers[target]) {
      target = activeCallPairs[socket.id];
    }

    if (target) {
      console.log(`🛑 Call ended. Notifying peer ${target}`);
      io.to(target).emit('call-ended');
      
      // Cleanup active call pairing
      delete activeCallPairs[target];
      delete activeCallPairs[socket.id];
    }

    // Notify all counselor web dashboards that the call ended
    Object.keys(connectedUsers).forEach(sid => {
      const user = connectedUsers[sid];
      if (user.role === 'counselor' && sid !== socket.id && sid !== target) {
        io.to(sid).emit('counselor-call-ended');
      }
    });

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

    // Broadcast transcript-update to all counselor web dashboards
    Object.keys(connectedUsers).forEach(sid => {
      const user = connectedUsers[sid];
      if (user.role === 'counselor' && sid !== socket.id && sid !== data.to) {
        io.to(sid).emit('counselor-transcript-update', {
          text: data.text,
          sender: data.sender
        });
      }
    });
  });

  socket.on('chat-message', (data) => {
    const { to, message, sender } = data;
    if (to) {
      io.to(to).emit('chat-message', { message, sender, timestamp: Date.now() });
    }
  });

  socket.on('log-message', (data) => {
    console.log(`[CLIENT LOG] [${data.level?.toUpperCase() || 'INFO'}] ${data.message}`);
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
    
    // Automatically notify active peer if socket was in activeCallPairs
    const peer = activeCallPairs[socket.id];
    if (peer) {
      console.log(`🔌 Active peer disconnected. Notifying peer ${peer}`);
      io.to(peer).emit('call-ended');
      delete activeCallPairs[peer];
      delete activeCallPairs[socket.id];
    }

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

      // Notify other counselors that a call might have ended due to disconnect
      Object.keys(connectedUsers).forEach(sid => {
        const otherUser = connectedUsers[sid];
        if (otherUser.role === 'counselor' && sid !== socket.id) {
          io.to(sid).emit('counselor-call-ended');
        }
      });
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
