const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  age: Number,
  gender: String,
  phone: String,
  address: String,
  district: String,
  consentCaptured: Boolean,
  counselorId: String,
  assignedDate: String,
  status: String,
  severity: String,
  addictionCategory: String,
  progress: Number,
  avatarColor: String,
  cravingsIntensity: Number,
  recoveryPhase: String,
  notes: String,
  preferredLanguage: String,
  clinicalStage: Number,
  admissionDate: String,
  checkpoints: mongoose.Schema.Types.Mixed,
  joinDate: String,
  assignedCounselor: String,
  consent: Boolean,
  lastSessionDate: String,
  history: [mongoose.Schema.Types.Mixed],
  nextOpdVisitDate: String,
  escalation: {
    level: Number,
    reason: String,
    resolved: Boolean,
    resolvedBy: String,
    resolvedAt: String
  },
  vitals: [mongoose.Schema.Types.Mixed],
  medicalHistory: [mongoose.Schema.Types.Mixed],
  familyHistory: [mongoose.Schema.Types.Mixed],
  cowsAssessment: [mongoose.Schema.Types.Mixed],
  doctorsAssessment: [mongoose.Schema.Types.Mixed]
}, { timestamps: true, strict: true });

PatientSchema.index({ district: 1 });
PatientSchema.index({ nextOpdVisitDate: 1 });
PatientSchema.index({ name: 'text', phone: 'text' });

const CallLogSchema = new mongoose.Schema({
  logId: { type: String, required: true, unique: true },
  timestamp: String,
  patientId: String,
  patientName: String,
  counselorId: String,
  counselorName: String,
  sessionId: String,
  direction: String,
  duration: String,
  disposition: String,
  recordingUrl: String,
  summary: mongoose.Schema.Types.Mixed
}, { timestamps: true });

CallLogSchema.index({ patientId: 1 });
CallLogSchema.index({ timestamp: -1 });

const AuditTrailSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  timestamp: String,
  eventType: String,
  patientId: String,
  sessionId: String,
  actorRole: String,
  detail: String,
  signature: String
}, { timestamps: true });

const CounselorSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  email: String,
  phone: String,
  specialization: String,
  avatar: String,
  district: String,
  roleKey: String
}, { timestamps: true, strict: true });

const MedicineSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: { type: String, required: true, unique: true },
  stock: { type: Number, default: 0 },
  unit: { type: String, default: 'Tablets' },
  expiryDate: String,
  lowStockThreshold: { type: Number, default: 50 },
  defaultQuantity: Number,
  defaultFrequency: String, // Daily/Weekly/Monthly
  defaultDuration: Number, // days between visits
  category: String, // Opioid/Anxiety/etc
});

const MedicationLogSchema = new mongoose.Schema({
  logId: { type: String, required: true, unique: true },
  patientId: String,
  date: String,
  medicineName: String,
  quantity: Number,
  nextVisitDate: String,
  uploadedBy: String,
  dispensedBy: String,
  status: { type: String, default: 'dispensed' }, // pending/dispensed/missed
  signature: String,
  photoVerified: Boolean,
  notes: String,
  batchSource: String
}, { timestamps: true, strict: false });

MedicationLogSchema.index({ patientId: 1 });
MedicationLogSchema.index({ date: -1 });

const OpdVisitSchema = new mongoose.Schema({
  visitId: { type: String, required: true, unique: true },
  patientId: String,
  date: String,
  time: String,
  status: String, // Waiting, In Progress, Completed
  priority: String,
  isWalkIn: Boolean
}, { timestamps: true });

OpdVisitSchema.index({ date: 1, status: 1 });
OpdVisitSchema.index({ patientId: 1 });

const StaffSchema = new mongoose.Schema({
  roleKey: String,
  username: { type: String, unique: true },
  password: { type: String, required: true },
  name: String,
  staffId: { type: String, unique: true },
  district: String
}, { timestamps: true });

const SessionSchema = new mongoose.Schema({
  staffId: { type: String, required: true },
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

// Auto-delete expired sessions
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = {
  Patient: mongoose.model('Patient', PatientSchema),
  CallLog: mongoose.model('CallLog', CallLogSchema),
  AuditTrail: mongoose.model('AuditTrail', AuditTrailSchema),
  Counselor: mongoose.model('Counselor', CounselorSchema),
  MedicationLog: mongoose.model('MedicationLog', MedicationLogSchema),
  Medicine: mongoose.model('Medicine', MedicineSchema),
  OpdVisit: mongoose.model('OpdVisit', OpdVisitSchema),
  Staff: mongoose.model('Staff', StaffSchema),
  Session: mongoose.model('Session', SessionSchema)
};
export {};
