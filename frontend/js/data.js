// Mock Patient and Session Data with relative dates and schema versioning

window.CounselFlow = window.CounselFlow || {};



// Centralized Configuration and Environment variables (Architecture #44, Code Quality #7)
window.CounselFlow.CONFIG = {
  SCHEMA_VERSION: 14,
  ENCRYPTION_KEY: (() => {
    try {
      let key = window.localStorage.getItem("counseling_encryption_key");
      if (!key) {
        // Generate secure 256-bit cryptographically-random key unique to client
        const arr = new Uint8Array(32);
        window.crypto.getRandomValues(arr);
        key = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
        window.localStorage.setItem("counseling_encryption_key", key);
      }
      return key;
    } catch (e) {
      return "CounselFlow_Local_Secure_Fallback_Key_2026_Salt_#9f8d3s!";
    }
  })(),
  INACTIVITY_LIMIT_MS: 2 * 60 * 60 * 1000, // 2 hours
  ASR_MAX_RETRY_COUNT: 3,
  ASR_RETRY_DELAY_MS: 3000,
  ENABLE_REAL_CALLS: true, // Set false for simulation/demo mode — no real calls placed
  STATUSES: {
    ACTIVE: 'Active',
    MONITORED: 'Monitored',
    RISK: 'Risk',
    COMPLETED: 'Completed'
  },
  SEVERITIES: {
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low'
  },
  LANGUAGES: {
    PUNJABI: 'pa-IN',
    HINDI: 'hi-IN',
    ENGLISH: 'en-US'
  },
  GROQ_API_KEY: "",
  GEMINI_API_KEY: "",
  AI_PROVIDER: "groq",
  DEFAULT_SETTINGS: {
    counselorAudioRetentionMins: 1,
    adminAudioRetentionDays: 10
  }
};

window.CounselFlow.ENV = {
  mode: 'production',
  get apiUrl() { return window.CounselFlow.API_BASE; },
  enableMocks: false,
  wsUrl: 'wss://telecalling.cubegtp.com'
};

window.CounselFlow.getSystemSettings = function() {
  const saved = window.CounselFlow.safeGetItem("counseling_system_settings");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch(e) {}
  }
  return window.CounselFlow.CONFIG.DEFAULT_SETTINGS;
};

window.CounselFlow.saveSystemSettings = function(settingsObj) {
  window.CounselFlow.safeSetItem("counseling_system_settings", JSON.stringify(settingsObj));
};

// Global Helper for escaping HTML text to prevent XSS (Bug #4, Bug #24, Bug #70)
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.CounselFlow.escapeHtml = escapeHtml;
// Sanitized relative date helper (Critical Bugs #10)
const MOCK_DATE = (daysAgo) => {
  const days = typeof daysAgo === 'number' && !isNaN(daysAgo) ? daysAgo : 0;
  try {
    const calculatedTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    if (isNaN(calculatedTime) || calculatedTime < 0) {
      return new Date().toISOString().split('T')[0];
    }
    return new Date(calculatedTime).toISOString().split('T')[0];
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
};

window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.calculateTreatmentDay = function(admissionDate) {
  if (!admissionDate) return 0;
  try {
    const admission = new Date(admissionDate);
    const today = new Date();
    const diffTime = today.getTime() - admission.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
    return Math.max(0, diffDays);
  } catch (e) {
    return 0;
  }
};

window.CounselFlow.evaluatePatientWorkflow = function(patient) {
  if (!patient || !patient.checkpoints) return patient;
  
  const currentDay = window.CounselFlow.calculateTreatmentDay(patient.admissionDate);
  let newStage = 1; // Default is Stage 1 (Detoxification)

  if (patient.status && patient.status.toLowerCase() === 'lama') {
    patient.clinicalStage = 0; // LAMA cases get special Stage 0
    return patient;
  }

  // Stage 1 -> 3 Logic (Requires MO Clearance & Independent checks)
  if (patient.checkpoints.withdrawalStabilised === true && patient.checkpoints.layer1And2Ready === true) {
    newStage = 3;
  } else if (patient.checkpoints.withdrawalStabilised === true || patient.checkpoints.layer1And2Ready === true || currentDay > 3) {
    newStage = 2;
  } else {
    newStage = 1;
  }

  // Stage 3 -> 4 Logic (Requires Family Psychoed)
  if (newStage === 3 && patient.checkpoints.familyPsychoedAttended === true) {
    newStage = 4;
  }

  // Stage 4 -> 5 Logic (Requires 30-Day Bridge Review)
  if (newStage === 4 && patient.checkpoints.day30ReviewPassed === true) {
    newStage = 5;
  }

  // Stage 5 -> 6 Logic (Requires reaching Day 90)
  if (newStage === 5 && currentDay >= 90) {
    newStage = 6;
  }

  patient.clinicalStage = newStage;
  return patient;
};

// Gap 1: Stage 4 Contact Frequency — counts confirmed sessions in the last 7 days
window.CounselFlow.getStage4ContactsThisWeek = function(patient) {
  if (!patient) return 0;
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const contacts = patient.cbmContacts || [];
  return contacts.filter(c => {
    try {
      return new Date(c.date).getTime() >= sevenDaysAgo && c.status === 'connected';
    } catch (e) { return false; }
  }).length;
};

// Gap 2: L3 Auto-trigger — returns true if patient should have an L3 escalation
// Fires when: (a) Stage 4 patient past Day 35 without passing 30-day review
//             (b) Stage 5 patient with cravingsIntensity >= 8 or status 'Risk' (severe relapse indicator)
window.CounselFlow.shouldAutoTriggerL3 = function(patient) {
  if (!patient) return false;
  const currentDay = window.CounselFlow.calculateTreatmentDay(patient.admissionDate);
  // Already in LAMA or Completed — no L3 needed
  if (patient.status === 'LAMA' || patient.status === 'Completed') return false;
  // Stage 4: past Day 35 and 30-day review not passed
  if (patient.clinicalStage === 4 && currentDay > 35 && !patient.checkpoints?.day30ReviewPassed) return true;
  // Stage 5: severe relapse indicators
  if (patient.clinicalStage === 5 && (patient.status === 'Risk' || (patient.cravingsIntensity ?? 0) >= 8)) return true;
  return false;
};

const INITIAL_PATIENTS = [];

const INITIAL_CALL_LOGS = [];

const INITIAL_AUDIT_TRAIL = [];

// Rich scripts for simulating realistic tele-counseling sessions on click
const CALL_SCENARIOS = {};

// Initial analytical values for rendering graphs and general metrics
const ANALYTICS_DATA = {};

// Version control schema details for localStorage migrations - moved to window.CounselFlow.CONFIG

// Secure Symmetric XXTEA Block-Cipher Implementation (Security #68)
// Secure Symmetric AES-GCM Implementation (Security #68)
async function getCryptoKey(password) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("counselflow-salt"),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function obfuscateData(dataObj) {
  try {
    const jsonStr = JSON.stringify(dataObj);
    const key = await getCryptoKey(window.CounselFlow.CONFIG.ENCRYPTION_KEY);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(jsonStr);
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    const payload = new Uint8Array(iv.length + encrypted.byteLength);
    payload.set(iv, 0);
    payload.set(new Uint8Array(encrypted), iv.length);
    let binary = '';
    for (let i = 0; i < payload.byteLength; i++) {
      binary += String.fromCharCode(payload[i]);
    }
    return btoa(binary);
  } catch (e) {
    console.error("Encryption error:", e);
    return JSON.stringify(dataObj);
  }
}

async function deobfuscateData(str) {
  try {
    if (!str) return null;
    if (str.startsWith('[') || str.startsWith('{')) return JSON.parse(str);
    const binary = atob(str);
    const payload = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) payload[i] = binary.charCodeAt(i);
    const iv = payload.slice(0, 12);
    const data = payload.slice(12);
    const key = await getCryptoKey(window.CounselFlow.CONFIG.ENCRYPTION_KEY);
    const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (e) {
    console.error("Decryption error:", e);
    throw e;
  }
}

// Expose secure functions to window scope for diagnostic tests (tests.js)
window.obfuscateData = obfuscateData;
window.deobfuscateData = deobfuscateData;

// Check if localStorage is available and writable
let isLocalStorageAvailable = false;
let storageWarningToToast = null;
try {
  const testKey = "__storage_test__";
  window.localStorage.setItem(testKey, testKey);
  window.localStorage.removeItem(testKey);
  isLocalStorageAvailable = true;
} catch (e) {
  isLocalStorageAvailable = false;
  console.warn("localStorage is not accessible. Falling back to in-memory session storage.", e);
  storageWarningToToast = {
    title: "Storage Unobtainable",
    message: "LocalStorage is blocked or unavailable (e.g. in Private mode). Patient data edits will be temporary for this session.",
    type: "error"
  };
}

// In-memory backup database
const IN_MEMORY_DB = {};

function safeGetItem(key) {
  if (isLocalStorageAvailable) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      console.error(`Error reading ${key} from localStorage:`, e);
    }
  }
  return IN_MEMORY_DB[key] || null;
}

function safeSetItem(key, value) {
  if (isLocalStorageAvailable) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.error(`Error writing ${key} to localStorage:`, e);
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        const title = "Storage Quota Exceeded";
        const message = "Local storage quota has been exceeded. Patient records are temporarily saved in memory for this session.";
        if (window.CounselFlow.app && typeof window.CounselFlow.app.showToast === 'function') {
          window.CounselFlow.app.showToast(title, message, "error");
        } else {
          storageWarningToToast = { title, message, type: "error" };
        }
      } else {
        const title = "Storage Unobtainable";
        const message = "Unable to write to local storage. Your changes will be lost when you close this window.";
        if (window.CounselFlow.app && typeof window.CounselFlow.app.showToast === 'function') {
          window.CounselFlow.app.showToast(title, message, "error");
        } else {
          storageWarningToToast = { title, message, type: "error" };
        }
      }
    }
  }
  IN_MEMORY_DB[key] = value;
  return false;
}

// Export storage helpers to global namespace
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.safeGetItem = safeGetItem;
window.CounselFlow.safeSetItem = safeSetItem;
window.CounselFlow.getStorageWarning = () => storageWarningToToast;
window.CounselFlow.clearStorageWarning = () => { storageWarningToToast = null; };

// Centralized Explicit Port Configuration (Issue #16)
window.CounselFlow.API_BASE = window.location.origin + '/api';

const API_BASE = window.CounselFlow.API_BASE;

// Inject headers into all fetch requests targeting our API
const originalFetch = window.fetch;
window.fetch = async function(resource, config) {
  let isApiCall = false;
  if (typeof resource === 'string' && resource.includes(API_BASE)) {
    isApiCall = true;
    config = config || {};
    config.headers = config.headers || {};
    
    // Add cache-busting timestamp to GET requests
    const method = (config.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const separator = resource.includes('?') ? '&' : '?';
      resource = `${resource}${separator}_t=${Date.now()}`;
    }

    if (config.headers instanceof Headers) {
      config.headers.append('ngrok-skip-browser-warning', '1');
      config.headers.append('X-Requested-With', 'XMLHttpRequest');
    } else {
      config.headers['ngrok-skip-browser-warning'] = '1';
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    const token = window.localStorage.getItem('counseling_logged_in_token');
    if (token && !config.headers['Authorization'] && !config.headers['authorization']) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  
  const response = await originalFetch(resource, config);
  
  if (isApiCall && response.status === 401 && !resource.includes('/auth/') && !resource.includes('/ai/')) {
    const isLoginPage = window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/') || window.location.pathname === '';
    if (!isLoginPage) {
      console.warn("Session expired or unauthorized. Logging out.");
      window.localStorage.removeItem('counseling_active_role');
      window.localStorage.removeItem('counseling_logged_in_name');
      window.localStorage.removeItem('counseling_logged_in_staff');
      window.localStorage.removeItem('counseling_logged_in_token');
      window.location.href = 'index.html';
    }
  }
  
  return response;
};

async function getStoredPatients() {
  // Database is the SINGLE source of truth — no localStorage caching.
  try {
    const token = window.localStorage.getItem('counseling_logged_in_token');
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/patients`, { headers });
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const resData = await res.json();
    const data = Array.isArray(resData) ? resData : (resData.data || []);
    console.info(`[Data] Fetched ${data.length} patients from database.`);
    return data;
  } catch (err) {
    console.error("[Data] Failed to fetch patients from database:", err);
    if (window.CounselFlow && window.CounselFlow.app && typeof window.CounselFlow.app.showToast === 'function') {
      window.CounselFlow.app.showToast("Database Error", "Could not load patients from database. Please check your connection.", "error");
    }
    return [];
  }
}


async function savePatients(patients) {
  // Database is the SINGLE source of truth — write directly to backend.
  try {
    const token = window.localStorage.getItem('counseling_logged_in_token');
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/patients`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(patients)
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    console.info(`[Data] Saved ${patients.length} patients to database.`);
  } catch (err) {
    console.error("[Data] Failed to save patients to database:", err);
    if (window.CounselFlow && window.CounselFlow.app && typeof window.CounselFlow.app.showToast === 'function') {
      window.CounselFlow.app.showToast("Save Error", "Failed to save patients to database.", "error");
    }
    throw err; // Re-throw so callers know the save failed
  }
}

// Atomic single-patient update — avoids stale-write clobbering from full-array saves.
async function patchPatient(patientId, updates) {
  try {
    const token = window.localStorage.getItem('counseling_logged_in_token');
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/patients/${patientId}`, {
      method: 'PATCH',
      headers: headers,
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const result = await res.json();
    console.info(`[Data] Patched patient ${patientId} in database.`);
    return result.patient; // Return the server-confirmed patient object
  } catch (err) {
    console.error(`[Data] Failed to patch patient ${patientId}:`, err);
    if (window.CounselFlow && window.CounselFlow.app && typeof window.CounselFlow.app.showToast === 'function') {
      window.CounselFlow.app.showToast("Save Error", "Failed to update patient in database.", "error");
    }
    throw err;
  }
}

async function deletePatient(id) {
  if (navigator.onLine) {
    try {
      const token = window.localStorage.getItem('counseling_logged_in_token');
      const headers = { 'X-Requested-With': 'XMLHttpRequest' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/patients/${id}`, {
        method: 'DELETE',
        headers: headers
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
    } catch (err) {
      console.error("Failed to delete patient from backend:", err);
    }
  }
}

// Global Registry for Call Log supervision history attempts (Phase 1, Requirement #2)
async function getStoredCallLogs() {
  // Database is the SINGLE source of truth.
  try {
    const res = await fetch(`${API_BASE}/call-logs`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const resData = await res.json();
    return Array.isArray(resData) ? resData : (resData.data || []);
  } catch (err) {
    console.error("[Data] Failed to fetch call logs from database:", err);
    return [];
  }
}

async function saveCallLogs(logs) {
  // Database is the SINGLE source of truth.
  try {
    await fetch(`${API_BASE}/call-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(logs)
    });
  } catch (err) {
    console.error("[Data] Failed to save call logs to database:", err);
  }
}

window.CounselFlow.getCallLogs = getStoredCallLogs;
window.CounselFlow.saveCallLogs = saveCallLogs;
window.CounselFlow.getStoredPatients = getStoredPatients;
window.CounselFlow.savePatients = savePatients;
window.CounselFlow.patchPatient = patchPatient;
window.CounselFlow.deletePatient = deletePatient;
window.CounselFlow.CALL_SCENARIOS = CALL_SCENARIOS;

// Bulk delete call logs by logId list
window.CounselFlow.deleteCallLogs = async function(logIds) {
  // Database is the SINGLE source of truth.
  try {
    await fetch(`${API_BASE}/call-logs`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ logIds })
    });
  } catch (err) {
    console.error('[Data] Failed to delete call logs from database:', err);
  }
};

// 
// Role-Based Access Control (Req 8)
// 

const ROLES = {
  'counsellor': {
    label: 'Tele-Counsellor',
    emoji: '‍️',
    color: 'var(--accent-blue)',
    allowedScreens: ['dashboard', 'patients', 'call-console', 'session-history', 'analytics', 'profiles'],
    canViewPII: true,
    canDeleteTranscript: false,
    canResolveEscalation: false,
    escalationLevels: [],
    canViewAuditTrail: false,
    canExportAll: false,
    canManageProfiles: false,
    canAddPatient: false,
    canDeletePatient: false,
    canEditPatient: false,
    canExportPatients: false,
    canDispenseMeds: false,
    canManageMedicines: false,
    canCallPatients: true,
    canAddWalkIn: false,
    canBulkDeletePatients: false,
    description: 'Access to assigned district patient records and calling panel.'
  },
  'supervisor': {
    label: 'Supervisor',
    emoji: '‍',
    color: 'var(--accent-purple)',
    allowedScreens: ['dashboard', 'patients', 'clinical-workflow', 'session-history', 'analytics', 'profiles'],
    canViewPII: true,
    canDeleteTranscript: true,
    canResolveEscalation: true,
    escalationLevels: [1, 2],
    canViewAuditTrail: true,
    canExportAll: true,
    canBulkDeleteLogs: true,
    canManageProfiles: true,
    canAddPatient: true,
    canDeletePatient: false,
    canEditPatient: true,
    canExportPatients: true,
    canDispenseMeds: false,
    canManageMedicines: false,
    canCallPatients: false,
    canAddWalkIn: false,
    canBulkDeletePatients: false,
    description: 'Supervises all districts. Review summaries, resolve L1 escalations, and audit logs.'
  },
  'ddrc': {
    label: 'DDRC Clinical',
    emoji: '🩺',
    color: 'var(--accent-teal)',
    allowedScreens: ['dashboard', 'patients', 'clinical-workflow', 'session-history', 'analytics', 'profiles'],
    canViewPII: true,
    canDeleteTranscript: false,
    canRedactTranscript: false,
    canResolveEscalation: true,
    escalationLevels: [2],
    canViewAuditTrail: false,
    canExportAll: false,
    canExportDistrict: true,
    canManageProfiles: true,
    canAddPatient: true,
    canDeletePatient: false,
    canEditPatient: true,
    canExportPatients: true,
    canDispenseMeds: true,
    canManageMedicines: true,
    canCallPatients: false,
    canAddWalkIn: true,
    canBulkDeletePatients: false,
    description: 'Clinical oversight: manage inpatient detox, checkpoints, and respond to L2 escalations.'
  },
  'ditsu': {
    label: 'DITSU',
    emoji: '',
    color: 'var(--accent-orange)',
    allowedScreens: ['dashboard', 'analytics', 'settings', 'profiles'],
    canViewPII: false,
    canDeleteTranscript: false,
    canResolveEscalation: false,
    escalationLevels: [],
    canViewAuditTrail: true,
    canExportAll: false,
    canManageProfiles: false,
    canAddPatient: true,
    canDeletePatient: false,
    canEditPatient: false,
    canExportPatients: true,
    canDispenseMeds: false,
    canManageMedicines: false,
    canCallPatients: false,
    canAddWalkIn: false,
    canBulkDeletePatients: false,
    description: 'Technical & data governance: system config, audit trail, and data export.'
  },
  'spo': {
    label: 'State Programme Owner (Admin)',
    emoji: '⚙️',
    color: 'var(--accent-red)',
    allowedScreens: ['dashboard', 'patients', 'clinical-workflow', 'call-console', 'session-history', 'analytics', 'settings', 'profiles', 'opd'],
    canViewPII: true,
    canDeleteTranscript: true,
    canResolveEscalation: true,
    escalationLevels: ['L1', 'L2', 'L3'],
    canViewAuditTrail: true,
    canExportAll: true,
    canManageProfiles: true,
    canAddPatient: true,
    canDeletePatient: true,
    canEditPatient: true,
    canExportPatients: true,
    canDispenseMeds: true,
    canManageMedicines: true,
    canCallPatients: true,
    canAddWalkIn: true,
    canBulkDeletePatients: true,
    description: 'State Admin. Highest authority with full platform control, monitoring, user governance, and security configuration.'
  },
  'opd_staff': {
    label: 'OPD Medication Staff',
    emoji: '💊',
    color: 'var(--accent-green)',
    allowedScreens: ['opd'],
    canViewPII: true,
    canDeleteTranscript: false,
    canResolveEscalation: false,
    escalationLevels: [],
    canViewAuditTrail: false,
    canExportAll: false,
    canAddPatient: false,
    canDeletePatient: false,
    canEditPatient: false,
    canExportPatients: false,
    canDispenseMeds: true,
    canManageMedicines: true,
    canCallPatients: false,
    canAddWalkIn: true,
    canBulkDeletePatients: false,
    description: 'Upload and manage daily medication dispensation records for outpatients.'
  }
};

window.CounselFlow.ROLES = ROLES;

function getActiveRole() {
  const stored = safeGetItem('counseling_active_role');
  if (stored && ROLES[stored]) return stored;
  return null; // null = not yet selected
}

function setActiveRole(roleKey) {
  if (!ROLES[roleKey]) throw new Error(`Unknown role: ${roleKey}`);
  safeSetItem('counseling_active_role', roleKey);
}

// 
// Demo Login Credentials (Req 8 — Role-Based Access)
// 

const DEMO_CREDENTIALS = [];

// -------------------------
// Global Fetch Wrapper for Offline Support
// -------------------------
async function safeFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (error) {
    if (options.method && options.method !== 'GET') {
      const queue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
      queue.push({ url, options, timestamp: Date.now() });
      localStorage.setItem('offlineQueue', JSON.stringify(queue));
      showToast('Offline Mode: Action queued.', 'warning');
      return { success: true, offline: true };
    }
    throw error;
  }
}

window.addEventListener('online', async () => {
  showToast('Back online. Syncing data...', 'info');
  const queue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
  if (queue.length > 0) {
    for (const item of queue) {
      try {
        await fetch(item.url, item.options);
      } catch(e) { console.warn('Sync failed', e); }
    }
    localStorage.removeItem('offlineQueue');
    showToast('Offline actions synced successfully!', 'success');
  }
});

// ==========================================
// 3. CORE APPLICATION DATA MANAGEMENT

window.CounselFlow.DEMO_CREDENTIALS = DEMO_CREDENTIALS;

/**
 * Validates demo credentials and returns the matching role key (or null).
 * @param {string} username
 * @param {string} password
 * @returns {{ roleKey: string, name: string, staffId: string } | null}
 */
function validateDemoLogin(username, password) {
  if (!username || !password) return null;
  const match = DEMO_CREDENTIALS.find(
    c => c.username.toLowerCase() === username.trim().toLowerCase() &&
         c.password === password.trim()
  );
  return match ? { roleKey: match.roleKey, name: match.name, staffId: match.staffId } : null;
}

window.CounselFlow.validateDemoLogin = validateDemoLogin;

window.CounselFlow.getActiveRole = getActiveRole;
window.CounselFlow.setActiveRole = setActiveRole;
window.CounselFlow.getRoleConfig = (roleKey) => ROLES[roleKey] || ROLES['counsellor'];

// 
// Audit Trail — Tamper-Evident Event Log (Req 7)
// 

async function generateEventHash(eventObj) {
  const payload = JSON.stringify(eventObj);
  
  if (window.crypto && window.crypto.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(payload);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    } catch (e) {
      console.warn("crypto.subtle failed, falling back to simple hash", e);
    }
  }
  
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(2, '0').repeat(16).slice(0, 32);
}

async function getAuditTrail() {
  // Database is the SINGLE source of truth.
  try {
    const res = await fetch(`${API_BASE}/audit-trail`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const resData = await res.json();
    const data = Array.isArray(resData) ? resData : (resData.data || []);
    return data;
  } catch (err) {
    console.error("[Data] Failed to fetch audit trail from database:", err);
    return [];
  }
}

async function saveAuditTrail(events) {
  // Database is the SINGLE source of truth.
  try {
    await fetch(`${API_BASE}/audit-trail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(events)
    });
  } catch (err) {
    console.error("[Data] Failed to save audit trail to database:", err);
  }
}

async function writeAuditEvent(eventType, patientId, sessionId, actorRole, detail = '') {
  try {
    const eventObj = {
      eventId: `AUD-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      eventType,        // e.g. 'TRANSCRIPT_DELETED', 'ESCALATION_RESOLVED', 'ROLE_CHANGED'
      patientId: patientId || 'N/A',
      sessionId: sessionId || 'N/A',
      actorRole: actorRole || getActiveRole() || 'unknown',
      timestamp: new Date().toLocaleString(),
      detail: detail || '',
    };
    eventObj.hash = await generateEventHash(eventObj);
    await saveAuditTrail([eventObj]);
    return eventObj;
  } catch (e) {
    console.error('Failed to write audit event:', e);
    return null;
  }
}

window.CounselFlow.getAuditTrail = getAuditTrail;
window.CounselFlow.saveAuditTrail = saveAuditTrail;
window.CounselFlow.writeAuditEvent = writeAuditEvent;

// 
// Offline Queue — Connectivity Resilience (Req 12)
// 

function getOfflineQueue() {
  const raw = safeGetItem('counseling_offline_queue');
  if (!raw) return [];
  try {
    return JSON.parse(raw); // Queue stored as plain JSON (no encrypt needed for metadata)
  } catch (e) {
    return [];
  }
}

function saveOfflineQueue(queue) {
  try {
    safeSetItem('counseling_offline_queue', JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to save offline queue:', e);
  }
}

function queueForSync(type, payload) {
  const queue = getOfflineQueue();
  queue.push({
    queueId: `Q-${Date.now()}`,
    type,      // 'CALL_LOG' | 'PATIENT_UPDATE' | 'AUDIT_EVENT'
    payload,
    queuedAt: new Date().toLocaleString()
  });
  saveOfflineQueue(queue);
  console.info(`[OfflineQueue] Item queued (${type}). Total pending: ${queue.length}`);
}

async function flushOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let flushed = 0;
  for (const item of queue) {
    try {
      if (item.type === 'CALL_LOG' && item.payload) {
        const logs = await getStoredCallLogs();
        logs.unshift(item.payload);
        await saveCallLogs(logs);
        flushed++;
      } else if (item.type === 'PATIENT_UPDATE' && item.payload) {
        flushed++;
      } else if (item.type === 'AUDIT_EVENT' && item.payload) {
        const events = await getAuditTrail();
        events.unshift(item.payload);
        await saveAuditTrail(events);
        flushed++;
      }
    } catch (e) {
      console.error(`[OfflineQueue] Failed to flush item ${item.queueId}:`, e);
    }
  }

  saveOfflineQueue([]);
  console.info(`[OfflineQueue] Flushed ${flushed}/${queue.length} items.`);
  return flushed;
}

window.CounselFlow.getOfflineQueue = getOfflineQueue;
window.CounselFlow.saveOfflineQueue = saveOfflineQueue;
window.CounselFlow.queueForSync = queueForSync;
window.CounselFlow.flushOfflineQueue = flushOfflineQueue;
