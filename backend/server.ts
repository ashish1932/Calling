const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const nodeCrypto = require('crypto');
if (!global.crypto) {
  global.crypto = nodeCrypto;
}
const { Server } = require('socket.io');
require('dotenv-flow').config({ path: path.join(__dirname), default_node_env: 'development' });

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const admin = require('firebase-admin');
const fs = require('fs');
const { SarvamAIClient } = require('sarvamai');
const logger = require('./utils/logger');

// Models
const { Staff, Counselor, Session, Patient, CallLog, Medicine } = require('./models');

// Middleware
const errorHandler = require('./middleware/error');

// Route modules
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const opdRoutes = require('./routes/opd');
const aiRoutes = require('./routes/ai');
const callingRoutes = require('./routes/calling');

// ==========================================
// CONFIG
// ==========================================

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-for-dev';

// ==========================================
// FIREBASE INIT
// ==========================================

const firebaseCredsPath = process.env.FIREBASE_CREDENTIALS_PATH || path.join(__dirname, '../google-services.json');
let fcmInitialized = false;
if (fs.existsSync(firebaseCredsPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(firebaseCredsPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    fcmInitialized = true;
    logger.info('Firebase Admin initialized for Push Notifications');
  } catch (err) {
    logger.error('Failed to initialize Firebase Admin: %s', err.message);
  }
} else {
  logger.warn('Firebase credentials not found. FCM push notifications will be disabled.');
}

// ==========================================
// JWT MIDDLEWARE
// ==========================================

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, async (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.user = user;
      
      // Fetch district for counselor/ddrc to enable RBAC district checking
      if (user.roleKey === 'counsellor' || user.roleKey === 'counselor' || user.roleKey === 'ddrc') {
        try {
          const { Counselor, Staff } = require('./models');
          let c = await Counselor.findOne({ id: user.staffId });
          if (!c) {
            c = await Staff.findOne({ staffId: user.staffId });
          }
          if (c && c.district) {
            req.user.district = c.district;
          }
        } catch (e) {
          console.error("Error fetching district for user in authenticateJWT:", e);
        }
      }
      next();
    });
  } else {
    res.status(401).json({ error: 'Authorization header missing' });
  }
};

// ==========================================
// EXPRESS APP
// ==========================================

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

// Serve the main application frontend directly from this server
  const staticOptions = {
    setHeaders: (res: any) => res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  };
  app.use(express.static(path.join(__dirname, '../frontend/pages'), staticOptions));
  app.use(express.static(path.join(__dirname, '../frontend'), staticOptions));

// Catch-all for 404
app.use((req: any, res: any, next: any) => {
  if (!req.path.startsWith('/api')) {
    res.status(404).sendFile(path.join(__dirname, '../frontend/pages/404.html'));
  } else {
    next();
  }
});

// CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['https://telecalling.cubegtp.com'];

const isNgrokOrLocalOrigin = (origin) => {
  if (!origin) return true;
  try {
    const parsedUrl = new URL(origin);
    const hostname = parsedUrl.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.ngrok-free.dev') ||
      hostname.endsWith('.ngrok.io') ||
      hostname.endsWith('.tunnelmole.net')
    );
  } catch (e) {
    return false;
  }
};

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || isNgrokOrLocalOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
};

app.use(cors(corsOptions));
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);

// Ngrok bypass and cache headers
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', '1');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// CSRF Protection
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (req.path.startsWith('/api/ai/')) return next();
    if (req.path === '/api/login' || req.path === '/api/auth/login' || req.path === '/api/auth/patient-login' || req.path === '/api/auth/refresh' || req.path === '/api/auth/logout') return next();
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: 'CSRF token missing or invalid (missing X-Requested-With header)' });
    }
  }
  next();
});

// ==========================================
// MOUNT ROUTES
// ==========================================

// Auth routes (public — no JWT middleware)
app.use('/api', authRoutes);

// AI proxy routes (no JWT — use API keys)
app.use('/api', aiRoutes);

// Protected data routes (require JWT)
app.use('/api', authenticateJWT, patientRoutes);
app.use('/api', authenticateJWT, opdRoutes);

// Calling routes (mix of public and protected)
callingRoutes.setFirebase(admin, fcmInitialized);
app.use('/api', authenticateJWT, callingRoutes);

// ==========================================
// SEED DATA
// ==========================================

const STAFF_CREDENTIALS = [
  { roleKey: 'spo',        username: 'spo@cbm.gov.in',                    password: process.env.SEED_PASSWORD_SPO,      name: 'Sh. Gurinder Bhullar IAS', staffId: 'STAFF-001' },
  { roleKey: 'supervisor',  username: 'supervisor@cbm.gov.in',            password: process.env.SEED_PASSWORD_SUPERVISOR,   name: 'Dr. Rajdeep Singh',        staffId: 'STAFF-002' },
  { roleKey: 'counsellor',  username: 'counsellor_amritsar@cbm.gov.in',   password: process.env.SEED_PASSWORD_COUNSELLOR,   name: 'Dr. Amanpreet Kaur',       staffId: 'STAFF-003', district: 'Amritsar' },
  { roleKey: 'counsellor',  username: 'counsellor_jalandhar@cbm.gov.in',  password: process.env.SEED_PASSWORD_COUNSELLOR,   name: 'Dr. Manpreet Sodhi',       staffId: 'STAFF-004', district: 'Jalandhar' },
  { roleKey: 'counsellor',  username: 'counsellor_ludhiana@cbm.gov.in',   password: process.env.SEED_PASSWORD_COUNSELLOR,   name: 'Dr. Harinder Gill',        staffId: 'STAFF-005', district: 'Ludhiana' },
  { roleKey: 'counsellor',  username: 'counsellor_patiala@cbm.gov.in',    password: process.env.SEED_PASSWORD_COUNSELLOR,   name: 'Dr. Gurbaksh Singh',       staffId: 'STAFF-006', district: 'Patiala' },
  { roleKey: 'ddrc',        username: 'ddrc_amritsar@cbm.gov.in',         password: process.env.SEED_PASSWORD_DDRC,         name: 'Dr. Harpreet Grewal',      staffId: 'STAFF-007', district: 'Amritsar' },
  { roleKey: 'ddrc',        username: 'ddrc_jalandhar@cbm.gov.in',        password: process.env.SEED_PASSWORD_DDRC,         name: 'Dr. Balwinder Singh',      staffId: 'STAFF-009', district: 'Jalandhar' },
  { roleKey: 'ddrc',        username: 'ddrc_ludhiana@cbm.gov.in',         password: process.env.SEED_PASSWORD_DDRC,         name: 'Dr. Simranjeet Kaur',      staffId: 'STAFF-010', district: 'Ludhiana' },
  { roleKey: 'ddrc',        username: 'ddrc_patiala@cbm.gov.in',          password: process.env.SEED_PASSWORD_DDRC,         name: 'Dr. Gurdeep Singh',        staffId: 'STAFF-011', district: 'Patiala' },
  { roleKey: 'ditsu',       username: 'ditsu@cbm.gov.in',                 password: process.env.SEED_PASSWORD_DITSU,        name: 'Er. Navneet Sharma',       staffId: 'STAFF-008' },
  { roleKey: 'opd_staff',   username: 'opd@cbm.gov.in',                   password: process.env.SEED_PASSWORD_OPD,          name: 'OPD Coordinator',          staffId: 'STAFF-012' }
];

// ==========================================
// MONGODB CONNECTION & SEEDING
// ==========================================

const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/counselflow';
mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 }).then(async () => {
  logger.info('Connected to MongoDB');
  try {
    for (const cred of STAFF_CREDENTIALS) {
      if (!cred.password) {
        logger.warn(`Skipping seeding/syncing for staff user ${cred.username} (password env var is not set)`);
        continue;
      }
      const hashedPassword = await bcrypt.hash(cred.password, 10);
      await Staff.findOneAndUpdate(
        { staffId: cred.staffId },
        { ...cred, password: hashedPassword },
        { upsert: true, new: true }
      );
    }
    logger.info('Synced Staff credentials to database');

    for (const c of STAFF_CREDENTIALS) {
      if (c.roleKey === 'counsellor' || c.roleKey === 'ddrc') {
        const count = await Counselor.countDocuments({ id: c.staffId });
        if (count === 0) {
          await Counselor.create({
            id: c.staffId,
            name: c.name,
            email: c.username,
            phone: (c as any).phone || '9876543210',
            specialization: c.roleKey === 'ddrc' ? 'DDRC Admin' : 'Counselor',
            avatar: c.name.split(' ').map((n:any)=>n[0]).join('').substring(0,2),
            district: c.district || 'Unknown',
            roleKey: c.roleKey
          });
          logger.info(`Seeded counselor: ${c.name} (${c.staffId})`);
        }
      }
    }

    // Seed Patients if there are no patients in the database
    const patientCount = await Patient.countDocuments();
    if (patientCount === 0) {
      logger.info('Database empty of patients. Seeding default patient list...');
      const seedPatients = [
        {
          id: 'PAT-001',
          name: 'Balbir Singh',
          age: 34,
          gender: 'Male',
          phone: '+91-98765-43210',
          address: 'Gali No. 3, Putligarh, Amritsar, Punjab',
          district: 'Amritsar',
          consentCaptured: true,
          counselorId: 'STAFF-003',
          assignedDate: '2026-05-10',
          status: 'Active',
          severity: 'High',
          addictionCategory: 'Heroin / Opioids',
          progress: 35,
          avatarColor: '#4f46e5',
          cravingsIntensity: 7,
          recoveryPhase: 'Early Abstinence',
          preferredLanguage: 'Punjabi',
          clinicalStage: 2,
          admissionDate: '2026-05-10',
          checkpoints: { withdrawalStabilised: true, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false },
          consent: true,
          joinDate: '2026-05-10',
          assignedCounselor: 'Dr. Amanpreet Kaur',
          lastSessionDate: '2026-06-18',
          history: [
            {
              sessionId: 'SESS-101',
              date: '2026-06-18T10:30:00Z',
              duration: '12:30',
              language: 'Punjabi',
              summary: {
                escalationLevel: 0,
                followUp: '2026-06-20',
                _scores: { average: 92 }
              }
            },
            {
              sessionId: 'SESS-102',
              date: '2026-06-15T11:15:00Z',
              duration: '10:45',
              language: 'Punjabi',
              summary: {
                escalationLevel: 0,
                followUp: '2026-06-18',
                _scores: { average: 88 }
              }
            }
          ]
        },
        {
          id: 'PAT-002',
          name: 'Gurpreet Singh',
          age: 28,
          gender: 'Male',
          phone: '+91-98765-43211',
          address: 'Model Town, Jalandhar, Punjab',
          district: 'Jalandhar',
          consentCaptured: true,
          counselorId: 'STAFF-004',
          assignedDate: '2026-05-12',
          status: 'Monitored',
          severity: 'Medium',
          addictionCategory: 'Alcohol',
          progress: 55,
          avatarColor: '#0ea5e9',
          cravingsIntensity: 4,
          recoveryPhase: 'Active Recovery',
          preferredLanguage: 'Punjabi',
          clinicalStage: 3,
          admissionDate: '2026-05-12',
          checkpoints: { withdrawalStabilised: true, layer1And2Ready: true, familyPsychoedAttended: false, day30ReviewPassed: false },
          consent: true,
          joinDate: '2026-05-12',
          assignedCounselor: 'Dr. Manpreet Sodhi',
          lastSessionDate: '2026-06-17',
          history: [
            {
              sessionId: 'SESS-201',
              date: '2026-06-17T14:20:00Z',
              duration: '08:15',
              language: 'Punjabi',
              summary: {
                escalationLevel: 0,
                followUp: '2026-06-24',
                _scores: { average: 95 }
              }
            }
          ]
        },
        {
          id: 'PAT-003',
          name: 'Jaswinder Kaur',
          age: 42,
          gender: 'Female',
          phone: '+91-98765-43212',
          address: 'Civil Lines, Ludhiana, Punjab',
          district: 'Ludhiana',
          consentCaptured: true,
          counselorId: 'STAFF-005',
          assignedDate: '2026-04-05',
          status: 'Completed',
          severity: 'Low',
          addictionCategory: 'Synthetic Drugs',
          progress: 95,
          avatarColor: '#10b981',
          cravingsIntensity: 1,
          recoveryPhase: 'Maintenance',
          preferredLanguage: 'Hindi',
          clinicalStage: 6,
          admissionDate: '2026-04-05',
          checkpoints: { withdrawalStabilised: true, layer1And2Ready: true, familyPsychoedAttended: true, day30ReviewPassed: true },
          consent: true,
          joinDate: '2026-04-05',
          assignedCounselor: 'Dr. Harinder Gill',
          lastSessionDate: '2026-06-10',
          history: [
            {
              sessionId: 'SESS-301',
              date: '2026-06-10T09:00:00Z',
              duration: '15:20',
              language: 'Hindi',
              summary: {
                escalationLevel: 0,
                followUp: 'Completed Program',
                _scores: { average: 98 }
              }
            }
          ]
        },
        {
          id: 'PAT-004',
          name: 'Manpreet Singh',
          age: 26,
          gender: 'Male',
          phone: '+91-98765-43213',
          address: 'Urban Estate, Patiala, Punjab',
          district: 'Patiala',
          consentCaptured: true,
          counselorId: 'STAFF-006',
          assignedDate: '2026-06-01',
          status: 'Risk',
          severity: 'High',
          addictionCategory: 'Heroin / Opioids',
          progress: 20,
          avatarColor: '#f43f5e',
          cravingsIntensity: 9,
          recoveryPhase: 'Early Abstinence',
          preferredLanguage: 'Punjabi',
          clinicalStage: 1,
          admissionDate: '2026-06-01',
          checkpoints: { withdrawalStabilised: false, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false },
          consent: true,
          joinDate: '2026-06-01',
          assignedCounselor: 'Dr. Gurbaksh Singh',
          lastSessionDate: '2026-06-19',
          history: [
            {
              sessionId: 'SESS-401',
              date: '2026-06-19T08:00:00Z',
              duration: '18:45',
              language: 'Punjabi',
              summary: {
                escalationLevel: 2,
                escalationResolvedAt: null,
                followUp: '2026-06-20 - Urgent escalation',
                _scores: { average: 75 }
              }
            }
          ]
        }
      ];
      await Patient.insertMany(seedPatients);
      logger.info('Successfully seeded patients.');
    }

    // Seed CallLogs if empty
    const callLogCount = await CallLog.countDocuments();
    if (callLogCount === 0) {
      logger.info('Database empty of call logs. Seeding default call logs...');
      const seedLogs = [
        {
          logId: 'LOG-101',
          timestamp: '2026-06-18T10:30:00Z',
          patientId: 'PAT-001',
          patientName: 'Balbir Singh',
          counselorId: 'STAFF-003',
          counselorName: 'Dr. Amanpreet Kaur',
          sessionId: 'SESS-101',
          direction: 'Outbound',
          duration: '12:30',
          disposition: 'Completed',
          recordingUrl: '/recordings/SESS-101.wav',
          summary: {
            escalationLevel: 0,
            followUp: '2026-06-20',
            _scores: { average: 92 }
          }
        },
        {
          logId: 'LOG-102',
          timestamp: '2026-06-15T11:15:00Z',
          patientId: 'PAT-001',
          patientName: 'Balbir Singh',
          counselorId: 'STAFF-003',
          counselorName: 'Dr. Amanpreet Kaur',
          sessionId: 'SESS-102',
          direction: 'Outbound',
          duration: '10:45',
          disposition: 'Completed',
          recordingUrl: '/recordings/SESS-102.wav',
          summary: {
            escalationLevel: 0,
            followUp: '2026-06-18',
            _scores: { average: 88 }
          }
        },
        {
          logId: 'LOG-201',
          timestamp: '2026-06-17T14:20:00Z',
          patientId: 'PAT-002',
          patientName: 'Gurpreet Singh',
          counselorId: 'STAFF-004',
          counselorName: 'Dr. Manpreet Sodhi',
          sessionId: 'SESS-201',
          direction: 'Outbound',
          duration: '08:15',
          disposition: 'Completed',
          recordingUrl: '/recordings/SESS-201.wav',
          summary: {
            escalationLevel: 0,
            followUp: '2026-06-24',
            _scores: { average: 95 }
          }
        },
        {
          logId: 'LOG-301',
          timestamp: '2026-06-10T09:00:00Z',
          patientId: 'PAT-003',
          patientName: 'Jaswinder Kaur',
          counselorId: 'STAFF-005',
          counselorName: 'Dr. Harinder Gill',
          sessionId: 'SESS-301',
          direction: 'Outbound',
          duration: '15:20',
          disposition: 'Completed',
          recordingUrl: '/recordings/SESS-301.wav',
          summary: {
            escalationLevel: 0,
            followUp: 'Completed Program',
            _scores: { average: 98 }
          }
        },
        {
          logId: 'LOG-401',
          timestamp: '2026-06-19T08:00:00Z',
          patientId: 'PAT-004',
          patientName: 'Manpreet Singh',
          counselorId: 'STAFF-006',
          counselorName: 'Dr. Gurbaksh Singh',
          sessionId: 'SESS-401',
          direction: 'Outbound',
          duration: '18:45',
          disposition: 'Completed',
          recordingUrl: '/recordings/SESS-401.wav',
          summary: {
            escalationLevel: 2,
            escalationResolvedAt: null,
            followUp: '2026-06-20 - Urgent escalation',
            _scores: { average: 75 }
          }
        },
        {
          logId: 'LOG-MISSED-01',
          timestamp: '2026-06-19T11:00:00Z',
          patientId: 'PAT-004',
          patientName: 'Manpreet Singh',
          counselorId: 'STAFF-006',
          counselorName: 'Dr. Gurbaksh Singh',
          sessionId: 'SESS-402',
          direction: 'Outbound',
          duration: '00:00',
          disposition: 'Missed',
          recordingUrl: '',
          summary: {}
        }
      ];
      await CallLog.insertMany(seedLogs);
      logger.info('Successfully seeded call logs.');
    }

    // Seed Medicines if empty
    const medicineCount = await Medicine.countDocuments();
    if (medicineCount === 0) {
      logger.info('Database empty of medicines. Seeding default medicines...');
      const seedMedicines = [
        { id: 'MED-001', name: 'Buprenorphine', stock: 1500, unit: 'Tablets', expiryDate: '2027-12-31', lowStockThreshold: 100, defaultQuantity: 5, defaultFrequency: 'Daily', defaultDuration: 7, category: 'Opioid Substitution' },
        { id: 'MED-002', name: 'Methadone', stock: 800, unit: 'ml', expiryDate: '2027-06-30', lowStockThreshold: 200, defaultQuantity: 10, defaultFrequency: 'Daily', defaultDuration: 5, category: 'Opioid Substitution' },
        { id: 'MED-003', name: 'Naltrexone', stock: 400, unit: 'Tablets', expiryDate: '2028-03-31', lowStockThreshold: 50, defaultQuantity: 2, defaultFrequency: 'Weekly', defaultDuration: 14, category: 'Antagonist' },
        { id: 'MED-004', name: 'Diazepam', stock: 200, unit: 'Tablets', expiryDate: '2026-11-30', lowStockThreshold: 50, defaultQuantity: 4, defaultFrequency: 'Daily', defaultDuration: 3, category: 'Anxiolytic' }
      ];
      await Medicine.insertMany(seedMedicines);
      logger.info('Successfully seeded medicines.');
    }

  } catch (err) {
    logger.error('Error seeding counselors, staff or patients: %O', err);
  }
})
  .catch(err => {
    logger.error('MongoDB Connection Error: %O', err);
    logger.warn('Server will continue running to allow frontend offline mode.');
  });

// ==========================================
// SOCKET.IO SIGNALING FOR WEBRTC IN-APP CALLS
// ==========================================

const connectedUsers = {};
const patientSockets = {};
const counselorSockets = {};
const relayPairs = {};
const sarvamStreams = {};

// Inject patientSockets into patient routes for /patients/online
patientRoutes.setPatientSocketsGetter(() => patientSockets);

io.on('connection', (socket) => {
  console.log(`⚡ Socket connected: ${socket.id}`);

  socket.on('register', (data) => {
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

  socket.on('call-user', (data) => {
    const targetSocket = patientSockets[data.to] || counselorSockets[data.to] || counselorSockets['counselor'];
    if (targetSocket) {
      console.log(`📞 Counselor calling patient ${data.to}`);
      io.to(targetSocket).emit('call-made', {
        offer: data.offer,
        socket: socket.id,
        callerInfo: data.callerInfo || { name: 'Counselor' }
      });
      if (data.offer && (data.offer.roomName || data.offer.sdp)) {
        io.emit('dashboard-observe-call', {
          roomName: data.offer.roomName || data.offer.sdp,
          patientId: data.to,
          counselorId: connectedUsers[socket.id] ? connectedUsers[socket.id].id : 'Unknown'
        });
      }
    } else {
      console.log(`⚠️ Patient ${data.to} is not online.`);
      socket.emit('call-failed', { reason: 'patient-offline' });
    }
  });

  socket.on('handoff-call', (data) => {
    const targetSocket = counselorSockets[data.to];
    if (targetSocket) {
      console.log(`📱 Web Dashboard handing off call to Counselor Mobile ${data.to}`);
      io.to(targetSocket).emit('handoff-call', {
        socket: socket.id,
        roomName: data.roomName,
        patientName: data.patientName
      });
    } else {
      console.log(`⚠️ Counselor Mobile ${data.to} is not online for handoff.`);
    }
  });

  socket.on('incoming-call', (data) => {
    const targetSocket = counselorSockets[data.to] || counselorSockets['counselor'];
    if (targetSocket) {
      console.log(`📲 Patient ${data.from} calling counselor ${data.to || 'default'}`);
      io.to(targetSocket).emit('incoming-call', {
        socket: socket.id,
        patientId: data.from,
        roomName: data.roomName,
        patientName: data.patientName
      });
      socket.broadcast.emit('incoming-call', {
        socket: socket.id,
        patientId: data.from,
        roomName: data.roomName,
        patientName: data.patientName
      });
    } else {
      console.log(`⚠️ Counselor ${data.to} is not online.`);
    }
  });

  socket.on('transcription', (data) => {
    if (data.roomName && data.text) {
      socket.broadcast.emit('transcription', {
        roomName: data.roomName,
        text: data.text,
        speaker: data.speaker,
        timestamp: data.timestamp || new Date().toISOString()
      });
    }
  });

  socket.on('make-answer', (data) => {
    console.log(`✅ Patient answered call, sending answer to counselor ${data.to}`);
    io.to(data.to).emit('answer-made', {
      socket: socket.id,
      answer: data.answer
    });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate-received', {
      socket: socket.id,
      candidate: data.candidate,
      source: data.source
    });
  });

  socket.on('reject-call', (data) => {
    console.log(`❌ Patient rejected call from counselor ${data.to}`);
    io.to(data.to).emit('call-rejected', {
      socket: socket.id
    });
  });

  socket.on('end-call', (data) => {
    let target = data.to;
    if (!target && data.toPatientId) {
      target = patientSockets[data.toPatientId];
    }
    if (target) {
      console.log(`🛑 Call ended. Notifying ${target}`);
      io.to(target).emit('call-ended');
    }
    for (const id of Object.keys(counselorSockets)) {
      const socketId = counselorSockets[id];
      if (socketId && socketId !== socket.id) {
        io.to(socketId).emit('call-ended');
      }
    }
    if (relayPairs[socket.id]) {
      delete relayPairs[relayPairs[socket.id]];
      delete relayPairs[socket.id];
    }
  });

  // Audio relay
  socket.on('audio-relay-start', (data) => {
    relayPairs[socket.id] = data.to;
    relayPairs[data.to] = socket.id;
    io.to(data.to).emit('audio-relay-start', { from: socket.id });
    console.log(`🔊 Audio relay started between ${socket.id} ↔ ${data.to}`);
  });

  socket.on('transcript-update', (data) => {
    if (data.to) {
      io.to(data.to).emit('transcript-update', { text: data.text, sender: data.sender });
    }
    for (const id of Object.keys(counselorSockets)) {
      const socketId = counselorSockets[id];
      if (socketId && socketId !== socket.id) {
        io.to(socketId).emit('transcript-update', { text: data.text, sender: data.sender });
      }
    }
  });

  socket.on('chat-message', (data) => {
    if (data.to) {
      io.to(data.to).emit('chat-message', { text: data.text, sender: data.sender || 'patient' });
    }
    for (const id of Object.keys(counselorSockets)) {
      const socketId = counselorSockets[id];
      if (socketId && socketId !== socket.id) {
        io.to(socketId).emit('chat-message', { text: data.text, sender: data.sender || 'patient' });
      }
    }
  });

  socket.on('audio-chunk', (data) => {
    const peerSocket = relayPairs[socket.id];
    if (peerSocket) {
      io.to(peerSocket).emit('audio-chunk', data);
    }
  });

  socket.on('audio-relay-stop', () => {
    if (relayPairs[socket.id]) {
      io.to(relayPairs[socket.id]).emit('audio-relay-stop');
      delete relayPairs[relayPairs[socket.id]];
      delete relayPairs[socket.id];
    }
    console.log(`🔇 Audio relay stopped for ${socket.id}`);
  });

  socket.on('mute-state-change', (data) => {
    if (data.to) {
      io.to(data.to).emit('mute-state-change', {
        isMuted: data.isMuted
      });
    }
  });

  // Sarvam Streaming STT
  socket.on('start-stt-stream', async (data) => {
    const speaker = data.speaker || 'Unknown';
    const language = data.language || 'hi-IN';
    const mode = data.mode || 'codemix';
    const streamKey = `${socket.id}_${speaker}`;

    if (sarvamStreams[streamKey]) {
      try { sarvamStreams[streamKey].close(); } catch (e) {}
      delete sarvamStreams[streamKey];
    }

    const apiKey = process.env.SARVAM_API_KEY || 'sk_lst0lo51_JTbjepcAbL4GGeDbtzRXigsS';
    if (!apiKey) {
      console.error('[Sarvam STT] SARVAM_API_KEY not set in .env');
      socket.emit('stt-error', { message: 'SARVAM_API_KEY not configured on server.' });
      return;
    }

    try {
      const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
      const sarvamSocket = await client.speechToTextStreaming.connect({
        model: 'saaras:v3',
        'language-code': language,
        high_vad_sensitivity: 'true',
        vad_signals: 'true',
        reconnectAttempts: 3,
        "Api-Subscription-Key": apiKey
      });

      sarvamSocket.on('open', () => {
        console.log(`[Sarvam STT] Stream opened for ${speaker} on socket ${socket.id}`);
      });

      sarvamSocket.on('message', (msg) => {
        if (msg.type === 'events' && msg.data) {
          socket.emit('stt-vad-event', {
            speaker: speaker,
            signalType: msg.data.signal_type
          });
        } else if (msg.type === 'data' && msg.data && msg.data.transcript) {
          socket.emit('stt-transcript', {
            speaker: speaker,
            text: msg.data.transcript
          });
        } else if (msg.transcript) {
          socket.emit('stt-transcript', {
            speaker: speaker,
            text: msg.transcript
          });
        }
      });

      sarvamSocket.on('error', (err) => {
        console.error(`[Sarvam STT] Error for ${speaker}:`, err.message);
        socket.emit('stt-error', { speaker: speaker, message: err.message });
      });

      sarvamSocket.on('close', (event) => {
        console.log(`[Sarvam STT] Stream closed for ${speaker}. Code: ${event?.code || 'unknown'}`);
        delete sarvamStreams[streamKey];
      });

      await sarvamSocket.waitForOpen();
      sarvamStreams[streamKey] = sarvamSocket;
      socket.emit('stt-stream-ready', { speaker: speaker });
      console.log(`[Sarvam STT] ✅ Stream ready for ${speaker}`);
    } catch (err) {
      console.error(`[Sarvam STT] Failed to start stream for ${speaker}:`, err);
      socket.emit('stt-error', { speaker: speaker, message: err.message });
    }
  });

  socket.on('stt-audio-chunk', (data) => {
    const streamKey = `${socket.id}_${data.speaker}`;
    const sarvamSocket = sarvamStreams[streamKey];
    if (sarvamSocket) {
      try {
        sarvamSocket.transcribe({
          audio: data.audio,
          sample_rate: 16000,
          encoding: 'pcm_s16le'
        });
      } catch (err) {
        console.error(`[Sarvam STT] Error sending chunk for ${data.speaker}:`, err.message);
      }
    }
  });

  socket.on('stt-flush', (data) => {
    const streamKey = `${socket.id}_${data.speaker}`;
    const sarvamSocket = sarvamStreams[streamKey];
    if (sarvamSocket) {
      try { sarvamSocket.flush(); } catch (e) {}
    }
  });

  socket.on('stop-stt-stream', (data) => {
    const speaker = data?.speaker;
    if (speaker) {
      const streamKey = `${socket.id}_${speaker}`;
      if (sarvamStreams[streamKey]) {
        try { sarvamStreams[streamKey].close(); } catch (e) {}
        delete sarvamStreams[streamKey];
        console.log(`[Sarvam STT] Stream stopped for ${speaker} on socket ${socket.id}`);
      }
    } else {
      for (const key of Object.keys(sarvamStreams)) {
        if (key.startsWith(socket.id + '_')) {
          try { sarvamStreams[key].close(); } catch (e) {}
          delete sarvamStreams[key];
        }
      }
      console.log(`[Sarvam STT] All streams stopped for socket ${socket.id}`);
    }
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`🔴 Socket disconnected: ${socket.id}`);
    for (const key of Object.keys(sarvamStreams)) {
      if (key.startsWith(socket.id + '_')) {
        try { sarvamStreams[key].close(); } catch (e) {}
        delete sarvamStreams[key];
      }
    }
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

app.use((req: any, res: any) => {
  res.status(404).sendFile(path.join(__dirname, '../frontend/pages/404.html'));
});

// ==========================================
// GLOBAL ERROR HANDLER (must be last)
// ==========================================

app.use(errorHandler);

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  logger.info(`CounselFlow Backend running on port ${PORT}`);
});
export {};
