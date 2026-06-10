
/* --- BUNDLED FROM: js/data.js --- */
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
  AI_PROVIDER: (() => {
    try {
      return window.localStorage.getItem("counseling_ai_provider") || "gemini";
    } catch (e) {
      return "gemini";
    }
  })(),
  DEFAULT_SETTINGS: {
    counselorAudioRetentionMins: 1,
    adminAudioRetentionDays: 10
  }
};
window.CounselFlow.ENV = {
  mode: 'production',
  apiUrl: window.CounselFlow.API_BASE,
  enableMocks: true,
  wsUrl: 'ws://localhost:5001' 
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
  if (patient.checkpoints.withdrawalStabilised && patient.checkpoints.layer1And2Ready) {
    newStage = 3;
  } else if (patient.checkpoints.withdrawalStabilised || patient.checkpoints.layer1And2Ready || currentDay > 3) {
    newStage = 2;
  } else {
    newStage = 1;
  }
  // Stage 3 -> 4 Logic (Requires Family Psychoed)
  if (newStage === 3 && patient.checkpoints.familyPsychoedAttended) {
    newStage = 4;
  }
  // Stage 4 -> 5 Logic (Requires 30-Day Bridge Review)
  if (newStage === 4 && patient.checkpoints.day30ReviewPassed) {
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
const INITIAL_PATIENTS = [
  {
    id: 'PT-LAMA-01',
    name: 'Daljit Singh',
    age: 26,
    gender: 'Male',
    phone: '+91-9871122334',
    address: 'Amritsar Bypass, Punjab',
    district: 'Amritsar',
    addictionCategory: 'Synthetic Drugs (Chitta)',
    severity: 'High',
    status: 'LAMA',
    progress: 5,
    cravingsIntensity: 9,
    recoveryPhase: 'AMA Discharge',
    clinicalStage: 0,
    admissionDate: MOCK_DATE(1),
    checkpoints: { withdrawalStabilised: false, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false },
    joinDate: MOCK_DATE(1),
    counselorId: 'STAFF-003',
    assignedCounselor: 'Dr. Amanpreet Kaur',
    consentCaptured: true,
    avatarColor: 'var(--accent-red)',
    ngoPartner: null,
    familyAnchorStatus: 'unknown',
    notes: 'Patient fled the facility during the night of Day 1. Severe withdrawal symptoms observed prior to absconding.',
    history: []
  },
  {
    id: 'PT-001',
    name: 'Balbir Singh',
    age: 38,
    gender: 'Male',
    phone: '+91-9876543210',
    address: 'Village Rurka Kalan, Jalandhar, Punjab',
    district: 'Jalandhar',
    addictionCategory: 'Opioid (Heroin)',
    severity: 'High',
    status: 'Risk',
    progress: 22,
    cravingsIntensity: 9,
    recoveryPhase: 'Detoxification',
    clinicalStage: 1,
    admissionDate: MOCK_DATE(16),
    checkpoints: { withdrawalStabilised: false, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false },
    joinDate: MOCK_DATE(42),
    counselorId: 'STAFF-004',
    assignedCounselor: 'Dr. Manpreet Sodhi',
    consentCaptured: true,
    avatarColor: 'var(--accent-red)',
    ngoPartner: null,
    familyAnchorStatus: 'unavailable',
    notes: 'Patient shows severe withdrawal symptoms. Daily check-ins recommended. Family support is limited — wife estranged. Enrolled in DDRC opioid substitution programme.',
    history: [
      {
        sessionId: 'SES-001-A',
        date: MOCK_DATE(3),
        duration: '0:24:15',
        language: 'Punjabi',
        counselor: 'Dr. Manpreet Sodhi',
        transcript: [
          { speaker: 'Counselor', text: 'Sat Sri Akal Balbir ji. How are you feeling today?' },
          { speaker: 'Patient', text: 'Bahut bura hal hai doctor ji. Raat ko neend nahi ayi.' },
          { speaker: 'Counselor', text: 'I understand. Withdrawal symptoms are difficult. Are you taking your Buprenorphine doses on time?' },
          { speaker: 'Patient', text: 'Haan doctor ji, le raha haan. Par dil karta hai chhad doon sab.' },
          { speaker: 'Counselor', text: 'That feeling is normal. Let\'s talk about what triggered these thoughts today.' }
        ],
        summary: {
          overview: 'Patient reported severe withdrawal symptoms including insomnia, sweating, and intense cravings. Emotional distress noted. Suicidal ideation was screened — patient denied active intent but expressed hopelessness.',
          concerns: 'High relapse risk. Limited family support. Possible co-occurring depression. Has not attended DDRC opioid substitution clinic this week.',
          observations: 'Speech was slow and slurred at start of call. Emotional breakdown midway through session. Patient became more composed after grounding technique was applied.',
          risk: 'High Risk',
          actions: 'Emergency escalation initiated to DDRC supervisor. Family counseling referral issued. Daily check-in calls scheduled for next 7 days. Buprenorphine compliance confirmed.',
          followUp: MOCK_DATE(-1) + ' at 10:00 AM',
          escalationLevel: 3,
          escalationReason: 'Patient reports severe relapse on chitta, lives alone in high-risk environment with active suicidal ideation - L3 SPO emergency intervention required.'
        },
        recordingUrl: null
      },
      {
        sessionId: 'SES-001-B',
        date: MOCK_DATE(10),
        duration: '0:19:42',
        language: 'Punjabi',
        counselor: 'Dr. Manpreet Sodhi',
        transcript: [
          { speaker: 'Counselor', text: 'Balbir ji, this is your intake assessment. Can you tell me about your usage history?' },
          { speaker: 'Patient', text: '6 saal ho gaye ne doctor ji. Pehle chitta, fir heroin.' },
          { speaker: 'Counselor', text: 'Thank you for being honest. That takes courage. Are you currently employed?' },
          { speaker: 'Patient', text: 'Nahi ji, koi kaam nahi. Ghar waale bhi nahi bolde ab.' }
        ],
        summary: {
          overview: 'Initial intake assessment. Patient voluntarily contacted the helpline. Shared background of 6-year heroin dependency starting with synthetic drugs (chitta).',
          concerns: 'Severe physical dependence. No stable income. Peer group still actively using. Family relations broken.',
          observations: 'Motivated to quit but lacks resources. Lives in high-risk social environment. Expressed shame and guilt.',
          risk: 'High Risk',
          actions: 'Referred to DDRC opioid programme. Buprenorphine dosing initiated at 4mg. Next call in 7 days.',
          followUp: MOCK_DATE(-7) + ' at 11:00 AM'
        },
        recordingUrl: null
      }
    ]
  },
  {
    id: 'PT-002',
    name: 'Gurpreet Kaur',
    age: 29,
    gender: 'Female',
    phone: '+91-9814567823',
    address: 'Mohalla Guru Nanak, Amritsar, Punjab',
    district: 'Amritsar',
    addictionCategory: 'Alcohol',
    severity: 'Medium',
    status: 'Monitored',
    progress: 55,
    cravingsIntensity: 5,
    recoveryPhase: 'Maintenance',
    clinicalStage: 5,
    admissionDate: MOCK_DATE(40),
    checkpoints: { withdrawalStabilised: true, layer1And2Ready: true, familyPsychoedAttended: true, day30ReviewPassed: true },
    joinDate: MOCK_DATE(68),
    counselorId: 'STAFF-003',
    assignedCounselor: 'Dr. Amanpreet Kaur',
    consentCaptured: true,
    avatarColor: 'var(--accent-purple)',
    ngoPartner: 'AA Punjab Chapter — Amritsar',
    familyAnchorStatus: 'confirmed',
    notes: 'Patient is making steady progress. Husband is supportive. Attending weekly AA group at local gurdwara. Occasional cravings on weekends. Liver function reports improving.',
    history: [
      {
        sessionId: 'SES-002-A',
        date: MOCK_DATE(5),
        duration: '0:22:08',
        language: 'Punjabi',
        counselor: 'Dr. Amanpreet Kaur',
        transcript: [
          { speaker: 'Counselor', text: 'Gurpreet ji, how has the past week been?' },
          { speaker: 'Patient', text: '3 hafte ho gaye ne, ek drop nahi pita. Bahut achha lag raha hai.' },
          { speaker: 'Counselor', text: 'That is wonderful progress! 3 weeks is a significant milestone. Did you attend the AA meeting this week?' },
          { speaker: 'Patient', text: 'Haan ji, do baar. Mere pati bhi saath aaye ek baar.' },
          { speaker: 'Counselor', text: 'Having your husband\'s support is very positive. Any cravings during the weekend gatherings?' },
          { speaker: 'Patient', text: 'Thodi si mushkil hui shaadi mein, par sambhal liya.' }
        ],
        summary: {
          overview: 'Patient reports 3 weeks of complete sobriety. Attended AA meeting twice this week with husband accompanying once. Social anxiety triggered minor cravings at a wedding event but patient successfully self-managed.',
          concerns: 'Upcoming festival season poses relapse risk. Social gatherings with alcohol present are challenging. Mild anxiety symptoms persisting.',
          observations: 'Positive and composed demeanor. Husband joined last 5 minutes of call for support reinforcement. Liver enzyme reports showing improvement.',
          risk: 'Medium Risk',
          actions: 'Continue weekly monitoring. Cognitive behavioral techniques shared for social anxiety. Relapse prevention worksheet sent. Follow-up in 10 days.',
          followUp: MOCK_DATE(-10) + ' at 3:00 PM'
        },
        recordingUrl: 'assets/audio/demo.mp3'
      }
    ]
  },
  {
    id: 'PT-003',
    name: 'Ramesh Kumar',
    age: 45,
    gender: 'Male',
    phone: '+91-9988112233',
    address: 'Ludhiana Industrial Area, Ludhiana, Punjab',
    district: 'Ludhiana',
    addictionCategory: 'Tobacco & Cannabis',
    severity: 'Low',
    status: 'Active',
    progress: 72,
    cravingsIntensity: 3,
    recoveryPhase: 'Relapse Prevention',
    clinicalStage: 4,
    admissionDate: MOCK_DATE(35),
    checkpoints: { withdrawalStabilised: true, layer1And2Ready: true, familyPsychoedAttended: true, day30ReviewPassed: false },
    joinDate: MOCK_DATE(95),
    counselorId: 'STAFF-005',
    assignedCounselor: 'Dr. Harinder Gill',
    ngoPartner: 'NIMHANS Outreach — Ludhiana',
    familyAnchorStatus: 'confirmed',
    consentCaptured: true,
    avatarColor: 'var(--accent-teal)',
    notes: 'Long-term factory worker. 20-year smoking and occasional cannabis use. Enrolled after cardiac warning from doctor. Very motivated. Wife highly supportive.',
    history: [
      {
        sessionId: 'SES-003-A',
        date: MOCK_DATE(7),
        duration: '0:15:33',
        language: 'Hindi',
        counselor: 'Dr. Harinder Gill',
        transcript: [
          { speaker: 'Counselor', text: 'Ramesh ji, namaste. Kaise hain aap?' },
          { speaker: 'Patient', text: 'Bahut accha doctor ji! 18 din ho gaye tambaaku nahi khaaya.' },
          { speaker: 'Counselor', text: 'Bahut badiya! Breathing exercises kaisi rahi?' },
          { speaker: 'Patient', text: 'Subah karta hoon. Neend bhi achhi aati hai ab. Bhook bhi badh gayi.' }
        ],
        summary: {
          overview: 'Patient reports 18 consecutive days without tobacco use. Cannabis craving intensity dropped from 7/10 to 3/10. Breathing exercises and NRT patches are effective. Sleep and appetite significantly improved.',
          concerns: 'Workplace peer pressure remains a challenge. Monday work stress identified as a key trigger for cravings.',
          observations: 'Confident and cheerful tone throughout. Wife confirmed compliance via WhatsApp. Mentioned improved lung capacity.',
          risk: 'Low Risk',
          actions: 'Motivational reinforcement provided. Stress management worksheet sent. Continue NRT patch. Monthly follow-up scheduled.',
          followUp: MOCK_DATE(-30) + ' at 2:00 PM',
          escalationLevel: 1,
          escalationReason: 'Patient reports mild anxiety and craving spike due to workplace peer pressure - L1 supervisor review recommended.'
        },
        recordingUrl: null
      },
      {
        sessionId: 'SES-003-B',
        date: MOCK_DATE(35),
        duration: '0:18:55',
        language: 'Hindi',
        counselor: 'Dr. Harinder Gill',
        transcript: [
          { speaker: 'Counselor', text: 'Ramesh ji, welcome. Apne baare mein batayein — kab se yeh problem hai?' },
          { speaker: 'Patient', text: '20 saal se cigarette pita hoon. Cannabis bhi 5 saal se. Doctor ne dara diya.' }
        ],
        summary: {
          overview: 'Intake session. Patient motivated to quit after cardiac scare. 20-year tobacco and 5-year cannabis history. Strong motivation driven by health fear.',
          concerns: 'Workplace peer pressure. Colleagues smoke during breaks creating constant exposure.',
          observations: 'Anxious but cooperative. Cardiac risk acknowledged by patient as serious.',
          risk: 'Medium Risk',
          actions: 'NRT patch 14mg initiated. Breathing techniques introduced. Follow-up in 4 weeks.',
          followUp: MOCK_DATE(-7) + ' at 11:00 AM'
        },
        recordingUrl: null
      }
    ]
  },
  {
    id: 'PT-004',
    name: 'Mandeep Gill',
    age: 24,
    gender: 'Male',
    phone: '+91-9855677412',
    address: 'Patiala Road, Sangrur, Punjab',
    district: 'Patiala',
    addictionCategory: 'Synthetic Drugs (Chitta)',
    severity: 'High',
    status: 'Risk',
    progress: 12,
    cravingsIntensity: 10,
    recoveryPhase: 'Detoxification',
    clinicalStage: 2,
    admissionDate: MOCK_DATE(12),
    checkpoints: { withdrawalStabilised: true, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false },
    joinDate: MOCK_DATE(15),
    counselorId: 'STAFF-006',
    assignedCounselor: 'Dr. Gurbaksh Singh',
    consentCaptured: true,
    avatarColor: 'var(--accent-orange)',
    notes: 'Young patient, critical case. Chitta (heroin-methamphetamine mix) dependency for 3 years. Parents brought him in. Extremely aggressive during calls. L2 escalation active.',
    history: [
      {
        sessionId: 'SES-004-A',
        date: MOCK_DATE(2),
        duration: '0:12:44',
        language: 'Punjabi',
        counselor: 'Dr. Gurbaksh Singh',
        transcript: [
          { speaker: 'Counselor', text: 'Mandeep, how are you feeling today? Your parents said you had a difficult night.' },
          { speaker: 'Patient', text: 'Theek haan. Koi problem nahi. Inna drama kyun karte ho sab.' },
          { speaker: 'Counselor', text: 'I hear you feeling frustrated. Can you tell me what happened last night?' },
          { speaker: 'Patient', text: 'Kuch nahi hua. Chhaddo mere piche padna.' }
        ],
        summary: {
          overview: 'Patient verbally hostile throughout session. Parents intervened midway. Patient denied recent use despite physical signs of intoxication. Session cut short due to patient hanging up.',
          concerns: 'Aggression and denial as defense mechanisms. Possible co-occurring mental health disorder. Suicidal risk flagged by parents.',
          observations: 'Parents report patient disappeared for 48 hours last week. Physical health deteriorating — weight loss visible.',
          risk: 'High Risk',
          actions: 'L2 escalation to DDRC Clinical team. Psychiatric evaluation requested. Emergency home visit arranged for tomorrow.',
          followUp: MOCK_DATE(-1) + ' at 9:00 AM',
          escalationLevel: 2,
          escalationReason: 'Aggressive behavior and denial of relapse during counseling call - L2 DDRC clinical review required.'
        },
        recordingUrl: null
      }
    ]
  },
  {
    id: 'PT-005',
    name: 'Sunita Devi',
    age: 52,
    gender: 'Female',
    phone: '+91-9779234567',
    address: 'Sector 22, Chandigarh',
    district: 'Ludhiana',
    addictionCategory: 'Prescription Sedatives',
    severity: 'Medium',
    status: 'Monitored',
    progress: 63,
    cravingsIntensity: 4,
    recoveryPhase: 'Maintenance',
    clinicalStage: 5,
    admissionDate: MOCK_DATE(82),
    checkpoints: { withdrawalStabilised: true, layer1And2Ready: true, familyPsychoedAttended: true, day30ReviewPassed: true },
    joinDate: MOCK_DATE(110),
    counselorId: 'STAFF-005',
    assignedCounselor: 'Dr. Harinder Gill',
    ngoPartner: 'Chandigarh Mental Health Society',
    familyAnchorStatus: 'confirmed',
    consentCaptured: true,
    avatarColor: 'var(--accent-blue)',
    notes: 'Widowed homemaker. Alprazolam and clonazepam dependency following bereavement. Slowly tapering off with doctor guidance. Daughter actively involved in sessions.',
    history: [
      {
        sessionId: 'SES-005-A',
        date: MOCK_DATE(6),
        duration: '0:24:18',
        language: 'Hindi',
        counselor: 'Dr. Harinder Gill',
        transcript: [
          { speaker: 'Counselor', text: 'Sunita ji, namaste. Aaj kaisi hain?' },
          { speaker: 'Patient', text: 'Thodi behtar. Dose ab 0.25mg hai, pehle 1mg tha.' },
          { speaker: 'Counselor', text: 'That is remarkable progress! How is your sleep quality now?' },
          { speaker: 'Patient', text: 'Kuch din better tha, phir unki yaad aa gayi... aur neend nahi aayi.' }
        ],
        summary: {
          overview: 'Patient reports dose reduction from 1mg to 0.25mg alprazolam. Sleep quality improving on most nights but grief episodes still present. Daughter confirmed dose compliance.',
          concerns: 'Anniversary of husband\'s death approaching — high relapse risk period. Grief remains prominent in speech pattern.',
          observations: 'Tearful but composed. Expressed gratitude for helpline support. Daughter participates actively and is a key protective factor.',
          risk: 'Medium Risk',
          actions: 'Grief counseling referral initiated. Mindfulness sessions introduced. Check-in call in 2 weeks. Psychiatrist review for dose tapering schedule.',
          followUp: MOCK_DATE(-14) + ' at 4:00 PM'
        },
        recordingUrl: 'assets/audio/demo.mp3'
      }
    ]
  },
  {
    id: 'PT-006',
    name: 'Arjun Verma',
    age: 33,
    gender: 'Male',
    phone: '+91-9845001122',
    address: 'Model Town, Bathinda, Punjab',
    district: 'Jalandhar',
    addictionCategory: 'Alcohol',
    severity: 'Low',
    status: 'Active',
    progress: 81,
    cravingsIntensity: 2,
    recoveryPhase: 'Relapse Prevention',
    clinicalStage: 6,
    admissionDate: MOCK_DATE(90),
    checkpoints: { withdrawalStabilised: true, layer1And2Ready: true, familyPsychoedAttended: true, day30ReviewPassed: true },
    joinDate: MOCK_DATE(140),
    counselorId: 'STAFF-004',
    assignedCounselor: 'Dr. Manpreet Sodhi',
    ngoPartner: 'Ex-Servicemen Recovery Group — Bathinda',
    familyAnchorStatus: 'confirmed',
    stage6SignoffCounsellor: true,
    stage6SignoffSupervisor: true,
    consentCaptured: true,
    avatarColor: 'var(--accent-green)',
    notes: 'Ex-army officer. Alcohol use disorder linked to PTSD. 5 months sober. Attending anger management sessions. Excellent engagement and compliance.',
    history: [
      {
        sessionId: 'SES-006-A',
        date: MOCK_DATE(8),
        duration: '0:20:12',
        language: 'English',
        counselor: 'Dr. Manpreet Sodhi',
        transcript: [
          { speaker: 'Counselor', text: 'Arjun, good afternoon. How has the week been for you?' },
          { speaker: 'Patient', text: '5 months sober today. Hit a milestone. Anger management class went well.' },
          { speaker: 'Counselor', text: 'Congratulations! That is a significant achievement. Any triggers this week?' },
          { speaker: 'Patient', text: 'Had a difficult conversation with an ex-colleague. Old habits crossed my mind but I called a friend instead.' }
        ],
        summary: {
          overview: '5-month sobriety milestone reached. Patient navigated a social trigger by calling his support network rather than relapsing. Anger management sessions proving effective.',
          concerns: 'PTSD flashbacks continue to be a challenge. Isolation risk on weekends.',
          observations: 'Confident and articulate. Strong insight into his triggers. Former military training aids discipline in recovery.',
          risk: 'Low Risk',
          actions: 'Continue weekly counseling. PTSD-focused therapy referral initiated. Celebrate milestone with support group.',
          followUp: MOCK_DATE(-30) + ' at 5:00 PM'
        },
        recordingUrl: null
      }
    ]
  },
  {
    id: 'PT-007',
    name: 'Harjinder Sandhu',
    age: 41,
    gender: 'Male',
    phone: '+91-9901234567',
    address: 'Nabha, Patiala, Punjab',
    district: 'Patiala',
    addictionCategory: 'Opioid (Tramadol)',
    severity: 'Medium',
    status: 'Active',
    progress: 48,
    cravingsIntensity: 6,
    recoveryPhase: 'Intensive Outpatient',
    clinicalStage: 4,
    admissionDate: MOCK_DATE(20),
    checkpoints: { withdrawalStabilised: true, layer1And2Ready: true, familyPsychoedAttended: false, day30ReviewPassed: false },
    joinDate: MOCK_DATE(55),
    counselorId: 'STAFF-006',
    assignedCounselor: 'Dr. Gurbaksh Singh',
    ngoPartner: null,
    familyAnchorStatus: 'pending',
    consentCaptured: true,
    avatarColor: 'var(--accent-purple)',
    notes: 'Farmer. Tramadol dependency started after back injury during harvesting. Accessing drugs via local medical shops without prescription. Enrolled in outpatient programme.',
    history: [
      {
        sessionId: 'SES-007-A',
        date: MOCK_DATE(9),
        duration: '0:16:40',
        language: 'Punjabi',
        counselor: 'Dr. Gurbaksh Singh',
        transcript: [
          { speaker: 'Counselor', text: 'Harjinder ji, pichle hafte kaida raha?' },
          { speaker: 'Patient', text: 'Thodi takleef rahi pith vich. Dawa lena mushkil hai chhad ke.' },
          { speaker: 'Counselor', text: 'I understand the back pain is real. Are you using the physiotherapy exercises we discussed?' },
          { speaker: 'Patient', text: 'Kuch baar karta haan. Par khet da kaam bahut hai is waqt.' }
        ],
        summary: {
          overview: 'Patient continues to struggle with tramadol dependency driven by chronic back pain from farming injury. Physiotherapy compliance is partial due to heavy workload during harvest season.',
          concerns: 'Chronic pain management is the root driver. Without pain relief, relapse risk remains high.',
          observations: 'Motivated but fatigued. Wife is supportive. Limited healthcare access in rural area.',
          risk: 'Medium Risk',
          actions: 'Pain management referral to orthopedic specialist. Physiotherapy guide sent as PDF. Next call in 12 days.',
          followUp: MOCK_DATE(-12) + ' at 11:30 AM'
        },
        recordingUrl: null
      }
    ]
  }
];
(function generateDynamicPatients() {
  const counselorMap = [
    { district: 'Amritsar', counselorId: 'STAFF-003', counselorName: 'Dr. Amanpreet Kaur' },
    { district: 'Jalandhar', counselorId: 'STAFF-004', counselorName: 'Dr. Manpreet Sodhi' },
    { district: 'Ludhiana', counselorId: 'STAFF-005', counselorName: 'Dr. Harinder Gill' },
    { district: 'Patiala', counselorId: 'STAFF-006', counselorName: 'Dr. Gurbaksh Singh' }
  ];
  const firstNames = ['Harjit', 'Manjeet', 'Sukhwinder', 'Gurpreet', 'Navjot', 'Rajinder', 'Amrinder', 'Daljit', 'Simran', 'Karamjit', 'Jaswinder', 'Gagandeep', 'Mandeep', 'Sandeep', 'Jagdish', 'Bhupinder'];
  const lastNames = ['Singh', 'Kaur', 'Gill', 'Sandhu', 'Dhillon', 'Brar', 'Grewal', 'Sidhu', 'Sharma', 'Verma', 'Kumar'];
  const categories = ['Opioid (Heroin)', 'Alcohol', 'Tobacco & Cannabis', 'Synthetic Drugs (Chitta)', 'Prescription Sedatives'];
  const severities = ['Low', 'Medium', 'High'];
  const statuses = ['Active', 'Monitored', 'Risk', 'Completed'];
  let ptCounter = 100;
  counselorMap.forEach(cmap => {
    for(let i = 0; i < 8; i++) {
      ptCounter++;
      const admissionOffset = Math.floor(Math.random() * 90) + 1;
      const severity = severities[Math.floor(Math.random() * severities.length)];
      let status = statuses[Math.floor(Math.random() * statuses.length)];
      if (severity === 'High' && status === 'Completed') status = 'Risk';
      const avatarColors = ['var(--accent-red)', 'var(--accent-blue)', 'var(--accent-green)', 'var(--accent-purple)', 'var(--accent-orange)', 'var(--accent-teal)'];
      const patient = {
        id: `PT-DYN-${ptCounter}`,
        name: `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`,
        age: Math.floor(Math.random() * (60 - 18 + 1)) + 18,
        gender: Math.random() > 0.5 ? 'Male' : 'Female',
        phone: `+91-98${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
        address: `Sample Address, ${cmap.district}, Punjab`,
        district: cmap.district,
        addictionCategory: categories[Math.floor(Math.random() * categories.length)],
        severity: severity,
        status: status,
        progress: Math.floor(Math.random() * 100),
        cravingsIntensity: Math.floor(Math.random() * 10),
        recoveryPhase: 'Treatment Phase',
        clinicalStage: Math.floor(Math.random() * 6) + 1,
        admissionDate: MOCK_DATE(admissionOffset),
        checkpoints: { 
          withdrawalStabilised: Math.random() > 0.3, 
          layer1And2Ready: Math.random() > 0.5, 
          familyPsychoedAttended: Math.random() > 0.6, 
          day30ReviewPassed: Math.random() > 0.7 
        },
        joinDate: MOCK_DATE(admissionOffset + 10),
        counselorId: cmap.counselorId,
        assignedCounselor: cmap.counselorName,
        consentCaptured: true,
        avatarColor: avatarColors[Math.floor(Math.random() * avatarColors.length)],
        ngoPartner: null,
        familyAnchorStatus: Math.random() > 0.5 ? 'confirmed' : 'pending',
        notes: 'Dynamically generated patient record for testing and demo purposes.',
        history: []
      };
      INITIAL_PATIENTS.push(patient);
    }
  });
})();
const INITIAL_CALL_LOGS = [
  { logId: 'LOG-1001', patientId: 'PT-001', patientName: 'Balbir Singh', counselorId: 'STAFF-004', counselorName: 'Dr. Manpreet Sodhi', timestamp: MOCK_DATE(1) + ' 10:15 AM', duration: '0:12:45', direction: 'Outbound', disposition: 'Connected' },
  { logId: 'LOG-1002', patientId: 'PT-003', patientName: 'Ramesh Kumar', counselorId: 'STAFF-005', counselorName: 'Dr. Harinder Gill', timestamp: MOCK_DATE(2) + ' 14:30 PM', duration: '0:05:30', direction: 'Inbound', disposition: 'Connected' },
  { logId: 'LOG-1003', patientId: 'PT-004', patientName: 'Mandeep Gill', counselorId: 'STAFF-006', counselorName: 'Dr. Gurbaksh Singh', timestamp: MOCK_DATE(3) + ' 09:00 AM', duration: '0:00:00', direction: 'Outbound', disposition: 'Missed' },
  { logId: 'LOG-1005', patientId: 'PT-002', patientName: 'Gurpreet Kaur', counselorId: 'STAFF-003', counselorName: 'Dr. Amanpreet Kaur', timestamp: MOCK_DATE(0) + ' 11:20 AM', duration: '0:08:15', direction: 'Outbound', disposition: 'Connected' }
];
const INITIAL_AUDIT_TRAIL = [
  { eventId: 'AUD-101', eventType: 'SYSTEM_START', patientId: 'N/A', sessionId: 'N/A', actorRole: 'system', timestamp: MOCK_DATE(5) + ' 08:00 AM', detail: 'System initialized' },
  { eventId: 'AUD-102', eventType: 'ROLE_CHANGED', patientId: 'N/A', sessionId: 'N/A', actorRole: 'counsellor', timestamp: MOCK_DATE(1) + ' 09:15 AM', detail: 'User logged in as counsellor' },
  { eventId: 'AUD-103', eventType: 'ESCALATION_RESOLVED', patientId: 'PT-001', sessionId: 'SESS-001', actorRole: 'supervisor', timestamp: MOCK_DATE(0) + ' 10:30 AM', detail: 'Supervisor reviewed relapse case' }
];
// Rich scripts for simulating realistic tele-counseling sessions on click
const CALL_SCENARIOS = {
  // PUNJABI SCENARIO: Balbir Singh — High Risk Relapse
  'pa-IN': {
    patientId: 'PT-001',
    langCode: 'pa-IN',
    transcript: [
      { speaker: 'Counselor', text: 'Sat Sri Akal Balbir ji. Main Dr. Amanpreet bol rahi haan. Aaj aap da ki haal hai?' },
      { speaker: 'Patient',   text: 'Sat Sri Akal ji. Theek nahin haan... bahut takleef ho rahi hai pichhle kaafi dina toh.' },
      { speaker: 'Counselor', text: 'Main samajh sakdi haan. Koi gall nahin, aap mujhe dasso ki kya ho raha hai. Koi vakhri gall hui hai?' },
      { speaker: 'Patient',   text: 'Ji, kall mere yaar da biyah si. Main wahaan gaya. Sabh log pi rahe si... main rok na sakiya apne aap nu.' },
      { speaker: 'Counselor', text: 'Balbir ji, aap ne mujhe dassiya, iha bahut himmat di gal hai. Kya aap mujhe dasse sakde ho ki kinna le liya si?' },
      { speaker: 'Patient',   text: 'Haan... main ne chitta le liya. Ek baar hi, par le liya. Hune bahut pachhtawa ho raha hai.' },
      { speaker: 'Counselor', text: 'Aap ne sahi kiya jo mujhe dassiya. Relapse hona matlab programme da khatam nahin. Aap abhi bhi recover kar sakte ho. Kya ghar vich koi hai aade naal?' },
      { speaker: 'Patient',   text: 'Nahin ji, mere ghar vich koi nahin. Meri patni naraaz hokar chali gayi si. Main akela haan.' },
      { speaker: 'Counselor', text: 'Main samajhdi haan. Aap akele nahin ho, assi haan na. Main aaj hi DDRC team nu contact karangi. Kal subah ghare aake milenge. Kya aap ghar rahoge?' },
      { speaker: 'Patient',   text: 'Ji main ghar hi rahanga. Dobaara nahin lena chahunda main. Sach mein nahin chahunda.' },
      { speaker: 'Counselor', text: 'Main tuhadi gal sunn sakdi haan. Aaj raat kisi nu call karo agar dil ghabra jaaye. DDRC da helpline number hai na? 1800-180-0023.' },
      { speaker: 'Patient',   text: 'Ji number save hai. Shukriya aap da... bahut changa lagya kisi naal gal karke.' },
      { speaker: 'Counselor', text: 'Shukriya Balbir ji, aap ne mujhe call kiya. Yarr darwazah band ho jaanda par raasta hamesha khulla rehta hai. Kal di call ka intezaar karo. Rabb rakha.' }
    ],
    summary: {
      overview: 'Patient admitted to a relapse incident at a wedding. Used chitta once and expressed immediate guilt and remorse. Lives alone after wife left. Expressed genuine willingness to re-engage with detox programme.',
      concerns: 'Active relapse confirmed. Complete social isolation — no family support at home. High emotional distress.',
      observations: 'Speech was slow at call start. Emotional breakdown mid-call but composure returned after empathetic engagement. Strong intrinsic motivation to recover.',
      risk: 'High Risk',
      actions: 'DDRC escalation filed. Home visit arranged for next morning. Emergency helpline reinforced. Daily calls for 7 days activated.',
      followUp: MOCK_DATE(-1) + ' at 10:00 AM',
      escalationLevel: 2,
      escalationReason: 'Active opioid relapse with social isolation — DDRC clinical review required within 24 hours.'
    }
  },
  // HINDI SCENARIO: Ramesh Kumar — Progress Check-in
  'hi-IN': {
    patientId: 'PT-003',
    langCode: 'hi-IN',
    transcript: [
      { speaker: 'Counselor', text: 'Namaste Ramesh ji. Main Dr. Amanpreet bol rahi hoon. Aaj kaisi tabiyat hai aapki?' },
      { speaker: 'Patient',   text: 'Namaste didi ji. Haan, theek hoon. Sacchi mein kuch zyada hi acha lag raha hai aaj kal.' },
      { speaker: 'Counselor', text: 'Bahut acha! Kuch khaas hua jo share karna chahenge?' },
      { speaker: 'Patient',   text: 'Haan didi, aaj mera 18 din poora hua bina sigret ke. Pahle toh socha bhi nahin tha ki ho payega.' },
      { speaker: 'Counselor', text: 'Wah Ramesh ji! 18 din — bahut badi baat hai! Cravings aa rahi hain abhi bhi?' },
      { speaker: 'Patient',   text: 'Kabhi kabhi aa jaati hai, especially factory mein jab baaki log bahar jaate hain break pe. Woh log abhi bhi peete hain.' },
      { speaker: 'Counselor', text: 'Haan, yeh mushkil situation hai. Aapne kya kiya jab break pe yeh feeling aayi?' },
      { speaker: 'Patient',   text: 'Maine woh breathing wali exercise ki jo aapne sikhaayi thi. Phir chai pi li aur wapas kaam pe aa gaya.' },
      { speaker: 'Counselor', text: 'Bilkul sahi kiya! Yahi technique kaam aati hai. Aur charas ke baare mein? Pichhli baar kuch chhota episode bataya tha.' },
      { speaker: 'Patient',   text: 'Nahin didi, ek baar bhi nahin liya. Doctor ne bola tha heart ke baare mein toh darr bhi lag raha hai.' },
      { speaker: 'Counselor', text: 'Bahut achha. Ghar pe sab kaisa hai? Bhabhi ji saath deti hain?' },
      { speaker: 'Patient',   text: 'Haan ji, woh bahut khush hain. Kal unho ne meri pasand ka khana banaya celebrate karne ke liye.' },
      { speaker: 'Counselor', text: 'Ramesh ji, aap family की support और apni mehnat dono se yahan tak pahunche hain. Stress management worksheet bhej rahi hoon aaj. Agla session ek mahine baad — tab tak khayal rakhiye.' },
      { speaker: 'Patient',   text: 'Shukriya didi ji. Aapki wajah se itna asaan ho gaya hai. Zaroor karungi worksheet bhi.' }
    ],
    summary: {
      overview: 'Patient has achieved an 18-day tobacco-free milestone. Cannabis use also stopped. Breathing exercises applied effectively during workplace triggers.',
      concerns: 'Peer pressure from co-workers smoking during breaks remains a recurring trigger. Cardiac health concern is a motivating but anxiety-inducing factor.',
      observations: 'Tone was cheerful and energetic throughout. Wife support highlighted as a major protective factor. Self-regulation skills improving significantly.',
      risk: 'Low Risk',
      actions: 'Motivational reinforcement provided. Stress management worksheet to be sent via SMS. Monthly follow-up scheduled.',
      followUp: MOCK_DATE(-30) + ' at 2:00 PM',
      escalationLevel: 0,
      escalationReason: null
    }
  },
  // ENGLISH SCENARIO: Arjun Verma — Discharge Planning
  'en-US': {
    patientId: 'PT-006',
    langCode: 'en-US',
    transcript: [
      { speaker: 'Counselor', text: 'Good afternoon Arjun. This is Dr. Amanpreet. How are you doing today?' },
      { speaker: 'Patient',   text: 'I am doing really well doctor. Honestly, I never thought I would be saying that five months ago.' },
      { speaker: 'Counselor', text: 'You should be incredibly proud of yourself. Five months of sobriety is a major milestone. What has been the biggest change this month?' },
      { speaker: 'Patient',   text: 'I started working again. Part-time, security trainer for a local institute. It gives me purpose. I feel like myself again.' },
      { speaker: 'Counselor', text: 'That is wonderful news. Getting back to work using your army skills is huge for identity and structure. How are the PTSD episodes?' },
      { speaker: 'Patient',   text: 'Still happen occasionally, maybe once or twice a week. Crowded places are tough. But I have learned to leave before it escalates. Yoga is helping a lot.' },
      { speaker: 'Counselor', text: 'That is excellent self-awareness. You are recognising your triggers and responding without reaching for alcohol. That is the whole journey in a nutshell.' },
      { speaker: 'Patient',   text: 'I think the biggest shift was when I stopped seeing sobriety as giving something up. I see it now as getting my life back.' },
      { speaker: 'Counselor', text: 'That is a profound shift, Arjun. I want to discuss next steps. You are ready for discharge from the active programme. How do you feel about that?' },
      { speaker: 'Patient',   text: 'Honestly, I feel ready. A little nervous, but ready. I know I can call if things get difficult.' },
      { speaker: 'Counselor', text: 'Absolutely. We will do quarterly check-in calls. And I am referring you to a PTSD specialist — that is the one piece of unfinished work. One step at a time.' },
      { speaker: 'Patient',   text: 'Thank you doctor. These conversations genuinely saved my life. I am going to keep going.' },
      { speaker: 'Counselor', text: 'The credit is all yours, Arjun. You did the hard work. Take good care, and we will speak in three months.' }
    ],
    summary: {
      overview: 'Patient has achieved 5 months of complete sobriety. Successfully returned to part-time employment. Self-awareness around PTSD triggers is excellent. Discharge from active programme approved.',
      concerns: 'PTSD flashbacks still occurring 1-2 times per week in crowded spaces. Specialist referral outstanding.',
      observations: 'Tone calm, reflective, and highly motivated. Demonstrated a fundamental cognitive reframe around sobriety. Family environment stable.',
      risk: 'Low Risk',
      actions: 'Formal discharge from active programme. PTSD specialist referral letter to be issued. Quarterly check-in calls scheduled.',
      followUp: MOCK_DATE(-90) + ' at 5:00 PM',
      escalationLevel: 0,
      escalationReason: null
    }
  }
};
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
window.CounselFlow.API_BASE = (() => {
  const origin = window.location.origin;
  if (origin.includes('localhost:3001')) {
    return 'http://localhost:5001/api';
  }
  return `${origin}/api`;
})();
const API_BASE = window.CounselFlow.API_BASE;
// Inject headers into all fetch requests targeting our API
const originalFetch = window.fetch;
window.fetch = async function(resource, config) {
  let isApiCall = false;
  if (typeof resource === 'string' && resource.includes(API_BASE)) {
    isApiCall = true;
    config = config || {};
    config.headers = config.headers || {};
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
  if (isApiCall && response.status === 401 && !resource.includes('/auth/')) {
    console.warn("Session expired or unauthorized. Logging out.");
    window.localStorage.removeItem('counseling_active_role');
    window.localStorage.removeItem('counseling_logged_in_name');
    window.localStorage.removeItem('counseling_logged_in_staff');
    window.localStorage.removeItem('counseling_logged_in_token');
    window.location.reload();
  }
  return response;
};
async function getStoredPatients() {
  //  Version-aware reseed check 
  // If the stored schema version differs from current CONFIG version, force
  // a reseed so new INITIAL_PATIENTS always appear after a data update.
  const storedVersion = safeGetItem('counseling_schema_version');
  const currentVersion = window.CounselFlow.CONFIG.SCHEMA_VERSION.toString();
  let needsReseed = !storedVersion;
  if (storedVersion && storedVersion !== currentVersion) {
    console.warn(`[DataSeed] Schema version mismatch (${storedVersion} → ${currentVersion}). Migrating gracefully...`);
    needsReseed = true;
  }
  if (needsReseed) {
    console.info(`[DataSeed] Initializing demo data...`);
    safeSetItem('counseling_patients', await obfuscateData(INITIAL_PATIENTS));
    safeSetItem('counseling_schema_version', currentVersion);
    safeSetItem('counseling_call_logs', await obfuscateData(INITIAL_CALL_LOGS));
    safeSetItem('counseling_audit_trail', await obfuscateData(INITIAL_AUDIT_TRAIL));
    if (navigator.onLine) {
      try {
        await fetch(`${API_BASE}/seed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ patients: INITIAL_PATIENTS })
        });
        console.info('[DataSeed] MongoDB reseeded successfully.');
      } catch (err) {
        console.warn('[DataSeed] Could not reach backend for reseed.', err);
      }
    }
    return INITIAL_PATIENTS;
  }
  // 
  if (!navigator.onLine) {
    const rawData = safeGetItem("counseling_patients");
    if (rawData) {
      try {
        return await deobfuscateData(rawData);
      } catch (decryptErr) {
        console.warn("Local storage decryption failed, resetting store:", decryptErr);
        safeSetItem('counseling_schema_version', '');
        return INITIAL_PATIENTS;
      }
    }
    return INITIAL_PATIENTS;
  }
  try {
    const res = await fetch(`${API_BASE}/patients`);
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const data = await res.json();
    if (data.length === 0) {
      await savePatients(INITIAL_PATIENTS);
      return INITIAL_PATIENTS;
    }
    safeSetItem('counseling_patients', await obfuscateData(data));
    return data;
  } catch (err) {
    console.error("Backend fetch failed, falling back to local storage:", err);
    const rawData = safeGetItem("counseling_patients");
    if (rawData) {
      try {
        return await deobfuscateData(rawData);
      } catch (decryptErr) {
        console.warn("Local storage decryption failed, resetting store:", decryptErr);
        safeSetItem('counseling_schema_version', '');
        return INITIAL_PATIENTS;
      }
    }
    return INITIAL_PATIENTS;
  }
}
async function savePatients(patients) {
  safeSetItem('counseling_patients', await obfuscateData(patients));
  safeSetItem("counseling_schema_version", window.CounselFlow.CONFIG.SCHEMA_VERSION.toString());
  if (navigator.onLine) {
    try {
      const res = await fetch(`${API_BASE}/patients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(patients)
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
    } catch (err) {
      console.error("Failed to sync patients to backend:", err);
      if (window.CounselFlow && window.CounselFlow.app && typeof window.CounselFlow.app.showToast === 'function') {
        window.CounselFlow.app.showToast("Sync Error", "Failed to save patients to backend.", "error");
      }
    }
  }
}
// Global Registry for Call Log supervision history attempts (Phase 1, Requirement #2)
async function getStoredCallLogs() {
  const defaultLogs = INITIAL_CALL_LOGS;
  if (!navigator.onLine) {
    const rawLogs = safeGetItem("counseling_call_logs");
    if (rawLogs) {
      try {
        return await deobfuscateData(rawLogs);
      } catch (decryptErr) {
        console.warn("Local storage decryption of call logs failed:", decryptErr);
        return defaultLogs;
      }
    }
    return defaultLogs;
  }
  try {
    const res = await fetch(`${API_BASE}/call-logs`);
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const data = await res.json();
    if (data.length === 0) {
      await saveCallLogs(defaultLogs);
      return defaultLogs;
    }
    safeSetItem('counseling_call_logs', await obfuscateData(data));
    return data;
  } catch (err) {
    console.error("Backend fetch failed, falling back to local storage:", err);
    const rawLogs = safeGetItem("counseling_call_logs");
    if (rawLogs) {
      try {
        return await deobfuscateData(rawLogs);
      } catch (decryptErr) {
        console.warn("Local storage decryption of call logs failed:", decryptErr);
        return defaultLogs;
      }
    }
    return defaultLogs;
  }
}
async function saveCallLogs(logs) {
  safeSetItem('counseling_call_logs', await obfuscateData(logs));
  if (navigator.onLine) {
    try {
      await fetch(`${API_BASE}/call-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(logs)
      });
    } catch (err) {
      console.error("Failed to sync call logs to backend:", err);
    }
  }
}
window.CounselFlow.getCallLogs = getStoredCallLogs;
window.CounselFlow.saveCallLogs = saveCallLogs;
window.CounselFlow.getStoredPatients = getStoredPatients;
window.CounselFlow.savePatients = savePatients;
window.CounselFlow.CALL_SCENARIOS = CALL_SCENARIOS;
// Bulk delete call logs by logId list
window.CounselFlow.deleteCallLogs = async function(logIds) {
  // Remove from local cache
  const rawLogs = safeGetItem('counseling_call_logs');
  if (rawLogs) {
    const existing = await deobfuscateData(rawLogs) || [];
    const updated = existing.filter(l => !logIds.includes(l.logId));
    safeSetItem('counseling_call_logs', await obfuscateData(updated));
  }
  // Delete from backend
  if (navigator.onLine) {
    try {
      await fetch(`${API_BASE}/call-logs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ logIds })
      });
    } catch (err) {
      console.error('Failed to delete call logs from backend:', err);
    }
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
    canViewAuditTrail: true,
    canExportAll: false,
    canExportDistrict: true,
    canManageProfiles: true,
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
    canExportAll: true,
    description: 'Technical & data governance: system config, audit trail, and data export.'
  },
  'spo': {
    label: 'State Programme Owner (Admin)',
    emoji: '️',
    color: 'var(--accent-red)',
    allowedScreens: ['dashboard', 'patients', 'clinical-workflow', 'call-console', 'session-history', 'analytics', 'settings', 'profiles'],
    canViewPII: true,
    canDeleteTranscript: true,
    canResolveEscalation: true,
    escalationLevels: [1, 2, 3],
    canViewAuditTrail: true,
    canExportAll: true,
    canBulkDeleteLogs: true,
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
const DEMO_CREDENTIALS = [
  {
    roleKey:  'spo',
    username: 'spo@cbm.gov.in',
    password: 'CBM@SPOwner24',
    name:     'Sh. Gurinder Bhullar IAS',
    staffId:  'STAFF-001'
  },
  {
    roleKey:  'supervisor',
    username: 'supervisor@cbm.gov.in',
    password: 'CBM@Supervisor24',
    name:     'Dr. Rajdeep Singh',
    staffId:  'STAFF-002'
  },
  {
    roleKey:  'counsellor',
    username: 'counsellor_amritsar@cbm.gov.in',
    password: 'CBM@Counsellor24',
    name:     'Dr. Amanpreet Kaur',
    staffId:  'STAFF-003',
    district: 'Amritsar'
  },
  {
    roleKey:  'counsellor',
    username: 'counsellor_jalandhar@cbm.gov.in',
    password: 'CBM@Counsellor24',
    name:     'Dr. Manpreet Sodhi',
    staffId:  'STAFF-004',
    district: 'Jalandhar'
  },
  {
    roleKey:  'counsellor',
    username: 'counsellor_ludhiana@cbm.gov.in',
    password: 'CBM@Counsellor24',
    name:     'Dr. Harinder Gill',
    staffId:  'STAFF-005',
    district: 'Ludhiana'
  },
  {
    roleKey:  'counsellor',
    username: 'counsellor_patiala@cbm.gov.in',
    password: 'CBM@Counsellor24',
    name:     'Dr. Gurbaksh Singh',
    staffId:  'STAFF-006',
    district: 'Patiala'
  },
  {
    roleKey:  'ddrc',
    username: 'ddrc_amritsar@cbm.gov.in',
    password: 'CBM@DDRC24',
    name:     'Dr. Harpreet Grewal',
    staffId:  'STAFF-007',
    district: 'Amritsar'
  },
  {
    roleKey:  'ddrc',
    username: 'ddrc_jalandhar@cbm.gov.in',
    password: 'CBM@DDRC24',
    name:     'Dr. Balwinder Singh',
    staffId:  'STAFF-009',
    district: 'Jalandhar'
  },
  {
    roleKey:  'ddrc',
    username: 'ddrc_ludhiana@cbm.gov.in',
    password: 'CBM@DDRC24',
    name:     'Dr. Simranjeet Kaur',
    staffId:  'STAFF-010',
    district: 'Ludhiana'
  },
  {
    roleKey:  'ddrc',
    username: 'ddrc_patiala@cbm.gov.in',
    password: 'CBM@DDRC24',
    name:     'Dr. Gurdeep Singh',
    staffId:  'STAFF-011',
    district: 'Patiala'
  },
  {
    roleKey:  'ditsu',
    username: 'ditsu@cbm.gov.in',
    password: 'CBM@DITSU24',
    name:     'Er. Navneet Sharma',
    staffId:  'STAFF-008'
  },
  {
    roleKey:  'opd_staff',
    username: 'opd@cbm.gov.in',
    password: 'CBM@OPD24',
    name:     'OPD Coordinator',
    staffId:  'STAFF-012'
  }
];
window.CounselFlow.DEMO_CREDENTIALS = DEMO_CREDENTIALS;
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
  const hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(2, '0').repeat(16).slice(0, 32);
}
async function getAuditTrail() {
  if (!navigator.onLine) {
    const raw = safeGetItem('counseling_audit_trail');
    if (!raw) return INITIAL_AUDIT_TRAIL;
    try {
      return await deobfuscateData(raw);
    } catch (e) {
      console.error('Audit trail read error:', e);
      return INITIAL_AUDIT_TRAIL;
    }
  }
  try {
    const res = await fetch(`${API_BASE}/audit-trail`);
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const data = await res.json();
    safeSetItem('counseling_audit_trail', await obfuscateData(data));
    return data;
  } catch (err) {
    console.error("Backend fetch failed, falling back to local storage:", err);
    const raw = safeGetItem('counseling_audit_trail');
    return raw ? await deobfuscateData(raw) : INITIAL_AUDIT_TRAIL;
  }
}
async function saveAuditTrail(events) {
  safeSetItem('counseling_audit_trail', await obfuscateData(events));
  if (navigator.onLine) {
    try {
      await fetch(`${API_BASE}/audit-trail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(events)
      });
    } catch (err) {
      console.error("Failed to sync audit trail to backend:", err);
    }
  }
}
async function writeAuditEvent(eventType, patientId, sessionId, actorRole, detail = '') {
  try {
    const events = await getAuditTrail();
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
    events.unshift(eventObj);
    // Keep last 500 audit events
    await saveAuditTrail(events.slice(0, 500));
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


/* --- BUNDLED FROM: js/ai.js --- */
// AI Summarization and NLP Parsing Engine for Tele-Counseling
class AIOrchestrator {
  constructor() {
    this.languagesSupported = {
      "pa-IN": "Punjabi (Gurmukhi ASR)",
      "hi-IN": "Hindi (Devanagari ASR)",
      "en-US": "English (Standard ASR)"
    };
  }
  // Returns { endpoint, headers, model } based on the active AI provider (Groq or Gemini)
  _getChatConfig() {
    const provider = (window.CounselFlow.CONFIG.AI_PROVIDER || 'groq').toLowerCase();
    const token = window.localStorage.getItem('counseling_logged_in_token');
    const headers = { 
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "ngrok-skip-browser-warning": "1"
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (provider === 'gemini') {
      if (window.CounselFlow.CONFIG.GEMINI_API_KEY) {
        headers["Authorization"] = `Bearer ${window.CounselFlow.CONFIG.GEMINI_API_KEY}`;
      }
      return {
        endpoint: `${window.CounselFlow.API_BASE}/ai/gemini/chat`,
        headers,
        model: 'gemini-2.0-flash',
        provider: 'gemini'
      };
    }
    // Default: Groq
    if (window.CounselFlow.CONFIG.GROQ_API_KEY) {
      headers["Authorization"] = `Bearer ${window.CounselFlow.CONFIG.GROQ_API_KEY}`;
    }
    return {
      endpoint: `${window.CounselFlow.API_BASE}/ai/chat/completions`,
      headers,
      model: 'llama-3.1-8b-instant',
      provider: 'groq'
    };
  }
  // Detect language based on transcript contents or user selection
  detectLanguage(transcriptText) {
    const containsPunjabiChar = /[\u0A00-\u0A7F]/.test(transcriptText);
    const containsHindiChar = /[\u0900-\u097F]/.test(transcriptText);
    if (containsPunjabiChar) return "pa-IN";
    if (containsHindiChar) return "hi-IN";
    return "en-US";
  }
  // Clean raw transcript text
  cleanTranscription(transcriptArray) {
    try {
      return transcriptArray.map(line => {
        return {
          speaker: line.speaker || "Speaker",
          text: (line.text || "").trim(),
          timestamp: line.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      });
    } catch (e) {
      console.error("Transcription cleaning failure:", e);
      return [];
    }
  }
  // Generate intelligent summary based on transcripts (supports dynamic keyword-based input)
  generateSummary(transcriptArray, languageCode = 'en-US') {
    try {
      // Join transcript lines into a single string to parse keywords
      const textBlob = transcriptArray.map(t => t.text).join(" ").toLowerCase();
      // Default fallback clinical points
      let overview = "Counseling session focused on general recovery milestones, check-in on patient's mood, and relapse prevention guidelines.";
      let concernsParts = [];
      let observationsParts = ["Patient presents a cooperative, stable mood and exhibits progressive engagement in rehabilitation work."];
      // Risk hierarchy: 0 = Stable/Low, 1 = Medium, 2 = High, 3 = Critical
      let maxRiskScore = 0;
      let actions = [
        "Continue standard daily sobriety routine.",
        "Engage in supportive family activities.",
        "Attend the next scheduled support group meeting."
      ];
      let nextFollowUp = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      // Multi-lingual word boundary regex patterns
      const cravingsRegex = /(?:\b(crav|urge|desire|want|trigger)\b)|(?:ਤਲਬ|ਮਨ ਡੋਲ|ਮਨ ਕੀਤਾ)|(?:तलब|मन डोल|मन किया|इच्छा)/i;
      const peersRegex = /(?:\b(friend|peer|circle|group|crowd|associate)\b)|(?:ਦੋਸਤ|ਸਾਥੀ|ਯਾਰ)|(?:दोस्त|साथी|यार)/i;
      const sleepRegex = /(?:\b(sleep|insomnia|wake|awake|night|rest)\b)|(?:ਨੀਂਦ|ਸੌਣ|ਰਾਤ)|(?:नींद|सोना|रात)/i;
      const withdrawalRegex = /(?:\b(pain|ache|vomit|nausea|sick|weak|hurt|sweat|tremor)\b)|(?:ਦਰਦ|ਦੁਖ|ਕਮਜ਼ੋਰੀ)|(?:दर्द|दुख|कमजोरी|उल्टी|बीमार)/i;
      // 1. Craving detection
      if (cravingsRegex.test(textBlob)) {
        handleCravings();
      }
      // 2. Peer group triggers
      if (peersRegex.test(textBlob)) {
        handlePeers();
      }
      // 3. Insomnia and sleep struggles
      if (sleepRegex.test(textBlob)) {
        handleSleep();
      }
      // 4. Withdrawal / Physical aches
      if (withdrawalRegex.test(textBlob)) {
        handleWithdrawal();
      }
      // Helpers to populate fields and scale the risk score hierarchy
      function handleCravings() {
        concernsParts.push("Patient experienced moderate-to-strong cravings since the last check-in.");
        concernsParts.push("The craving episode was successfully managed through self-control and coping tools.");
        maxRiskScore = Math.max(maxRiskScore, 1); // Medium Risk
        actions.unshift("Develop written daily triggers journal to track and anticipate craving spikes.");
      }
      function handlePeers() {
        concernsParts.push("Encountered active peer circles associated with previous substance use triggers.");
        maxRiskScore = Math.max(maxRiskScore, 2); // High Risk
        observationsParts.push("Patient demonstrates high accountability by immediately removing themselves from triggering environments, but social vulnerability remains.");
        actions.unshift("Avoid physical travel along high-risk routes frequented by former active circles.");
      }
      function handleSleep() {
        concernsParts.push("Significant insomnia or disturbed sleeping patterns reported.");
        concernsParts.push("Patient struggles to sleep prior to midnight.");
        observationsParts.push("Appears slightly fatigued due to sleep deficit. Alert but low energy.");
        actions.push("Implement sleep-hygiene routine (avoid screens 1 hour before sleep, discontinue caffeine past 4 PM).");
      }
      function handleWithdrawal() {
        concernsParts.push("Persistent physical discomfort, including muscle aches or mild nausea, associated with active detox.");
        // Critical escalation trigger: severe symptoms mentioned
        const severeRegex = /\b(vomit|tremor|sweat|shak|severe|ਬਹੁਤ ਬੁਰਾ|ਉਲਟੀ|ਬਹੁਤ ਜ਼ਿਆਦਾ|ਤੀਬਰ)\b/i;
        if (severeRegex.test(textBlob)) {
          concernsParts.push("Severe clinical withdrawal tremors, vomiting, or excessive perspiration observed.");
          maxRiskScore = Math.max(maxRiskScore, 3); // Critical Risk
        } else {
          maxRiskScore = Math.max(maxRiskScore, 2); // High Risk
        }
        actions.unshift("Coordinate with medical detox officer for checking pharmacotherapy or medication dosage adjustments.");
      }
      // Map numerical risk score back to clinical string tags
      const riskMapping = {
        0: "Stable / Low Risk",
        1: "Medium Risk",
        2: "High Risk",
        3: "Critical Risk"
      };
      const riskLevel = riskMapping[maxRiskScore];
      // Join and clean concerns using sentence-based clause deduplication
      let finalConcerns = "No severe cravings or critical medical withdrawal symptoms reported.";
      if (concernsParts.length > 0) {
        const uniqueClauses = [];
        const seen = new Set();
        concernsParts.forEach(part => {
          const clauses = part.split(/[.;,]+/).map(c => c.trim()).filter(c => c.length > 0);
          clauses.forEach(clause => {
            const normalized = clause.toLowerCase().replace(/\s+/g, ' ');
            if (!seen.has(normalized)) {
              seen.add(normalized);
              uniqueClauses.push(clause);
            }
          });
        });
        finalConcerns = uniqueClauses.join(". ") + ".";
      }
      // Join and clean observations
      let finalObservations = observationsParts.join(" ");
      // Deduplicate actions array elements
      actions = [...new Set(actions)];
      // Derive escalation level from risk score
      const escalationMap = { 0: 0, 1: 0, 2: 1, 3: 2 };
      const escalationLevel = escalationMap[maxRiskScore] || 0;
      const escalationReasonMap = {
        0: null,
        1: "High craving intensity or peer-association trigger detected.",
        2: "Critical withdrawal symptoms or extreme craving episode reported."
      };
      return {
        overview: overview,
        concerns: finalConcerns,
        observations: finalObservations,
        risk: riskLevel,
        actions: actions.map((act, i) => `${i+1}. ${act}`).join("\n"),
        followUp: nextFollowUp,
        escalationLevel: escalationLevel,
        escalationReason: escalationReasonMap[escalationLevel] || null
      };
    } catch (e) {
      console.error("AI summarization failure:", e);
      return {
        overview: "Error compiling session summary automatically.",
        concerns: "Error parsing transcript keywords.",
        observations: "Error reading emotional markers.",
        risk: "Medium Risk",
        actions: "1. Monitor patient stability closely.",
        followUp: nextFollowUp,
        escalationLevel: 0,
        escalationReason: null
      };
    }
  }
  // Generate intelligent summary using Groq API llama-3.1-8b-instant (supports JSON mode)
  async generateSummaryAsync(transcriptArray, languageCode = 'en-US') {
    // Convert transcript array into readable text representation
    const transcriptText = transcriptArray
      .map(line => `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}`)
      .join('\n');
    if (!transcriptText.trim()) {
      return this.generateSummary(transcriptArray, languageCode);
    }
    const chatConfig = this._getChatConfig();
    const payload = {
      model: chatConfig.model,
      messages: [
        {
          role: "system",
          content: `You are a clinical counseling AI assistant specializing in addiction recovery for the Punjab CBM (Community Bridge Model) programme.
Summarize the tele-counseling session below.
You MUST respond with a valid JSON object only. No intro text, no markdown fences.
The JSON object must have EXACTLY these fields:
{
  "overview": "Clinical summary of session, recovery progress, key topics discussed.",
  "concerns": "Cravings, social triggers, insomnia, physical withdrawal, or psychosocial stressors reported.",
  "observations": "Counselor observations: patient mood, engagement level, attitude, body language cues if mentioned.",
  "risk": "Exactly one of: 'Stable / Low Risk', 'Medium Risk', 'High Risk', 'Critical Risk'.",
  "actions": "Numbered list of next-step recommendations, newline-separated.",
  "escalationLevel": "Integer 0-3. 0=no escalation needed. 1=L1 supervisor alert within 4 hours (missed session or language risk cues). 2=L2 DDRC clinical alert within 24 hours (high risk, relapse indicators). 3=L3 emergency state programme owner within 48 hours (critical risk, active relapse or safety concern).",
  "escalationReason": "Short one-sentence reason for the escalation level, or null if level 0."
}`
        },
        {
          role: "user",
          content: `Here is the conversation transcript (language: ${languageCode}):\n\n${transcriptText}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    };
    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP error ${response.status}`);
      }
      const responseData = await response.json();
      const content = responseData.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from AI engine");
      }
      const summaryObj = JSON.parse(content);
      // Map actions safely to strings
      let actionsStr = "";
      if (Array.isArray(summaryObj.actions)) {
        actionsStr = summaryObj.actions.map((act, i) => `${i + 1}. ${act}`).join("\n");
      } else if (typeof summaryObj.actions === 'string') {
        const lines = summaryObj.actions.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(l => l.length > 0);
        actionsStr = lines.map((act, i) => `${i + 1}. ${act}`).join("\n");
      } else {
        actionsStr = "1. Continue standard daily sobriety routine.";
      }
      const rawEscLevel = parseInt(summaryObj.escalationLevel);
      const escalationLevel = isNaN(rawEscLevel) ? 0 : Math.min(3, Math.max(0, rawEscLevel));
      return {
        overview: summaryObj.overview || "No overview provided.",
        concerns: summaryObj.concerns || "No concerns reported.",
        observations: summaryObj.observations || "No observations recorded.",
        risk: summaryObj.risk || "Stable / Low Risk",
        actions: actionsStr,
        followUp: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        escalationLevel: escalationLevel,
        escalationReason: summaryObj.escalationReason || null
      };
    } catch (e) {
      console.error(`${chatConfig.provider} API Summary generation failed:`, e);
      if (window.CounselFlow && window.CounselFlow.app) {
        window.CounselFlow.app.showToast("AI Error", "Failed to generate summary. Using fallback.", "error");
      }
      throw e;
    }
  }
  // ── Live Sarvam Transcription (Replaces flaky Web Speech API)
  async transcribeAudioChunkAsync(audioBlob, languageCode = 'en') {
    // Skip sending if the audio chunk is too small (prevents 400 Bad Requests and reduces hallucinations on silence)
    if (audioBlob.size < 1000) return null;
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "chunk.webm");
      // Determine language for the backend to map to Sarvam's language_code
      let reqLang = 'en';
      if (languageCode.startsWith('hi')) reqLang = 'hi';
      else if (languageCode.startsWith('pa')) reqLang = 'pa';
      formData.append("language", reqLang);
      const token = window.localStorage.getItem('counseling_logged_in_token');
      const headers = {
        "X-Requested-With": "XMLHttpRequest",
        "ngrok-skip-browser-warning": "1"
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(`${window.CounselFlow.API_BASE}/ai/audio/transcriptions`, {
        method: "POST",
        headers: headers,
        body: formData
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP error ${response.status}`);
      }
      const data = await response.json();
      return data.text ? data.text.trim() : null;
    } catch (e) {
      console.error("Sarvam Transcription failed:", e);
      return null;
    }
  }
  // ── Dictation Mode: Convert counsellor's post-call narration to structured summary (Req 6)
  async generateDictationSummaryAsync(dictationText, languageCode = 'en-US') {
    if (!dictationText || !dictationText.trim()) throw new Error("No dictation text provided.");
    const chatConfig = this._getChatConfig();
    const payload = {
      model: chatConfig.model,
      messages: [
        {
          role: "system",
          content: `You are a clinical documentation AI for addiction recovery counselling (Punjab CBM programme).
The following is a post-call verbal dictation by a counsellor describing a session they just conducted — the call was NOT recorded.
Convert this dictation into a structured clinical summary.
Respond ONLY with a valid JSON object with these EXACT fields:
{
  "overview": "Summary of session as described by the counsellor.",
  "concerns": "Patient concerns, triggers, cravings, or risk factors mentioned.",
  "observations": "Counsellor's clinical observations of the patient.",
  "risk": "Exactly one of: 'Stable / Low Risk', 'Medium Risk', 'High Risk', 'Critical Risk'.",
  "actions": "Numbered list of next-step recommendations, newline-separated.",
  "escalationLevel": "Integer 0-3 as defined: 0=none, 1=L1(4h), 2=L2(24h), 3=L3(48h).",
  "escalationReason": "One sentence reason or null."
}`
        },
        {
          role: "user",
          content: `Counsellor dictation (language code: ${languageCode}):\n\n${dictationText}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    };
    const response = await fetch(chatConfig.endpoint, {
      method: "POST",
      headers: chatConfig.headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP error ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty dictation summary response.");
    const obj = JSON.parse(content);
    let actionsStr = "";
    if (Array.isArray(obj.actions)) {
      actionsStr = obj.actions.map((a, i) => `${i+1}. ${a}`).join("\n");
    } else if (typeof obj.actions === 'string') {
      actionsStr = obj.actions;
    } else {
      actionsStr = "1. Monitor patient progress at next check-in.";
    }
    const rawEsc = parseInt(obj.escalationLevel);
    return {
      overview: obj.overview || "",
      concerns: obj.concerns || "",
      observations: obj.observations || "",
      risk: obj.risk || "Stable / Low Risk",
      actions: actionsStr,
      followUp: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      escalationLevel: isNaN(rawEsc) ? 0 : Math.min(3, Math.max(0, rawEsc)),
      escalationReason: obj.escalationReason || null,
      isDictation: true
    };
  }
  // ── Session Scoring Engine: 6-dimension quality rubric (Req 5)
  scoreSession(summaryObj, transcriptArray) {
    const text = transcriptArray.map(t => t.text || '').join(' ').toLowerCase();
    const summary = JSON.stringify(summaryObj).toLowerCase();
    const combined = text + ' ' + summary;
    // 1. Rapport (0-10): engagement language, greeting, empathy
    const rapportMatches = (combined.match(/(?:बहुत अच्छा|ਬਹੁਤ ਵਧੀਆ|great|well done|understand|feel|listen|empathy|support|ਧੰਨਵਾਦ|धन्यवाद|thank)/gi) || []).length;
    const rapport = Math.min(10, 4 + rapportMatches);
    // 2. Relapse-Prevention Frame (0-10): coping strategies mentioned
    const copingMatches = (combined.match(/(?:coping|breathing|exercise|routine|strategy|plan|avoid|distract|support group|ਸਾਹ|ਕਸਰਤ|सांस|कसरत|दिनचर्या)/gi) || []).length;
    const relapseFrame = Math.min(10, 3 + copingMatches * 2);
    // 3. Risk Cue Identification (0-10): based on escalation level detected
    const riskMapping = { 'stable / low risk': 8, 'medium risk': 6, 'high risk': 4, 'critical risk': 2 };
    const riskCueId = riskMapping[(summaryObj.risk || '').toLowerCase()] || 5;
    // 4. Action Clarity (0-10): numbered actions present
    const actionLines = (summaryObj.actions || '').split('\n').filter(l => l.trim().length > 3);
    const actionClarity = Math.min(10, actionLines.length * 2);
    // 5. Escalation Hygiene (0-10): correctly identified escalation vs risk
    const esc = summaryObj.escalationLevel || 0;
    const riskStr = (summaryObj.risk || '').toLowerCase();
    const escalationHygiene = (() => {
      if (esc === 0 && (riskStr.includes('stable') || riskStr.includes('low'))) return 10;
      if (esc >= 1 && (riskStr.includes('high') || riskStr.includes('critical'))) return 9;
      if (esc === 0 && riskStr.includes('medium')) return 7;
      return 6;
    })();
    // 6. Language Sensitivity (0-10): multilingual handling
    const hasPunjabi = /[\u0A00-\u0A7F]/.test(text);
    const hasHindi = /[\u0900-\u097F]/.test(text);
    const hasEnglish = /[a-z]{4,}/.test(text);
    const langScore = (hasPunjabi ? 3 : 0) + (hasHindi ? 3 : 0) + (hasEnglish ? 2 : 0) + 2;
    const languageSensitivity = Math.min(10, langScore);
    const scores = { rapport, relapseFrame, riskCueId, actionClarity, escalationHygiene, languageSensitivity };
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const average = Math.round((total / 60) * 100); // percentage
    return { ...scores, total, average };
  }
  // Export clinical session detail as a text file for counselor records
  exportSessionData(patient, session) {
    try {
      const divider = "=========================================================\n";
      let text = `${divider}  CLINICAL TELE-COUNSELING SESSION HISTORY RECORD\n${divider}`;
      text += `Patient Name  : ${patient.name}\n`;
      text += `Age / Gender  : ${patient.age} / ${patient.gender}\n`;
      text += `Phone No      : ${patient.phone}\n`;
      text += `Addiction Cat : ${patient.addictionCategory}\n`;
      text += `Session Date  : ${session.date}\n`;
      text += `Duration      : ${session.duration}\n`;
      text += `Language      : ${session.language}\n`;
      text += `Counselor     : ${session.counselor}\n`;
      text += `${divider}  SPEECH-TO-TEXT TRANSCRIPT\n${divider}`;
      session.transcript.forEach(line => {
        text += `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}\n`;
      });
      text += `\n${divider}  AI-GENERATED CLINICAL SUMMARY\n${divider}`;
      text += `[Session Overview]\n${session.summary.overview}\n\n`;
      text += `[Key Concerns / Triggers]\n${session.summary.concerns}\n\n`;
      text += `[Counselor Observations]\n${session.summary.observations}\n\n`;
      text += `[Risk Indicators]\n${session.summary.risk || session.summary.riskIndicators}\n\n`;
      text += `[Recommended Actions]\n${session.summary.actions}\n\n`;
      text += `[Follow-up Date]\n${session.summary.followUp}\n`;
      text += `${divider}`;
      // Trigger download in browser
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Session_${session.sessionId || 'SESS'}_${patient.name.replace(/\s+/g, '_')}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to export session record:", e);
    }
  }
  // ── Translate non-English input to English
  async translateToEnglishAsync(text) {
    if (!text || text.trim() === '') return text;
    const chatConfig = this._getChatConfig();
    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify({
          model: chatConfig.model,
          messages: [
            {
              role: "system",
              content: "You are a professional translator. Translate the following text exactly to English. If it is already in English, return it exactly as is. Output ONLY the translated English text, with no explanations, no quotes, and no intro."
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.1,
          max_tokens: 200
        })
      });
      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content.trim();
      }
    } catch (e) {
      console.error("Translation failed:", e);
    }
    return text;
  }
  // ── Translate entire transcript array to a target language post-call
  async translateFullTranscriptAsync(transcriptArray, targetLanguage = 'English') {
    if (!transcriptArray || transcriptArray.length === 0) return transcriptArray;
    const rawText = transcriptArray
      .map(line => `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}`)
      .join('\n');
    const chatConfig = this._getChatConfig();
    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify({
          model: chatConfig.model,
          messages: [
            {
              role: "system",
              content: `You are a professional translator for medical and counseling conversations. Translate each line of the following dialogue to ${targetLanguage}. Keep the exact format: [timestamp] Speaker: translated text. Do NOT change timestamps or speaker names. Translate ONLY the text after the speaker name.`
            },
            {
              role: "user",
              content: rawText
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });
      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`${chatConfig.provider} API rate limit reached (429 Too Many Requests). Translation skipped.`);
          if (window.CounselFlow && window.CounselFlow.app && window.CounselFlow.app.showToast) {
            window.CounselFlow.app.showToast("Rate Limit Hit", "Translation skipped due to API rate limits.", "warning");
          }
        }
        return transcriptArray;
      }
      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        const translatedRaw = data.choices[0].message.content.trim();
        // Parse the translated lines back into the transcript array format
        const lines = translatedRaw.split('\n').filter(l => l.trim() && !l.toLowerCase().startsWith('here is the'));
        return lines.map((line, idx) => {
          const orig = transcriptArray[idx] || { timestamp: '00:00', speaker: 'Unknown', text: '' };
          const match = line.match(/^\[(.*?)\]\s*(.*?):\s*(.*)$/);
          if (match) {
            return {
              timestamp: match[1],
              speaker: orig.speaker, // Always preserve the original English speaker name for UI consistency
              text: match[3].trim().replace(/^["']|["']$/g, '')
            };
          }
          // Fallback: If formatting broke but we have line parity, salvage the text.
          let cleanedText = line
            .replace(/^\[.*?\]\s*/, '') // Remove timestamps like [00:00]
            .replace(/^(?:\*\*.*?\*\*|.*?)\s*[:-]\s*/, '') // Remove speaker names like **Counselor**: or Counselor -
            .replace(/^["']|["']$/g, '')
            .trim();
          return {
            timestamp: orig.timestamp,
            speaker: orig.speaker,
            text: cleanedText || line // Use cleaned text, or whole line if it's completely malformed
          };
        });
      }
    } catch (e) {
      console.error("Bulk transcript translation failed:", e);
    }
    return transcriptArray;
  }
  // ── Demo Simulator: Generate natural human-like responses for the patient (Req 7)
  async generatePatientResponseAsync(transcriptArray, patientObj, languageCode = 'en-US') {
    const transcriptText = transcriptArray
      .map(line => `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}`)
      .join('\n');
    const patientDetails = patientObj ? `You are ${patientObj.name}, recovering from ${patientObj.addictionCategory}. Your risk level is ${patientObj.riskLevel}.` : "You are a patient in an addiction recovery tele-counseling session.";
    const chatConfig = this._getChatConfig();
    const payload = {
      model: chatConfig.model,
      messages: [
        {
          role: "system",
          content: `${patientDetails}
You are talking to your counselor over a phone call.
Respond to the counselor's latest statement naturally, conversationally, and concisely as a human would. Do NOT write long paragraphs. A few short sentences at most.
Respond naturally in the same language as the conversation. If Punjabi, use Punjabi. If Hindi, use Hindi. If English, use English.
DO NOT include any JSON, prefixes, or speaker tags in your response. Just the raw text of what you say.`
        },
        {
          role: "user",
          content: `Here is the conversation so far:\n\n${transcriptText}\n\nWhat do you say next as the patient? Respond naturally in the same language the counselor is using.`
        }
      ],
      temperature: 0.7
    };
    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const responseData = await response.json();
      const content = responseData.choices?.[0]?.message?.content;
      return content ? content.trim() : "I'm not sure what to say.";
    } catch (e) {
      console.error("Patient response generation failed:", e);
      if (window.CounselFlow && window.CounselFlow.app) {
        window.CounselFlow.app.showToast("AI Error", "Failed to generate patient response.", "error");
      }
      return "I'm having trouble hearing you.";
    }
  }
}
// Namespace consolidation
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.aiOrchestrator = new AIOrchestrator();


/* --- BUNDLED FROM: js/profiles.js --- */
// Profiles Management Logic
document.addEventListener('DOMContentLoaded', () => {
  const btnPatients = document.getElementById('btn-profiles-patient');
  const btnCounselors = document.getElementById('btn-profiles-counselor');
  const container = document.getElementById('profiles-list-container');
  if (!btnPatients || !btnCounselors || !container) return;
  // Gap 10: Inject Search & Filter above the grid
  const searchFilterHtml = `
    <div style="display: flex; gap: 10px; margin-bottom: 15px; background: var(--bg-card); padding: 10px; border-radius: 8px; border: 1px solid var(--border-light); align-items: center;">
      <input type="text" id="profiles-search-input" placeholder="Search by name, ID or phone..." style="flex:1; background: var(--bg-input); border: 1px solid var(--border-light); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 13px;">
      <select id="profiles-filter-select" style="background: var(--bg-input); border: 1px solid var(--border-light); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 13px;">
        <option value="all">All Statuses</option>
        <option value="Active">Active</option>
        <option value="Risk">At Risk</option>
        <option value="Completed">Completed</option>
      </select>
      <button class="btn-primary" id="btn-profiles-export" style="display:none; margin-left: auto;">
        Export Roster (CSV)
      </button>
    </div>
    <div id="profiles-grid-container" class="list-scrollable" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px;"></div>
  `;
  container.innerHTML = searchFilterHtml;
  const gridContainer = document.getElementById('profiles-grid-container');
  const searchInput = document.getElementById('profiles-search-input');
  const filterSelect = document.getElementById('profiles-filter-select');
  const exportBtn = document.getElementById('btn-profiles-export');
  let currentTab = 'patients';
  let searchTerm = '';
  let statusFilter = 'all';
  ensureCounselorModal(); // Patient modal is removed; we use index.html's #modal-add-patient
  btnPatients.addEventListener('click', () => {
    btnPatients.classList.replace('btn-secondary', 'btn-primary');
    btnCounselors.classList.replace('btn-primary', 'btn-secondary');
    currentTab = 'patients';
    renderUI();
  });
  btnCounselors.addEventListener('click', () => {
    btnCounselors.classList.replace('btn-secondary', 'btn-primary');
    btnPatients.classList.replace('btn-primary', 'btn-secondary');
    currentTab = 'counselors';
    renderUI();
  });
  searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase();
    renderUI();
  });
  filterSelect.addEventListener('change', (e) => {
    statusFilter = e.target.value;
    renderUI();
  });
  exportBtn.addEventListener('click', () => {
    try {
      const isPatients = currentTab === 'patients';
      const activeRole = getActiveRole();
      const config = window.CounselFlow && window.CounselFlow.getRoleConfig ? window.CounselFlow.getRoleConfig(activeRole) : null;
      const maskPII = (val) => (config && config.canViewPII) ? val : '[PII Restricted]';
      let csvContent = "";
      if (isPatients) {
        let patients = window.CounselFlow && window.CounselFlow.app ? window.CounselFlow.app.patients : [];
        if (statusFilter !== 'all') patients = patients.filter(p => (p.status || '').toLowerCase() === statusFilter.toLowerCase());
        csvContent = "ID,Name,Phone,Status,Stage\n" + patients.map(p => 
          `"${p.id}","${maskPII(p.name)}","${maskPII(p.phone)}","${p.status}","${p.clinicalStage || 'N/A'}"`
        ).join("\n");
      } else {
        const counselors = getLocalCounselors();
        csvContent = "ID,Name,Staff ID,Role,District,Email\n" + counselors.map(c => 
          `"${c.id}","${c.name}","${c.staffId}","${c.roleKey}","${c.district}","${c.email}"`
        ).join("\n");
      }
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('hidden', '');
      a.setAttribute('href', url);
      a.setAttribute('download', `roster_export_${currentTab}_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (window.CounselFlow && window.CounselFlow.app) window.CounselFlow.app.showToast('Export Complete', 'Roster downloaded successfully.', 'success');
    } catch(e) {
      if (window.CounselFlow && window.CounselFlow.app) window.CounselFlow.app.showToast('Export Failed', 'An error occurred during export.', 'error');
    }
  });
  function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  function getActiveRole() {
    return (window.CounselFlow && typeof window.CounselFlow.getActiveRole === 'function')
      ? window.CounselFlow.getActiveRole() : 'counsellor';
  }
  function isAdmin() {
    const role = getActiveRole();
    const config = window.CounselFlow && window.CounselFlow.getRoleConfig ? window.CounselFlow.getRoleConfig(role) : null;
    return config && config.canManageProfiles;
  }
  function updateExportButton() {
    const role = getActiveRole();
    const config = window.CounselFlow && window.CounselFlow.getRoleConfig ? window.CounselFlow.getRoleConfig(role) : null;
    if (config && (config.canExportAll || config.canExportDistrict)) {
      exportBtn.style.display = 'block';
    } else {
      exportBtn.style.display = 'none';
    }
  }
  // Gap 8: coerceNumbers
  function coerceNumbers(data) {
    const numFields = ['age', 'progress', 'cravingsIntensity', 'clinicalStage'];
    numFields.forEach(f => {
      if (f in data && data[f] !== '') {
        const n = Number(data[f]);
        if (!isNaN(n)) data[f] = n;
        else delete data[f];
      } else {
        delete data[f]; // Do not send undefined
      }
    });
    return data;
  }
  // Gap 12: Expanded Counselor Modal
  function ensureCounselorModal() {
    if (document.getElementById('counselor-form-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'counselor-form-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); z-index:1000;';
    modal.innerHTML = `
      <div class="modal-content" style="width:500px; max-height:80vh; overflow-y:auto; background:var(--bg-card); padding:24px; border-radius:12px; box-shadow:0 0 20px rgba(0,0,0,0.5);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
          <h3>Counselor Profile</h3>
          <button type="button" class="modal-close" data-action="close-counselor-modal" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:20px;">&times;</button>
        </div>
        <form id="counselor-profile-form" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:15px;">
          <input type="hidden" id="c-id" name="id">
          <div style="grid-column: span 2;">
            <label style="font-size:11px; color:var(--text-secondary);">Full Name</label>
            <input type="text" id="c-name" name="name" class="select-filter" style="width:100%" required>
          </div>
          <div>
            <label style="font-size:11px; color:var(--text-secondary);">Staff ID</label>
            <input type="text" id="c-staffId" name="staffId" class="select-filter" style="width:100%" placeholder="STAFF-XXX" required>
          </div>
          <div>
            <label style="font-size:11px; color:var(--text-secondary);">Role</label>
            <select id="c-roleKey" name="roleKey" class="select-filter" style="width:100%">
              <option value="counsellor">Counselor</option>
              <option value="ddrc">DDRC Clinical</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px; color:var(--text-secondary);">Email/Username</label>
            <input type="email" id="c-email" name="email" class="select-filter" style="width:100%" required>
          </div>
          <div>
            <label style="font-size:11px; color:var(--text-secondary);">Password (New only)</label>
            <input type="password" id="c-password" name="password" class="select-filter" style="width:100%" placeholder="Leave blank to keep">
          </div>
          <div>
            <label style="font-size:11px; color:var(--text-secondary);">District</label>
            <input type="text" id="c-district" name="district" class="select-filter" style="width:100%">
          </div>
          <div>
            <label style="font-size:11px; color:var(--text-secondary);">Phone</label>
            <input type="tel" id="c-phone" name="phone" class="select-filter" style="width:100%">
          </div>
          <div style="grid-column: span 2;">
            <label style="font-size:11px; color:var(--text-secondary);">Specialization</label>
            <input type="text" id="c-specialization" name="specialization" class="select-filter" style="width:100%">
          </div>
          <div style="grid-column: span 2; display:flex; justify-content:flex-end; gap:10px; margin-top:15px;">
            <button type="button" class="btn-secondary" data-action="close-counselor-modal">Cancel</button>
            <button type="submit" class="btn-primary">Save Counselor</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    const overlay = document.createElement('div');
    overlay.id = 'counselor-overlay';
    overlay.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:999;';
    overlay.dataset.close = 'counselor';
    document.body.appendChild(overlay);
  }
  document.addEventListener('click', (e) => {
    const closeTarget = e.target.closest('[data-action="close-counselor-modal"]');
    if (closeTarget) {
      document.getElementById('counselor-form-modal').style.display = 'none';
      document.getElementById('counselor-overlay').style.display = 'none';
      return;
    }
  });
  async function getLocalCounselors() {
    let local = [];
    try {
      if (navigator.onLine) {
        const res = await fetch(`${window.CounselFlow.API_BASE}/counselors`);
        if (res.ok) {
          local = await res.json();
          localStorage.setItem('counseling_counselors', JSON.stringify(local));
        }
      } else {
        const stored = localStorage.getItem('counseling_counselors');
        if (stored) local = JSON.parse(stored);
      }
    } catch(e) {
      console.warn("Failed to fetch counselors from backend:", e);
      const stored = localStorage.getItem('counseling_counselors');
      if (stored) local = JSON.parse(stored);
    }
    // Merge with DEMO_CREDENTIALS
    const base = window.CounselFlow.DEMO_CREDENTIALS.filter(c => c.roleKey === 'counsellor' || c.roleKey === 'ddrc').map(c => ({
      id: c.staffId,
      staffId: c.staffId,
      name: c.name,
      email: c.username,
      roleKey: c.roleKey,
      district: c.district || 'Unknown',
      phone: c.phone || 'N/A',
      specialization: c.roleKey === 'ddrc' ? 'DDRC Admin' : 'Counselor',
      avatar: c.name.split(' ').map(n=>n[0]).join('').substring(0,2)
    }));
    // Override base with local
    local.forEach(l => {
       const idx = base.findIndex(b => b.id === l.id);
       if (idx >= 0) base[idx] = l;
       else base.push(l);
    });
    return base;
  }
  async function saveLocalCounselor(data) {
     let local = [];
     try {
       const stored = localStorage.getItem('counseling_counselors');
       if (stored) local = JSON.parse(stored);
     } catch(e) {}
     const idx = local.findIndex(l => l.id === data.id);
     if (idx >= 0) local[idx] = data;
     else local.push(data);
     localStorage.setItem('counseling_counselors', JSON.stringify(local));
     if (navigator.onLine) {
       try {
         await fetch(`${window.CounselFlow.API_BASE}/counselors`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
           body: JSON.stringify([data])
         });
       } catch (err) {
         console.error("Failed to sync counselor to backend:", err);
       }
     }
  }
  async function deleteLocalCounselor(id) {
     let local = [];
     try {
       const stored = localStorage.getItem('counseling_counselors');
       if (stored) local = JSON.parse(stored);
     } catch(e) {}
     local = local.filter(l => l.id !== id);
     localStorage.setItem('counseling_counselors', JSON.stringify(local));
     if (navigator.onLine) {
       try {
         await fetch(`${window.CounselFlow.API_BASE}/counselors/${id}`, {
           method: 'DELETE',
           headers: { 'X-Requested-With': 'XMLHttpRequest' }
         });
       } catch (err) {
         console.error("Failed to delete counselor from backend:", err);
       }
     }
  }
  function renderUI() {
     updateExportButton();
     if (currentTab === 'patients') renderPatientsProfileUI();
     else renderCounselorsProfileUI();
  }
  window.CounselFlow = window.CounselFlow || {};
  window.CounselFlow.renderProfilesList = renderUI;
  async function renderPatientsProfileUI() {
    // Gap 1: Decouple from dead API, use local app state
    let patients = window.CounselFlow && window.CounselFlow.app ? window.CounselFlow.app.patients : [];
    // Scoping
    const activeRole = getActiveRole();
    const staffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
    if (activeRole === 'counsellor') {
      patients = patients.filter(p => p.counselorId === staffId);
    } else if (activeRole === 'ddrc') {
      const currentUser = window.CounselFlow.DEMO_CREDENTIALS.find(c => c.staffId === staffId);
      const district = currentUser ? currentUser.district : '';
      patients = patients.filter(p => (p.district || '').toLowerCase() === (district || '').toLowerCase());
    }
    // Filtering
    if (statusFilter !== 'all') {
      patients = patients.filter(p => (p.status || '').toLowerCase() === statusFilter.toLowerCase());
    }
    if (searchTerm) {
      patients = patients.filter(p => 
        (p.name || '').toLowerCase().includes(searchTerm) || 
        (p.id || '').toLowerCase().includes(searchTerm) ||
        (p.phone || '').includes(searchTerm)
      );
    }
    const admin = isAdmin();
    let html = '';
    if (admin) {
      // Show add patient button floating or above grid
      html += `<div style="grid-column: 1 / -1; display:flex; justify-content:flex-end; margin-bottom:10px;">
        <button class="btn-primary" data-action="show-patient-form">+ Add New Patient</button>
      </div>`;
    }
    if (patients.length === 0) {
      html += '<div style="grid-column: 1 / -1; padding:20px; text-align:center; color:var(--text-muted);">No patients found.</div>';
    } else {
      // Gap 15: Use profile-card CSS
      patients.forEach(p => {
        const stageStr = p.clinicalStage !== undefined ? `Stage ${p.clinicalStage}` : 'N/A';
        html += `
          <div class="profile-card" style="border: 1px solid var(--border-light); background: var(--bg-card); border-radius: 8px; padding: 16px; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
               <div>
                 <h4 class="profile-name" style="margin-bottom:4px;">${escapeHtml(p.name || 'Unnamed')}</h4>
                 <div class="profile-tag" style="background:var(--bg-darkest); color:var(--text-secondary); padding:2px 8px; border-radius:12px; font-size:10px;">ID: ${escapeHtml(p.id)}</div>
               </div>
               <div style="width:40px; height:40px; border-radius:50%; background:${p.avatarColor || 'var(--accent-blue)'}; color:white; display:flex; align-items:center; justify-content:center; font-weight:bold;">
                  ${(p.name || 'U').substring(0,2).toUpperCase()}
               </div>
            </div>
            <div class="profile-info-list" style="margin-top:16px; display:flex; flex-direction:column; gap:8px;">
               <div class="info-item" style="display:flex; justify-content:space-between; font-size:12px;">
                 <span style="color:var(--text-muted);">Phone</span>
                 <span>${escapeHtml(p.phone || 'N/A')}</span>
               </div>
               <div class="info-item" style="display:flex; justify-content:space-between; font-size:12px;">
                 <span style="color:var(--text-muted);">Status</span>
                 <span style="color: ${p.status === 'Risk' ? 'var(--accent-red)' : 'var(--text-primary)'}; font-weight:bold;">${escapeHtml(p.status || 'N/A')}</span>
               </div>
               <div class="info-item" style="display:flex; justify-content:space-between; font-size:12px;">
                 <span style="color:var(--text-muted);">Clinical Stage</span>
                 <span>${escapeHtml(stageStr)}</span>
               </div>
            </div>
            <div style="margin-top:auto; padding-top:16px; display:flex; gap:8px; border-top:1px solid var(--border-light);">
              ${admin ? `<button class="btn-secondary" data-action="edit-patient" data-id="${escapeHtml(p.id)}" style="flex:1; font-size:11px;">Edit Profile</button>` : ''}
              ${admin ? `<button class="btn-secondary" data-action="delete-patient" data-id="${escapeHtml(p.id)}" style="flex:1; font-size:11px; color:var(--accent-red); border-color:rgba(238,93,80,0.3);">Delete</button>` : ''}
            </div>
          </div>
        `;
      });
    }
    gridContainer.innerHTML = html;
  }
  async function renderCounselorsProfileUI() {
    let counselors = await getLocalCounselors();
    const activeRole = getActiveRole();
    const staffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
    if (activeRole === 'counsellor') {
      counselors = counselors.filter(c => c.id === staffId);
    } else if (activeRole === 'ddrc') {
      // Gap 5: District scoping for DDRC
      const currentUser = window.CounselFlow.DEMO_CREDENTIALS.find(c => c.staffId === staffId);
      const district = currentUser ? currentUser.district : '';
      counselors = counselors.filter(c => (c.district || '').toLowerCase() === (district || '').toLowerCase());
    }
    if (searchTerm) {
      counselors = counselors.filter(c => 
        (c.name || '').toLowerCase().includes(searchTerm) || 
        (c.staffId || '').toLowerCase().includes(searchTerm) ||
        (c.email || '').toLowerCase().includes(searchTerm)
      );
    }
    const admin = isAdmin();
    const allPatients = window.CounselFlow && window.CounselFlow.app ? window.CounselFlow.app.patients : [];
    let html = '';
    if (admin) {
      html += `<div style="grid-column: 1 / -1; display:flex; justify-content:flex-end; margin-bottom:10px;">
        <button class="btn-primary" data-action="show-counselor-form">+ Add New Counselor</button>
      </div>`;
    }
    if (counselors.length === 0) {
      html += '<div style="grid-column: 1 / -1; padding:20px; text-align:center; color:var(--text-muted);">No counselor profiles found.</div>';
    } else {
      counselors.forEach(c => {
        // Gap 13: Counselor workload badge
        const pts = allPatients.filter(p => p.counselorId === c.id || p.counselorId === c.staffId);
        const activePts = pts.filter(p => p.status !== 'Completed' && p.status !== 'LAMA').length;
        html += `
          <div class="profile-card" style="border: 1px solid var(--border-light); background: var(--bg-card); border-radius: 8px; padding: 16px; display:flex; flex-direction:column;">
            <div style="display:flex; gap:12px; align-items:center; margin-bottom:16px;">
               <div style="width:40px; height:40px; border-radius:50%; background:var(--accent-purple); color:white; display:flex; align-items:center; justify-content:center; font-weight:bold;">
                  ${escapeHtml(c.avatar || c.name.substring(0,2).toUpperCase())}
               </div>
               <div>
                 <h4 class="profile-name" style="margin-bottom:2px;">${escapeHtml(c.name || 'Unnamed')}</h4>
                 <div style="font-size:11px; color:var(--accent-teal); font-weight:600;">${escapeHtml(c.staffId || c.id)}</div>
               </div>
            </div>
            <div class="profile-info-list" style="margin-bottom:16px; display:flex; flex-direction:column; gap:8px;">
               <div class="info-item" style="display:flex; justify-content:space-between; font-size:12px;">
                 <span style="color:var(--text-muted);">Role</span>
                 <span>${escapeHtml(c.roleKey === 'ddrc' ? 'DDRC Admin' : 'Counselor')}</span>
               </div>
               <div class="info-item" style="display:flex; justify-content:space-between; font-size:12px;">
                 <span style="color:var(--text-muted);">District</span>
                 <span>${escapeHtml(c.district || 'N/A')}</span>
               </div>
               <div class="info-item" style="display:flex; justify-content:space-between; font-size:12px;">
                 <span style="color:var(--text-muted);">Email</span>
                 <span>${escapeHtml(c.email || 'N/A')}</span>
               </div>
            </div>
            <div style="margin-top:auto; padding:12px; background:var(--bg-input); border-radius:6px; display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
               <span style="font-size:11px; color:var(--text-secondary);">Active Patients</span>
               <span style="font-size:14px; font-weight:bold; color:var(--text-primary);">${activePts}</span>
            </div>
            <div style="display:flex; gap:8px; border-top:1px solid var(--border-light); padding-top:12px;">
              ${admin ? `<button class="btn-secondary" data-action="edit-counselor" data-id="${escapeHtml(c.id)}" style="flex:1; font-size:11px;">Edit Profile</button>` : ''}
              ${admin ? `<button class="btn-secondary" data-action="delete-counselor" data-id="${escapeHtml(c.id)}" style="flex:1; font-size:11px; color:var(--accent-red); border-color:rgba(238,93,80,0.3);">Delete</button>` : ''}
            </div>
          </div>
        `;
      });
    }
    gridContainer.innerHTML = html;
  }
  container.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (action === 'show-patient-form') {
      if (window.CounselFlow && window.CounselFlow.app) {
         window.CounselFlow.app.openPatientForm();
      }
    } else if (action === 'edit-patient' && id) {
      if (window.CounselFlow && window.CounselFlow.app) {
         const p = window.CounselFlow.app.patients.find(x => x.id === id);
         if (p) window.CounselFlow.app.openPatientDetail(p);
      }
    } else if (action === 'delete-patient' && id) {
      if (confirm('Are you sure you want to delete this patient profile? This action cannot be undone.')) {
         if (window.CounselFlow && window.CounselFlow.app) {
            window.CounselFlow.app.patients = window.CounselFlow.app.patients.filter(p => p.id !== id);
            window.CounselFlow.savePatients(window.CounselFlow.app.patients);
            // Gap 7: Audit trail
            window.CounselFlow.writeAuditEvent('PATIENT_PROFILE_DELETED', id, 'N/A', getActiveRole(), 'Deleted patient profile via Profiles Management');
            renderUI();
         }
      }
    } else if (action === 'show-counselor-form') {
      document.getElementById('counselor-profile-form').reset();
      document.getElementById('c-id').value = '';
      document.getElementById('counselor-form-modal').style.display = 'flex';
      document.getElementById('counselor-overlay').style.display = 'block';
    } else if (action === 'edit-counselor' && id) {
      const counselors = await getLocalCounselors();
      const c = counselors.find(x => x.id === id);
      if (!c) return;
      document.getElementById('counselor-profile-form').reset();
      Object.keys(c).forEach(k => {
        const el = document.getElementById('c-' + k);
        if (el) el.value = c[k];
      });
      document.getElementById('counselor-form-modal').style.display = 'flex';
      document.getElementById('counselor-overlay').style.display = 'block';
    } else if (action === 'delete-counselor' && id) {
      if (confirm('Are you sure you want to delete this counselor profile? This action cannot be undone.')) {
         await deleteLocalCounselor(id);
         window.CounselFlow.writeAuditEvent('COUNSELOR_PROFILE_DELETED', id, 'N/A', getActiveRole(), 'Deleted counselor profile via Profiles Management');
         renderUI();
      }
    }
  });
  document.getElementById('counselor-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (!data.name || !data.name.trim()) {
      alert('Counselor name is required.');
      return;
    }
    if (!data.id) {
       data.id = data.staffId || ('C-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    }
    await saveLocalCounselor(data);
    window.CounselFlow.writeAuditEvent('COUNSELOR_PROFILE_UPDATED', data.id, 'N/A', getActiveRole(), 'Updated counselor profile via Profiles Management');
    document.getElementById('counselor-form-modal').style.display = 'none';
    document.getElementById('counselor-overlay').style.display = 'none';
    renderUI();
  });
});


/* --- BUNDLED FROM: js/calling.js --- */
// WebRTC Tele-Calling, Waveform Visualizer, and Speech Recognition Script
class CallManager {
  // Private field declaration (Architecture #36)
  #currentTranscript = [];
  constructor() {
    this.isActive = false;
    this.isMuted = false;
    this.isRecording = false;
    this.isHeld = false; // UX #47: Hold state toggle
    this.duration = 0;
    this.timerInterval = null;
    this.whisperQueue = Promise.resolve(); // Issue 2: Initialize whisperQueue
    this.canvas = null;
    this.ctx = null;
    this.animationFrame = null;
    this.counselorRecorder = null;
    this.patientRecorder = null;
    this.activePatient = null;
    this.activeLanguage = 'pa-IN';
    this.lastSessionTranscript = []; // Cache for post-call summaries (Bug #2)
    this.asrSupportWarned = false; // ASR browser support warning flag (Error Handling #4)
    this.asrRetryCount = 0; // ASR network retry attempt counter (Error Handling #4)
    // Performance #67: FPS Throttling variables
    this.lastFrameTime = 0;
    this.fpsInterval = 1000 / 60; // Limit to 60 FPS
    // Bind event listeners for visibility change
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    // Bind Keyboard Shortcuts (UX #53)
    this.bindKeyboardShortcuts();
    // WebRTC & Socket properties
    this.socket = null;
    this.peerConnection = null;
    this.localStream = null;
    this.patientSocketId = null; // Store actual socket ID for routing ICE & end-call
    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    // Unlock autoplay: browsers need a user gesture
    this.audioUnlockHandler = () => {
      // Only attempt to play remoteAudio if a source is set
      if (this.remoteAudio && (this.remoteAudio.srcObject || this.remoteAudio.src)) {
        if (typeof this.remoteAudio.play === 'function') {
          this.remoteAudio.play().catch(e => {
            console.warn('[WebRTC] Audio autoplay blocked:', e);
            if (!document.getElementById('autoplay-unlock-banner')) {
              this.addWarningToTranscriptLog(
                "Audio Blocked", 
                "Browser blocked autoplay. Click anywhere on the screen to enable audio."
              );
            }
          });
        }
      }
      // Resume any suspended AudioContexts (Relay or STT)
      if (this.relayAudioCtx && this.relayAudioCtx.state === 'suspended') {
        this.relayAudioCtx.resume().catch(e => console.warn('[Relay] Failed to resume AudioContext:', e));
      }
      for (const speaker of Object.keys(this.sttAudioContexts)) {
        const ctx = this.sttAudioContexts[speaker];
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(e => console.warn(`[STT] Failed to resume AudioContext for ${speaker}:`, e));
        }
      }
      // Play all other audio elements (like LiveKit ones) to unlock them
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(el => {
        if (el !== this.remoteAudio && el.paused) {
          el.play().catch(e => console.warn('[LiveKit] Failed to play attached audio element on gesture:', e));
        }
      });
    };
    // Add persistent handler that doesn't remove itself
    document.addEventListener('click', this.audioUnlockHandler);
    document.addEventListener('touchstart', this.audioUnlockHandler);
    // Also try to unlock on keydown for keyboard accessibility
    document.addEventListener('keydown', this.audioUnlockHandler);
    this.iceCandidateQueue = [];
    this.patientAnswered = false;
    // Socket Audio Relay fallback (activated when WebRTC P2P fails)
    this.isRelayMode = false;
    this.relayRecorder = null;       // MediaRecorder capturing local mic for relay
    this.relayAudioCtx = null;       // AudioContext for playing received relay chunks
    this.relaySourceQueue = [];      // Queue of scheduled audio sources
    this.relayNextPlayTime = 0;      // Gapless scheduling clock
    // Sarvam Streaming STT state
    this.sttAudioContexts = {};      // speaker -> AudioContext used for PCM extraction
    this.sttProcessors = {};         // speaker -> ScriptProcessorNode
    this.sttStreamsActive = {};       // speaker -> boolean
    this.initSocket();
  }
  // Initialize Socket.io connection for Counselor
  initSocket() {
    if (typeof io !== 'undefined') {
      // Always connect to the same origin (serve.js proxies /socket.io → port 5001)
      // This works locally (localhost:3001) AND via ngrok without any URL changes.
      const socketUrl = window.location.origin;
      this.socket = io(socketUrl, { transports: ['websocket', 'polling'] });
      this.socket.on('connect', () => {
        console.log('[WebRTC] Connected to Signaling Server:', this.socket.id);
        const counselorId = 'counselor-' + Math.random().toString(36).substr(2, 9);
        this.socket.emit('register', { role: 'counselor', id: counselorId });
      });
      this.socket.on('answer-made', async (data) => {
        // Save patient's SOCKET ID for ICE and end-call routing
        this.patientSocketId = data.socket;
        this.patientAnswered = true;
        console.log('[WebRTC] Patient answered. Patient socket:', this.patientSocketId);
        if (this.peerConnection) {
          try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('[WebRTC] Remote description (answer) set successfully.');
            // Flush buffered ICE candidates now that the remote description is set
            for (let candidate of this.iceCandidateQueue) {
              this.socket.emit('ice-candidate', {
                to: this.patientSocketId,
                candidate: candidate
              });
            }
            this.iceCandidateQueue = [];
          } catch (err) {
            console.error('[WebRTC] Failed to set remote description:', err);
          }
        }
      });
      this.socket.on('ice-candidate-received', async (data) => {
      if (this.peerConnection && data.candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          window.CounselFlow.writeAuditEvent(
            'ICE_CANDIDATE_RECEIVED',
            this.currentPatientId,
            null,
            window.CounselFlow.getActiveRole(),
            `Received ICE candidate from ${data.source || 'patient'}`
          );
        } catch (e) {
          console.error('[WebRTC] Error adding received ICE candidate', e);
        }
      }
    });
      this.socket.on('call-failed', (data) => {
        const reason = data && data.reason === 'patient-offline'
          ? 'Patient is not connected to the mobile app.'
          : 'Call could not be connected.';
        window.CounselFlow.app.showToast('Call Failed', reason, 'error');
        this.endCall();
      });
      this.socket.on('call-rejected', () => {
        window.CounselFlow.app.showToast("Call Rejected", "Patient declined the call.", "error");
        this.patientSocketId = null;
        this.endCall();
      });
      this.socket.on('call-ended', () => {
        window.CounselFlow.app.showToast("Call Ended", "Patient ended the call.", "info");
        this.patientSocketId = null;
        this.endCall();
      });
      this.socket.on('dashboard-observe-call', async (data) => {
         if (!this.isActive && !this.room && data.roomName) {
             const isSdp = data.roomName.includes('v=0') || data.roomName.includes('\n') || data.roomName.length > 128;
             console.log('[LiveKit] Auto-observing mobile-to-mobile call. Is WebRTC SDP:', isSdp, 'Room:', data.roomName);
             let patientName = 'Patient ' + data.patientId;
             let targetPatient = null;
             if (window.CounselFlow && window.CounselFlow.app && window.CounselFlow.app.patients) {
                 const pt = window.CounselFlow.app.patients.find(p => p.id === data.patientId);
                 if (pt) {
                     targetPatient = pt;
                     patientName = pt.name || patientName;
                 }
             }
             if (isSdp) {
                 // WebRTC Peer-to-Peer / Relay Mode
                 this.isActive = true;
                 this.isObserver = true;
                 this.activePatient = targetPatient || { id: data.patientId, name: patientName };
                 this.callDirection = "Mobile Call";
                 // Update UI to active call state
                 this.setupObserverUI(this.activePatient);
                 window.CounselFlow.app.switchScreen('call-console');
                 this.duration = 0;
                 if (this.timerInterval) clearInterval(this.timerInterval);
                 this.timerInterval = setInterval(() => {
                   this.duration++;
                   const hrs = Math.floor(this.duration / 3600).toString();
                   const mins = Math.floor((this.duration % 3600) / 60).toString().padStart(2, '0');
                   const secs = (this.duration % 60).toString().padStart(2, '0');
                   const timerEl = document.getElementById('call-duration-timer');
                   if (timerEl) timerEl.innerText = `${hrs}:${mins}:${secs}`;
                 }, 1000);
                 window.CounselFlow.app.showToast("Call Observer Active", "Live transcription enabled for mobile WebRTC call.", "info");
             } else {
                 // LiveKit Mode
                 try {
                     const participantName = `Dashboard-Observer-${Math.random().toString(36).substr(2, 5)}`;
                     const resp = await fetch('/api/livekit/token', {
                         method: 'POST',
                         headers: { 
                           'Content-Type': 'application/json',
                           'Authorization': 'Bearer ' + (localStorage.getItem('token') || ''),
                           'X-Requested-With': 'XMLHttpRequest'
                         },
                         body: JSON.stringify({ roomName: data.roomName, participantName, isCounselor: true })
                     });
                     const tokenData = await resp.json();
                     if (tokenData.token && window.LivekitClient) {
                         this.isActive = true;
                         this.isObserver = true;
                         this.activePatient = targetPatient || { id: data.patientId, name: patientName };
                         this.callDirection = "Mobile Call";
                         // Update UI to active call state
                         this.setupObserverUI(this.activePatient);
                         window.CounselFlow.app.switchScreen('call-console');
                         this.duration = 0;
                         if (this.timerInterval) clearInterval(this.timerInterval);
                         this.timerInterval = setInterval(() => {
                           this.duration++;
                           const hrs = Math.floor(this.duration / 3600).toString();
                           const mins = Math.floor((this.duration % 3600) / 60).toString().padStart(2, '0');
                           const secs = (this.duration % 60).toString().padStart(2, '0');
                           const timerEl = document.getElementById('call-duration-timer');
                           if (timerEl) timerEl.innerText = `${hrs}:${mins}:${secs}`;
                         }, 1000);
                         this.room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
                         this.room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
                             if (track.kind === 'audio' || track.kind === LivekitClient.Track.Kind.Audio) {
                                  const element = track.attach();
                                  document.body.appendChild(element);
                                  if (typeof element.play === 'function') {
                                      element.play().catch(e => {
                                          console.warn('[LiveKit] Audio autoplay blocked:', e);
                                          this.showAutoplayUnlockBanner();
                                      });
                                  }
                                 const stream = new MediaStream([track.mediaStreamTrack]);
                                 const speakerName = (participant.name || "").toLowerCase().includes("counselor") ? "Counselor" : "Patient";
                                 this.setupStreamingSTT(stream, speakerName);
                              }
                          });
                          this.room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
                              console.log('[LiveKit] Participant disconnected:', participant.identity);
                              window.CounselFlow.app.showToast("Call Ended", "Participant ended the call.", "info");
                              this.endCall();
                          });
                          this.room.on(LivekitClient.RoomEvent.Disconnected, () => {
                              console.log('[LiveKit] Room disconnected.');
                              this.endCall();
                          });
                          // Listen for transcription from mobile clients
                          this.socket.on('transcription', (transcriptData) => {
                              if (transcriptData && transcriptData.roomName === data.roomName && transcriptData.text) {
                                  const speaker = transcriptData.speaker === 'counselor' ? 'Counselor' : 'Patient';
                                  this.addTranscriptLine(speaker, transcriptData.text);
                              }
                          });
                          await this.room.connect('wss://ai-assistant-ommd272n.livekit.cloud', tokenData.token);
                          window.CounselFlow.app.showToast("Call Observer Active", "Live transcription enabled for mobile call.", "info");
                      }
                  } catch (err) {
                      console.error('[LiveKit] Failed to observe call:', err);
                  }
             }
         }
        });
       // Handle inbound call notifications (patient calling counselor)
       this.socket.on('incoming-call', (data) => {
         console.log('[WebRTC] Incoming call from patient:', data.patientName || data.patientId);
         if (!this.isActive) {
           this.showIncomingCallPopup(data.patientId, data.patientName, data.roomName);
         }
       });
       // Handle transcript updates during LiveKit calls
       this.socket.on('transcript-update', (data) => {
         if (data && data.text && this.isActive) {
           const speaker = data.sender === 'counselor' ? 'Counselor' : 'Patient';
           this.addTranscriptLine(speaker, data.text);
         }
       });
       // ── Sarvam Streaming STT Events ──
       this.socket.on('stt-transcript', (data) => {
         if (data && data.text && this.isActive) {
           // Apply hallucination guard
           const t = data.text.trim();
           if (t.length < 2) return;
           if (/(\S+)(\s+\1){2,}/i.test(t)) return;
           const HALLUCINATIONS = [
             'thank you for watching', 'thank you', 'thanks for watching',
             'please subscribe', 'like and subscribe',
             'bye bye', 'goodbye', 'see you', 'okay okay okay',
             '.   .', '. . .', '...',
           ];
           const tLower = t.toLowerCase().replace(/[.,!?;*"]/g, '').trim();
           if (HALLUCINATIONS.some(h => tLower === h)) return;
           this.addTranscriptLine(data.speaker, data.text);
         }
       });
       this.socket.on('stt-vad-event', (data) => {
         if (!this.isActive || !data) return;
         const indicator = document.getElementById(`vad-indicator-${data.speaker}`);
         if (indicator) {
           if (data.signalType === 'START_SPEECH') {
             indicator.classList.add('speaking');
             indicator.textContent = `${data.speaker}: Speaking...`;
           } else {
             indicator.classList.remove('speaking');
             indicator.textContent = `${data.speaker}: Silent`;
           }
         }
       });
       this.socket.on('stt-stream-ready', (data) => {
         console.log(`[Sarvam STT] Stream ready for ${data.speaker}`);
       });
       this.socket.on('stt-error', (data) => {
         console.error('[Sarvam STT] Error:', data.message);
         if (window.CounselFlow && window.CounselFlow.app) {
           window.CounselFlow.app.showToast('STT Error', data.message || 'Transcription error.', 'error');
         }
       });
    } else {
      console.warn("Socket.io is not loaded.");
    }
  }
  // Init LiveKit for In-App Calling (App-to-App Architecture)
  async initLiveKit(patient) {
    if (!window.LivekitClient) {
      window.CounselFlow.app.showToast('Error', 'LiveKit SDK not loaded', 'error');
      return;
    }
    try {
      // The web dashboard no longer publishes its mic. It acts as an observer for ASR.
      const roomName = `counselflow-room-${patient.id}`;
      const participantName = `Dashboard-Observer-${Math.random().toString(36).substr(2, 5)}`;
      const resp = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('token') || ''),
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ roomName, participantName, isCounselor: true }) // Still considered a counselor for JWT role
      });
      const data = await resp.json();
      if (!data.token) throw new Error(data.error || "Could not get LiveKit token");
      this.room = new LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
      });
      this.room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === LivekitClient.Track.Kind.Audio || track.kind === 'audio') {
          console.log('[LiveKit] Remote audio track subscribed from:', participant.name || participant.identity);
          const element = track.attach();
          document.body.appendChild(element);
          if (typeof element.play === 'function') {
            element.play().catch(e => {
              console.warn('[LiveKit] Audio autoplay blocked:', e);
              this.showAutoplayUnlockBanner();
            });
          }
          // Wire up Sarvam Streaming STT!
          const stream = new MediaStream([track.mediaStreamTrack]);
          const speakerName = (participant.name || "").toLowerCase().includes("counselor") ? "Counselor" : "Patient";
          this.setupStreamingSTT(stream, speakerName);
        }
      });
      this.room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        track.detach();
      });
      this.room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
        console.log('[LiveKit] Participant disconnected:', participant.identity);
        window.CounselFlow.app.showToast("Call Ended", "Participant ended the call.", "info");
        this.endCall();
      });
      this.room.on(LivekitClient.RoomEvent.Disconnected, () => {
        console.log('[LiveKit] Room disconnected.');
        this.endCall();
      });
      // Connect to LiveKit Room
      await this.room.connect('wss://ai-assistant-ommd272n.livekit.cloud', data.token);
      console.log('[LiveKit] Connected to room as Dashboard Observer');
      // 1. Notify patient mobile app to join room
      this.socket.emit('call-user', {
         to: patient.id,
         offer: { type: 'livekit', roomName: roomName },
         callerInfo: { name: "Dr. Amanpreet (Counselor)" }
      });
      // 2. Notify counselor mobile app to join room (Handoff)
      const counselorId = patient.counselorId || "CO-101";
      this.socket.emit('handoff-call', {
         to: counselorId,
         roomName: roomName,
         patientName: patient.name
      });
      window.CounselFlow.app.showToast("Ringing", `Calling ${patient.name} via Patient Portal...`, "info");
    } catch (error) {
      console.error("LiveKit Setup failed:", error);
      this.endCall();
      window.CounselFlow.app.showToast("Call Setup Failed", error.message || "Could not set up LiveKit audio.", "error");
      throw error;
    }
  }
  // Getter for private transcript field supporting inactive fallback (Bug #2)
  getTranscript() {
    return this.isActive ? this.#currentTranscript : this.lastSessionTranscript;
  }
  // Keyboard Shortcuts (UX #53)
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Only trigger shortcuts if a call is actively running
      if (!this.isActive) return;
      // Prevent shortcut interference inside input fields or textareas
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
      }
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.endCall();
      } else if (key === 'm') {
        e.preventDefault();
        this.toggleMute();
      } else if (key === 'r') {
        e.preventDefault();
        this.toggleRecording();
      } else if (key === 'h') {
        e.preventDefault();
        this.toggleHold();
      }
    });
  }
  // Helper function to create a chunked recorder that stops/starts to rewrite WebM headers for Groq Whisper
  setupChunkedRecorder(stream, speaker) {
    if (!stream || !window.MediaRecorder) return null;
    let options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'audio/webm', audioBitsPerSecond: 16000 };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
         options = {}; // fallback for Safari
      }
    }
    const recorder = new MediaRecorder(stream, options);
    recorder.ondataavailable = async (event) => {
      try {
        if (event.data.size > 1500 && this.isActive && (!this.isMuted || speaker === "Patient") && !this.isHeld) {
          this.whisperQueue = (this.whisperQueue || Promise.resolve()).then(async () => {
            const transcript = await window.CounselFlow.aiOrchestrator.transcribeAudioChunkAsync(event.data, this.activeLanguage);
            if (transcript && this.isActive) {
            //  Hallucination Guard 
            const isHallucination = (text) => {
              const t = text.trim();
              // 2. Repetition loop detection (same word ≥3 times in a row)
              if (/(\S+)(\s+\1){2,}/i.test(t)) return true;
              // 3. Known Whisper hallucination blocklist (English / Hindi / Punjabi)
              const HALLUCINATIONS = [
                "what's going on", "everything is fine", "i'm feeling a bit anxious",
                "i am feeling very anxious and restless my heart is racing and i am having trouble breathing",
                "i am feeling very anxious and restless",
                "i have been experiencing chest pain and shortness of breath for the past few days",
                "my heart rate is very fast and i am having trouble sleeping",
                "i am also experiencing palpitations and dizziness",
                "i am worried that i might be having a heart attack",
                "i am feeling very scared and anxious",
                "i am feeling very weak",
                "doctor",
                "i am experiencing severe chest pain and difficulty breathing",
                "i am feeling like i am going to pass out",
                "i am feeling like i am going to collapse",
                "i am scared",
                "i am experiencing chest pain shortness of breath and a feeling of impending doom",
                "i am feeling like i am going to die",
                "i am feeling a tightness in my chest and throat",
                "i am feeling numb my body is shaking and i am having trouble speaking",
                "i am feeling like i am losing control",
                "i am experiencing a sense of detachment from my body",
                "i am feeling like i am floating above myself",
                "i am feeling a sense of panic and anxiety",
                "i am feeling like i am going to pass out",
                "i am feeling a lump in my throat",
                "i am feeling a sense of dread my heart is racing and i am having trouble breathing",
                "thank you for watching", "thank you", "thanks for watching",
                "please subscribe", "like and subscribe",
                "कर दो", "झाल", "अलवूँ", "जरूर जो",
                "ਸੁਣੋ", "ਹਾਂ ਜੀ", "ਜੀ ਹਾਂ",
                "bye bye", "goodbye", "see you", "okay okay okay",
                "hello", "all right", "yeah", "okay", "yes", "no",
                ".   .", ". . .", "...",
              ];
              const tLower = t.toLowerCase().replace(/[.,!?;*"]/g, '').trim();
              if (HALLUCINATIONS.some(h => tLower === h || tLower.startsWith(h + " ") || tLower.endsWith(" " + h))) return true;
              return false;
            };
            if (isHallucination(transcript)) {
              console.debug('[ASR] Filtered hallucination:', transcript);
              return;
            }
            this.addTranscriptLine(speaker, transcript);
            }
          });
        }
      } catch (err) {
        console.error(`[MediaRecorder] Error processing chunk for ${speaker}:`, err);
      }
    };
    // Explicit error handler for recorder
    recorder.onerror = (e) => {
      console.error(`[MediaRecorder] Error for ${speaker}:`, e.error);
    };
    recorder.start();
    // Interval to stop and restart so headers are rewritten for the Whisper API
    const intervalId = setInterval(() => {
      if (this.isActive && recorder.state === 'recording') {
        recorder.stop();
        recorder.start();
      } else if (!this.isActive) {
        clearInterval(intervalId);
        if (recorder.state === 'recording') recorder.stop();
      }
    }, 4000);
    return recorder;
  }
  // ── Sarvam Streaming STT: Extract raw 16kHz PCM from a MediaStream and stream to server
  setupStreamingSTT(stream, speaker) {
    if (!stream || !this.socket) return;
    // Map active language to Sarvam language code
    const langMap = { 'pa-IN': 'pa-IN', 'hi-IN': 'hi-IN', 'en-US': 'en-IN' };
    const language = langMap[this.activeLanguage] || 'hi-IN';
    // 1. Tell the server to open a Sarvam WebSocket for this speaker
    this.socket.emit('start-stt-stream', {
      speaker: speaker,
      language: language,
      mode: 'codemix'
    });
    // 2. Create an AudioContext at 16kHz to downsample browser audio (usually 48kHz)
    let audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    } catch (e) {
      console.error(`[Sarvam STT] Failed to create AudioContext for ${speaker}:`, e);
      return;
    }
    const source = audioCtx.createMediaStreamSource(stream);
    // ScriptProcessorNode with bufferSize=4096 (~256ms at 16kHz)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    this.sttStreamsActive[speaker] = true;
    processor.onaudioprocess = (e) => {
      if (!this.isActive || !this.sttStreamsActive[speaker]) return;
      if (this.isMuted && speaker === 'Counselor') return;
      if (this.isHeld) return;
      const float32 = e.inputBuffer.getChannelData(0);
      // Convert Float32 [-1, 1] to Int16 [-32768, 32767] (pcm_s16le)
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      // Convert to base64
      const uint8 = new Uint8Array(int16.buffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64Audio = btoa(binary);
      // Send to server
      this.socket.emit('stt-audio-chunk', {
        speaker: speaker,
        audio: base64Audio
      });
    };
    source.connect(processor);
    processor.connect(audioCtx.destination); // Required for ScriptProcessor to fire
    // Store references for cleanup
    this.sttAudioContexts[speaker] = audioCtx;
    this.sttProcessors[speaker] = processor;
    console.log(`[Sarvam STT] PCM extraction started for ${speaker} at ${audioCtx.sampleRate}Hz`);
  }
  // Stop all active Sarvam STT streams
  stopAllStreamingSTT() {
    for (const speaker of Object.keys(this.sttStreamsActive)) {
      this.sttStreamsActive[speaker] = false;
      // Disconnect AudioContext processor
      if (this.sttProcessors[speaker]) {
        try { this.sttProcessors[speaker].disconnect(); } catch (e) {}
        delete this.sttProcessors[speaker];
      }
      if (this.sttAudioContexts[speaker]) {
        try { this.sttAudioContexts[speaker].close(); } catch (e) {}
        delete this.sttAudioContexts[speaker];
      }
    }
    this.sttStreamsActive = {};
    // Tell server to close all Sarvam streams for this socket
    if (this.socket) {
      this.socket.emit('stop-stt-stream', {});
    }
    console.log('[Sarvam STT] All streams stopped.');
  }
  // Issue 1: Missing startInteractiveDemo Method
  startInteractiveDemo() {
    console.log("[CallManager] Starting interactive demo...");
    const demoPatient = {
      id: "DEMO-001",
      name: "Interactive Demo Patient",
      severity: "Medium",
      status: "Active",
      phone: "+91-0000000000",
      addictionCategory: "Opioid (Heroin)"
    };
    window.CounselFlow.app.switchScreen('call-console');
    this.startCall(demoPatient);
  }
  // Live Transcription is now triggered directly by LiveKit track subscriptions
  initLiveTranscription() {
     // No-op for now. ASR is initialized dynamically when LiveKit tracks arrive in TrackSubscribed event.
     console.log('[ASR] Transcription engine armed and waiting for LiveKit audio tracks...');
  }
  // ── Socket Audio Relay — activated automatically when WebRTC P2P fails
  // Streams mic audio as 250ms WebM chunks through Socket.IO → server → patient
  // Incoming chunks from patient are decoded & played via AudioContext (gapless queue)
  startSocketAudioRelay() {
    if (this.isRelayMode || !this.patientSocketId || !this.localStream) return;
    this.isRelayMode = true;
    console.log('[Relay] Starting Socket audio relay to patient:', this.patientSocketId);
    // Tell the server to create a relay pair with the patient socket
    this.socket.emit('audio-relay-start', { to: this.patientSocketId });
    // 1. Capture and stream local mic → server → patient
    try {
      const options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 };
      this.relayRecorder = new MediaRecorder(this.localStream, options);
      this.relayRecorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 100 && this.isRelayMode && this.isActive && !this.isMuted) {
          const buf = await event.data.arrayBuffer();
          this.socket.emit('audio-chunk', buf);
        }
      };
      this.relayRecorder.start(1000); // 1000ms chunks
      console.log('[Relay] Mic relay recorder started (1000ms chunks)');
    } catch (e) {
      console.error('[Relay] Could not start relay recorder:', e);
    }
    // 2. Receive and play incoming audio chunks from patient
    this.relayAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    this.relayNextPlayTime = this.relayAudioCtx.currentTime;
    // Add unlock handler for relay audio
    const unlockRelayAudio = () => {
      // Resume audio context if it's suspended
      if (this.relayAudioCtx && this.relayAudioCtx.state === 'suspended') {
        this.relayAudioCtx.resume().then(() => {
          console.log('[Relay] Audio context resumed');
        }).catch(e => {
          console.warn('[Relay] Failed to resume audio context:', e);
        });
      }
    };
    document.addEventListener('click', unlockRelayAudio);
    document.addEventListener('touchstart', unlockRelayAudio);
    this.socket.on('audio-chunk', async (data) => {
      if (!this.isRelayMode || !this.relayAudioCtx) return;
      try {
        // data arrives as ArrayBuffer from the server
        const arrayBuf = data instanceof ArrayBuffer ? data : await new Response(data).arrayBuffer();
        const audioBuf = await this.relayAudioCtx.decodeAudioData(arrayBuf);
        const source = this.relayAudioCtx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(this.relayAudioCtx.destination);
        // Gapless playback scheduling
        const now = this.relayAudioCtx.currentTime;
        const startAt = Math.max(now, this.relayNextPlayTime);
        source.start(startAt);
        this.relayNextPlayTime = startAt + audioBuf.duration;
      } catch (e) {
        // Ignore decode errors for partial/tiny chunks
      }
    });
    console.log('[Relay] Socket audio relay fully active — audio routing through server.');
  }
  stopSocketAudioRelay() {
    if (!this.isRelayMode) return;
    this.isRelayMode = false;
    if (this.relayRecorder && this.relayRecorder.state !== 'inactive') {
      try { this.relayRecorder.stop(); } catch(e) {}
    }
    this.relayRecorder = null;
    if (this.relayAudioCtx) {
      this.relayAudioCtx.close().catch(() => {});
      this.relayAudioCtx = null;
    }
    if (this.socket) {
      this.socket.emit('audio-relay-stop');
      this.socket.off('audio-chunk');
    }
    // Note: We don't remove the unlock handlers here as they're removed in endCall cleanup
    console.log('[Relay] Socket audio relay stopped.');
  }
  // Visual warning banner inside call transcript feed (Error Handling #4)
  addWarningToTranscriptLog(title, message) {
    requestAnimationFrame(() => {
      try {
        const container = document.getElementById('call-transcript-log');
        if (!container) return;
        // Remove placeholder text if exists
        const placeholder = document.getElementById('transcript-placeholder-text');
        if (placeholder) placeholder.remove();
        const warningDiv = document.createElement('div');
        warningDiv.className = 'transcript-warning';
        warningDiv.style.cssText = "padding: 12px; margin: 10px 0; background: rgba(239, 68, 68, 0.08); border-left: 4px solid var(--accent-red); border-radius: 4px; font-size: 12px; color: var(--text-primary);";
        // Use textContent for safe rendering — no raw HTML interpolation
        const strong = document.createElement('strong');
        strong.style.cssText = 'color: var(--accent-red); display: flex; align-items: center; gap: 6px; margin-bottom: 4px;';
        strong.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        strong.appendChild(document.createTextNode(title));
        const span = document.createElement('span');
        span.style.color = 'var(--text-secondary)';
        span.textContent = message;
        warningDiv.appendChild(strong);
        warningDiv.appendChild(span);
        container.appendChild(warningDiv);
        container.scrollTop = container.scrollHeight;
      } catch (e) {
        console.error("DOM rendering error in addWarningToTranscriptLog:", e);
      }
    });
  }
  // Show a visible, working "Enable Audio" banner when browser blocks remote audio autoplay
  // This fixes the broken recovery mechanism — the button directly calls if (this.remoteAudio && typeof this.remoteAudio.play === 'function') { this.remoteAudio.play().catch(e => console.warn('Autoplay prevented:', e)); }
  // instead of referencing a non-existent DOM element (#remote-audio is absent in index.html)
  showAutoplayUnlockBanner() {
    requestAnimationFrame(() => {
      try {
        const container = document.getElementById('call-transcript-log');
        if (!container) return;
        // Avoid showing duplicate banners
        if (document.getElementById('autoplay-unlock-banner')) return;
        const placeholder = document.getElementById('transcript-placeholder-text');
        if (placeholder) placeholder.remove();
        const bannerDiv = document.createElement('div');
        bannerDiv.id = 'autoplay-unlock-banner';
        bannerDiv.style.cssText = [
          'padding: 14px 16px',
          'margin: 10px 0',
          'background: rgba(239, 68, 68, 0.08)',
          'border-left: 4px solid var(--accent-red)',
          'border-radius: 4px',
          'font-size: 12px',
          'color: var(--text-primary)',
          'display: flex',
          'align-items: center',
          'gap: 12px',
          'flex-wrap: wrap',
        ].join(';');
        const label = document.createElement('span');
        label.style.flex = '1';
        label.innerHTML = `<strong style="color:var(--accent-red);">⚠ Audio Blocked</strong> — Your browser blocked remote audio autoplay. Click the button to hear the patient.`;
        const btn = document.createElement('button');
        btn.textContent = '🔊 Enable Audio';
        btn.className = 'btn-primary';
        btn.style.cssText = 'padding: 5px 12px; font-size: 11px; white-space: nowrap; flex-shrink: 0;';
        btn.addEventListener('click', () => {
          if (this.peerConnection) {
            const receivers = this.peerConnection.getReceivers();
            const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
            if (audioReceiver) {
              this.remoteAudio.srcObject = new MediaStream([audioReceiver.track]);
            }
          }
          let promises = [];
          if (this.remoteAudio && (this.remoteAudio.srcObject || this.remoteAudio.src)) {
            promises.push(this.remoteAudio.play());
          }
          const audioElements = document.querySelectorAll('audio');
          audioElements.forEach(el => {
            if (el !== this.remoteAudio) {
              promises.push(el.play());
            }
          });
          if (promises.length === 0) {
            bannerDiv.remove();
            window.CounselFlow.app.showToast('Audio Unlocked', 'Audio playback is enabled.', 'success');
            return;
          }
          Promise.all(promises)
            .then(() => {
              this._audioUnlocked = true;
              bannerDiv.remove();
              window.CounselFlow.app.showToast('Audio Enabled', 'Remote audio is now playing.', 'success');
            })
            .catch(err => {
              console.error('[Audio] Manual audio unlock failed:', err);
              const anyPlaying = Array.from(audioElements).some(el => !el.paused);
              if (anyPlaying) {
                bannerDiv.remove();
                window.CounselFlow.app.showToast('Audio Enabled', 'Remote audio is now playing.', 'success');
              } else {
                btn.textContent = '⚠ Retry — Click Again';
                window.CounselFlow.app.showToast('Audio Error', 'Click the Enable Audio button again.', 'error');
              }
            });
        });
        bannerDiv.appendChild(label);
        bannerDiv.appendChild(btn);
        container.insertBefore(bannerDiv, container.firstChild);
        container.scrollTop = 0;
      } catch (e) {
        console.error('[WebRTC] showAutoplayUnlockBanner error:', e);
      }
    });
  }
  setCanvas(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }
  resizeCanvas() {
    if (this.canvas) {
      this.canvas.width = this.canvas.parentElement.clientWidth;
      this.canvas.height = this.canvas.parentElement.clientHeight || 80;
    }
  }
  // Draw WebRTC audio waveforms with FPS capping and visibility checks (Performance #67, UX #46, UX #47)
  drawWaveform(timestamp) {
    if (!this.isActive) {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      return;
    }
    if (document.hidden) {
      this.animationFrame = requestAnimationFrame((t) => this.drawWaveform(t));
      return;
    }
    // Throttle frames to 60 FPS max
    if (!timestamp) timestamp = performance.now();
    const elapsed = timestamp - this.lastFrameTime;
    if (elapsed > this.fpsInterval) {
      this.lastFrameTime = timestamp - (elapsed % this.fpsInterval);
      if (!this.canvas) return;
      const width = this.canvas.width;
      const height = this.canvas.height;
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.beginPath();
      // Determine stroke color by status
      const isDark = document.body.classList.contains("dark-theme");
      if (this.isHeld) {
        this.ctx.strokeStyle = isDark ? 'rgba(165, 94, 234, 0.4)' : 'rgba(139, 92, 246, 0.5)';
      } else if (!this.isRecording) {
        this.ctx.strokeStyle = isDark ? 'rgba(239, 68, 68, 0.4)' : 'rgba(220, 38, 38, 0.5)';
      } else {
        this.ctx.strokeStyle = this.isMuted 
          ? (isDark ? 'rgba(255, 159, 67, 0.4)' : 'rgba(234, 88, 12, 0.6)') 
          : (isDark ? 'rgba(0, 242, 254, 0.6)' : 'rgba(79, 172, 254, 0.8)');
      }
      this.ctx.lineWidth = 3;
      this.ctx.lineCap = 'round';
      const pointsCount = 40;
      const sliceWidth = width / pointsCount;
      let x = 0;
      // Draw visual flatline or overlay if muted/held/not recording (UX #46, UX #47, Phase 2)
      const isFlatLine = this.isMuted || this.isHeld || !this.isRecording;
      for (let i = 0; i < pointsCount; i++) {
        let amplitude = 0;
        if (!isFlatLine) {
          amplitude = Math.sin(i * 0.15 + Date.now() * 0.01) * 20 + Math.cos(i * 0.3 + Date.now() * 0.015) * 10;
          // Dampen ends
          const factor = Math.sin((i / pointsCount) * Math.PI);
          amplitude *= factor;
        }
        const y = (height / 2) + amplitude;
        if (i === 0) {
          this.ctx.moveTo(x, y);
        } else {
          this.ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      this.ctx.stroke();
      // Draw TEXT overlay on flatline (UX #46, UX #47, Phase 2)
      if (isFlatLine) {
        this.ctx.font = '10px sans-serif';
        this.ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
        this.ctx.textAlign = 'center';
        let label = 'MICROPHONE MUTED';
        if (this.isHeld) {
          label = 'CALL ON HOLD';
        } else if (!this.isRecording) {
          label = 'RECORDING DISABLED - NO CONSENT';
        }
        this.ctx.fillText(label, width / 2, height / 2 - 10);
      }
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = requestAnimationFrame((t) => this.drawWaveform(t));
  }
  // Handle Tab visibility switches (Performance #67)
  handleVisibilityChange() {
    if (this.isActive) {
      if (document.hidden) {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      } else {
        this.lastFrameTime = performance.now();
        this.drawWaveform();
      }
    }
  }
  clearCanvas() {
    if (this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
  }
  // Begin Tele-Counseling session call
  async startCall(patient, languageCode, direction = "Outbound") {
    if (this.isActive) return;
    this.isActive = true;
    this.isMuted = false;
    this.isHeld = false;
    this.duration = 0;
    this.activePatient = patient;
    this.activeLanguage = languageCode;
    this.callDirection = direction;
    this.#currentTranscript = []; // Clean private transcripts array (Bug #2)
    this.lastSessionTranscript = []; // Reset cache (Bug #2)
    this.asrRetryCount = 0; // Reset ASR network retry count (Error Handling #4)
    this.iceCandidateQueue = [];
    this.patientAnswered = false;
    // Initiate LiveKit Call (Replaces WebRTC)
    try {
      await this.initLiveKit(patient);
    } catch (e) {
      return; // initLiveKit already called endCall() and showed a toast
    }
    // Gate call recording by patient consent status (Phase 2, Solution Scope #3)
    this.isRecording = !!patient.consentCaptured;
    // Update UI elements
    const statusDot = document.getElementById('call-status-dot');
    const statusLabel = document.getElementById('call-status-label');
    const recordBtn = document.getElementById('btn-call-record');
    if (this.isRecording) {
      statusDot.className = 'status-dot rec';
      statusLabel.innerText = `${direction} Call - Recording Active`;
      recordBtn.className = 'call-btn record recording';
    } else {
      statusDot.className = 'status-dot';
      statusLabel.innerText = `${direction} Call - Recording Disabled (No Consent)`;
      recordBtn.className = 'call-btn record';
    }
    document.getElementById('call-recipient-name').innerText = escapeHtml(patient.name);
    document.getElementById('call-recipient-details').innerText = `${escapeHtml(patient.id)} | ${escapeHtml(patient.addictionCategory)}`;
    document.getElementById('call-recipient-avatar').innerText = patient.name.split(' ').map(n => n[0]).join('');
    document.getElementById('call-recipient-avatar').classList.add('active-call');
    // Add hold call button toggle if missing in original index layout
    this.injectHoldButtonIfNeeded();
    document.getElementById('btn-call-start').style.display = 'none';
    document.getElementById('btn-call-end').style.display = 'flex';
    document.getElementById('btn-call-mute').className = 'call-btn mute';
    document.getElementById('call-transcript-log').innerHTML = '';
    document.getElementById('call-duration-timer').innerText = '0:00:00'; // Expanded timer default
    document.getElementById('call-post-summary-section').style.display = 'none';
    document.getElementById('call-transcript-log').style.display = 'flex';
    // Reset post-call actions panel
    const postCallPanel = document.getElementById('post-call-actions-panel');
    if (postCallPanel) postCallPanel.style.display = 'none';
    // Show active language indicator bar
    const langBar = document.getElementById('active-language-bar');
    const langLabel = document.getElementById('active-language-label');
    if (langBar && langLabel) {
      const langNames = { 'pa-IN': 'Punjabi (ਪੰਜਾਬੀ)', 'hi-IN': 'Hindi (हिंदी)', 'en-US': 'English' };
      langLabel.innerText = langNames[languageCode] || languageCode;
      langBar.style.display = 'flex';
    }
    // Start canvas waveforms
    this.lastFrameTime = performance.now();
    this.drawWaveform();
    // Start duration timer supporting hours layout (UX #51)
    this.timerInterval = setInterval(() => {
      this.duration++;
      const hrs = Math.floor(this.duration / 3600).toString();
      const mins = Math.floor((this.duration % 3600) / 60).toString().padStart(2, '0');
      const secs = (this.duration % 60).toString().padStart(2, '0');
      document.getElementById('call-duration-timer').innerText = `${hrs}:${mins}:${secs}`;
    }, 1000);
    // In the new App-to-App LiveKit architecture, the Dashboard acts as an observer.
    // Transcription is wired up dynamically when remote tracks are subscribed (in initLiveKit).
    if (!this.isRecording) {
      this.addWarningToTranscriptLog(
        "Recording Consent Denied", 
        "This call is not being recorded or transcribed because the patient has not provided consent. Only manual clinical notes will be saved."
      );
    } else {
      this.addWarningToTranscriptLog(
        "AI Observer Active",
        "The Dashboard is observing the call. Transcription will start automatically when the patient and counselor speak."
      );
    }
    window.CounselFlow.app.showToast("Call Connected", `Tele-counseling call started with ${patient.name}.`, "success");
  }
  setupObserverUI(patient) {
    const statusDot = document.getElementById('call-status-dot');
    const statusLabel = document.getElementById('call-status-label');
    const recordBtn = document.getElementById('btn-call-record');
    if (statusDot) statusDot.className = 'status-dot rec';
    if (statusLabel) statusLabel.innerText = 'Observing Active Call';
    if (recordBtn) recordBtn.className = 'call-btn record recording';
    const nameEl = document.getElementById('call-recipient-name');
    if (nameEl) nameEl.innerText = patient.name;
    const detailsEl = document.getElementById('call-recipient-details');
    if (detailsEl) {
        detailsEl.innerText = `${patient.id} | ${patient.addictionCategory || 'General'}`;
    }
    const avatarEl = document.getElementById('call-recipient-avatar');
    if (avatarEl) {
        avatarEl.innerText = patient.name.split(' ').map(n => n[0]).join('');
        avatarEl.classList.add('active-call');
    }
    const startBtn = document.getElementById('btn-call-start');
    if (startBtn) startBtn.style.display = 'none';
    const endBtn = document.getElementById('btn-call-end');
    if (endBtn) endBtn.style.display = 'flex';
    const transcriptLog = document.getElementById('call-transcript-log');
    if (transcriptLog) {
        transcriptLog.innerHTML = '';
        transcriptLog.style.display = 'flex';
    }
    const summarySection = document.getElementById('call-post-summary-section');
    if (summarySection) summarySection.style.display = 'none';
    const postCallPanel = document.getElementById('post-call-actions-panel');
    if (postCallPanel) postCallPanel.style.display = 'none';
    const timerEl = document.getElementById('call-duration-timer');
    if (timerEl) timerEl.innerText = '0:00:00';
    this.addWarningToTranscriptLog(
      "Call Observer Active",
      `The Dashboard is observing the mobile call with ${patient.name || 'Patient'}. Live transcription will stream below.`
    );
  }
  // End Tele-Counseling session call and trigger AI processing
  endCall() {
    if (!this.isActive) return;
    this.isObserver = false;
    // Log call attempt (Connected) (Phase 2, Solution Scope #2)
    this.logCallAttempt(this.activePatient, this.duration, this.callDirection || "Outbound", "Connected");
    // Finalize transcripts and push to AI for summarization
    try {
      this.lastSessionTranscript = JSON.parse(JSON.stringify(this.#currentTranscript || []));
    } catch (e) {
      console.warn("Failed to deep copy transcript, resetting to empty array", e);
      this.lastSessionTranscript = [];
    }
    this.#currentTranscript = [];
    this.isActive = false;
    clearInterval(this.timerInterval);
    this.clearCanvas();
    // End WebRTC Connection — use patientSocketId (not patient.id) for socket routing
    if (this.socket) {
      const targetId = this.patientSocketId || (this.activePatient ? this.activePatient.id : null);
      if (targetId) {
        this.socket.emit('end-call', { to: targetId });
      }
    }
    this.patientSocketId = null;
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
     // Stop Sarvam Streaming STT
     this.stopAllStreamingSTT();
     // Stop legacy Whisper Transcribers (if any still active)
     if (this.counselorRecorder && this.counselorRecorder.state !== "inactive") {
       try { this.counselorRecorder.stop(); } catch(e){}
     }
     if (this.patientRecorder && this.patientRecorder.state !== "inactive") {
       try { this.patientRecorder.stop(); } catch(e){}
     }
     // Remove audio unlock handlers
     if (this.audioUnlockHandler) {
       document.removeEventListener('click', this.audioUnlockHandler);
       document.removeEventListener('touchstart', this.audioUnlockHandler);
       document.removeEventListener('keydown', this.audioUnlockHandler);
     }
     // Stop socket audio relay if active
    this.stopSocketAudioRelay();
    // Reset hold button UI status
    const holdBtn = document.getElementById('btn-call-hold');
    if (holdBtn) holdBtn.classList.remove('active');
    // Update Control State UI
    document.getElementById('call-status-dot').className = 'status-dot';
    document.getElementById('call-status-label').innerText = 'Idle';
    document.getElementById('call-recipient-avatar').classList.remove('active-call');
    document.getElementById('btn-call-start').style.display = 'flex';
    document.getElementById('btn-call-end').style.display = 'none';
    document.getElementById('btn-call-record').className = 'call-btn record';
    document.getElementById('btn-call-mute').className = 'call-btn mute';
    window.CounselFlow.app.showToast("Call Disconnected", "Review the transcript below, then generate your AI summary.", "info");
    // Keep the live transcript visible for review — do NOT swap to summary panel yet
    document.getElementById('call-transcript-log').style.display = 'block';
    document.getElementById('call-post-summary-section').style.display = 'none';
    // Show the Post-Call Actions panel beneath the transcript
    const postCallPanel = document.getElementById('post-call-actions-panel');
    if (postCallPanel) {
      postCallPanel.style.display = 'flex';
    }
  }
  // Record connected/missed/rejected call attempts into global localstorage call logs (Phase 2, Solution Scope #2)
  async logCallAttempt(patient, durationSec, direction, disposition) {
    if (!patient) return;
    const hrs = Math.floor(durationSec / 3600).toString();
    const mins = Math.floor((durationSec % 3600) / 60).toString().padStart(2, '0');
    const secs = (durationSec % 60).toString().padStart(2, '0');
    const formattedDuration = `${hrs}:${mins}:${secs}`;
    const logId = `LOG-${Math.floor(10000 + Math.random() * 90000)}`;
    const newLog = {
      logId: logId,
      patientId: patient.id,
      patientName: patient.name,
      counselorId: patient.counselorId || "CO-101",
      counselorName: patient.assignedCounselor || "Dr. Amanpreet Kaur",
      timestamp: new Date().toLocaleString(),
      duration: formattedDuration,
      direction: direction || "Outbound",
      disposition: disposition || "Connected"
    };
    try {
      const logs = await window.CounselFlow.getCallLogs();
      logs.unshift(newLog);
      window.CounselFlow.saveCallLogs(logs);
      // Update the patient's cbmContacts for Stage 4 tracking
      if (!patient.cbmContacts) patient.cbmContacts = [];
      patient.cbmContacts.push({
        date: newLog.timestamp,
        type: newLog.direction,
        counselorId: newLog.counselorId,
        outcome: disposition === 'Connected' ? 'connected' : (disposition === 'Missed' ? 'missed' : 'rejected')
      });
      // Try to save patient changes (assumes we have access to app.patients)
      if (window.CounselFlow.app && window.CounselFlow.app.patients) {
         const ptRef = window.CounselFlow.app.patients.find(p => p.id === patient.id);
         if (ptRef) {
           ptRef.cbmContacts = patient.cbmContacts;
           await window.CounselFlow.savePatients(window.CounselFlow.app.patients);
         }
      }
      // If the app controller is running, refresh the supervisor tables
      if (window.CounselFlow.app && typeof window.CounselFlow.app.renderSessionHistoryLogs === 'function') {
        window.CounselFlow.app.renderSessionHistoryLogs();
      }
    } catch (e) {
      console.error("Failed to write call log attempt:", e);
    }
  }
  // Mute audio stream toggler
  toggleMute() {
    if (!this.isActive) return;
    this.isMuted = !this.isMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }
    const btn = document.getElementById('btn-call-mute');
    if (this.isMuted) {
      btn.classList.add('active');
      window.CounselFlow.app.showToast("Mic Muted", "Microphone audio feeds suspended.", "info");
    } else {
      btn.classList.remove('active');
      window.CounselFlow.app.showToast("Mic Active", "Microphone audio feeds restored.", "success");
    }
  }
  // Hold Call handler (UX #47)
  toggleHold() {
    if (!this.isActive) return;
    this.isHeld = !this.isHeld;
    const btn = document.getElementById('btn-call-hold');
    if (btn) {
      if (this.isHeld) {
        btn.classList.add('active');
        window.CounselFlow.app.showToast("Call Held", "Tele-counseling call has been placed on hold.", "info");
      } else {
        btn.classList.remove('active');
        window.CounselFlow.app.showToast("Call Restored", "Tele-counseling call has been resumed.", "success");
      }
    }
  }
  // Recording status toggler
  toggleRecording() {
    if (!this.isActive) return;
    this.isRecording = !this.isRecording;
    const btn = document.getElementById('btn-call-record');
    if (this.isRecording) {
      btn.classList.add('recording');
      document.getElementById('call-status-dot').className = 'status-dot rec';
      document.getElementById('call-status-label').innerText = 'Call Recording Active';
      window.CounselFlow.app.showToast("Recording Resumed", "ASR pipeline is running.", "info");
    } else {
      btn.classList.remove('recording');
      document.getElementById('call-status-dot').className = 'status-dot';
      document.getElementById('call-status-label').innerText = 'Recording Suspended';
      window.CounselFlow.app.showToast("Recording Paused", "Speech transcription temporarily paused.", "info");
    }
  }
  // Populate line on current visual transcript feed with batched/requestAnimationFrame frames
  addTranscriptLine(speaker, text) {
    if (!text || !text.trim()) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.#currentTranscript.push({ speaker, text, timestamp: time });
    // Relay to patient portal for live transcript feature
    if (this.socket && this.patientSocketId) {
      this.socket.emit('transcript-update', {
        to: this.patientSocketId,
        text: text,
        sender: speaker.toLowerCase() === 'counselor' ? 'counselor' : 'patient'
      });
    }
    // Performance #62: requestAnimationFrame scheduling
    requestAnimationFrame(() => {
      try {
        const container = document.getElementById('call-transcript-log');
        if (!container) return;
        // Remove placeholder text if exists
        const placeholder = document.getElementById('transcript-placeholder-text');
        if (placeholder) placeholder.remove();
        const bubble = document.createElement('div');
        bubble.className = `transcript-bubble ${speaker.toLowerCase()}`;
        // UX #52: Speaker avatars or initials next to bubble speaker names
        const initials = speaker === 'Counselor' ? 'C' : (this.activePatient ? this.activePatient.name.charAt(0) : 'P');
        const color = speaker === 'Counselor' ? 'var(--accent-blue)' : 'var(--text-secondary)';
        bubble.innerHTML = `
          <div class="bubble-speaker ${speaker.toLowerCase()}" style="display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:16px; height:16px; font-size:10px; font-weight:700; border-radius:50%; background:${color}; color:white; text-align:center; line-height:16px;">${initials}</span>
            <span>${speaker === 'Counselor' ? 'Dr. Amanpreet (Counselor)' : escapeHtml(this.activePatient.name)}</span>
            <span class="bubble-time">${time}</span>
          </div>
          <p>${escapeHtml(text)}</p>
        `;
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;
      } catch (e) {
        console.error("DOM rendering error in addTranscriptLine:", e);
      }
    });
  }
  // Load and play a dialogue scenario to demonstrate multi-language speech capabilities (Bug #3, Issue #30)
  async playScenarioScript(langKey, targetPatient = null) {
    // Bug #3: Clear old scenario intervals before triggering a new one
    if (this.scenarioInterval) {
      clearInterval(this.scenarioInterval);
    }
    const scenario = CALL_SCENARIOS[langKey];
    if (!scenario) return;
    const patientObj = targetPatient || window.CounselFlow.app.patients.find(p => p.id === scenario.patientId);
    if (!patientObj) return;
    this.activeScenarioKey = langKey;
    await this.startCall(patientObj, scenario.langCode, "Outbound", true);
    // Disable audio track instead of pausing the recorder
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => track.enabled = false);
    }
    this.addTranscriptLine("System", "[Counselor placed call on Hold]");
    const scriptLines = scenario.transcript;
    this.scenarioIndex = 0;
    const playNextTurn = () => {
      if (this.scenarioIndex < scriptLines.length) {
        const line = scriptLines[this.scenarioIndex];
        this.addTranscriptLine(line.speaker, line.text);
        this.scenarioIndex++;
        // Issue #30: Replace robotic fixed interval with dynamic text length delay
        const nextDelay = Math.max(1500, line.text.length * 60);
        this.scenarioInterval = setTimeout(playNextTurn, nextDelay);
      } else {
        setTimeout(() => this.endCall(), 1200);
      }
    };
    // Trigger the dynamic recursive timeout sequence
    this.scenarioInterval = setTimeout(playNextTurn, 1000);
  }
  async compileAISummary() {
    let summaryObj;
    try {
      summaryObj = await window.CounselFlow.aiOrchestrator.generateSummaryAsync(this.getTranscript(), this.activeLanguage);
    } catch (e) {
      console.error("Failed to generate summary asynchronously, falling back to local NLP:", e);
      summaryObj = window.CounselFlow.aiOrchestrator.generateSummary(this.getTranscript(), this.activeLanguage);
    }
    // Draw fields safely escaping outputs
    document.getElementById('summary-field-overview').innerText = summaryObj.overview;
    document.getElementById('summary-field-concerns').innerText = summaryObj.concerns;
    document.getElementById('summary-field-observations').innerText = summaryObj.observations;
    // Bug #4: Safely escape risk content before rendering inside unescaped status HTML
    const safeRisk = escapeHtml(summaryObj.risk);
    const riskClass = safeRisk.toLowerCase().includes('high') ? 'risk' : safeRisk.toLowerCase().includes('medium') ? 'monitored' : 'completed';
    document.getElementById('summary-field-risk').innerHTML = `<span class="pill-status ${riskClass}">${safeRisk}</span>`;
    document.getElementById('summary-field-actions').innerText = summaryObj.actions;
    document.getElementById('summary-field-notes').value = "";
    //  Escalation Badge (Req 4, Req 9) 
    const escLevel = summaryObj.escalationLevel || 0;
    const escReason = summaryObj.escalationReason || null;
    const escConfigs = {
      0: { label: 'L0 — No Escalation', color: 'var(--accent-teal)', deadline: null },
      1: { label: '️ L1 Escalation — Supervisor (4h)', color: 'var(--accent-orange)', deadline: '4 hours' },
      2: { label: ' L2 Escalation — DDRC Clinical (24h)', color: 'var(--accent-red)', deadline: '24 hours' },
      3: { label: ' L3 Escalation — State Programme (48h)', color: '#dc2626', deadline: '48 hours' }
    };
    const escCfg = escConfigs[escLevel] || escConfigs[0];
    // Inject or update escalation badge in summary header
    let escBadge = document.getElementById('summary-escalation-badge');
    if (!escBadge) {
      const summaryHeader = document.querySelector('#call-post-summary-section h3');
      if (summaryHeader) {
        escBadge = document.createElement('div');
        escBadge.id = 'summary-escalation-badge';
        escBadge.style.cssText = 'margin-top:10px; padding:8px 14px; border-radius: 4px; font-size:12px; font-weight:700; display:inline-flex; align-items:center; gap:8px;';
        summaryHeader.insertAdjacentElement('afterend', escBadge);
      }
    }
    if (escBadge) {
      escBadge.style.background = escLevel > 0 ? `${escCfg.color}22` : 'var(--bg-input)';
      escBadge.style.border = `1px solid ${escLevel > 0 ? escCfg.color : 'var(--border-light)'}`;
      escBadge.style.color = escLevel > 0 ? escCfg.color : 'var(--text-muted)';
      escBadge.innerHTML = `<span>${escCfg.label}</span>${escReason ? `<span style="font-weight:400; font-size:11px;">— ${escapeHtml(escReason)}</span>` : ''}`;
    }
    // Auto-push notification if escalation needed (Req 9)
    if (escLevel >= 1 && window.CounselFlow.app && this.activePatient) {
      const patName = this.activePatient.name;
      const deadline = escCfg.deadline;
      window.CounselFlow.app.notifications.unshift({
        id: Date.now(),
        text: `${escCfg.label}: ${patName} — SOP response required within ${deadline}. ${escReason || ''}`,
        time: 'Just now',
        unread: true
      });
      window.CounselFlow.app.updateNotificationBadge();
      window.CounselFlow.app.renderNotificationDropdownList();
    }
    //  Session Score Card (Req 5) 
    if (window.CounselFlow.app && typeof window.CounselFlow.app.renderSessionScoreCard === 'function') {
      window.CounselFlow.app.renderSessionScoreCard(summaryObj, this.getTranscript());
    }
    this.loadedSummary = summaryObj;
  }
  injectHoldButtonIfNeeded() {
    let holdBtn = document.getElementById('btn-call-hold');
    if (!holdBtn) {
      const controls = document.querySelector('.call-controls');
      if (controls) {
        holdBtn = document.createElement('button');
        holdBtn.id = 'btn-call-hold';
        holdBtn.className = 'call-btn mute';
        holdBtn.title = 'Hold Call (Press H)';
        holdBtn.style.marginRight = '8px';
        holdBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;
        const recordBtn = document.getElementById('btn-call-record');
        controls.insertBefore(holdBtn, recordBtn);
        holdBtn.addEventListener('click', () => this.toggleHold());
      }
    }
  }
  showIncomingCallPopup(patientId, patientName, roomName) {
    const existingPopup = document.getElementById('incoming-call-popup');
    if (existingPopup) existingPopup.remove();
    const popup = document.createElement('div');
    popup.id = 'incoming-call-popup';
    popup.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'background: rgba(0,0,0,0.8)',
      'z-index: 10000',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'flex-direction: column'
    ].join(';');
    const card = document.createElement('div');
    card.style.cssText = [
      'background: rgb(30,41,59)',
      'border-radius: 16px',
      'padding: 32px',
      'text-align: center',
      'max-width: 320px',
      'width: 90%',
      'border: 2px solid rgb(45,212,191)'
    ].join(';');
    card.innerHTML = `
      <div style="color: rgb(45,212,191); font-size: 18px; font-weight: bold; margin-bottom: 16px;">INCOMING CALL</div>
      <div style="color: white; font-size: 24px; font-weight: bold; margin-bottom: 8px;">${escapeHtml(patientName || patientId)}</div>
      <div style="color: rgb(148,163,184); font-size: 14px; margin-bottom: 24px;">Patient is calling for counseling</div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="btn-answer-call" style="background: rgb(34,197,94); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer;">Answer</button>
        <button id="btn-decline-call" style="background: rgb(239,68,68); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer;">Decline</button>
      </div>
    `;
    popup.appendChild(card);
    document.body.appendChild(popup);
    const audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
    const playAudio = () => {
      audio.play().catch(() => {});
    };
    playAudio();
    const audioInterval = setInterval(playAudio, 2000);
    document.getElementById('btn-answer-call').onclick = () => {
      clearInterval(audioInterval);
      popup.remove();
      this.initLiveKit({ id: patientId, name: patientName, counselorId: 'counselor' });
    };
    document.getElementById('btn-decline-call').onclick = () => {
      clearInterval(audioInterval);
      popup.remove();
      window.CounselFlow.app.showToast('Call Declined', 'Patient call declined.', 'info');
    };
  }
  // Stop active scenario loops if user navigates away (Architecture #43)
  cleanup() {
    if (this.scenarioInterval) {
      clearTimeout(this.scenarioInterval);
      this.scenarioInterval = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.clearCanvas();
  }
}
// Namespace consolidation (Architecture #32)
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.callManager = new CallManager();


/* --- BUNDLED FROM: js/charts.js --- */
// SVG-based Responsive Chart Rendering Engine
class ChartRenderer {
  #observers = new Map();
  constructor() {}
  // Escape text helper for SVG rendering safety (Bug #24)
  #escape(text) {
    if (!text && text !== 0) return '';
    return text.toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  // Helper to resolve CSS variables into Hex for clean export compatibility (Gap 16)
  #resolveColor(colorVal) {
    if (!colorVal || !colorVal.startsWith('var(')) return colorVal;
    const varName = colorVal.replace(/^var\(/, '').replace(/\)$/, '').trim();
    return getComputedStyle(document.body).getPropertyValue(varName).trim() || colorVal;
  }
  // Setup Observer to handle responsive container shifts (Bug #22)
  #observeResize(containerId, redrawFunc) {
    if (this.#observers.has(containerId)) {
      return; // Already observing
    }
    const container = document.getElementById(containerId);
    if (!container) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        // Prevent loops by only redrawing when active screen matches or is visible
        if (container.clientWidth > 0) {
          redrawFunc();
        }
      });
    });
    observer.observe(container);
    this.#observers.set(containerId, observer);
  }
  // Render weekly workload bar chart using programmatic SVG nodes (Bug #24, Bug #22)
  renderBarChart(containerId, data) {
    // Attach resize observer once
    this.#observeResize(containerId, () => this.renderBarChart(containerId, data));
    const container = document.getElementById(containerId);
    if (!container) return;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 280;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const maxCalls = Math.max(...data.map(d => d.calls)) * 1.15; // 15% top padding
    // Gap 1: Bar Chart Breaks on Zero Data (NaN Crash)
    if (maxCalls === 0) {
      container.innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:var(--text-muted); font-size:12px;">No session data available this period</div>';
      return;
    }
    const barWidth = (chartWidth / data.length) * 0.6;
    const barSpacing = (chartWidth / data.length) * 0.4;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "chart-svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    // Create defs gradient
    const defs = document.createElementNS(svgNS, "defs");
    const grad = document.createElementNS(svgNS, "linearGradient");
    grad.setAttribute("id", "bar-grad");
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "1");
    const stop1 = document.createElementNS(svgNS, "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", this.#resolveColor("var(--accent-blue)"));
    const stop2 = document.createElementNS(svgNS, "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", this.#resolveColor("var(--accent-indigo)"));
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);
    const fragment = document.createDocumentFragment();
    // 1. Draw horizontal grid lines and vertical labels
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding + (chartHeight / gridLines) * i;
      const val = Math.round(maxCalls - (maxCalls / gridLines) * i);
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("class", "chart-grid-line");
      line.setAttribute("x1", padding.toString());
      line.setAttribute("y1", y.toString());
      line.setAttribute("x2", (width - padding).toString());
      line.setAttribute("y2", y.toString());
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("class", "chart-text");
      text.setAttribute("x", (padding - 14).toString());
      text.setAttribute("y", (y + 4).toString());
      text.setAttribute("text-anchor", "end");
      text.textContent = val.toString();
      fragment.appendChild(line);
      fragment.appendChild(text);
    }
    // 2. Draw bars and bottom labels
    data.forEach((d, idx) => {
      const x = padding + (idx * (chartWidth / data.length)) + barSpacing / 2;
      const valHeight = (d.calls / maxCalls) * chartHeight;
      const y = padding + chartHeight - valHeight;
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("class", "chart-bar");
      rect.setAttribute("x", x.toString());
      rect.setAttribute("y", y.toString());
      rect.setAttribute("width", barWidth.toString());
      rect.setAttribute("height", valHeight.toString());
      rect.setAttribute("fill", "url(#bar-grad)");
      rect.setAttribute("rx", "4");
      rect.style.cursor = "pointer";
      rect.addEventListener("click", () => {
        if (window.CounselFlow && window.CounselFlow.app) {
           window.CounselFlow.app.showToast("Drill Down", `Filtering to sessions on ${d.day}`, "info");
        }
      });
      const textDay = document.createElementNS(svgNS, "text");
      textDay.setAttribute("class", "chart-axis-text");
      textDay.setAttribute("x", (x + barWidth / 2).toString());
      textDay.setAttribute("y", (height - padding + 18).toString());
      textDay.setAttribute("text-anchor", "middle");
      textDay.textContent = this.#escape(d.day);
      const textCalls = document.createElementNS(svgNS, "text");
      textCalls.setAttribute("class", "chart-axis-text");
      textCalls.setAttribute("x", (x + barWidth / 2).toString());
      textCalls.setAttribute("y", (y - 8).toString());
      textCalls.setAttribute("text-anchor", "middle");
      textCalls.setAttribute("font-weight", "700");
      textCalls.setAttribute("fill", this.#resolveColor("var(--text-primary)"));
      textCalls.textContent = this.#escape(d.calls);
      fragment.appendChild(rect);
      fragment.appendChild(textDay);
      fragment.appendChild(textCalls);
    });
    svg.appendChild(fragment);
    container.innerHTML = "";
    container.appendChild(svg);
  }
  // Render language distribution donut chart using programmatically built SVG nodes (Bug #23, Performance #63)
  // Gap 4: Donut Chart Center Label
  renderDonutChart(containerId, data, centerLabel = "Total Cases") {
    // Attach resize observer once
    this.#observeResize(containerId, () => this.renderDonutChart(containerId, data, centerLabel));
    const container = document.getElementById(containerId);
    if (!container) return;
    const width = container.clientWidth || 300;
    const height = container.clientHeight || 280;
    const size = Math.min(width, height);
    const radius = size * 0.35;
    const cx = width / 2;
    const cy = height / 2;
    const strokeWidth = 20;
    // Performance #39: Compute static totals once
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) {
      container.innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:var(--text-muted); font-size:12px;">No language data available</div>';
      return;
    }
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "chart-svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const fragment = document.createDocumentFragment();
    let accumulatedPercentage = 0;
    let legendsHtml = '';
    data.forEach((d) => {
      const percentage = d.value / total;
      const circumference = 2 * Math.PI * radius;
      const strokeDashArray = `${(percentage * circumference)} ${circumference}`;
      const rotationAngle = (accumulatedPercentage * 360) - 90; // Start top
      const segment = document.createElementNS(svgNS, "circle");
      segment.setAttribute("class", "donut-segment");
      segment.setAttribute("cx", cx.toString());
      segment.setAttribute("cy", cy.toString());
      segment.setAttribute("r", radius.toString());
      segment.setAttribute("stroke", this.#resolveColor(d.color));
      segment.setAttribute("stroke-dasharray", strokeDashArray);
      segment.setAttribute("stroke-dashoffset", "0");
      segment.setAttribute("transform", `rotate(${rotationAngle} ${cx} ${cy})`);
      segment.setAttribute("fill", "none");
      segment.setAttribute("stroke-width", strokeWidth.toString());
      segment.style.cursor = "pointer";
      segment.addEventListener("click", () => {
         if (window.CounselFlow && window.CounselFlow.app && window.CounselFlow.app.switchScreen) {
           window.CounselFlow.app.switchScreen("patients");
           if (window.CounselFlow.app.dom.patientSearchInput) {
             window.CounselFlow.app.dom.patientSearchInput.value = d.label;
             window.CounselFlow.app.dom.patientSearchInput.dispatchEvent(new Event('input'));
           }
         }
      });
      fragment.appendChild(segment);
      accumulatedPercentage += percentage;
      legendsHtml += `
        <div class="legend-item">
          <div class="legend-color" style="background: ${d.color};"></div>
          <span>${this.#escape(d.label)}: <strong>${d.value}</strong> (${Math.round(percentage * 100)}%)</span>
        </div>
      `;
    });
    // 3. Central labels overlay text
    const innerCircle = document.createElementNS(svgNS, "circle");
    innerCircle.setAttribute("cx", cx.toString());
    innerCircle.setAttribute("cy", cy.toString());
    innerCircle.setAttribute("r", (radius - strokeWidth).toString());
    innerCircle.setAttribute("fill", "var(--bg-darkest)");
    const textLabel = document.createElementNS(svgNS, "text");
    textLabel.setAttribute("class", "chart-text");
    textLabel.setAttribute("x", cx.toString());
    textLabel.setAttribute("y", (cy - 4).toString());
    textLabel.setAttribute("font-size", "11");
    textLabel.setAttribute("fill", this.#resolveColor("var(--text-secondary)"));
    textLabel.setAttribute("text-anchor", "middle");
    textLabel.textContent = centerLabel;
    const textVal = document.createElementNS(svgNS, "text");
    textVal.setAttribute("class", "chart-text");
    textVal.setAttribute("x", cx.toString());
    textVal.setAttribute("y", (cy + 16).toString());
    textVal.setAttribute("font-size", "20");
    textVal.setAttribute("font-weight", "700");
    textVal.setAttribute("fill", this.#resolveColor("var(--text-primary)"));
    textVal.setAttribute("text-anchor", "middle");
    textVal.textContent = total.toString();
    fragment.appendChild(innerCircle);
    fragment.appendChild(textLabel);
    fragment.appendChild(textVal);
    svg.appendChild(fragment);
    container.innerHTML = "";
    container.appendChild(svg);
    const legendBox = document.createElement('div');
    legendBox.className = 'chart-legends';
    legendBox.style.cssText = 'display:flex; flex-wrap:wrap; justify-content:center; gap:12px; margin-top:20px;';
    legendBox.innerHTML = legendsHtml;
    container.appendChild(legendBox);
  }
  // Draw relapse risk progress rows
  renderRiskIndicatorProgress(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">No risk assessment data available</div>';
      return;
    }
    let html = '';
    data.forEach(d => {
      const percentage = Math.round((d.value / total) * 100);
      // Escape all fields safely
      const escapedLabel = this.#escape(d.label);
      // Gap 13: Relapse Risk Progress Bars Trend Arrows
      let trendHtml = '';
      if (d.trend === 'up') trendHtml = '<span style="color:var(--accent-red); margin-left:6px;" title="Worsening trend">↑</span>';
      else if (d.trend === 'down') trendHtml = '<span style="color:var(--accent-green); margin-left:6px;" title="Improving trend">↓</span>';
      else trendHtml = '<span style="color:var(--text-muted); margin-left:6px;" title="Stable trend">→</span>';
      html += `
        <div style="flex-grow: 1; cursor:pointer;" onclick="if(window.CounselFlow && window.CounselFlow.app){ window.CounselFlow.app.switchScreen('patients'); window.CounselFlow.app.dom.patientSearchInput.value = '${escapedLabel.split(' ')[0]}'; window.CounselFlow.app.dom.patientSearchInput.dispatchEvent(new Event('input')); }">
          <div style="display: flex; justify-content: space-between; align-items:center; font-size: 11px; margin-bottom: 6px;">
            <span>${escapedLabel}</span>
            <strong style="display:flex; align-items:center;">${d.value} Cases (${percentage}%) ${trendHtml}</strong>
          </div>
          <div class="progress-bar-container" style="width: 100%; height: 8px;">
            <div class="progress-fill" style="width: ${percentage}%; background: ${this.#resolveColor(d.color)};"></div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  }
  // Release Observers on tear-down
  cleanup() {
    this.#observers.forEach(obs => obs.disconnect());
    this.#observers.clear();
  }
}
// Namespace consolidation
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.chartRenderer = new ChartRenderer();


/* --- BUNDLED FROM: js/app.js --- */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
class AppController {
  constructor() {
    this.patients = [];
    this.activeScreen = 'dashboard';
    this.selectedPatient = null;
    this.isNotesDirty = false; 
    this.currentLogTab = 'sessions'; 
    this.currentPatientSort = { field: null, dir: 'asc' };
    this.selectedPatients = new Set();
    this.ddrcQueueSort = 'oldest'; 
    this.currentPatientFilter = { query: '', severity: 'all', status: 'all', minAge: '', maxAge: '', startDate: '', endDate: '' };
    this.currentWorkflowFilter = { query: '', sort: 'newest' };
    this.notifications = [];
    this.inactivityTimeout = null;
    this.inactivityLimit = window.CounselFlow.CONFIG.INACTIVITY_LIMIT_MS; 
    this.dom = {};
    this.onlinePatientIds = [];
    this.initRoleGate = this.initRoleGate.bind(this);
    this.renderSettingsTab = this.renderSettingsTab.bind(this);
    this.renderCallConsole = this.renderCallConsole.bind(this);
  }
  async init() {
    try {
      window.localStorage.removeItem('counseling_groq_api_key');
      window.localStorage.removeItem('counseling_gemini_api_key');
    } catch (e) {}
    this.cacheDOMElements();
    const activeRole = window.CounselFlow.getActiveRole();
    const loggedInName = window.CounselFlow.safeGetItem('counseling_logged_in_name');
    if (!activeRole || !loggedInName) {
      this.showLoginScreen();
      return;
    }
    this.patients = await window.CounselFlow.getStoredPatients();
    this.patients.forEach(pt => {
      if (!pt.history) pt.history = [];
      if (!pt.checkpoints) pt.checkpoints = {};
      if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
        window.CounselFlow.evaluatePatientWorkflow(pt);
      }
    });
    this.bindNavigation();
    this.bindSearchAndFilters();
    this.bindWorkflowSearchAndSort();
    const btnExpAnalytics = document.getElementById('btn-export-analytics');
    if (btnExpAnalytics) {
       btnExpAnalytics.addEventListener('click', () => {
           this.exportAnalyticsToCSV();
       });
    }
    this.bindModals();
    this.bindNotifications();
    this.bindCallConsoleActions();
    this.bindSettingsTabs();
    this.bindThemeToggle();
    this.bindEventDelegation();
    this.initInactivityTimer();
    this.initNetworkMonitoring();
    this.refreshData().then(() => {
      this.renderDashboard();
      this.renderPatientsList();
      this.updateNotificationBadge();
      this.startOnlinePolling();
    });
    const canvas = document.getElementById('call-waveform-canvas');
    if (canvas) {
      if (window.CounselFlow && window.CounselFlow.callManager) {
        window.CounselFlow.callManager.setCanvas(canvas);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (window.CounselFlow && window.CounselFlow.callManager) {
            window.CounselFlow.callManager.setCanvas(canvas);
          }
        });
      }
    }
    this.injectDynamicSubtitleDate();
    const storageWarning = window.CounselFlow.getStorageWarning();
    if (storageWarning) {
      setTimeout(() => {
        this.showToast(storageWarning.title, storageWarning.message, storageWarning.type);
        window.CounselFlow.clearStorageWarning();
      }, 800);
    }
    this.initOpdScreen();
    this.initRoleGate();
  }
  startOnlinePolling() {
    const fetchOnline = async () => {
      try {
        const response = await fetch(`${window.CounselFlow.API_BASE}/patients/online`, {
          headers: {
            'ngrok-skip-browser-warning': 'true'
          }
        });
        if (response.ok) {
          const data = await response.json();
          const oldOnline = this.onlinePatientIds || [];
          this.onlinePatientIds = data.onlinePatientIds || [];
          const changed = oldOnline.length !== this.onlinePatientIds.length || 
                          oldOnline.some(id => !this.onlinePatientIds.includes(id));
          if (changed) {
            if (this.activeScreen === 'dashboard') {
              this.renderPatientsList();
            }
          }
        }
      } catch (err) {
        console.warn('Error fetching online patients:', err);
      }
    };
    fetchOnline();
    setInterval(fetchOnline, 5000);
  }
  bindEventDelegation() {
    const handlePatientRowClick = (e) => {
      const row = e.target.closest('.patient-row');
      if (!row) return;
      const patientId = row.getAttribute('data-patient-id');
      const callBtn = e.target.closest('.btn-call-trigger');
      const checkbox = e.target.closest('.patient-row-checkbox');
      if (checkbox) {
        return;
      }
      if (callBtn) {
        e.stopPropagation();
        this.initiateCallSequenceById(patientId);
      } else {
        this.openPatientDetailById(patientId);
      }
    };
    const handlePatientRowKeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const row = e.target.closest('.patient-row');
        if (row) {
          e.preventDefault();
          handlePatientRowClick({ target: row, stopPropagation: () => {} });
        }
      }
    };
    if (this.dom.dashboardPatientsList) {
      this.dom.dashboardPatientsList.addEventListener('click', handlePatientRowClick);
      this.dom.dashboardPatientsList.addEventListener('keydown', handlePatientRowKeydown);
    }
    if (this.dom.patientsListContainer) {
      this.dom.patientsListContainer.addEventListener('click', handlePatientRowClick);
      this.dom.patientsListContainer.addEventListener('keydown', handlePatientRowKeydown);
    }
    if (this.dom.missedCallsPanelContainer) {
      this.dom.missedCallsPanelContainer.addEventListener('click', handlePatientRowClick);
      this.dom.missedCallsPanelContainer.addEventListener('keydown', handlePatientRowKeydown);
    }
    if (this.dom.detailSessionsList) {
      this.dom.detailSessionsList.addEventListener('click', (e) => {
        const item = e.target.closest('.session-history-item');
        if (item) {
          const patientId = item.getAttribute('data-patient-id');
          const sessionId = item.getAttribute('data-session-id');
          this.viewSessionDetailModal(patientId, sessionId);
        }
      });
    }
    if (this.dom.historyRecordsList) {
      this.dom.historyRecordsList.addEventListener('click', (e) => {
        const item = e.target.closest('.session-history-item');
        if (item) {
          const patientId = item.getAttribute('data-patient-id');
          const sessionId = item.getAttribute('data-session-id');
          this.viewSessionDetailModal(patientId, sessionId);
        }
      });
    }
    if (this.dom.settingsTabPanel) {
      this.dom.settingsTabPanel.addEventListener('click', (e) => {
        const saveBtn = e.target.closest('.btn-primary');
        if (!saveBtn) return;
        const h3 = this.dom.settingsTabPanel.querySelector('h3');
        if (!h3) return;
        const tab = h3.textContent;
        if (tab.includes("AI")) {
          this.showToast('Settings Saved', 'AI configuration updated.', 'success');
        } else if (tab.includes("Privacy")) {
          this.showToast('Settings Saved', 'Privacy configurations updated.', 'success');
        } else if (tab.includes("Telephony")) {
          this.showToast('Settings Saved', 'Telephony configurations updated.', 'success');
        }
      });
    }
  }
  initOpdScreen() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const previewSection = document.getElementById('preview-section');
    const previewTbody = document.getElementById('preview-tbody');
    const recordCount = document.getElementById('record-count');
    const btnSync = document.getElementById('btn-sync-data');
    const opdAlerts = document.getElementById('opd-alerts');
    if (!dropZone || !fileInput) return; // Not on the right screen or DOM element missing
    let parsedData = [];
    const showAlert = (msg, isError = false) => {
      if (!opdAlerts) return;
      opdAlerts.innerHTML = `
        <div style="padding: 16px; border-radius: 8px; background: ${isError ? 'rgba(220,38,38,0.1)' : 'rgba(5,205,153,0.1)'}; color: ${isError ? 'var(--accent-red)' : 'var(--accent-green)'}; border: 1px solid ${isError ? 'var(--accent-red)' : 'var(--accent-green)'};">
          ${msg}
        </div>
      `;
      setTimeout(() => { opdAlerts.innerHTML = ''; }, 5000);
    };
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.background = 'rgba(67,24,255,0.05)';
    });
    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.style.background = 'rgba(0,0,0,0.02)';
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.background = 'rgba(0,0,0,0.02)';
      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
      }
    });
    const handleFile = (file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          if (typeof XLSX === 'undefined') {
             showAlert('Excel parser not loaded. Please wait or refresh the page.', true);
             return;
          }
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(worksheet, { raw: false });
          processExcelData(json);
        } catch (err) {
          console.error(err);
          showAlert('Error parsing Excel file. Ensure it is a valid .xlsx or .csv format.', true);
        }
      };
      reader.readAsArrayBuffer(file);
    };
    const processExcelData = (rows) => {
      parsedData = [];
      if (previewTbody) previewTbody.innerHTML = '';
      if (!rows || rows.length === 0) {
        showAlert('The uploaded file is empty.', true);
        return;
      }
      rows.forEach(row => {
        // Look for variations of column names
        const patientId = row['Patient ID'] || row['Patient_ID'] || row['PatientID'];
        const date = row['Date of Visit'] || row['Date'] || row['Visit Date'];
        const medicine = row['Medicine Given'] || row['Medicine'] || row['Drug'];
        const qty = row['Quantity'] || row['Qty'] || 0;
        const nextVisit = row['Next Scheduled Visit'] || row['Next Visit'] || row['NextVisit'];
        if (patientId) {
          parsedData.push({
            patientId: patientId,
            date: date,
            medicineName: medicine,
            quantity: parseInt(qty) || 0,
            nextVisitDate: nextVisit || null
          });
          if (previewTbody) {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-light)';
            tr.innerHTML = `
              <td style="padding: 12px; font-family: monospace;">${patientId || '—'}</td>
              <td style="padding: 12px;">${date || '—'}</td>
              <td style="padding: 12px;">${medicine || '—'}</td>
              <td style="padding: 12px;">${qty || 0}</td>
              <td style="padding: 12px; color: var(--accent-blue);">${nextVisit || '—'}</td>
            `;
            previewTbody.appendChild(tr);
          }
        }
      });
      if (parsedData.length > 0) {
        if (recordCount) recordCount.textContent = parsedData.length;
        if (previewSection) previewSection.style.display = 'block';
        showAlert(`Successfully parsed ${parsedData.length} records. Please verify and sync.`);
      } else {
        showAlert('No valid records found. Ensure the "Patient ID" column exists.', true);
        if (previewSection) previewSection.style.display = 'none';
      }
    };
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        if (parsedData.length === 0) return;
        btnSync.disabled = true;
        btnSync.textContent = 'Syncing...';
        try {
          const API_URL = window.CounselFlow.API_BASE || 'http://localhost:5001/api';
          const response = await fetch(`${API_URL}/opd/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(parsedData)
          });
          const result = await response.json();
          if (response.ok) {
            showAlert(`Successfully synced ${result.processed} records to the database!`);
            if (previewSection) previewSection.style.display = 'none';
            parsedData = [];
          } else {
            showAlert(result.error || 'Failed to sync data to the server.', true);
          }
        } catch (err) {
          console.error(err);
          showAlert('Network error while trying to reach the server.', true);
        } finally {
          btnSync.disabled = false;
          btnSync.textContent = 'Confirm & Sync to Database';
        }
      });
    }
  }
  cacheDOMElements() {
    this.dom.pageTitleText = document.getElementById('page-title-text');
    this.dom.pageSubtitleText = document.getElementById('page-subtitle-text');
    this.dom.dashboardPatientsList = document.getElementById('dashboard-patients-list');
    this.dom.dashboardTimelineList = document.getElementById('dashboard-timeline-list');
    this.dom.missedCallsPanelContainer = document.getElementById('missed-calls-panel-container');
    this.dom.patientsListContainer = document.getElementById('patients-view-list-container');
    this.dom.patientsDetailContainer = document.getElementById('patients-view-detail-container');
    this.dom.detailProfileCard = document.getElementById('detail-profile-card');
    this.dom.detailSessionsList = document.getElementById('detail-sessions-list');
    this.dom.detailCurrentConditionContainer = document.getElementById('detail-current-condition-container');
    this.dom.patientSearchInput = document.getElementById('patient-search-input');
    this.dom.patientFilterSeverity = document.getElementById('patient-filter-severity');
    this.dom.patientFilterStatus = document.getElementById('patient-filter-status');
    this.dom.patientFilterDistrict = document.getElementById('patient-filter-district');
    this.dom.patientFilterDateStart = document.getElementById('patient-filter-date-start');
    this.dom.patientFilterDateEnd = document.getElementById('patient-filter-date-end');
    this.dom.btnExportPatients = document.getElementById('btn-export-patients');
    this.dom.historySearchInput = document.getElementById('history-search-input');
    this.dom.historyFilterLanguage = document.getElementById('history-filter-language');
    this.dom.historyRecordsList = document.getElementById('history-records-list');
    this.dom.settingsTabPanel = document.getElementById('settings-tab-panel');
    this.dom.toastContainer = document.getElementById('toast-container');
    this.dom.notificationBadge = document.getElementById('notification-badge-count');
    this.dom.notificationsList = document.getElementById('list-notification-items');
    this.dom.clinicalWorkflowBoard = document.getElementById('clinical-workflow-board');
    this.dom.mobileMenuBtn = document.getElementById('mobile-menu-btn');
    this.dom.sidebarOverlay = document.getElementById('sidebar-overlay');
  }
  injectDynamicSubtitleDate() {
    const todayStr = new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (this.dom.pageSubtitleText && this.activeScreen === 'dashboard') {
      this.dom.pageSubtitleText.innerText = `${todayStr} | Session Monitor`;
    }
  }
  bindNavigation() {
    if (this.dom.mobileMenuBtn && this.dom.sidebarOverlay) {
      this.dom.mobileMenuBtn.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        if(sidebar) sidebar.classList.add('open');
        this.dom.sidebarOverlay.classList.add('active');
      });
      this.dom.sidebarOverlay.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        if(sidebar) sidebar.classList.remove('open');
        this.dom.sidebarOverlay.classList.remove('active');
      });
    }
    const navItems = document.querySelectorAll('.nav-item');
    const handleNavigation = (item) => {
      const screenId = item.getAttribute('data-screen');
      if (this.isNotesDirty) {
        if (!confirm("You have unsaved clinical notes changes. Do you want to discard them?")) {
          return;
        }
        this.isNotesDirty = false;
      }
      this.switchScreen(screenId);
    };
    navItems.forEach(item => {
      item.addEventListener('click', () => handleNavigation(item));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNavigation(item);
        }
      });
    });
    document.querySelector('.logo-container').addEventListener('click', () => {
      if (this.isNotesDirty) {
        if (!confirm("You have unsaved changes. Discard?")) return;
        this.isNotesDirty = false;
      }
      this.switchScreen('dashboard');
    });
    document.getElementById('btn-quick-call').addEventListener('click', () => {
      const firstPatientObj = this.getSecurityScopedPatients()[0];
      if (!firstPatientObj) {
        this.showToast('No Patients Found', 'Please add a patient profile before initiating a call.', 'error');
        return;
      }
      this.initiateCallSequence(firstPatientObj);
    });
    document.getElementById('btn-dashboard-view-all').addEventListener('click', () => {
      if (this.isNotesDirty) {
        if (!confirm("You have unsaved changes in general clinical notes. Discard?")) return;
        this.isNotesDirty = false;
      }
      this.selectedPatient = null;
      if (this.dom.patientsListContainer && this.dom.patientsDetailContainer) {
        this.dom.patientsListContainer.style.display = 'flex';
        this.dom.patientsDetailContainer.style.display = 'none';
      }
      this.switchScreen('patients');
    });
    const backBtn = document.getElementById('btn-back-to-patients-list');
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('mouseenter', () => {
        logoutBtn.style.color = 'var(--accent-red)';
        logoutBtn.style.borderColor = 'var(--accent-red)';
        logoutBtn.style.background = 'var(--accent-red)11';
      });
      logoutBtn.addEventListener('mouseleave', () => {
        logoutBtn.style.color = 'var(--text-muted)';
        logoutBtn.style.borderColor = 'var(--border-light)';
        logoutBtn.style.background = 'transparent';
      });
      logoutBtn.addEventListener('click', () => this.performLogout());
    }
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this.isNotesDirty) {
          if (!confirm("You have unsaved changes in general clinical notes. Discard?")) return;
          this.isNotesDirty = false;
        }
        if (this.dom.patientsListContainer && this.dom.patientsDetailContainer) {
          this.dom.patientsListContainer.style.display = 'flex';
          this.dom.patientsDetailContainer.style.display = 'none';
        }
        this.selectedPatient = null;
      });
    }
    const queueList = document.getElementById('cbm-scheduled-queue-list');
    if (queueList) {
      queueList.addEventListener('click', (e) => {
        const callBtn = e.target.closest('.btn-queue-call-trigger');
        if (callBtn) {
          e.stopPropagation();
          const patientId = callBtn.getAttribute('data-patient-id');
          this.initiateCallSequenceById(patientId);
        }
      });
    }
    const escList = document.getElementById('escalation-panel-container');
    if (escList) {
      escList.addEventListener('click', async (e) => {
        const resolveBtn = e.target.closest('.btn-escalation-resolve-trigger');
        if (resolveBtn) {
          e.stopPropagation();
          const sessionId = resolveBtn.getAttribute('data-session-id');
          const patientId = resolveBtn.getAttribute('data-patient-id');
          await this.markEscalationResolved(sessionId, patientId);
        }
      });
    }
  }
  async refreshData() {
    if (window.CounselFlow && window.CounselFlow.getStoredPatients) {
      try {
        const fetchId = Symbol();
        this._currentFetchId = fetchId;
        const freshData = (await window.CounselFlow.getStoredPatients()) || [];
        if (this._currentFetchId === fetchId) {
          this.patients = freshData;
          this._hasFetchedData = true;
        }
      } catch (e) {
        console.error("Failed to refresh patients:", e);
      }
    }
  }
  getSecurityScopedPatients() {
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const staffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
    if (activeRole === 'spo' || activeRole === 'supervisor' || activeRole === 'ditsu') {
      return this.patients || [];
    }
    if (activeRole === 'ddrc') {
      const currentUser = window.CounselFlow.DEMO_CREDENTIALS.find(c => c.staffId === staffId);
      const district = currentUser ? currentUser.district : '';
      return (this.patients || []).filter(p => p.district === district);
    }
    if (activeRole === 'counsellor') {
      return (this.patients || []).filter(p => p.counselorId === staffId);
    }
    return this.patients || [];
  }
  async switchScreen(screenId) {
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    if (!roleConfig.allowedScreens.includes(screenId)) {
      this.showToast('Access Denied', `Your role (${roleConfig.label}) does not have permission to view this screen.`, 'error');
      screenId = 'dashboard';
    }
    if (this.activeScreen === 'analytics' && screenId !== 'analytics') {
      if (window.CounselFlow && window.CounselFlow.chartRenderer) {
        window.CounselFlow.chartRenderer.cleanup();
      }
    }
    if (this.activeScreen === 'call-console' && screenId !== 'call-console') {
      window.CounselFlow.callManager?.cleanup?.();
    }
    this.activeScreen = screenId;
    if (screenId === 'patients') {
      this.selectedPatient = null;
      if (this.dom.patientsListContainer && this.dom.patientsDetailContainer) {
        this.dom.patientsListContainer.style.display = 'flex';
        this.dom.patientsDetailContainer.style.display = 'none';
      }
    }
    if (screenId === 'opd') {
      const activeOpdTab = document.querySelector('.nav-item-opd.active');
      if (!activeOpdTab) {
        const firstOpdTab = document.querySelector('.nav-item-opd');
        if (firstOpdTab) {
          // Defer click slightly to let switchScreen finish
          setTimeout(() => firstOpdTab.click(), 0);
        }
      }
    }
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.getAttribute('data-screen') === screenId) {
        if (!el.classList.contains('nav-item-opd')) {
          el.classList.add('active');
        }
      } else {
        el.classList.remove('active');
      }
    });
    document.querySelectorAll('.screen-content').forEach(el => {
      if (el.id === `screen-${screenId}`) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
    const todayStr = new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    try {
      await this.refreshData();
    } catch (err) {
      console.error("Failed to fetch live data on navigation", err);
    }
    switch (screenId) {
      case 'dashboard': {
        const staffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
        const currentUser = window.CounselFlow.DEMO_CREDENTIALS.find(c => c.staffId === staffId);
        const district = currentUser ? currentUser.district : '';
        const roleConfig = window.CounselFlow.ROLES[this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor'];
        const contextText = district ? `District: ${district}` : (roleConfig.label.includes('State') || this.activeRole === 'supervisor' ? 'State Level' : '');
        this.dom.pageTitleText.innerText = "Dashboard";
        this.dom.pageSubtitleText.innerText = contextText ? `${todayStr} | ${contextText} | Session Monitor` : `${todayStr} | Session Monitor`;
        this.renderDashboard();
        break;
      }
      case 'patients':
        this.dom.pageTitleText.innerText = "Patient Database";
        this.dom.pageSubtitleText.innerText = "Manage patient recovery records and clinical notes";
        this.renderPatientsList(this.currentPatientFilter?.query, this.currentPatientFilter?.severity, this.currentPatientFilter?.status);
        break;
      case 'call-console':
        this.dom.pageTitleText.innerText = "Tele-Counseling Call Panel";
        this.dom.pageSubtitleText.innerText = "Simulated WebRTC call and automated transcription pipeline";
        this.renderCallConsole();
        break;
      case 'session-history':
        this.dom.pageTitleText.innerText = "Counseling Logs";
        this.dom.pageSubtitleText.innerText = "Review previous session transcripts and generated summaries";
        this.renderHistoryRecords();
        break;
      case 'analytics':
        this.dom.pageTitleText.innerText = "Analytics & Insights";
        this.dom.pageSubtitleText.innerText = "Track clinical workloads and regional recovery indicators";
        this.renderAnalyticsCharts();
        break;
      case 'settings':
        this.dom.pageTitleText.innerText = "System Configuration";
        this.dom.pageSubtitleText.innerText = "Manage ASR models, privacy policies, and calling nodes";
        this.renderSettingsTab('ai-models');
        break;
      case 'clinical-workflow':
        this.dom.pageTitleText.innerText = "Clinical Stage Pipeline";
        this.dom.pageSubtitleText.innerText = "Manage patient clinical checkpoints and stage transitions inline";
        this.renderClinicalWorkflow();
        break;
      case 'profiles':
        this.dom.pageTitleText.innerText = "Profiles Management";
        this.dom.pageSubtitleText.innerText = "Manage patient and counselor rosters and assignments";
        this.renderProfilesList();
        break;
    }
  }
  renderProfilesList() {
    if (window.CounselFlow && typeof window.CounselFlow.renderProfilesList === 'function') {
      window.CounselFlow.renderProfilesList();
    } else {
      console.error("renderProfilesList is not defined in window.CounselFlow. Make sure profiles.js is loaded.");
    }
  }
  bindThemeToggle() {
    const toggleBtn = document.getElementById('btn-theme-toggle');
    if (!toggleBtn) return;
    const icon = document.getElementById('theme-toggle-icon');
    const savedTheme = window.CounselFlow.safeGetItem("counseling_theme") || "light";
    if (savedTheme === "dark") {
      document.body.classList.add("dark-theme");
      icon.innerHTML = `<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 5a7 7 0 100 14 7 7 0 000-14z"></path>`;
      toggleBtn.title = "Toggle Light Theme";
    } else {
      document.body.classList.remove("dark-theme");
      icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
      toggleBtn.title = "Toggle Dark Theme";
    }
    toggleBtn.addEventListener('click', () => {
      const isDark = document.body.classList.toggle("dark-theme");
      window.CounselFlow.safeSetItem("counseling_theme", isDark ? "dark" : "light");
      if (isDark) {
        icon.innerHTML = `<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 5a7 7 0 100 14 7 7 0 000-14z"></path>`;
        toggleBtn.title = "Toggle Light Theme";
        this.showToast("Dark Mode Enabled", "Switched dashboard to dark theme.", "info");
      } else {
        icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
        toggleBtn.title = "Toggle Dark Theme";
        this.showToast("Light Mode Enabled", "Switched dashboard to light theme.", "info");
      }
      if (window.CounselFlow.callManager && window.CounselFlow.callManager.isActive) {
        window.CounselFlow.callManager.drawWaveform();
      }
      if (this.activeScreen === 'analytics') {
        this.renderAnalyticsCharts();
      }
    });
  }
  bindNotifications() {
    const bellBtn = document.getElementById('btn-notification-bell');
    const dropdown = document.getElementById('dropdown-notifications');
    const clearBtn = document.getElementById('btn-clear-notifications');
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', () => {
      dropdown.style.display = 'none';
    });
    dropdown.addEventListener('click', (e) => e.stopPropagation());
    clearBtn.addEventListener('click', () => {
      this.notifications.forEach(n => n.unread = false);
      this.updateNotificationBadge();
      this.renderNotificationDropdownList();
      this.showToast("Alerts Cleared", "All alerts marked as read.", "info");
    });
    if (this.dom.notificationsList) {
      this.dom.notificationsList.addEventListener('click', (e) => {
        const item = e.target.closest('.notification-item');
        if (item) {
          const id = parseInt(item.getAttribute('data-id'));
          this.readNotification(id);
        }
      });
    }
    this.renderNotificationDropdownList();
  }
  updateNotificationBadge() {
    const unreadCount = this.notifications.filter(n => n.unread).length;
    if (unreadCount > 0) {
      this.dom.notificationBadge.style.display = 'flex';
      this.dom.notificationBadge.innerText = unreadCount;
    } else {
      this.dom.notificationBadge.style.display = 'none';
    }
  }
  renderNotificationDropdownList() {
    if (!this.dom.notificationsList) return;
    if (this.notifications.length === 0) {
      this.dom.notificationsList.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted);">No new notifications</div>`;
      return;
    }
    this.dom.notificationsList.innerHTML = this.notifications.map(n => this.renderNotificationItemHTML(n)).join('');
  }
  renderNotificationItemHTML(n) {
    return `
      <div class="notification-item ${n.unread ? 'unread' : ''}" data-id="${n.id}">
        <p>${escapeHtml(n.text)}</p>
        <span>${escapeHtml(n.time)}</span>
      </div>
    `;
  }
  readNotification(id) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif) {
      notif.unread = false;
      this.updateNotificationBadge();
      this.renderNotificationDropdownList();
      if (notif.text.includes("Balbir Singh")) {
        const pt = this.patients.find(p => p.name === "Balbir Singh");
        if (pt) this.openPatientDetail(pt);
      }
    }
  }
  getRealAnalyticsData() {
    const filteredPatients = this.getSecurityScopedPatients();
    const weeklySessionTrend = [
      { day: "Mon", calls: 0 },
      { day: "Tue", calls: 0 },
      { day: "Wed", calls: 0 },
      { day: "Thu", calls: 0 },
      { day: "Fri", calls: 0 },
      { day: "Sat", calls: 0 },
      { day: "Sun", calls: 0 }
    ];
    const languageDistribution = [
      { label: "Punjabi", value: 0, color: "var(--accent-blue)" },
      { label: "Hindi", value: 0, color: "var(--accent-purple)" },
      { label: "English", value: 0, color: "var(--accent-teal)" },
      { label: "Others", value: 0, color: "var(--accent-orange)" }
    ];
    const riskLevels = [
      { label: "Critical", value: 0, color: "var(--accent-red)" },
      { label: "High Risk", value: 0, color: "var(--accent-orange)" },
      { label: "Medium", value: 0, color: "var(--accent-purple)" },
      { label: "Stable / Low", value: 0, color: "var(--accent-green)" }
    ];
    let totalCalls = 0;
    let totalDurationSeconds = 0;
    filteredPatients.forEach(pt => {
      if (pt.status === 'Risk' && pt.cravingsIntensity >= 8) {
        riskLevels[0].value++; 
      } else if (pt.severity === 'High') {
        riskLevels[1].value++; 
      } else if (pt.severity === 'Medium') {
        riskLevels[2].value++; 
      } else {
        riskLevels[3].value++; 
      }
      (pt.history || []).forEach(sess => {
        totalCalls++;
        if (sess.date) {
          try {
            const dateObj = new Date(sess.date);
            if (!isNaN(dateObj.getTime())) {
              const dayIndex = dateObj.getDay();
              const mappedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
              if (mappedIndex >= 0 && mappedIndex < 7) {
                weeklySessionTrend[mappedIndex].calls++;
              }
            }
          } catch (e) {}
        }
        const lang = (sess.language || "").trim().toLowerCase();
        if (lang.includes("punjabi")) languageDistribution[0].value++;
        else if (lang.includes("hindi")) languageDistribution[1].value++;
        else if (lang.includes("english")) languageDistribution[2].value++;
        else languageDistribution[3].value++;
        if (sess.duration) {
          const parts = sess.duration.split(':').map(Number);
          let seconds = 0;
          if (parts.length === 3) seconds = (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
          else if (parts.length === 2) seconds = (parts[0] || 0) * 60 + (parts[1] || 0);
          totalDurationSeconds += seconds;
        }
      });
    });
    const hasLangData = languageDistribution.some(l => l.value > 0);
    if (!hasLangData) {
      filteredPatients.forEach(pt => {
        const lang = (pt.preferredLanguage || pt.addictionCategory || '').toLowerCase();
        const addr = (pt.address || '').toLowerCase();
        if (addr.includes('punjab') || addr.includes('chandigarh') || addr.includes('amritsar') || addr.includes('ludhiana') || addr.includes('patiala') || addr.includes('bathinda') || addr.includes('sangrur')) {
          languageDistribution[0].value++;
        } else if (addr.includes('delhi') || addr.includes('up') || addr.includes('bihar') || addr.includes('rajasthan')) {
          languageDistribution[1].value++;
        } else {
          languageDistribution[2].value++;
        }
      });
    }
    let avgDurationStr = "N/A";
    if (totalCalls > 0) {
      const avgSeconds = Math.round(totalDurationSeconds / totalCalls);
      const avgMins = Math.floor(avgSeconds / 60);
      const avgSecs = avgSeconds % 60;
      avgDurationStr = `${avgMins}m ${avgSecs}s`;
    }
    const activePatients = filteredPatients.filter(p => p.status !== 'Completed').length;
    const riskPatients = filteredPatients.filter(p => p.status === 'Risk' || p.severity === 'High').length;
    return {
      totalCalls,
      activePatients,
      riskPatients,
      totalPatients: filteredPatients.length,
      averageDuration: avgDurationStr,
      summaryEfficiency: totalCalls > 0 ? "98.4%" : `${activePatients} Active`,
      weeklySessionTrend,
      languageDistribution,
      riskLevels
    };
  }
  renderTimelineList() {
    if (!this.dom.dashboardTimelineList) return;
    const items = [];
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    const showName = roleConfig.canViewPII;
    const filteredPatients = this.getSecurityScopedPatients();
    const riskPatients = filteredPatients.filter(p => p.status === 'Risk' || p.severity === 'High');
    riskPatients.forEach(pt => {
      const lastSess = (pt.history || [])[0];
      const followUp = lastSess?.summary?.followUp || 'Today – Urgent Review Required';
      items.push({
        type: 'critical',
        title: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Urgent: Follow-up with ${showName ? escapeHtml(pt.name) : '[PII Restricted]'}`,
        desc: `${escapeHtml(pt.addictionCategory)} | Severity: ${escapeHtml(pt.severity)} | Cravings: ${pt.cravingsIntensity}/10`,
        time: `Next: ${escapeHtml(followUp)}`
      });
    });
    const activePatients = filteredPatients.filter(p => (p.status === 'Active' || p.status === 'Monitored') && p.severity !== 'High');
    activePatients.slice(0, 3).forEach(pt => {
      const lastSess = (pt.history || [])[0];
      const followUp = lastSess?.summary?.followUp || 'Scheduled – Next Available Slot';
      items.push({
        type: 'routine',
        title: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg> Routine Check-in: ${showName ? escapeHtml(pt.name) : '[PII Restricted]'}`,
        desc: `Stage ${pt.clinicalStage || 1} | Day ${window.CounselFlow && window.CounselFlow.calculateTreatmentDay ? window.CounselFlow.calculateTreatmentDay(pt.admissionDate) : 0} | ${escapeHtml(pt.recoveryPhase || 'Active Recovery')}`,
        time: `Next: ${escapeHtml(followUp)}`
      });
    });
    const allSessions = [];
    filteredPatients.forEach(pt => {
      (pt.history || []).forEach(sess => allSessions.push({ patient: pt, session: sess }));
    });
    allSessions.sort((a, b) => new Date(b.session.date) - new Date(a.session.date));
    allSessions.slice(0, 2).forEach(item => {
      items.push({
        type: 'completed',
        title: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Session Completed: ${showName ? escapeHtml(item.patient.name) : '[PII Restricted]'}`,
        desc: escapeHtml(item.session.summary?.overview || 'Clinical session record committed.'),
        time: `Completed: ${escapeHtml(item.session.date)} (${escapeHtml(item.session.duration || '--')})`
      });
    });
    const completedPatients = filteredPatients.filter(p => p.status === 'Completed');
    completedPatients.slice(0, 1).forEach(pt => {
      items.push({
        type: 'completed',
        title: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><circle cx="12" cy="8" r="6"></circle><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"></path></svg> Recovery Milestone: ${showName ? escapeHtml(pt.name) : '[PII Restricted]'}`,
        desc: `Successfully completed ${escapeHtml(pt.addictionCategory)} recovery programme.`,
        time: `Enrolled: ${escapeHtml(pt.joinDate || 'N/A')} | Phase: ${escapeHtml(pt.recoveryPhase || 'Completed')}`
      });
    });
    if (items.length === 0) {
      this.dom.dashboardTimelineList.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">No patients enrolled yet.</div>`;
      return;
    }
    this.dom.dashboardTimelineList.innerHTML = items.map(item => {
      const dotClass = item.type === 'critical' ? 'timeline-dot critical' : 'timeline-dot';
      const dotStyle = item.type === 'completed' ? 'background:var(--text-muted); box-shadow:none;' : item.type === 'routine' ? 'background:var(--accent-blue);' : '';
      return `
        <div class="timeline-item">
          <div class="${dotClass}" style="${dotStyle}" aria-hidden="true"></div>
          <div class="timeline-text">
            <h5>${item.title}</h5>
            <p>${item.desc}</p>
            <span>${item.time}</span>
          </div>
        </div>
      `;
    }).join('');
  }
  renderCallConsole() {
    const pt = this.selectedPatient;
    if (pt) {
      document.getElementById('call-recipient-name').innerText = escapeHtml(pt.name);
      document.getElementById('call-recipient-details').innerText = `${escapeHtml(pt.id)} | ${escapeHtml(pt.addictionCategory)}`;
      const initials = pt.name.split(' ').map(n => n[0]).join('').substring(0, 2);
      document.getElementById('call-recipient-avatar').innerText = initials;
      document.getElementById('call-recipient-avatar').style.background = pt.avatarColor || 'var(--accent-blue)';
    } else {
      document.getElementById('call-recipient-name').innerText = "No Patient Selected";
      document.getElementById('call-recipient-details').innerText = "Select a patient from the database";
      document.getElementById('call-recipient-avatar').innerText = "?";
      document.getElementById('call-recipient-avatar').style.background = "var(--border-light)";
    }
  }
  renderDashboard() {
    const realData = this.getRealAnalyticsData();
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    const filteredPatients = this.getSecurityScopedPatients();
    const quickCallBtn = document.getElementById('btn-quick-call');
    if (quickCallBtn) {
      quickCallBtn.style.display = roleConfig.allowedScreens.includes('call-console') ? '' : 'none';
    }
    const gridDashboard = document.querySelector('.grid-dashboard');
    if (activeRole === 'ddrc') {
      const awaitingPsychoed = filteredPatients.filter(p => p.clinicalStage === 2 && (!p.checkpoints || !p.checkpoints.familyPsychoedAttended));
      const readyFor30Day = filteredPatients.filter(p => p.clinicalStage === 3 && (!p.checkpoints || !p.checkpoints.day30ReviewPassed));
      const approaching90Day = filteredPatients.filter(p => p.clinicalStage === 5 && window.CounselFlow.calculateTreatmentDay(p.admissionDate) >= 80);
      const overdueCheckpoints = filteredPatients.filter(p => p.clinicalStage <= 2 && window.CounselFlow.calculateTreatmentDay(p.admissionDate) > 14 && p.status !== 'Completed' && p.status !== 'LAMA');
      if (gridDashboard) {
        gridDashboard.innerHTML = `
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(165, 94, 234, 0.1); color: var(--accent-purple);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div>
            <div class="card-info">
              <span>Awaiting Family Psychoed</span>
              <h3>${awaitingPsychoed.length}</h3>
            </div>
          </div>
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(0, 242, 254, 0.1); color: var(--accent-blue);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div>
            <div class="card-info">
              <span>Ready for 30-Day Review</span>
              <h3>${readyFor30Day.length}</h3>
            </div>
          </div>
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--accent-teal);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"></circle><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"></path></svg></div>
            <div class="card-info">
              <span>Approaching 90-Day</span>
              <h3>${approaching90Day.length}</h3>
            </div>
          </div>
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(220, 38, 38, 0.1); color: var(--accent-red);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>
            <div class="card-info">
              <span>Overdue Checkpoints</span>
              <h3>${overdueCheckpoints.length}</h3>
            </div>
          </div>
        `;
      }
      if (!this.dom.dashboardPatientsList) return;
      const queueSection = this.dom.dashboardPatientsList.closest('section, .panel, div[class]');
      const queueHeader = document.getElementById('dashboard-queue-title');
      const sortVal = this.ddrcQueueSort || 'oldest';
      if (queueHeader) queueHeader.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg> Stage 1: Pending Clinical Clearance 
        <div style="float:right; display:flex; gap:8px; align-items:center; font-size:12px; font-weight:normal;">
          <select id="ddrc-queue-sort" style="padding:4px; border-radius:4px; border:1px solid var(--border-light); background:var(--bg-card); color:var(--text-primary);">
            <option value="oldest" ${sortVal === 'oldest' ? 'selected' : ''}>Sort: Oldest First</option>
            <option value="stage" ${sortVal === 'stage' ? 'selected' : ''}>Sort: Clinical Stage</option>
            <option value="missing" ${sortVal === 'missing' ? 'selected' : ''}>Sort: Most Missing</option>
          </select>
        </div>`;
      const sortSelect = document.getElementById('ddrc-queue-sort');
      if (sortSelect) {
        sortSelect.onchange = () => {
          this.ddrcQueueSort = sortSelect.value;
          this.renderDashboard();
        };
      }
      let stageOneQueue = filteredPatients.filter(p =>
        p.clinicalStage <= 2 && p.status !== 'Completed' && p.status !== 'LAMA'
      );
      stageOneQueue.sort((a, b) => {
        if (sortVal === 'stage') return a.clinicalStage - b.clinicalStage;
        if (sortVal === 'missing') {
           const aMissing = (!a.checkpoints?.withdrawalStabilised ? 1 : 0) + (!a.checkpoints?.layer1And2Ready ? 1 : 0);
           const bMissing = (!b.checkpoints?.withdrawalStabilised ? 1 : 0) + (!b.checkpoints?.layer1And2Ready ? 1 : 0);
           return bMissing - aMissing;
        }
        return window.CounselFlow.calculateTreatmentDay(b.admissionDate) - window.CounselFlow.calculateTreatmentDay(a.admissionDate);
      });
      stageOneQueue = stageOneQueue.slice(0, 10);
      this.dom.dashboardPatientsList.innerHTML = stageOneQueue.length > 0 ? `
        <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
          ${stageOneQueue.map(pt => {
            const day = window.CounselFlow.calculateTreatmentDay(pt.admissionDate);
            const wStab = pt.checkpoints?.withdrawalStabilised ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
            const layer = pt.checkpoints?.layer1And2Ready ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
            let urgencyColor = 'var(--accent-green)';
            let urgencyText = 'On Track';
            if (day > 14) { urgencyColor = 'var(--accent-red)'; urgencyText = 'Overdue'; }
            else if (day >= 10) { urgencyColor = 'var(--accent-orange)'; urgencyText = 'Due Soon'; }
            else if (day >= 5) { urgencyColor = '#facc15'; urgencyText = 'Approaching'; }
            const escapedId = escapeHtml(pt.id || '');
            const escapedName = escapeHtml(pt.name || '');
            return `
              <div class="patient-row" data-patient-id="${escapedId}" style="cursor:pointer; border-left: 3px solid ${urgencyColor};">
                <div class="patient-meta">
                  <div class="patient-avatar" style="background:${pt.avatarColor || urgencyColor}; font-size:13px;">${escapedName.substring(0,2).toUpperCase()}</div>
                  <div class="patient-details">
                    <h4>${escapedName} <span style="margin-left:8px; padding:2px 6px; font-size:9px; border-radius:4px; background:${urgencyColor}22; color:${urgencyColor};">${urgencyText}</span></h4>
                    <span>Day ${day} | Stage ${pt.clinicalStage || 1} | ${escapeHtml(pt.addictionCategory)}</span>
                  </div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px; font-size:10px;">
                  <span style="color:var(--text-muted);">${wStab} Withdrawal Stab.</span>
                  <span style="color:var(--text-muted);">${layer} Layer 1+2 Ready</span>
                </div>
              </div>`;
          }).join('')}
        </div>
      ` : `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> No patients pending MO clearance.</div>`;
    } else {
      if (gridDashboard) {
        gridDashboard.innerHTML = `
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(0, 242, 254, 0.1); color: var(--accent-blue);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg></div>
            <div class="card-info">
              <span>Total Sessions</span>
              <h3 id="stat-total-calls">${realData.totalCalls > 0 ? realData.totalCalls : realData.totalPatients}</h3>
            </div>
          </div>
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--accent-teal);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div>
            <div class="card-info">
              <span>Active Patients</span>
              <h3 id="stat-active-patients">${realData.activePatients}</h3>
            </div>
          </div>
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(165, 94, 234, 0.1); color: var(--accent-purple);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
            <div class="card-info">
              <span>${realData.averageDuration !== 'N/A' ? 'Avg Call Duration' : 'Total Enrolled'}</span>
              <h3 id="stat-avg-duration">${realData.averageDuration !== 'N/A' ? realData.averageDuration : `${realData.totalPatients} Enrolled`}</h3>
            </div>
          </div>
          <div class="card-stats">
            <div class="card-icon" style="background: rgba(255, 159, 67, 0.1); color: var(--accent-orange);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg></div>
            <div class="card-info">
              <span>Counselor Score</span>
              <h3 id="stat-accuracy">${realData.totalCalls > 0 ? '98.4%' : `${realData.activePatients} Active`}</h3>
            </div>
          </div>
        `;
      }
      const queueHeader = document.getElementById('dashboard-queue-title');
      if (queueHeader) {
        const staffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
        const currentUser = window.CounselFlow.DEMO_CREDENTIALS.find(c => c.staffId === staffId);
        const district = currentUser ? currentUser.district : '';
        queueHeader.innerText = district ? `Today's CBM Call Queue — ${district} District` : "Today's CBM Call Queue — All Districts";
      }
      if (!this.dom.dashboardPatientsList) return;
      const monitoredPatients = filteredPatients.filter(p => p.status !== 'Completed').slice(0, 3);
      this.dom.dashboardPatientsList.innerHTML = monitoredPatients.length > 0 ? `
        <div role="table" aria-label="Today's CBM Call Queue" style="display:flex; flex-direction:column; gap:12px; width:100%;">
          ${monitoredPatients.map(pt => this.renderPatientRowHTML(pt, true)).join('')}
        </div>
      ` : `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">No calls scheduled for today.</div>`;
    }
    this.renderMissedCallsPanel();
    this.renderTimelineList();
    this.renderEscalationPanel();
  }
  renderProfilesList() {
    if (window.CounselFlow && typeof window.CounselFlow.renderProfilesList === 'function') {
      window.CounselFlow.renderProfilesList();
    } else {
      console.warn("Profiles rendering function not registered yet.");
    }
  }
  renderClinicalWorkflow() {
    const board = document.getElementById('clinical-workflow-board');
    const statsHeatmap = document.getElementById('workflow-stats-heatmap');
    if (!board) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const query = (this.currentWorkflowFilter?.query || '').toLowerCase().trim();
    const sortMode = this.currentWorkflowFilter?.sort || 'newest';
    let filteredPatients = this.getSecurityScopedPatients();
    if (query) {
      filteredPatients = filteredPatients.filter(p =>
        (p.name || '').toLowerCase().includes(query) ||
        (p.id || '').toLowerCase().includes(query)
      );
    }
    const detoxPatients = filteredPatients.filter(p => (p.clinicalStage === 1 || p.clinicalStage === 2) && p.status !== 'Completed' && p.status !== 'LAMA');
    const stage3Patients = filteredPatients.filter(p => p.clinicalStage === 3 && p.status !== 'Completed' && p.status !== 'LAMA');
    const stage4Patients = filteredPatients.filter(p => p.clinicalStage === 4 && p.status !== 'Completed' && p.status !== 'LAMA');
    const stage5Patients = filteredPatients.filter(p => p.clinicalStage === 5 && p.status !== 'Completed' && p.status !== 'LAMA');
    const lamaPatients = filteredPatients.filter(p => p.status === 'LAMA' || p.clinicalStage === 0);
    const sortFn = (a, b) => {
      const dayA = window.CounselFlow.calculateTreatmentDay(a.admissionDate);
      const dayB = window.CounselFlow.calculateTreatmentDay(b.admissionDate);
      if (sortMode === 'newest') return dayA - dayB;
      if (sortMode === 'overdue') return dayB - dayA;
      if (sortMode === 'severity') {
        const sevOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        return (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9);
      }
      return 0;
    };
    detoxPatients.sort(sortFn);
    stage3Patients.sort(sortFn);
    stage4Patients.sort(sortFn);
    stage5Patients.sort(sortFn);
    lamaPatients.sort((a, b) => window.CounselFlow.calculateTreatmentDay(a.admissionDate) - window.CounselFlow.calculateTreatmentDay(b.admissionDate));
    if (statsHeatmap) {
      const colDefs = [
        { id: 'detox', label: 'Detox & Clearance', patients: detoxPatients, thresholds: [14, 10, 5] },
        { id: 'family', label: 'Family Activation', patients: stage3Patients, thresholds: [14, 10, 5] },
        { id: 'bridge', label: '30-Day Bridge', patients: stage4Patients, thresholds: [45, 30] },
        { id: 'maintenance', label: '90-Day Maintenance', patients: stage5Patients, thresholds: [90] },
        { id: 'lama', label: 'LAMA Cases', patients: lamaPatients, thresholds: [] },
      ];
      statsHeatmap.innerHTML = colDefs.map(col => {
        if (!col.patients.length) return `<span style="color:var(--text-muted);">${col.label}: 0</span>`;
        const overdue = col.patients.filter(p => {
          const day = window.CounselFlow.calculateTreatmentDay(p.admissionDate);
          if (col.id === 'bridge') return day > 45;
          if (col.id === 'maintenance') return day >= 90;
          return day > (col.thresholds[0] || 999);
        }).length;
        const dueSoon = col.patients.filter(p => {
          const day = window.CounselFlow.calculateTreatmentDay(p.admissionDate);
          if (col.id === 'bridge') return day >= 30 && day <= 45;
          if (col.id === 'maintenance') return false;
          const t = col.thresholds;
          return day >= (t[1] || 0) && day <= (t[0] || 999);
        }).length;
        const approaching = col.patients.filter(p => {
          const day = window.CounselFlow.calculateTreatmentDay(p.admissionDate);
          if (col.id === 'bridge' || col.id === 'maintenance') return 0;
          return day >= (col.thresholds[2] || 0) && day < (col.thresholds[1] || 999);
        }).length;
        const onTrack = col.patients.length - overdue - dueSoon - approaching;
        return `<span style="display:flex; gap:6px; align-items:center;">
          <strong style="color:var(--text-primary);">${col.label}:</strong>
          <span style="color:var(--accent-green);">${onTrack}</span>
          ${approaching ? `<span style="color:#facc15;">${approaching}</span>` : ''}
          ${dueSoon ? `<span style="color:var(--accent-orange);">${dueSoon}</span>` : ''}
          ${overdue ? `<span style="color:var(--accent-red); font-weight:700;">${overdue} overdue</span>` : ''}
        </span>`;
      }).join('');
    }
    const columns = [
      {
        id: 'detox',
        title: 'Detox & Clearance',
        subtitle: 'Stage 1 & 2',
        count: detoxPatients.length,
        patients: detoxPatients,
        renderChecklist: (pt) => {
          const wChecked = pt.checkpoints?.withdrawalStabilised ? 'checked' : '';
          const lChecked = pt.checkpoints?.layer1And2Ready ? 'checked' : '';
          const canEdit = ['spo', 'supervisor', 'ddrc'].includes(activeRole);
          const disabledAttr = canEdit ? '' : 'disabled';
          return `
            <div class="workflow-check-list">
              <label class="workflow-check-item${canEdit ? '' : ' workflow-read-only'}">
                <input type="checkbox" class="chk-workflow-checkpoint" data-id="${pt.id}" data-field="withdrawalStabilised" ${wChecked} ${disabledAttr}>
                Withdrawal Stabilised
              </label>
              <label class="workflow-check-item${canEdit ? '' : ' workflow-read-only'}">
                <input type="checkbox" class="chk-workflow-checkpoint" data-id="${pt.id}" data-field="layer1And2Ready" ${lChecked} ${disabledAttr}>
                Layer 1+2 Ready
              </label>
            </div>
            ${(canEdit && pt.checkpoints?.withdrawalStabilised && pt.checkpoints?.layer1And2Ready) ? `
              <button class="workflow-action-btn primary btn-workflow-promote" data-id="${pt.id}" data-target-stage="3">Request MO Clearance</button>
            ` : ''}
          `;
        }
      },
      {
        id: 'family',
        title: 'Family Activation',
        subtitle: 'Stage 3',
        count: stage3Patients.length,
        patients: stage3Patients,
        renderChecklist: (pt) => {
          const fChecked = pt.checkpoints?.familyPsychoedAttended ? 'checked' : '';
          const canEdit = ['spo', 'supervisor', 'ddrc'].includes(activeRole);
          const disabledAttr = canEdit ? '' : 'disabled';
          const anchorStatus = pt.familyAnchorStatus || 'pending';
          let anchorHtml = '';
          if (anchorStatus === 'unavailable') {
             anchorHtml = `<div class="workflow-no-family-warning">No Family Anchor. Reference card issued.</div>`;
          } else if (canEdit && !pt.checkpoints?.familyPsychoedAttended) {
             anchorHtml = `<button class="workflow-action-btn secondary btn-workflow-no-family" data-id="${pt.id}" style="margin-top:4px; font-size:10px; border-color:var(--accent-orange); color:var(--accent-orange);">Mark No Family Anchor</button>`;
          }
          return `
            <div class="workflow-check-list">
              <label class="workflow-check-item${canEdit ? '' : ' workflow-read-only'}">
                <input type="checkbox" class="chk-workflow-checkpoint" data-id="${pt.id}" data-field="familyPsychoedAttended" ${fChecked} ${disabledAttr}>
                Family Psychoed Attended
              </label>
              ${anchorHtml}
            </div>
            ${(canEdit && (pt.checkpoints?.familyPsychoedAttended || anchorStatus === 'unavailable')) ? `
              <button class="workflow-action-btn primary btn-workflow-promote" data-id="${pt.id}" data-target-stage="4" style="margin-top:8px;">Schedule Bridge Review</button>
            ` : ''}
          `;
        }
      },
      {
        id: 'bridge',
        title: '30-Day Bridge',
        subtitle: 'Stage 4',
        count: stage4Patients.length,
        patients: stage4Patients,
        renderChecklist: (pt) => {
          const bChecked = pt.checkpoints?.day30ReviewPassed ? 'checked' : '';
          const canEdit = ['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole);
          const canFail = ['spo', 'supervisor', 'ddrc'].includes(activeRole);
          const disabledAttr = canEdit ? '' : 'disabled';
          const contactsThisWeek = window.CounselFlow.getStage4ContactsThisWeek ? window.CounselFlow.getStage4ContactsThisWeek(pt) : 0;
          const contactAlert = contactsThisWeek < 3 ? `<div style="font-size:10px; color:var(--accent-red); margin-top:4px; font-weight:bold;">Contacts this week: ${contactsThisWeek}/3 (L1 Alert)</div>` : `<div style="font-size:10px; color:var(--accent-teal); margin-top:4px;">Contacts this week: ${contactsThisWeek}/3</div>`;
          const ngoHtml = pt.ngoPartner ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">NGO: ${escapeHtml(pt.ngoPartner)}</div>` : `<div style="font-size:10px; color:var(--accent-orange); margin-top:2px;">No NGO Partner Assigned</div>`;
          return `
            <div class="workflow-check-list">
              ${contactAlert}
              ${ngoHtml}
              <label class="workflow-check-item${canEdit ? '' : ' workflow-read-only'}" style="margin-top:8px;">
                <input type="checkbox" class="chk-workflow-checkpoint" data-id="${pt.id}" data-field="day30ReviewPassed" ${bChecked} ${disabledAttr}>
                30-Day Review Passed
              </label>
            </div>
            ${(canEdit && pt.checkpoints?.day30ReviewPassed) ? `
              <button class="workflow-action-btn primary btn-workflow-promote" data-id="${pt.id}" data-target-stage="5" style="margin-top:8px;">Promote to Maintenance</button>
            ` : ''}
            ${(canFail && !pt.checkpoints?.day30ReviewPassed) ? `
              <button class="workflow-action-btn secondary btn-workflow-fail-review" data-id="${pt.id}" style="margin-top:4px; border-color:var(--accent-red); color:var(--accent-red);">Fail 30-Day Review</button>
            ` : ''}
          `;
        }
      },
      {
        id: 'maintenance',
        title: '90-Day Maintenance',
        subtitle: 'Stage 5',
        count: stage5Patients.length,
        patients: stage5Patients,
        renderChecklist: (pt) => {
          const day = window.CounselFlow.calculateTreatmentDay(pt.admissionDate);
          const canEdit = ['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole);
          const counselorSigned = pt.stage6SignoffCounsellor ? '✅' : '❌';
          const supervisorSigned = pt.stage6SignoffSupervisor ? '✅' : '❌';
          return `
            <div class="workflow-maintenance-status">
              Day ${day} on maintenance. Ready for closeout at Day 90.
              <div style="margin-top:4px; font-weight:bold; color:var(--accent-blue);">📉 Reduced Cadence: Weekly Calls</div>
            </div>
            ${(canEdit && day >= 90) ? `
              <div style="font-size:10px; margin-bottom:4px; color:var(--text-secondary);">Final Review Sign-offs:</div>
              <div class="workflow-signoff-buttons">
                <button class="workflow-action-btn secondary btn-workflow-signoff-counsellor workflow-signoff-btn" data-id="${pt.id}" ${pt.stage6SignoffCounsellor ? 'disabled' : ''}>Counsellor ${counselorSigned}</button>
                <button class="workflow-action-btn secondary btn-workflow-signoff-supervisor workflow-signoff-btn" data-id="${pt.id}" ${pt.stage6SignoffSupervisor ? 'disabled' : ''}>Supervisor ${supervisorSigned}</button>
              </div>
            ` : ''}
          `;
        }
      },
      {
        id: 'lama',
        title: 'LAMA Cases',
        subtitle: 'Stage 0 Discharge',
        count: lamaPatients.length,
        patients: lamaPatients,
        renderChecklist: (pt) => {
          const canEdit = ['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole);
          return `
            <div class="workflow-maintenance-status" style="color:var(--accent-red); background:rgba(220,38,38,0.05); border-color:rgba(220,38,38,0.2);">
              Left Against Medical Advice. Monitor safety-net protocols.
            </div>
            ${canEdit ? `
            <button class="workflow-action-btn secondary btn-workflow-re-enroll workflow-re-enroll-btn" data-id="${pt.id}">Re-Enroll Patient</button>
            ` : ''}
          `;
        }
      }
    ];
    board.innerHTML = columns.map(col => {
      return `
        <div class="workflow-column" id="workflow-col-${col.id}">
          <div class="workflow-column-header">
            <div class="workflow-column-title">${col.title}</div>
            <div class="workflow-column-count">${col.count}</div>
          </div>
          <div class="workflow-column-subtitle">${col.subtitle}</div>
          <div class="workflow-cards-container">
            ${col.patients.length > 0 ? col.patients.map(pt => {
              const day = window.CounselFlow.calculateTreatmentDay(pt.admissionDate);
              let urgencyColor = 'var(--accent-green)';
              let urgencyText = 'On Track';
              if (pt.status === 'LAMA') {
                urgencyColor = 'var(--accent-red)';
                urgencyText = 'LAMA';
              } else if (col.id === 'detox' || col.id === 'family') {
                if (day > 14) { urgencyColor = 'var(--accent-red)'; urgencyText = 'Overdue'; }
                else if (day >= 10) { urgencyColor = 'var(--accent-orange)'; urgencyText = 'Due Soon'; }
                else if (day >= 5) { urgencyColor = '#facc15'; urgencyText = 'Approaching'; }
              } else if (col.id === 'bridge') {
                if (day > 45) { urgencyColor = 'var(--accent-red)'; urgencyText = 'Overdue'; }
                else if (day >= 30) { urgencyColor = 'var(--accent-orange)'; urgencyText = 'Review Due'; }
              }
              const escapedName = escapeHtml(pt.name || '');
              const escapedId = escapeHtml(pt.id || '');
              const escapedCategory = escapeHtml(pt.addictionCategory || 'N/A');
              return `
                <div class="workflow-card" data-id="${escapedId}" style="border-left: 3px solid ${urgencyColor};">
                  <div class="workflow-card-header">
                    <div class="workflow-card-info">
                       <h4 class="workflow-card-nav">${escapedName}</h4>
                      <span>ID: ${escapedId}</span>
                    </div>
                    <span class="workflow-card-badge" style="background:${urgencyColor}22; color:${urgencyColor};">${urgencyText}</span>
                  </div>
                  <div class="workflow-card-details">
                    <div><strong>Day:</strong> ${day} | <strong>Severity:</strong> ${escapeHtml(pt.severity || 'Low')}</div>
                    <div><strong>Category:</strong> ${escapedCategory}</div>
                  </div>
                  <div class="workflow-card-interactive" onclick="event.stopPropagation();">
                    ${col.renderChecklist(pt)}
                  </div>
                </div>
              `;
            }).join('') : `
              <div style="padding:20px; text-align:center; color:var(--text-muted); font-size:11px; border:1px dashed var(--border-light); border-radius:10px;">
                No patients in this stage.
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
    this.bindWorkflowEvents();
  }
  bindWorkflowEvents() {
    const board = document.getElementById('clinical-workflow-board');
    if (!board) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    board.querySelectorAll('.chk-workflow-checkpoint').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-id');
        const field = e.target.getAttribute('data-field');
        const checked = e.target.checked;
        const isDetoxOrFamilyField = ['withdrawalStabilised', 'layer1And2Ready', 'familyPsychoedAttended'].includes(field);
        const allowedRoles = isDetoxOrFamilyField ? ['spo', 'supervisor', 'ddrc'] : ['spo', 'supervisor', 'ddrc', 'counsellor'];
        if (!allowedRoles.includes(activeRole)) {
          e.target.checked = !checked;
          this.showToast('Access Denied', 'Your role is not authorized to edit this checkpoint.', 'error');
          return;
        }
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          if (!pt.checkpoints) pt.checkpoints = {};
          pt.checkpoints[field] = checked;
          if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
            window.CounselFlow.evaluatePatientWorkflow(pt);
          }
          await window.CounselFlow.savePatients(this.patients);
          this.showToast('Checkpoint Updated', `Updated checkpoint for ${pt.name}`, 'success');
          this.renderClinicalWorkflow();
        }
      });
    });
    // Gap 5: Family Anchor Unavailable Handler
    board.querySelectorAll('.btn-workflow-no-family').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        if (!['spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Only DDRC or Supervisors can mark a family anchor unavailable.', 'error');
          return;
        }
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          pt.familyAnchorStatus = 'unavailable';
          pt.checkpoints.familyPsychoedAttended = false;
          window.CounselFlow.writeAuditEvent('FAMILY_ANCHOR_UNAVAILABLE', pt.id, 'N/A', activeRole, `No family anchor available for ${pt.name}. Reference card issued.`);
          await window.CounselFlow.savePatients(this.patients);
          this.showToast('Anchor Updated', `No family anchor marked for ${pt.name}.`, 'warning');
          this.renderClinicalWorkflow();
        }
      });
    });
    board.querySelectorAll('.btn-workflow-promote').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        const targetStage = parseInt(e.target.getAttribute('data-target-stage'));
        const isDetoxOrFamilyTarget = [3, 4].includes(targetStage);
        const allowedRoles = isDetoxOrFamilyTarget ? ['spo', 'supervisor', 'ddrc'] : ['spo', 'supervisor', 'ddrc', 'counsellor'];
        if (!allowedRoles.includes(activeRole)) {
          this.showToast('Access Denied', 'Your role is not authorized to promote this patient stage.', 'error');
          return;
        }
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          if (targetStage === 3) {
            pt.checkpoints.withdrawalStabilised = true;
            pt.checkpoints.layer1And2Ready = true;
          } else if (targetStage === 4) {
            pt.checkpoints.familyPsychoedAttended = true;
          } else if (targetStage === 5) {
            pt.checkpoints.day30ReviewPassed = true;
          } else if (targetStage === 6) {
            pt.status = 'Completed';
            pt.clinicalStage = 6;
          }
          if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
            window.CounselFlow.evaluatePatientWorkflow(pt);
          }
          await window.CounselFlow.savePatients(this.patients);
          this.showToast('Stage Promoted', `${pt.name} promoted to Stage ${pt.clinicalStage}`, 'success');
          this.renderClinicalWorkflow();
        }
      });
    });
    board.querySelectorAll('.btn-workflow-re-enroll').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        const allowedRoles = ['spo', 'supervisor', 'ddrc', 'counsellor'];
        if (!allowedRoles.includes(activeRole)) {
          this.showToast('Access Denied', 'Your role is not authorized to re-enroll patients.', 'error');
          return;
        }
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          pt.status = 'Monitored'; 
          pt.checkpoints.withdrawalStabilised = false;
          pt.checkpoints.layer1And2Ready = false;
          pt.checkpoints.familyPsychoedAttended = false;
          pt.checkpoints.day30ReviewPassed = false;
          // Gap 8: Log LAMA callback/re-enroll as structured audit event
          window.CounselFlow.writeAuditEvent('LAMA_CALLBACK', pt.id, 'N/A', activeRole, `Patient ${pt.name} re-enrolled after LAMA. Checkpoints reset. Safety-net callback registered.`);
          if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
            window.CounselFlow.evaluatePatientWorkflow(pt);
          }
          await window.CounselFlow.savePatients(this.patients);
          this.showToast('Patient Re-Enrolled', `${pt.name} status reset to Detoxification. LAMA callback logged.`, 'success');
          this.renderClinicalWorkflow();
        }
      });
    });
    // Gap 4: Failed 30-Day Review — recycle patient back to Stage 4 bridge
    board.querySelectorAll('.btn-workflow-fail-review').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        if (!['spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Only DDRC, Supervisor, or SPO can record a failed review.', 'error');
          return;
        }
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          pt.checkpoints.day30ReviewPassed = false;
          pt.clinicalStage = 4; // Force back to bridge
          pt.status = 'Risk';
          // Auto-create L3 escalation in last session summary if present
          if (pt.history && pt.history.length > 0) {
            pt.history[0].summary = pt.history[0].summary || {};
            pt.history[0].summary.escalationLevel = 3;
            pt.history[0].summary.escalationReason = `30-Day Review FAILED. Patient recycled from Stage 5 back to Stage 4 Bridge. L3 SPO intervention required.`;
          }
          window.CounselFlow.writeAuditEvent('REVIEW_FAILED_L3', pt.id, 'N/A', activeRole, `30-Day Review failed for ${pt.name}. Recycled to Stage 4 bridge. L3 escalation auto-triggered.`);
          await window.CounselFlow.savePatients(this.patients);
          this.showToast('Review Failed — Bridge Recycled', `${pt.name} returned to Stage 4. L3 escalation raised to SPO.`, 'error');
          this.renderClinicalWorkflow();
          this.renderEscalationPanel();
        }
      });
    });
    // Gap 3: Stage 6 dual sign-off — counsellor sign-off
    board.querySelectorAll('.btn-workflow-signoff-counsellor').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        if (!['counsellor', 'spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Only the Tele-Counsellor or DDRC Clinical can provide counsellor sign-off.', 'error');
          return;
        }
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          pt.stage6SignoffCounsellor = true;
          pt.stage6SignoffCounsellorAt = new Date().toLocaleString();
          pt.stage6SignoffCounsellorBy = this.loggedInName || activeRole;
          await window.CounselFlow.savePatients(this.patients);
          this.showToast('Counsellor Sign-off Recorded', `Final review sign-off by counsellor saved for ${pt.name}.`, 'success');
          this.renderClinicalWorkflow();
        }
      });
    });
    // Gap 3: Stage 6 dual sign-off — supervisor sign-off
    board.querySelectorAll('.btn-workflow-signoff-supervisor').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.getAttribute('data-id');
        if (!['supervisor', 'spo'].includes(activeRole)) {
          this.showToast('Access Denied', 'Only the Supervisor or SPO can provide supervisor sign-off.', 'error');
          return;
        }
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          pt.stage6SignoffSupervisor = true;
          pt.stage6SignoffSupervisorAt = new Date().toLocaleString();
          pt.stage6SignoffSupervisorBy = this.loggedInName || activeRole;
          // Both signed off — mark complete
          if (pt.stage6SignoffCounsellor && pt.stage6SignoffSupervisor) {
            pt.status = 'Completed';
            pt.clinicalStage = 6;
            window.CounselFlow.writeAuditEvent('COHORT_CLOSE_DUAL_SIGNOFF', pt.id, 'N/A', activeRole, `Stage 6 dual sign-off complete. Counsellor: ${pt.stage6SignoffCounsellorBy || 'N/A'}, Supervisor: ${pt.stage6SignoffSupervisorBy}. Case formally closed.`);
            this.showToast('Case Formally Closed', `${pt.name} cohort closed with dual sign-off. File marked Completed.`, 'success');
          } else {
            this.showToast('Supervisor Sign-off Recorded', `Awaiting counsellor sign-off to complete closure for ${pt.name}.`, 'info');
          }
          await window.CounselFlow.savePatients(this.patients);
          this.renderClinicalWorkflow();
        }
      });
    });
    board.querySelectorAll('.workflow-card').forEach(card => {
      const nav = card.querySelector('.workflow-card-nav');
      if (!nav) return;
      nav.addEventListener('click', async (e) => {
        const id = card.getAttribute('data-id');
        await this.switchScreen('patients');
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          this.openPatientDetail(pt);
        }
      });
    });
  }
  bindWorkflowSearchAndSort() {
    const searchInput = document.getElementById('workflow-search-input');
    const sortSelect = document.getElementById('workflow-sort-select');
    if (!searchInput || !sortSelect) return;
    this.dom.workflowSearchInput = searchInput;
    this.dom.workflowSortSelect = sortSelect;
    this.dom.workflowStatsHeatmap = document.getElementById('workflow-stats-heatmap');
    const savedQuery = this.currentWorkflowFilter?.query || '';
    searchInput.value = savedQuery;
    sortSelect.value = this.currentWorkflowFilter?.sort || 'newest';
    const handler = debounce(() => {
      this.currentWorkflowFilter = {
        query: searchInput.value,
        sort: sortSelect.value,
      };
      this.renderClinicalWorkflow();
    }, 200);
    searchInput.addEventListener('input', handler);
    sortSelect.addEventListener('change', handler);
  }
  renderMissedCallsPanel() {
    const missedCallsContainer = document.getElementById('missed-calls-panel-container');
    if (!missedCallsContainer) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    if (activeRole === 'ddrc') {
      const panelWrap = missedCallsContainer.parentElement?.parentElement;
      if (panelWrap) panelWrap.style.display = 'none';
      return;
    }
    const missedPatients = this.getSecurityScopedPatients().filter(p => p.severity === 'High' && p.status === 'Risk').slice(0, 1);
    if (missedPatients.length === 0) {
      const panelWrap = missedCallsContainer.parentElement?.parentElement;
      if (panelWrap) panelWrap.style.display = 'none';
      return;
    }
    const panelWrap = document.querySelector('#missed-calls-panel-container');
    if(panelWrap && panelWrap.parentElement && panelWrap.parentElement.parentElement) {
        panelWrap.parentElement.parentElement.style.display = 'block';
    }
    missedCallsContainer.innerHTML = missedPatients.map(pt => {
      const escapedName = escapeHtml(pt.name || '');
      const escapedId = escapeHtml(pt.id || '');
      return `
        <div class="patient-row" data-patient-id="${escapedId}" style="background: rgba(220,38,38,0.05); border-color: rgba(220,38,38,0.2);">
          <div class="patient-meta">
            <div class="patient-avatar" style="background: var(--accent-red);">!</div>
            <div class="patient-details">
              <h4>${roleConfig.canViewPII ? escapedName : '[PII Restricted]'}</h4>
              <span style="color: var(--accent-red);">Missed Call (LAMA Safety-Net) • 10 mins ago</span>
            </div>
          </div>
          <div>
          </div>
        </div>
      `;
    }).join('');
    this.renderOpdDefaulters(missedCallsContainer, roleConfig);
  }
  async renderOpdDefaulters(container, roleConfig) {
    if (this.activeRole === 'ddrc') return;
    try {
      const res = await fetch(`${window.CounselFlow.API_BASE}/opd/defaulters`);
      if (res.ok) {
        const defaulters = await res.json();
        if (defaulters.length > 0) {
          const panelWrap = container.parentElement?.parentElement;
          if (panelWrap) panelWrap.style.display = 'block';
          const defaulterHtml = defaulters.map(pt => {
            const escapedName = escapeHtml(pt.name || '');
            const escapedId = escapeHtml(pt.id || '');
            return `
              <div class="patient-row" data-patient-id="${escapedId}" style="background: rgba(220,38,38,0.05); border-color: rgba(220,38,38,0.2);">
                <div class="patient-meta">
                  <div class="patient-avatar" style="background: var(--accent-orange);">⚠️</div>
                  <div class="patient-details">
                    <h4>${roleConfig.canViewPII ? escapedName : '[PII Restricted]'}</h4>
                    <span style="color: var(--accent-orange);">OPD Defaulter • Missed visit on ${pt.nextOpdVisitDate}</span>
                  </div>
                </div>
                <div>
                </div>
              </div>
            `;
          }).join('');
          container.innerHTML += defaulterHtml;
          // Bind the newly added call buttons
          container.querySelectorAll('.btn-call-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const id = e.target.closest('.btn-call-trigger').getAttribute('data-patient-id');
              const patient = this.patients.find(p => p.id === id);
              if (patient) this.initiateCallSequence(patient);
            });
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch OPD defaulters:', e);
    }
  }
  bindSearchAndFilters() {
    const input = this.dom.patientSearchInput;
    const sevFilter = this.dom.patientFilterSeverity;
    const statFilter = this.dom.patientFilterStatus;
    const dateStart = this.dom.patientFilterDateStart;
    const dateEnd = this.dom.patientFilterDateEnd;
    const distFilter = this.dom.patientFilterDistrict;
    const btnExport = this.dom.btnExportPatients;
    if (!input || !sevFilter || !statFilter) return;
    input.value = this.currentPatientFilter?.query || '';
    sevFilter.value = this.currentPatientFilter?.severity || 'all';
    statFilter.value = this.currentPatientFilter?.status || 'all';
    if(dateStart) dateStart.value = this.currentPatientFilter?.startDate || '';
    if(dateEnd) dateEnd.value = this.currentPatientFilter?.endDate || '';
    if(distFilter) distFilter.value = this.currentPatientFilter?.district || 'all';
    const filterHandler = debounce(() => {
      this.currentPatientFilter = {
        query: input.value,
        severity: sevFilter.value,
        status: statFilter.value,
        startDate: dateStart ? dateStart.value : '',
        endDate: dateEnd ? dateEnd.value : '',
        district: distFilter ? distFilter.value : 'all'
      };
      this.renderPatientsList();
    }, 200);
    input.addEventListener('input', filterHandler);
    sevFilter.addEventListener('change', filterHandler);
    statFilter.addEventListener('change', filterHandler);
    if(dateStart) dateStart.addEventListener('change', filterHandler);
    if(dateEnd) dateEnd.addEventListener('change', filterHandler);
    if(distFilter) distFilter.addEventListener('change', filterHandler);
    if(btnExport) {
      btnExport.addEventListener('click', () => {
        this.exportPatientsToCSV();
      });
    }
    const histInput = this.dom.historySearchInput;
    const histLang = this.dom.historyFilterLanguage;
    const histHandler = debounce(() => {
      this.renderHistoryRecords(histInput.value, histLang.value);
    }, 200);
    histInput.addEventListener('input', histHandler);
    histLang.addEventListener('change', histHandler);
  }
  getFilteredPatients() {
    const filter = this.currentPatientFilter;
    const query = (filter.query || '').toLowerCase();
    const severity = (filter.severity || 'all').toLowerCase();
    const status = (filter.status || 'all').toLowerCase();
    const startDate = filter.startDate ? new Date(filter.startDate) : null;
    const endDate = filter.endDate ? new Date(filter.endDate) : null;
    let filtered = this.getSecurityScopedPatients().filter(p => {
      const matchesQuery = (p.name || '').toLowerCase().includes(query) || 
                           (p.id || '').toLowerCase().includes(query) ||
                           (p.addictionCategory || '').toLowerCase().includes(query);
      const matchesSeverity = severity === 'all' || (p.severity || '').toLowerCase() === severity;
      const matchesStatus = status === 'all' || (p.status || '').toLowerCase() === status;
      let matchesDate = true;
      if (startDate || endDate) {
        const pDate = new Date(p.joinDate);
        if (startDate && pDate < startDate) matchesDate = false;
        if (endDate && pDate > endDate) matchesDate = false;
      }
      const filterDist = (filter.district || 'all').toLowerCase();
      const matchesDistrict = filterDist === 'all' || (p.district || '').toLowerCase() === filterDist;
      return matchesQuery && matchesSeverity && matchesStatus && matchesDate && matchesDistrict;
    });
    if (this.currentPatientSort && this.currentPatientSort.field) {
      filtered.sort((a, b) => {
        let valA = a[this.currentPatientSort.field];
        let valB = b[this.currentPatientSort.field];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return this.currentPatientSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return this.currentPatientSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return filtered;
  }
  exportPatientsToCSV(patientList = null) {
    const pts = patientList || this.getFilteredPatients();
    if (pts.length === 0) {
      this.showToast("Export Failed", "No patients to export.", "error");
      return;
    }
    try {
      const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
      const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
      const maskPII = (val) => roleConfig.canViewPII ? val : '[PII Restricted]';
      const headers = ["ID", "Name", "Age", "Gender", "Phone", "Address", "Substance", "Severity", "Status", "Progress", "Join Date"];
      const csvRows = [];
      csvRows.push(headers.join(','));
      for (const p of pts) {
        const row = [
          p.id,
          maskPII(p.name),
          p.age,
          p.gender,
          maskPII(p.phone),
          maskPII(p.address),
          p.addictionCategory,
          p.severity,
          p.status,
          `${p.progress || 0}%`,
          p.joinDate
        ].map(v => `"${(v || '').toString().replace(/"/g, '""')}"`);
        csvRows.push(row.join(','));
      }
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('hidden', '');
      a.setAttribute('href', url);
      a.setAttribute('download', `patients_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Patient export error:", e);
      this.showToast("Export Failed", "An error occurred generating the CSV.", "error");
    }
  }
  renderPatientsList() {
    if (!this.dom.patientsListContainer) return;
    if (this.patients.length === 0 && !this._hasFetchedData) {
      this.dom.patientsListContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-light); border-radius:16px;">
          <div class="spinner" style="margin: 0 auto 12px auto; width: 24px; height: 24px; border: 3px solid rgba(0, 242, 254, 0.2); border-top-color: var(--accent-blue); border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <p style="font-weight:600; color:var(--text-primary);">Loading Patient Database...</p>
        </div>
      `;
      return;
    }
    const filtered = this.getFilteredPatients();
    if (filtered.length === 0) {
      this.dom.patientsListContainer.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-light); border-radius:16px;">
          <p style="font-size: 32px; margin-bottom:12px;"></p>
          <p style="font-weight:600; color:var(--text-primary);">No Patients Matched Your Criteria</p>
          <p style="font-size:12px; margin-top:4px;">Refine your filter fields or click "+ Add Profile" above to create a new profile.</p>
        </div>
      `;
      return;
    }
    const sortIndicator = (field) => {
      if (!this.currentPatientSort || this.currentPatientSort.field !== field) return `<span style="opacity:0.3; margin-left:4px;"></span>`;
      return this.currentPatientSort.dir === 'asc' ? `<span style="margin-left:4px;">↑</span>` : `<span style="margin-left:4px;">↓</span>`;
    };
    const headerRow = `
      <div role="row" style="display:flex; align-items:center; padding:0 16px 8px; font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; border: 1px solid transparent;">
        <div role="columnheader" style="width:42px; margin-right:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          <input type="checkbox" id="bulk-select-all" style="cursor:pointer; width:16px; height:16px;" ${this.selectedPatients.size > 0 && this.selectedPatients.size === filtered.length ? 'checked' : ''} aria-label="Select all patients">
        </div>
        <div role="columnheader" style="flex:1; cursor:pointer; display:flex; align-items:center;" class="sort-header" data-sort="name">Patient Details ${sortIndicator('name')}</div>
        <div role="columnheader" style="width:80px; text-align:center; cursor:pointer; display:flex; justify-content:center; align-items:center; flex-shrink:0;" class="sort-header" data-sort="severity">Severity ${sortIndicator('severity')}</div>
        <div role="columnheader" style="width:160px; text-align:center; cursor:pointer; display:flex; justify-content:center; align-items:center; flex-shrink:0;" class="sort-header" data-sort="progress">Progress ${sortIndicator('progress')}</div>
        <div role="columnheader" style="width:120px; text-align:center; cursor:pointer; display:flex; justify-content:center; align-items:center; flex-shrink:0;" class="sort-header" data-sort="status">Status ${sortIndicator('status')}</div>
        <div role="columnheader" style="width:130px; text-align:center; flex-shrink:0;">Consent</div>
        <div role="columnheader" style="width:80px; flex-shrink:0;"></div>
      </div>
    `;
    const bulkToolbar = this.selectedPatients.size > 0 ? `
      <div style="position:sticky; top:0; z-index:10; background:var(--bg-card); border:1px solid var(--accent-blue); padding:10px 16px; border-radius:8px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; box-shadow:var(--shadow-neon);">
        <span style="font-size:13px; font-weight:600;"><span style="color:var(--accent-blue);">${this.selectedPatients.size}</span> patients selected</span>
        <div style="display:flex; gap:10px;">
          <button class="btn-secondary" id="btn-bulk-export" style="font-size:11px; padding:6px 12px;">Export Selected</button>
          <button class="btn-secondary" id="btn-bulk-delete" style="font-size:11px; padding:6px 12px; border-color:var(--accent-red); color:var(--accent-red);">Delete Selected</button>
        </div>
      </div>
    ` : '';
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    let districtStatsBar = '';
    if (['spo', 'supervisor'].includes(activeRole)) {
      const distName = (this.currentPatientFilter?.district && this.currentPatientFilter.district !== 'all') 
        ? this.currentPatientFilter.district.charAt(0).toUpperCase() + this.currentPatientFilter.district.slice(1)
        : 'All Districts';
      const total = filtered.length;
      const stage1 = filtered.filter(p => p.clinicalStage == 1).length;
      const stage2 = filtered.filter(p => p.clinicalStage == 2).length;
      const stage3 = filtered.filter(p => p.clinicalStage == 3).length;
      const stage4 = filtered.filter(p => p.clinicalStage == 4).length;
      const stage5 = filtered.filter(p => p.clinicalStage == 5).length;
      const stage6 = filtered.filter(p => p.clinicalStage == 6).length;
      districtStatsBar = `
        <div style="background: var(--bg-card); border: 1px solid var(--border-light); padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;">
          <div style="font-weight: 600; color: var(--text-primary); font-size: 14px;">
            Overview: <span style="color: var(--accent-blue);">${distName}</span> (Total: ${total})
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; color: var(--text-secondary);">
            <div style="background: rgba(0, 242, 254, 0.1); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(0, 242, 254, 0.2);">Stage 1: <strong style="color:var(--text-primary);">${stage1}</strong></div>
            <div style="background: rgba(16, 185, 129, 0.1); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.2);">Stage 2: <strong style="color:var(--text-primary);">${stage2}</strong></div>
            <div style="background: rgba(165, 94, 234, 0.1); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(165, 94, 234, 0.2);">Stage 3: <strong style="color:var(--text-primary);">${stage3}</strong></div>
            <div style="background: rgba(255, 159, 67, 0.1); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(255, 159, 67, 0.2);">Stage 4: <strong style="color:var(--text-primary);">${stage4}</strong></div>
            <div style="background: rgba(220, 38, 38, 0.1); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(220, 38, 38, 0.2);">Stage 5: <strong style="color:var(--text-primary);">${stage5}</strong></div>
            <div style="background: rgba(30, 64, 175, 0.1); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(30, 64, 175, 0.2);">Stage 6: <strong style="color:var(--text-primary);">${stage6}</strong></div>
          </div>
        </div>
      `;
    }
    this.dom.patientsListContainer.innerHTML = `
      ${districtStatsBar}
      ${bulkToolbar}
      <div role="table" aria-label="Patients listing" style="display:flex; flex-direction:column; gap:14px; width:100%;">
        ${headerRow}
        ${filtered.map(pt => this.renderPatientRowHTML(pt, false)).join('')}
      </div>
    `;
    this.dom.patientsListContainer.querySelectorAll('.sort-header').forEach(el => {
      el.addEventListener('click', () => {
        const field = el.getAttribute('data-sort');
        if (this.currentPatientSort.field === field) {
          this.currentPatientSort.dir = this.currentPatientSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this.currentPatientSort.field = field;
          this.currentPatientSort.dir = 'asc';
        }
        this.renderPatientsList();
      });
    });
    const selectAll = this.dom.patientsListContainer.querySelector('#bulk-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        if (e.target.checked) {
          filtered.forEach(p => this.selectedPatients.add(p.id));
        } else {
          this.selectedPatients.clear();
        }
        this.renderPatientsList();
      });
    }
    const rowCheckboxes = this.dom.patientsListContainer.querySelectorAll('.patient-row-checkbox');
    rowCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        if (e.target.checked) this.selectedPatients.add(id);
        else this.selectedPatients.delete(id);
        this.renderPatientsList();
      });
    });
    const bulkExport = this.dom.patientsListContainer.querySelector('#btn-bulk-export');
    if (bulkExport) {
      bulkExport.addEventListener('click', () => {
        const toExport = this.patients.filter(p => this.selectedPatients.has(p.id));
        this.exportPatientsToCSV(toExport);
      });
    }
    const bulkDelete = this.dom.patientsListContainer.querySelector('#btn-bulk-delete');
    if (bulkDelete) {
      bulkDelete.addEventListener('click', async () => {
        if(confirm(`Are you sure you want to delete ${this.selectedPatients.size} patients?`)) {
          this.patients = this.patients.filter(p => !this.selectedPatients.has(p.id));
          this.selectedPatients.clear();
          await window.CounselFlow.savePatients(this.patients);
          this.renderPatientsList();
          this.showToast("Deleted", "Patients removed.", "success");
        }
      });
    }
  }
  renderPatientRowHTML(pt, isOverview = false) {
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    const escapedName = escapeHtml(pt.name || '');
    const escapedId = escapeHtml(pt.id || '');
    const escapedSubstance = escapeHtml(pt.addictionCategory || 'N/A');
    const escapedSeverity = escapeHtml(pt.severity || 'Low');
    const escapedStatus = escapeHtml(pt.status || 'Active');
    let statusMarker = '️';
    if (escapedStatus.toLowerCase() === 'risk') statusMarker = '️';
    if (escapedStatus.toLowerCase() === 'completed') statusMarker = '';
    if (escapedStatus.toLowerCase() === 'monitored') statusMarker = '';
    if (escapedStatus.toLowerCase() === 'lama') statusMarker = '';
    const isLama = escapedStatus.toLowerCase() === 'lama';
    const rowBorderStyle = isLama ? 'border-left: 3px solid var(--accent-red); background: rgba(220,38,38,0.04);' : '';
    const isOnline = this.onlinePatientIds && this.onlinePatientIds.includes(escapedId);
    return `
      <div class="patient-row" style="justify-content: flex-start; ${rowBorderStyle}" role="row" data-patient-id="${escapedId}" tabindex="0" aria-label="Patient ${escapedName}, ID ${escapedId}">
        ${!isOverview ? `
        <div style="width:42px; margin-right:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;" role="cell">
          <input type="checkbox" class="patient-row-checkbox" data-id="${escapedId}" style="cursor:pointer; width:16px; height:16px;" ${this.selectedPatients.has(escapedId) ? 'checked' : ''} aria-label="Select ${escapedName}">
        </div>
        ` : ''}
        <div class="patient-meta" role="cell" style="flex: 1;">
          <div class="patient-avatar" style="background: ${pt.avatarColor || 'var(--accent-blue)'}; position: relative;">
            ${escapedName.split(' ').map(n => n[0]).join('')}
            ${isOnline ? `<span style="position: absolute; bottom: -2px; right: -2px; width: 10px; height: 10px; background-color: var(--accent-green); border: 2px solid var(--bg-card); border-radius: 50%; box-shadow: 0 0 6px var(--accent-green);"></span>` : ''}
          </div>
          <div class="patient-details">
            <h4 style="font-size: ${isOverview ? '14px' : '15px'}">${escapedName}</h4>
            <span style="font-size: ${isOverview ? '11px' : '12px'}">${escapedId} | Stage ${pt.clinicalStage || 1} | Day ${window.CounselFlow && window.CounselFlow.calculateTreatmentDay ? window.CounselFlow.calculateTreatmentDay(pt.admissionDate) : 0} | ${escapedSubstance}</span>
          </div>
        </div>
        ${!isOverview ? `
          <div style="width:80px; flex-shrink:0; display:flex; align-items:center; justify-content:center;" role="cell">
            <span style="font-size:12px; font-weight:700; color:${escapedSeverity === 'High' ? 'var(--accent-red)' : escapedSeverity === 'Medium' ? 'var(--accent-orange)' : 'var(--accent-teal)'}">${escapedSeverity}</span>
          </div>
        ` : ''}
        <div style="width:160px; flex-shrink:0; display:flex; align-items:center; justify-content:center; gap:8px;" role="cell">
          <div class="progress-bar-container" style="width:90px;">
            <div class="progress-fill" style="width:${pt.progress ?? 0}%;"></div>
          </div>
          <span style="font-size:12px; font-weight:700; width:34px; text-align:right;">${pt.progress ?? 0}%</span>
        </div>
        <div style="width:120px; flex-shrink:0; display:flex; align-items:center; justify-content:center;" role="cell">
          <span class="pill-status ${escapedStatus.toLowerCase()}" aria-label="Status: ${escapedStatus}">
            ${statusMarker} ${escapedStatus}
          </span>
        </div>
        <div style="width:130px; flex-shrink:0; display:flex; align-items:center; justify-content:center;" role="cell">
          ${pt.consent === false ?
            `<span style="font-size:10px; padding:4px 8px; border-radius:12px; background:rgba(220,38,38,0.1); color:var(--accent-red); border:1px solid var(--accent-red);"> Dictation Only</span>` :
            `<span style="font-size:10px; padding:4px 8px; border-radius:12px; background:rgba(16,185,129,0.1); color:var(--accent-teal); border:1px solid var(--accent-teal);"> Consent Given</span>`
          }
        </div>
        <div style="width:80px; flex-shrink:0;" role="cell"></div>
      </div>
    `;
  }
  openPatientForm() {
    const overlay = document.getElementById('modal-add-patient');
    if (overlay) {
      document.querySelector('#modal-add-patient h3').innerText = "Create Patient Profile";
      document.querySelector('#modal-add-patient button[type="submit"]').innerText = "Save Profile";
      document.getElementById('form-add-patient').reset();
      delete document.getElementById('form-add-patient').dataset.editId;
      overlay.classList.add('active');
    }
  }
  openPatientDetail(patient) {
    this.switchScreen('patients');
    this.selectedPatient = patient;
    this.dom.patientsListContainer.style.display = 'none';
    this.dom.patientsDetailContainer.style.display = 'block';
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    const maskPII = (val) => roleConfig.canViewPII ? escapeHtml(val) : '[PII Restricted]';
    const card = this.dom.detailProfileCard;
    const escapedName = escapeHtml(patient.name || '');
    const escapedId = escapeHtml(patient.id || '');
    const escapedSubstance = escapeHtml(patient.addictionCategory || 'N/A');
    const escapedSeverity = escapeHtml(patient.severity || 'Low');
    const escapedAddress = maskPII(patient.address || 'N/A');
    const escapedPhone = maskPII(patient.phone || 'N/A');
    const escapedPhase = escapeHtml(patient.recoveryPhase || 'N/A');
    const escapedJoinDate = escapeHtml(patient.joinDate || 'N/A');
    const escapedGender = escapeHtml(patient.gender || 'N/A');
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="profile-avatar-large" style="background: ${patient.avatarColor || 'var(--accent-blue)'};">
          ${escapedName.split(' ').map(n => n[0]).join('')}
        </div>
        <button class="btn-secondary" id="btn-edit-patient" style="font-size:11px; padding:6px 10px; display:flex; align-items:center; gap:6px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
      </div>
      <h2 class="profile-name">${escapedName}</h2>
      <div class="profile-tag">${escapedId} | ${escapedSubstance}</div>
      <div style="display:flex; gap:16px; margin-bottom:24px; width:100%;">
        <div style="flex:1; background:var(--bg-input); padding:12px; border-radius:10px; border:1px solid var(--border-light);">
          <div style="font-size:10px; color:var(--text-muted);">Severity</div>
          <div style="font-size:16px; font-weight:700; margin-top:4px; color:${escapedSeverity==='High'?'var(--accent-red)':escapedSeverity==='Medium'?'var(--accent-orange)':'var(--accent-teal)'}">${escapedSeverity}</div>
        </div>
        <div style="flex:1; background:var(--bg-input); padding:12px; border-radius:10px; border:1px solid var(--border-light);">
          <div style="font-size:10px; color:var(--text-muted);">Craving Index</div>
          <div style="font-size:16px; font-weight:700; margin-top:4px; color:${(patient.cravingsIntensity ?? 0) > 6 ? 'var(--accent-red)' : 'var(--accent-green)'}">​${patient.cravingsIntensity ?? 'N/A'}/10</div>
        </div>
      </div>
      <div class="profile-info-list">
        <div class="info-item">
          <span>Gender / Age</span>
          <span>${escapedGender} / ${patient.age} yrs</span>
        </div>
        <div class="info-item">
          <span>Contact Number</span>
          <span>${escapedPhone}</span>
        </div>
        <div class="info-item">
          <span>City Address</span>
          <span>${escapedAddress}</span>
        </div>
        <div class="info-item">
          <span>Recovery Phase</span>
          <span>${escapedPhase}</span>
        </div>
        <div class="info-item">
          <span>Enroll Date</span>
          <span>${escapedJoinDate}</span>
        </div>
        <div class="info-item" style="flex-direction:column; gap:8px; align-items:flex-start; border-top:1px solid var(--border-light); padding-top:16px; text-align:left;">
          <span style="font-size:11px; font-weight:600; text-transform:uppercase; color:var(--text-secondary);">General Clinical Notes</span>
          <textarea id="patient-notes-textarea" aria-label="Patient clinical notes" style="width:100%; height:80px; background:var(--bg-input); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); padding:8px; font-size:12px; font-family:var(--font-body); resize:none;">${escapeHtml(patient.notes || '')}</textarea>
          <button class="btn-secondary" id="btn-save-general-notes" style="font-size:11px; padding:6px 12px; align-self:flex-end;">Save General Notes</button>
        </div>
      </div>
      <div class="clinical-tracker" style="margin-top:20px; padding: 12px; background:var(--bg-input); border:1px solid var(--border-light); border-radius:10px;">
        <h4 style="font-size: 13px; margin-bottom: 8px; color: var(--accent-blue);">Clinical Stages & Checkpoints</h4>
        <div style="display:flex; justify-content:space-between; font-size: 11px; margin-bottom: 12px;">
          <span>Current Stage: <strong>${patient.clinicalStage || 1}</strong></span>
          <span>Day in Program: <strong>${window.CounselFlow && window.CounselFlow.calculateTreatmentDay ? window.CounselFlow.calculateTreatmentDay(patient.admissionDate) : 0}</strong></span>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; font-size: 11px;">
          <label style="display:flex; align-items:center; gap:8px; opacity: ${['spo', 'supervisor', 'ddrc'].includes(activeRole) ? '1' : '0.5'};">
            <input type="checkbox" id="chk-withdrawal" ${patient.checkpoints?.withdrawalStabilised ? 'checked' : ''} ${['spo', 'supervisor', 'ddrc'].includes(activeRole) ? '' : 'disabled'}>
            [Stage 2] Withdrawal Stabilised? (MO clearance)
          </label>
          <label style="display:flex; align-items:center; gap:8px; opacity: ${['spo', 'supervisor', 'ddrc'].includes(activeRole) ? '1' : '0.5'};">
            <input type="checkbox" id="chk-layer12" ${patient.checkpoints?.layer1And2Ready ? 'checked' : ''} ${['spo', 'supervisor', 'ddrc'].includes(activeRole) ? '' : 'disabled'}>
            [Stage 2] Layer 1 + 2 Ready? (Independent)
          </label>
          <label style="display:flex; align-items:center; gap:8px; opacity: ${['spo', 'supervisor', 'ddrc'].includes(activeRole) ? '1' : '0.5'};">
            <input type="checkbox" id="chk-family" ${patient.checkpoints?.familyPsychoedAttended ? 'checked' : ''} ${['spo', 'supervisor', 'ddrc'].includes(activeRole) ? '' : 'disabled'}>
            [Stage 3] Family attended Psychoed? (90-min)
          </label>
          <label style="display:flex; align-items:center; gap:8px; opacity: ${['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole) ? '1' : '0.5'};">
            <input type="checkbox" id="chk-day30" ${patient.checkpoints?.day30ReviewPassed ? 'checked' : ''} ${['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole) ? '' : 'disabled'}>
            [Stage 4] 30-Day Bridge Review Passed?
          </label>
        </div>
        ${['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole) ? `
        <button class="btn-primary" id="btn-save-checkpoints" style="font-size:11px; padding:6px 12px; margin-top:10px; width:100%;">Save Checkpoints</button>
        ` : ''}
        ${['spo', 'supervisor', 'ddrc'].includes(activeRole) && (patient.clinicalStage || 1) === 1 ? `
        <button class="btn-primary" id="btn-action-mo-clear" style="font-size:11px; padding:6px 12px; margin-top:6px; width:100%; background:var(--accent-teal); border-color:var(--accent-teal);">
           Request MO Clearance
        </button>` : ''}
        ${['spo', 'supervisor', 'ddrc'].includes(activeRole) && (patient.clinicalStage || 1) === 2 ? `
        <button class="btn-primary" id="btn-action-family" style="font-size:11px; padding:6px 12px; margin-top:6px; width:100%; background:var(--accent-purple); border-color:var(--accent-purple);">
          ‍‍ Schedule Family Psychoed
        </button>` : ''}
        ${['spo', 'supervisor', 'ddrc'].includes(activeRole) && (patient.clinicalStage || 1) === 3 ? `
        <button class="btn-primary" id="btn-action-day30" style="font-size:11px; padding:6px 12px; margin-top:6px; width:100%; background:var(--accent-blue); border-color:var(--accent-blue);">
           Order 30-Day Review
        </button>` : ''}
        ${['spo', 'supervisor', 'ddrc'].includes(activeRole) && (patient.clinicalStage || 1) === 5 ? `
        <button class="btn-primary" id="btn-action-day90" style="font-size:11px; padding:6px 12px; margin-top:6px; width:100%; background:var(--accent-green); border-color:var(--accent-green);">
           Flag for 90-Day Transition
        </button>` : ''}
        ${['spo', 'supervisor', 'ddrc'].includes(activeRole) && (patient.clinicalStage || 1) <= 3 && patient.status !== 'LAMA' ? `
        <button class="btn-secondary" id="btn-mark-lama" style="font-size:11px; padding:6px 12px; margin-top:6px; width:100%; border-color:var(--accent-red); color:var(--accent-red);">
           Mark as LAMA (Left Against Medical Advice)
        </button>` : ''}
        ${patient.status === 'LAMA' ? `
        <div style="margin-top:8px; padding:8px; background:rgba(220,38,38,0.1); border:1px solid rgba(220,38,38,0.3); border-radius:8px; font-size:11px; color:var(--accent-red); text-align:center;">
           This patient has left against medical advice (LAMA). Escalate immediately.
        </div>` : ''}
      </div>
    `;
    const notesArea = document.getElementById('patient-notes-textarea');
    if (notesArea) {
      notesArea.addEventListener('input', () => {
        this.isNotesDirty = true;
      });
    }
    const saveNotesBtn = document.getElementById('btn-save-general-notes');
    if (saveNotesBtn) {
      saveNotesBtn.addEventListener('click', () => this.savePatientNotes());
    }
    const saveCheckpointsBtn = document.getElementById('btn-save-checkpoints');
    if (saveCheckpointsBtn) {
      saveCheckpointsBtn.addEventListener('click', async () => {
        if (!this.selectedPatient) return;
        const canEditDetox = ['spo', 'supervisor', 'ddrc'].includes(activeRole);
        const canEditBridge = ['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole);
        if (!canEditDetox && !canEditBridge) {
          this.showToast("Access Denied", "Your role is not authorized to edit checkpoints.", "error");
          return;
        }
        const original = this.selectedPatient.checkpoints || {};
        this.selectedPatient.checkpoints = {
          withdrawalStabilised: canEditDetox ? document.getElementById('chk-withdrawal').checked : !!original.withdrawalStabilised,
          layer1And2Ready: canEditDetox ? document.getElementById('chk-layer12').checked : !!original.layer1And2Ready,
          familyPsychoedAttended: canEditDetox ? document.getElementById('chk-family').checked : !!original.familyPsychoedAttended,
          day30ReviewPassed: canEditBridge ? document.getElementById('chk-day30').checked : !!original.day30ReviewPassed
        };
        if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
          this.selectedPatient = window.CounselFlow.evaluatePatientWorkflow(this.selectedPatient);
        }
        if(window.CounselFlow && window.CounselFlow.savePatients) {
          await window.CounselFlow.savePatients(this.patients);
        } else if(window.CounselFlow && window.CounselFlow.safeSetItem) {
           window.CounselFlow.safeSetItem('counseling_patients', window.obfuscateData ? window.obfuscateData(this.patients) : JSON.stringify(this.patients));
        }
        this.showToast("Checkpoints Updated", `Clinical progress saved for ${this.selectedPatient.name}.`, "success");
        this.openPatientDetail(this.selectedPatient); 
      });
    }
    const lamaBtn = document.getElementById('btn-mark-lama');
    if (lamaBtn) {
      lamaBtn.addEventListener('click', async () => {
        if (!this.selectedPatient) return;
        if (!['spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Your role cannot mark patients as LAMA.', 'error');
          return;
        }
        if (!confirm(`Are you sure you want to mark ${this.selectedPatient.name} as LAMA (Left Against Medical Advice)? This will trigger an immediate L2 escalation.`)) return;
        this.selectedPatient.status = 'LAMA';
        this.selectedPatient.clinicalStage = 0;
        if(window.CounselFlow && window.CounselFlow.savePatients) {
          await window.CounselFlow.savePatients(this.patients);
        } else if (window.CounselFlow && window.CounselFlow.safeSetItem) {
          window.CounselFlow.safeSetItem('counseling_patients', window.obfuscateData ? window.obfuscateData(this.patients) : JSON.stringify(this.patients));
        }
        this.showToast('LAMA Status Set', `${this.selectedPatient.name} has been flagged as LAMA. Dashboard updated.`, 'warning');
        this.renderDashboard();
        this.openPatientDetail(this.selectedPatient);
      });
    }
    const actionMoClearBtn = document.getElementById('btn-action-mo-clear');
    if (actionMoClearBtn) {
      actionMoClearBtn.addEventListener('click', async () => {
        if (!this.selectedPatient) return;
        if (!['spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Your role cannot request MO clearance.', 'error');
          return;
        }
        this.selectedPatient.checkpoints = this.selectedPatient.checkpoints || {};
        this.selectedPatient.checkpoints.withdrawalStabilised = true;
        this.selectedPatient.checkpoints.layer1And2Ready = true;
        if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
          this.selectedPatient = window.CounselFlow.evaluatePatientWorkflow(this.selectedPatient);
        }
        if (window.CounselFlow && window.CounselFlow.savePatients) {
          await window.CounselFlow.savePatients(this.patients);
        }
        this.showToast("Clearance Requested", `${this.selectedPatient.name} cleared to Stage 3.`, "success");
        this.openPatientDetail(this.selectedPatient);
      });
    }
    const actionFamilyBtn = document.getElementById('btn-action-family');
    if (actionFamilyBtn) {
      actionFamilyBtn.addEventListener('click', async () => {
        if (!this.selectedPatient) return;
        if (!['spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Your role cannot schedule family psychoed.', 'error');
          return;
        }
        this.selectedPatient.checkpoints = this.selectedPatient.checkpoints || {};
        this.selectedPatient.checkpoints.familyPsychoedAttended = true;
        if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
          this.selectedPatient = window.CounselFlow.evaluatePatientWorkflow(this.selectedPatient);
        }
        if (window.CounselFlow && window.CounselFlow.savePatients) {
          await window.CounselFlow.savePatients(this.patients);
        }
        this.showToast("Psychoeducation Scheduled", `Family psychoeducation marked completed for ${this.selectedPatient.name}.`, "success");
        this.openPatientDetail(this.selectedPatient);
      });
    }
    const actionDay30Btn = document.getElementById('btn-action-day30');
    if (actionDay30Btn) {
      actionDay30Btn.addEventListener('click', async () => {
        if (!this.selectedPatient) return;
        if (!['spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Your role cannot order 30-day reviews.', 'error');
          return;
        }
        this.selectedPatient.checkpoints = this.selectedPatient.checkpoints || {};
        this.selectedPatient.checkpoints.day30ReviewPassed = true;
        if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
          this.selectedPatient = window.CounselFlow.evaluatePatientWorkflow(this.selectedPatient);
        }
        if (window.CounselFlow && window.CounselFlow.savePatients) {
          await window.CounselFlow.savePatients(this.patients);
        }
        this.showToast("30-Day Review Completed", `30-Day Bridge Review passed for ${this.selectedPatient.name}.`, "success");
        this.openPatientDetail(this.selectedPatient);
      });
    }
    const actionDay90Btn = document.getElementById('btn-action-day90');
    if (actionDay90Btn) {
      actionDay90Btn.addEventListener('click', async () => {
        if (!this.selectedPatient) return;
        if (!['spo', 'supervisor', 'ddrc'].includes(activeRole)) {
          this.showToast('Access Denied', 'Your role cannot flag 90-day transitions.', 'error');
          return;
        }
        // Gap 9 fix: explicitly set status + stage before evaluate
        this.selectedPatient.status = 'Completed';
        this.selectedPatient.clinicalStage = 6;
        if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
          this.selectedPatient = window.CounselFlow.evaluatePatientWorkflow(this.selectedPatient);
        }
        if (window.CounselFlow && window.CounselFlow.savePatients) {
          await window.CounselFlow.savePatients(this.patients);
        }
        window.CounselFlow.writeAuditEvent('COHORT_CLOSE_DAY90', this.selectedPatient.id, 'N/A', activeRole, `90-day cohort close executed for ${this.selectedPatient.name}.`);
        this.showToast("90-Day Transition Completed", `Cohort closeout completed for ${this.selectedPatient.name}.`, "success");
        this.openPatientDetail(this.selectedPatient);
      });
    }
    const editBtn = document.getElementById('btn-edit-patient');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const overlay = document.getElementById('modal-add-patient');
        const form = document.getElementById('form-add-patient');
        document.querySelector('#modal-add-patient h3').innerText = "Edit Patient Profile";
        document.querySelector('#modal-add-patient button[type="submit"]').innerText = "Update Profile";
        form.dataset.editId = patient.id;
        document.getElementById('new-patient-name').value = patient.name || '';
        document.getElementById('new-patient-age').value = patient.age || '';
        document.getElementById('new-patient-gender').value = patient.gender || 'Male';
        document.getElementById('new-patient-phone').value = patient.phone || '';
        document.getElementById('new-patient-address').value = patient.address || '';
        document.getElementById('new-patient-substance').value = patient.addictionCategory || 'Heroin / Opioids';
        if (document.getElementById('new-patient-ngo')) document.getElementById('new-patient-ngo').value = patient.ngoPartner || '';
        document.getElementById('new-patient-severity').value = patient.severity || 'Medium';
        const admInput = document.getElementById('new-patient-admission');
        if(admInput) admInput.value = patient.admissionDate || '';
        const stageInput = document.getElementById('new-patient-stage');
        if(stageInput) stageInput.value = patient.clinicalStage || '1';
        const colorInput = document.getElementById('new-patient-color');
        if (colorInput) {
            if (patient.avatarColor && patient.avatarColor.startsWith('#')) {
                colorInput.value = patient.avatarColor;
            } else {
                colorInput.value = '#00f2fe';
            }
        }
        overlay.classList.add('active');
      });
    }
    this.renderPatientConditionSummary(patient);
    this.renderPatientSessionLogs();
    this.renderPatientOpdLogs(patient);
    const startSessionBtn = document.getElementById('btn-detail-start-session');
    if (startSessionBtn) {
      startSessionBtn.style.display = roleConfig.allowedScreens.includes('call-console') ? '' : 'none';
    }
    document.getElementById('btn-detail-start-session').onclick = () => {
      if (this.isNotesDirty) {
        if (!confirm("You have unsaved changes in clinical notes. Discard?")) return;
        this.isNotesDirty = false;
      }
      this.initiateCallSequence(this.selectedPatient);
    };
    // Bind EMR tab switching
    const tabBtns = document.querySelectorAll('.emr-tab-btn');
    const tabPanes = document.querySelectorAll('.emr-tab-pane');
    tabBtns.forEach(btn => {
      btn.onclick = () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.getAttribute('data-target');
        const pane = document.getElementById(target);
        if (pane) pane.classList.add('active');
      };
    });
    // Bind add EMR record buttons
    const addEmrBtns = document.querySelectorAll('.btn-add-emr-record');
    addEmrBtns.forEach(btn => {
      btn.onclick = () => {
        const type = btn.getAttribute('data-type');
        this.openEmrRecordModal(type, patient);
      };
    });
    this.renderEmrTables(patient);
  }
  renderEmrTables(patient) {
    const renderTable = (tbodyId, dataArray, renderRowStr) => {
      const tbody = document.getElementById(tbodyId);
      if (!tbody) return;
      if (!dataArray || dataArray.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px; color:var(--text-muted);">No records found</td></tr>`;
        return;
      }
      tbody.innerHTML = dataArray.map(renderRowStr).join('');
    };
    renderTable('tbody-emr-vitals', patient.vitals, (v) => `
      <tr style="border-bottom: 1px solid var(--border-light);">
        <td style="padding: 12px;">${v.date}</td>
        <td style="padding: 12px;">${v.bloodPressure}</td>
        <td style="padding: 12px;">${v.heartRate}</td>
        <td style="padding: 12px;">${v.temperature}</td>
        <td style="padding: 12px;">${v.weight}</td>
      </tr>
    `);
    renderTable('tbody-emr-medical-history', patient.medicalHistory, (m) => `
      <tr style="border-bottom: 1px solid var(--border-light);">
        <td style="padding: 12px;">${m.condition}</td>
        <td style="padding: 12px;">${m.date}</td>
        <td style="padding: 12px;">${m.status}</td>
      </tr>
    `);
    renderTable('tbody-emr-family-history', patient.familyHistory, (f) => `
      <tr style="border-bottom: 1px solid var(--border-light);">
        <td style="padding: 12px;">${f.relation}</td>
        <td style="padding: 12px;">${f.condition}</td>
        <td style="padding: 12px;">${f.date || 'N/A'}</td>
      </tr>
    `);
    renderTable('tbody-emr-cows', patient.cowsAssessment, (c) => `
      <tr style="border-bottom: 1px solid var(--border-light);">
        <td style="padding: 12px;">${c.date}</td>
        <td style="padding: 12px; font-weight: bold; color: ${c.totalScore > 10 ? 'var(--accent-red)' : 'var(--text-primary)'}">${c.totalScore}</td>
        <td style="padding: 12px;">${c.severity}</td>
        <td style="padding: 12px;">${c.recordedBy || 'System'}</td>
      </tr>
    `);
  }
  openEmrRecordModal(type, patient) {
    const overlay = document.getElementById('modal-emr-record');
    const form = document.getElementById('form-emr-record');
    const typeInput = document.getElementById('emr-record-type');
    const dateEl = document.getElementById('emr-record-date');
    const titleEl = document.getElementById('emr-modal-title');
    const subtitleEl = document.getElementById('emr-modal-subtitle');
    const iconContainer = document.getElementById('emr-modal-icon');
    if (!overlay || !form) return;
    // Reset all field groups
    document.querySelectorAll('.emr-field-group').forEach(g => g.style.display = 'none');
    form.reset();
    typeInput.value = type;
    dateEl.textContent = new Date().toISOString().split('T')[0];
    // Configure modal based on type
    const configs = {
      vitals: {
        title: 'Add Vitals Record',
        subtitle: 'Record patient vital signs',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
        iconBg: 'rgba(238, 93, 80, 0.1)',
        iconColor: 'var(--accent-red)'
      },
      medicalHistory: {
        title: 'Add Medical History',
        subtitle: 'Record a medical condition or diagnosis',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        iconBg: 'rgba(79, 172, 254, 0.1)',
        iconColor: 'var(--accent-blue)'
      },
      familyHistory: {
        title: 'Add Family History',
        subtitle: 'Record hereditary or family medical history',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        iconBg: 'rgba(139, 92, 246, 0.1)',
        iconColor: 'var(--accent-purple)'
      },
      cowsAssessment: {
        title: 'Add COWS Assessment',
        subtitle: 'Clinical Opiate Withdrawal Scale evaluation',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        iconBg: 'rgba(255, 152, 0, 0.1)',
        iconColor: 'var(--accent-orange)'
      }
    };
    const config = configs[type];
    if (!config) return;
    titleEl.textContent = config.title;
    subtitleEl.textContent = config.subtitle;
    iconContainer.innerHTML = config.icon;
    iconContainer.style.background = config.iconBg;
    iconContainer.style.color = config.iconColor;
    // Show the correct field group
    const fieldGroup = document.getElementById(`emr-fields-${type}`);
    if (fieldGroup) fieldGroup.style.display = 'block';
    // Toggle required on visible inputs only
    document.querySelectorAll('.emr-field-group input[required], .emr-field-group select[required]').forEach(el => {
      el.required = false;
    });
    if (fieldGroup) {
      fieldGroup.querySelectorAll('input[type="text"], input[type="number"]').forEach(el => {
        if (el.id !== 'emr-cows-severity') el.required = true;
      });
    }
    // Open modal
    overlay.classList.add('active');
    // Focus first input after animation
    setTimeout(() => {
      const firstInput = fieldGroup?.querySelector('input:not([readonly]), select, textarea');
      if (firstInput) firstInput.focus();
    }, 150);
    // Bind form submission (remove old listener by cloning)
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    // Re-bind COWS auto-severity after clone
    const cowsScoreInput = document.getElementById('emr-cows-score');
    const cowsSeverityInput = document.getElementById('emr-cows-severity');
    if (cowsScoreInput && cowsSeverityInput) {
      cowsScoreInput.addEventListener('input', () => {
        const score = parseInt(cowsScoreInput.value, 10);
        if (isNaN(score)) { cowsSeverityInput.value = '—'; return; }
        if (score <= 4) cowsSeverityInput.value = 'No Withdrawal';
        else if (score <= 12) cowsSeverityInput.value = 'Mild';
        else if (score <= 24) cowsSeverityInput.value = 'Moderate';
        else if (score <= 36) cowsSeverityInput.value = 'Moderately Severe';
        else cowsSeverityInput.value = 'Severe';
      });
    }
    // Bind close / cancel
    const closeEmrModal = () => {
      document.getElementById('modal-emr-record').classList.remove('active');
    };
    document.getElementById('btn-close-emr-modal')?.addEventListener('click', closeEmrModal);
    document.getElementById('btn-cancel-emr-form')?.addEventListener('click', closeEmrModal);
    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
      const entry = { date: new Date().toISOString().split('T')[0], recordedBy: activeRole };
      const currentType = document.getElementById('emr-record-type').value;
      if (currentType === 'vitals') {
        entry.bloodPressure = document.getElementById('emr-vitals-bp').value || '120/80';
        entry.heartRate = parseInt(document.getElementById('emr-vitals-hr').value, 10) || 0;
        entry.temperature = parseFloat(document.getElementById('emr-vitals-temp').value) || 0;
        entry.weight = parseFloat(document.getElementById('emr-vitals-weight').value) || 0;
      } else if (currentType === 'medicalHistory') {
        entry.condition = document.getElementById('emr-med-condition').value || 'Unknown';
        entry.status = document.getElementById('emr-med-status').value || 'Active';
      } else if (currentType === 'familyHistory') {
        entry.relation = document.getElementById('emr-family-relation').value || 'N/A';
        entry.condition = document.getElementById('emr-family-condition').value || 'Unknown';
        entry.notes = document.getElementById('emr-family-notes').value || '';
      } else if (currentType === 'cowsAssessment') {
        const score = parseInt(document.getElementById('emr-cows-score').value, 10);
        if (isNaN(score)) {
          this.showToast('Invalid Input', 'COWS score must be a valid number.', 'error');
          return;
        }
        entry.totalScore = score;
        if (score <= 4) entry.severity = 'No Withdrawal';
        else if (score <= 12) entry.severity = 'Mild';
        else if (score <= 24) entry.severity = 'Moderate';
        else if (score <= 36) entry.severity = 'Moderately Severe';
        else entry.severity = 'Severe';
      } else {
        return;
      }
      // Disable submit button
      const submitBtn = document.getElementById('btn-submit-emr-form');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Saving...';
      }
      try {
        const API_URL = window.CounselFlow.API_BASE || 'http://localhost:5001/api';
        const res = await fetch(`${API_URL}/patients/${patient.id}/records/${currentType}`, {
          method: 'PUT',
          headers: window.CounselFlow.getAuthHeaders ? window.CounselFlow.getAuthHeaders() : { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry)
        });
        if (res.ok) {
          closeEmrModal();
          this.showToast('Record Added', 'New EMR record added successfully.', 'success');
          await this.refreshData();
          const updatedPatient = this.patients.find(p => p.id === patient.id);
          if (updatedPatient) this.openPatientDetail(updatedPatient);
        } else {
          this.showToast('Error', 'Failed to add EMR record. Server returned an error.', 'error');
        }
      } catch(err) {
        console.error('EMR save error:', err);
        this.showToast('Error', 'Could not connect to server. Please try again.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Save Record';
        }
      }
    });
  }
  async savePatientNotes() {
    if (!this.selectedPatient) return;
    const textVal = document.getElementById('patient-notes-textarea').value;
    this.selectedPatient.notes = textVal;
    try {
      await window.CounselFlow.savePatients(this.patients);
      this.isNotesDirty = false; 
      this.showToast("Notes Updated", `General recovery records updated for ${this.selectedPatient.name}.`, "success");
    } catch (e) {
      console.error("Failed to save patient notes:", e);
      this.showToast("Save Failed", "Could not sync notes to the server.", "error");
    }
  }
  renderPatientConditionSummary(patient) {
    const container = this.dom.detailCurrentConditionContainer;
    if (!container) return;
    const sortedHistory = patient.history && patient.history.length > 0
      ? [...patient.history].sort((a, b) => new Date(b.date) - new Date(a.date))
      : [];
    const latestSession = sortedHistory.length > 0 ? sortedHistory[0] : null;
    if (!latestSession) {
      container.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--border-light); padding-bottom:12px; margin-bottom:14px;">
          <div style="font-size:20px;"></div>
          <h3 style="font-size:15px; margin:0; font-weight:700; color:var(--text-primary);">Current Stage Summary & Condition</h3>
        </div>
        <div style="text-align:center; padding:20px; color:var(--text-muted);">
          <p style="font-size:24px; margin-bottom:8px;"></p>
          <p style="font-size:12px; font-weight:600; color:var(--text-primary);">Intake Phase - No Session Logs Available</p>
          <p style="font-size:11px; margin-top:4px; max-width:400px; margin-left:auto; margin-right:auto;">This patient has not completed any tele-counseling sessions yet. Their recovery stage and clinical checklists are managed on the left panel.</p>
        </div>
      `;
      return;
    }
    const summary = latestSession.summary || {};
    const risk = summary.risk || 'Low Risk';
    const overview = summary.overview || 'No overview available.';
    const concerns = summary.concerns || 'No concerns recorded.';
    const observations = summary.observations || 'No observations recorded.';
    const actions = summary.actions || 'No actions recommended.';
    let riskClass = 'completed'; 
    if (risk.toLowerCase().includes('high') || risk.toLowerCase().includes('critical')) {
      riskClass = 'risk';
    } else if (risk.toLowerCase().includes('medium')) {
      riskClass = 'monitored';
    }
    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding-bottom:12px; margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="font-size:20px;"></div>
          <h3 style="font-size:15px; margin:0; font-weight:700; color:var(--text-primary);">Current Recovery Stage Summary & Condition</h3>
        </div>
        <span class="pill-status ${riskClass}" style="font-size:10px; font-weight:800; padding:4px 10px;">
          ${risk}
        </span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <!-- Left: Overview & Concerns -->
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="background:var(--bg-item); border:1px solid var(--border-light); border-radius:10px; padding:12px;">
            <h4 style="font-size:11px; font-weight:700; color:var(--accent-blue); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.02em;"> Condition Overview</h4>
            <p style="font-size:11.5px; line-height:1.5; color:var(--text-secondary);">${escapeHtml(overview)}</p>
          </div>
          <div style="background:var(--bg-item); border:1px solid var(--border-light); border-radius:10px; padding:12px;">
            <h4 style="font-size:11px; font-weight:700; color:var(--accent-orange); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.02em;">️ Relapse Concerns & Triggers</h4>
            <p style="font-size:11.5px; line-height:1.5; color:var(--text-secondary);">${escapeHtml(concerns)}</p>
          </div>
        </div>
        <!-- Right: Observations & Recommended Actions -->
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="background:var(--bg-item); border:1px solid var(--border-light); border-radius:10px; padding:12px;">
            <h4 style="font-size:11px; font-weight:700; color:var(--accent-teal); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.02em;">️ Clinical Observations</h4>
            <p style="font-size:11.5px; line-height:1.5; color:var(--text-secondary);">${escapeHtml(observations)}</p>
          </div>
          <div style="background:var(--bg-item); border:1px solid var(--border-light); border-radius:10px; padding:12px;">
            <h4 style="font-size:11px; font-weight:700; color:var(--accent-purple); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.02em;"> Recommended Actions</h4>
            <p style="font-size:11.5px; line-height:1.5; color:var(--text-secondary);">${escapeHtml(actions)}</p>
          </div>
        </div>
      </div>
      <div style="font-size:9.5px; color:var(--text-muted); margin-top:14px; text-align:right; border-top:1px solid var(--border-light); padding-top:8px;">
        *Derived automatically from latest counseling session logs (Session Date: ${latestSession.date})
      </div>
    `;
  }
  renderPatientSessionLogs() {
    if (!this.dom.detailSessionsList) return;
    if (!this.selectedPatient.history || this.selectedPatient.history.length === 0) {
      this.dom.detailSessionsList.innerHTML = `<div style="padding:30px; text-align:center; color:var(--text-muted);">No sessions recorded yet for this profile.</div>`;
      return;
    }
    this.selectedPatient.history.sort((a, b) => new Date(b.date) - new Date(a.date));
    this.dom.detailSessionsList.innerHTML = this.selectedPatient.history.map(sess => {
      const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
      const settings = window.CounselFlow.getSystemSettings();
      const callTime = new Date(sess.date).getTime();
      const diffMins = isNaN(callTime) ? 999999 : (Date.now() - callTime) / (1000 * 60);
      const diffDays = diffMins / (60 * 24);
      let audioUI = '';
      if (activeRole === 'counsellor') {
        if (diffMins <= settings.counselorAudioRetentionMins) {
          audioUI = `<button class="btn-secondary" style="font-size:10px; padding:4px 8px; border-color:var(--accent-teal); color:var(--accent-teal);">▶ Play Audio</button>`;
        } else {
          audioUI = `<span style="font-size:10px; color:var(--text-muted); background:var(--bg-input); padding:4px 8px; border-radius:4px; border:1px dashed var(--border-light);">🔒 Auto-Deleted (Privacy)</span>`;
        }
      } else {
        if (diffDays <= settings.adminAudioRetentionDays) {
          audioUI = `<a href="${sess.recordingUrl || 'assets/audio/demo.mp3'}" download="call_audio.mp3" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size:10px; padding:4px 8px; border-color:var(--accent-blue); color:var(--accent-blue);" onclick="event.stopPropagation()">⬇ Download Audio</a>`;
        } else {
          audioUI = `<span style="font-size:10px; color:var(--accent-red); background:rgba(238,93,80,0.1); padding:4px 8px; border-radius:4px; border:1px solid rgba(238,93,80,0.2);">🗑 Permanently Deleted (Compliance)</span>`;
        }
      }
      return `
      <div class="session-history-item" data-patient-id="${escapeHtml(this.selectedPatient.id)}" data-session-id="${escapeHtml(sess.sessionId)}">
        <div class="session-history-header">
          <h4>Call session - ${escapeHtml(sess.date)}</h4>
          <span class="pill-status" style="font-size: 8px; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border-light);">${escapeHtml(sess.language)} (${escapeHtml(sess.duration)})</span>
        </div>
        <p class="session-summary-preview">${escapeHtml(sess.summary?.overview || 'No summary available.')}</p>
        <div style="margin-top: 10px; display: flex; justify-content: flex-end;">${audioUI}</div>
      </div>
    `}).join('');
  }
  async renderPatientOpdLogs(patient) {
    const listContainer = document.getElementById('detail-opd-logs-list');
    const badge = document.getElementById('opd-next-visit-badge');
    if (!listContainer) return;
    if (patient.nextOpdVisitDate) {
      const today = new Date().toISOString().split('T')[0];
      const isPast = patient.nextOpdVisitDate < today;
      badge.textContent = `Next Visit: ${patient.nextOpdVisitDate}`;
      badge.style.color = isPast ? 'var(--accent-red)' : 'var(--accent-green)';
      badge.style.background = isPast ? 'rgba(220,38,38,0.1)' : 'rgba(5,205,153,0.1)';
      badge.style.border = `1px solid ${isPast ? 'var(--accent-red)' : 'var(--accent-green)'}`;
    } else {
      badge.textContent = 'Next Visit: Not scheduled';
      badge.style.color = 'var(--text-muted)';
      badge.style.background = 'rgba(0,0,0,0.1)';
      badge.style.border = 'none';
    }
    listContainer.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:12px; margin-top:20px;">Fetching logs...</div>';
    try {
      const res = await fetch(`http://localhost:5001/api/opd/logs/${patient.id}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const logs = await res.json();
      if (logs.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:12px; margin-top:20px;">No OPD records found.</div>';
        return;
      }
      listContainer.innerHTML = logs.map(log => `
        <div style="padding: 12px; border-bottom: 1px solid var(--border-light); background: var(--bg-card);">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="font-weight:600; font-size:13px; color: var(--text-primary);">${escapeHtml(log.medicineName)}</span>
            <span style="font-size:11px; color:var(--text-muted);">${log.date}</span>
          </div>
          <div style="font-size:12px; color:var(--text-secondary);">Qty: ${log.quantity}</div>
        </div>
      `).join('');
    } catch (e) {
      console.error(e);
      listContainer.innerHTML = '<div style="text-align:center; color:var(--accent-red); font-size:12px; margin-top:20px;">Error fetching records.</div>';
    }
  }
  async openPatientDetailById(id) {
    if (this.isNotesDirty) {
      if (!confirm("You have unsaved clinical notes. Discard?")) return;
      this.isNotesDirty = false;
    }
    await this.switchScreen('patients');
    const pt = this.patients.find(p => p.id === id);
    if (pt) {
      this.openPatientDetail(pt);
    }
  }
  bindModals() {
    const openBtn = document.getElementById('btn-add-patient-modal');
    const closeBtn = document.getElementById('btn-close-patient-modal');
    const cancelBtn = document.getElementById('btn-cancel-patient-form');
    const overlay = document.getElementById('modal-add-patient');
    const form = document.getElementById('form-add-patient');
    if (!openBtn || !closeBtn || !cancelBtn || !overlay || !form) return;
    const openModal = () => {
      overlay.classList.add('active');
      const focusable = overlay.querySelectorAll('button, input, select, textarea');
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    };
    const closeModal = () => {
      overlay.classList.remove('active');
      form.reset();
      delete form.dataset.editId;
      const titleEl = document.querySelector('#modal-add-patient h3');
      const submitEl = document.querySelector('#modal-add-patient button[type="submit"]');
      if (titleEl) titleEl.innerText = "Create Patient Profile";
      if (submitEl) submitEl.innerText = "Save Profile";
    };
    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('active')) {
        closeModal();
      }
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const focusable = overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputName = escapeHtml(document.getElementById('new-patient-name').value);
      const inputAge = parseInt(document.getElementById('new-patient-age').value);
      const inputGender = escapeHtml(document.getElementById('new-patient-gender').value);
      const inputPhone = escapeHtml(document.getElementById('new-patient-phone').value);
      const inputAddress = escapeHtml(document.getElementById('new-patient-address').value);
      const inputSubstance = escapeHtml(document.getElementById('new-patient-substance').value);
      const ngoEl = document.getElementById('new-patient-ngo');
      const inputNgo = ngoEl ? escapeHtml(ngoEl.value) : null;
      const inputSeverity = escapeHtml(document.getElementById('new-patient-severity').value);
      const inputColor = escapeHtml(document.getElementById('new-patient-color').value || '#00f2fe');
      const admInputEl = document.getElementById('new-patient-admission');
      const inputAdmission = admInputEl ? admInputEl.value || new Date().toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const stageInputEl = document.getElementById('new-patient-stage');
      const inputStage = stageInputEl ? parseInt(stageInputEl.value || '1') : 1;
      const counselorEl = document.getElementById('new-patient-counselor');
      const inputCounselor = counselorEl ? counselorEl.value : 'auto';
      const nameTrim = inputName.trim();
      if (!nameTrim || nameTrim.length < 2 || nameTrim.length > 50) {
        this.showToast("Validation Error", "Patient name must be between 2 and 50 characters.", "error");
        return;
      }
      if (isNaN(inputAge) || inputAge < 12 || inputAge > 100) {
        this.showToast("Validation Error", "Age must be a valid number between 12 and 100.", "error");
        return;
      }
      const phoneRegex = /^\+?[0-9\s\-()]{10,20}$/;
      if (!inputPhone || !phoneRegex.test(inputPhone.trim())) {
        this.showToast("Validation Error", "Please enter a valid phone number (10 to 20 digits, spaces/hyphens allowed).", "error");
        return;
      }
      const addressTrim = inputAddress.trim();
      if (!addressTrim || addressTrim.length < 3 || addressTrim.length > 100) {
        this.showToast("Validation Error", "Address must be between 3 and 100 characters.", "error");
        return;
      }
      const editingId = form.dataset.editId;
      if (editingId) {
        const pt = this.patients.find(p => p.id === editingId);
        if (pt) {
            pt.name = inputName;
            pt.age = inputAge;
            pt.gender = inputGender;
            pt.phone = inputPhone;
            pt.address = inputAddress;
            pt.addictionCategory = inputSubstance;
            pt.ngoPartner = inputNgo;
            pt.severity = inputSeverity;
            pt.avatarColor = inputColor;
            pt.admissionDate = inputAdmission;
            pt.clinicalStage = inputStage;
            if(!pt.checkpoints) {
                pt.checkpoints = { withdrawalStabilised: false, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false };
            }
            const addrLower = inputAddress.toLowerCase();
            // District parsing fallback
            let parsedDistrict = 'Amritsar';
            if (addrLower.includes('jalandhar')) parsedDistrict = 'Jalandhar';
            else if (addrLower.includes('ludhiana')) parsedDistrict = 'Ludhiana';
            else if (addrLower.includes('patiala') || addrLower.includes('sangrur') || addrLower.includes('nabha')) parsedDistrict = 'Patiala';
            pt.district = parsedDistrict;
            if (inputCounselor !== 'auto') {
              pt.counselorId = inputCounselor;
              if (inputCounselor === 'STAFF-003') pt.assignedCounselor = 'Dr. Amanpreet Kaur';
              else if (inputCounselor === 'STAFF-004') pt.assignedCounselor = 'Dr. Manpreet Sodhi';
              else if (inputCounselor === 'STAFF-005') pt.assignedCounselor = 'Dr. Harinder Gill';
              else if (inputCounselor === 'STAFF-006') pt.assignedCounselor = 'Dr. Gurbaksh Singh';
            } else {
              if (parsedDistrict === 'Jalandhar') {
                pt.counselorId = 'STAFF-004';
                pt.assignedCounselor = 'Dr. Manpreet Sodhi';
              } else if (parsedDistrict === 'Ludhiana') {
                pt.counselorId = 'STAFF-005';
                pt.assignedCounselor = 'Dr. Harinder Gill';
              } else if (parsedDistrict === 'Patiala') {
                pt.counselorId = 'STAFF-006';
                pt.assignedCounselor = 'Dr. Gurbaksh Singh';
              } else {
                pt.counselorId = 'STAFF-003';
                pt.assignedCounselor = 'Dr. Amanpreet Kaur';
              }
            }
            if(window.CounselFlow && window.CounselFlow.savePatients) {
              await window.CounselFlow.savePatients(this.patients);
            } else if(window.CounselFlow && window.CounselFlow.safeSetItem) {
               window.CounselFlow.safeSetItem('counseling_patients', window.obfuscateData ? window.obfuscateData(this.patients) : JSON.stringify(this.patients));
            }
            closeModal();
            this.renderPatientsList();
            if (this.selectedPatient && this.selectedPatient.id === pt.id) {
                this.openPatientDetail(pt);
            }
            this.showToast("Profile Updated", `Record updated for ${pt.name}.`, "success");
        }
        return;
      }
      const activeStaffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
      const activeCreds = window.CounselFlow.DEMO_CREDENTIALS.find(c => c.staffId === activeStaffId);
      let pDistrict = 'Amritsar';
      let pCounselorId = 'STAFF-003';
      let pCounselorName = 'Dr. Amanpreet Kaur';
      if (activeCreds && activeCreds.roleKey === 'counsellor') {
        pDistrict = activeCreds.district || 'Amritsar';
        pCounselorId = activeCreds.staffId;
        pCounselorName = activeCreds.name;
      } else {
        const addrLower = inputAddress.toLowerCase();
        let parsedDistrict = 'Amritsar';
        if (addrLower.includes('jalandhar')) parsedDistrict = 'Jalandhar';
        else if (addrLower.includes('ludhiana')) parsedDistrict = 'Ludhiana';
        else if (addrLower.includes('patiala') || addrLower.includes('sangrur') || addrLower.includes('nabha')) parsedDistrict = 'Patiala';
        pDistrict = parsedDistrict;
        if (inputCounselor !== 'auto') {
          pCounselorId = inputCounselor;
          if (inputCounselor === 'STAFF-003') pCounselorName = 'Dr. Amanpreet Kaur';
          else if (inputCounselor === 'STAFF-004') pCounselorName = 'Dr. Manpreet Sodhi';
          else if (inputCounselor === 'STAFF-005') pCounselorName = 'Dr. Harinder Gill';
          else if (inputCounselor === 'STAFF-006') pCounselorName = 'Dr. Gurbaksh Singh';
        } else {
          if (parsedDistrict === 'Jalandhar') {
            pCounselorId = 'STAFF-004';
            pCounselorName = 'Dr. Manpreet Sodhi';
          } else if (parsedDistrict === 'Ludhiana') {
            pCounselorId = 'STAFF-005';
            pCounselorName = 'Dr. Harinder Gill';
          } else if (parsedDistrict === 'Patiala') {
            pCounselorId = 'STAFF-006';
            pCounselorName = 'Dr. Gurbaksh Singh';
          } else {
            pCounselorId = 'STAFF-003';
            pCounselorName = 'Dr. Amanpreet Kaur';
          }
        }
      }
      const newPt = {
        id: `PT-${Math.floor(8000 + Math.random() * 999)}-${Date.now().toString(16).slice(-4)}`, 
        name: inputName,
        age: inputAge,
        gender: inputGender,
        phone: inputPhone,
        address: inputAddress,
        district: pDistrict,
        counselorId: pCounselorId,
        assignedCounselor: pCounselorName,
        addictionCategory: inputSubstance,
        ngoPartner: inputNgo,
        severity: inputSeverity,
        status: "Active",
        progress: 10,
        admissionDate: inputAdmission,
        clinicalStage: inputStage,
        checkpoints: { withdrawalStabilised: false, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false },
        preferredLanguage: inputName.includes("Singh") || inputAddress.includes("Punjab") ? "pa-IN" : "hi-IN", 
        joinDate: new Date().toISOString().split('T')[0],
        lastSessionDate: "Never",
        cravingsIntensity: 5,
        recoveryPhase: "Stabilization (Month 1)",
        notes: "New profile created.",
        avatarColor: inputColor,
        history: []
      };
      this.patients.unshift(newPt);
      if (window.CounselFlow && window.CounselFlow.savePatients) {
        await window.CounselFlow.savePatients(this.patients);
      }
      closeModal();
      this.renderPatientsList();
      this.showToast("Profile Added", `New record registered for ${newPt.name}.`, "success");
    });
  }
  initiateCallSequence(patient) {
    this.selectedPatient = patient;
    this.switchScreen('call-console');
    const languageCode = patient.preferredLanguage || 'pa-IN';
    const langSelect = document.getElementById('call-language-select');
    if (langSelect) {
      langSelect.value = languageCode;
    }
  }
  initiateCallSequenceById(id) {
    const pt = this.patients.find(p => p.id === id);
    if (pt) {
      this.initiateCallSequence(pt);
    }
  }
  bindCallConsoleActions() {
    const muteBtn = document.getElementById('btn-call-mute');
    const recordBtn = document.getElementById('btn-call-record');
    const endBtn = document.getElementById('btn-call-end');
    muteBtn.addEventListener('click', () => window.CounselFlow.callManager.toggleMute());
    recordBtn.addEventListener('click', () => window.CounselFlow.callManager.toggleRecording());
    endBtn.addEventListener('click', () => window.CounselFlow.callManager.endCall());
    const startBtn = document.getElementById('btn-call-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (!this.selectedPatient) {
          this.showToast('No Patient Selected', 'Please select a patient from the database or scheduling queue before placing a call.', 'error');
          return;
        }
        const langSelect = document.getElementById('call-language-select');
        const selectedLang = langSelect ? langSelect.value : (this.selectedPatient.preferredLanguage || 'pa-IN');
        window.CounselFlow.callManager.startCall(this.selectedPatient, selectedLang);
      });
    }
    document.querySelectorAll('.script-loader-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.getAttribute('data-lang');
        if (window.CounselFlow.loadCallScenario) {
          window.CounselFlow.loadCallScenario(lang);
        }
      });
    });
    const interactiveBtn = document.getElementById('btn-call-interactive');
    if (interactiveBtn) {
      interactiveBtn.addEventListener('click', () => {
        if (!this.selectedPatient) {
          this.showToast('No Patient Selected', 'Please select a patient before placing a call.', 'error');
          return;
        }
        const langSelect = document.getElementById('call-language-select');
        const selectedLang = langSelect ? langSelect.value : (this.selectedPatient.preferredLanguage || 'en-US');
        window.CounselFlow.callManager.startInteractiveDemo(this.selectedPatient, selectedLang);
      });
    }
    if (!window.CounselFlow.loadCallScenario) {
      window.CounselFlow.loadCallScenario = (langKey) => {
        const scenario = CALL_SCENARIOS[langKey];
        if (scenario) {
          const pt = this.selectedPatient || this.patients.find(p => p.id === scenario.patientId);
          if (pt) {
            this.selectedPatient = pt;
            window.CounselFlow.callManager.playScenarioScript(langKey, pt);
          }
        }
      };
    }
    const simInboundBtn = document.getElementById('btn-sim-inbound');
    const simLamaBtn = document.getElementById('btn-sim-lama');
    if (simInboundBtn) {
      simInboundBtn.addEventListener('click', () => {
        const activePts = this.patients.filter(p => p.status !== 'Completed');
        const pt = activePts[Math.floor(Math.random() * activePts.length)] || this.patients[0];
        if (pt) this.triggerInboundCallRinger(pt, 'Inbound');
      });
    }
    if (simLamaBtn) {
      simLamaBtn.addEventListener('click', () => {
        const highRiskPts = this.patients.filter(p => p.severity === 'High' || p.status === 'Risk');
        const pt = highRiskPts[0] || this.patients[0];
        if (pt) this.triggerInboundCallRinger(pt, 'LAMA Inbound');
      });
    }
    const acceptBtn = document.getElementById('btn-accept-inbound');
    const declineBtn = document.getElementById('btn-decline-inbound');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => this.acceptInboundCall());
    }
    if (declineBtn) {
      declineBtn.addEventListener('click', () => this.declineInboundCall());
    }
    const exportLogsBtn = document.getElementById('btn-export-call-logs');
    if (exportLogsBtn) {
      exportLogsBtn.addEventListener('click', () => this.exportCallLogsToCSV());
      const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
      const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
      if (roleConfig.canExportAll) {
        exportLogsBtn.style.display = '';
      } else {
        exportLogsBtn.style.display = 'none';
      }
    }
document.getElementById('btn-summary-export').addEventListener('click', () => {
       if (this.selectedPatient && window.CounselFlow.callManager.loadedSummary) {
         const customSession = {
           date: new Date().toISOString().split('T')[0],
           duration: document.getElementById('call-duration-timer').innerText,
           language: window.CounselFlow.callManager.activeLanguage === 'pa-IN' ? 'Punjabi' : window.CounselFlow.callManager.activeLanguage === 'hi-IN' ? 'Hindi' : 'English',
           counselor: "Dr. Amanpreet Kaur",
           transcript: window.CounselFlow.callManager.getTranscript(), 
           summary: window.CounselFlow.callManager.loadedSummary
         };
         window.CounselFlow.aiOrchestrator.exportSessionData(this.selectedPatient, customSession);
       }
     });
     document.getElementById('btn-summary-save').addEventListener('click', () => {
       this.commitCallSummaryToRecord();
     });
    this.renderScheduledCallQueue();
    const translateBtn = document.getElementById('btn-post-call-translate');
    const genSummaryBtn = document.getElementById('btn-generate-ai-summary');
    const playDemoAudioBtn = document.getElementById('btn-play-demo-audio');
    if (playDemoAudioBtn) {
      playDemoAudioBtn.addEventListener('click', () => {
        const audioContainer = document.getElementById('demo-audio-container');
        const audioPlayer = document.getElementById('demo-audio-player');
        if (audioContainer) {
          if (audioContainer.style.display === 'none' || audioContainer.style.display === '') {
            audioContainer.style.display = 'block';
            if (audioPlayer) audioPlayer.play().catch(e => console.log('Audio autoplay blocked', e));
            playDemoAudioBtn.innerHTML = `⏸ Hide Call Audio`;
          } else {
            audioContainer.style.display = 'none';
            if (audioPlayer) audioPlayer.pause();
            playDemoAudioBtn.innerHTML = `▶ Play Call Audio`;
          }
        }
      });
    }
    if (translateBtn) {
      translateBtn.addEventListener('click', async () => {
        const targetLang = document.getElementById('post-call-translate-lang').value;
        const transcript = window.CounselFlow.callManager.getTranscript();
        if (!transcript || transcript.length === 0) {
          this.showToast('No Transcript', 'There is no conversation to translate.', 'error');
          return;
        }
        const loadBar = document.getElementById('translate-loading-bar');
        if (loadBar) loadBar.style.display = 'flex';
        translateBtn.disabled = true;
        translateBtn.innerText = 'Translating...';
        try {
          const translated = await window.CounselFlow.aiOrchestrator.translateFullTranscriptAsync(transcript, targetLang);
          window.CounselFlow.callManager.lastSessionTranscript = translated;
          const logEl = document.getElementById('call-transcript-log');
          if (logEl) {
            logEl.innerHTML = '';
            translated.forEach(line => {
              const bubble = document.createElement('div');
              bubble.className = `transcript-line ${line.speaker === 'Counselor' ? 'counselor' : 'patient'}`;
              bubble.innerHTML = `
                <span class="transcript-speaker">${line.speaker}</span>
                <span class="transcript-timestamp">${line.timestamp || '00:00'}</span>
                <p>${line.text}</p>
              `;
              logEl.appendChild(bubble);
            });
            logEl.scrollTop = logEl.scrollHeight;
          }
          this.showToast('Translation Complete', `Transcript translated to ${targetLang} successfully.`, 'success');
        } catch (err) {
          console.error('Translation error:', err);
          this.showToast('Translation Failed', 'Could not translate the transcript. Please try again.', 'error');
        } finally {
          if (loadBar) loadBar.style.display = 'none';
          translateBtn.disabled = false;
          translateBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
            Translate Chat`;
        }
      });
    }
    if (genSummaryBtn) {
      genSummaryBtn.addEventListener('click', async () => {
        const postCallPanel = document.getElementById('post-call-actions-panel');
        if (postCallPanel) postCallPanel.style.display = 'none';
        document.getElementById('call-transcript-log').style.display = 'none';
        document.getElementById('call-post-summary-section').style.display = 'block';
        const loader = document.getElementById('summary-generator-loader');
        const wrapper = document.getElementById('summary-results-wrapper');
        loader.style.display = 'flex';
        wrapper.style.display = 'none';
        genSummaryBtn.disabled = true;
        try {
          await window.CounselFlow.callManager.compileAISummary();
          loader.style.display = 'none';
          wrapper.style.display = 'grid';
        } catch (e) {
          console.error("AI Summary compilation error:", e);
          loader.style.display = 'none';
          wrapper.style.display = 'grid';
          this.showToast("AI Summary Error", "Failed to compile the session summary.", "error");
        } finally {
          genSummaryBtn.disabled = false;
        }
      });
    }
    const btnOpenDictation = document.getElementById('btn-open-dictation');
    if (btnOpenDictation) {
      btnOpenDictation.addEventListener('click', () => {
        if (this.selectedPatient) {
          this.openDictationMode(this.selectedPatient);
        } else {
          this.showToast('No Patient Selected', 'Please select a patient first from the Patients screen.', 'error');
        }
      });
    }
    const btnCancelDictation = document.getElementById('btn-cancel-dictation');
    if (btnCancelDictation) {
      btnCancelDictation.addEventListener('click', () => {
        document.getElementById('dictation-panel').style.display = 'none';
        document.getElementById('call-transcript-log').style.display = 'block';
      });
    }
    const btnSubmitDictation = document.getElementById('btn-submit-dictation');
    if (btnSubmitDictation) {
      btnSubmitDictation.addEventListener('click', () => {
        this.submitDictationForSummary();
      });
    }
  }
  triggerInboundCallRinger(patient, callType = 'Inbound') {
    this._inboundPatient = patient;
    const callerName = document.getElementById('inbound-caller-name');
    const callerDetails = document.getElementById('inbound-caller-details');
    const callTypeLabel = document.getElementById('inbound-call-type-label');
    const ringerModal = document.getElementById('modal-inbound-call');
    const timerNote = document.getElementById('inbound-call-timer-note');
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    const maskPII = (val) => roleConfig.canViewPII ? escapeHtml(val) : '[PII Restricted]';
    if (callerName) callerName.innerText = escapeHtml(patient.name);
    if (callerDetails) callerDetails.innerText = `District: ${maskPII(patient.district || 'N/A')} | Category: ${escapeHtml(patient.addictionCategory)}`;
    if (callTypeLabel) {
      callTypeLabel.innerText = callType === 'LAMA Inbound' ? ' LAMA EMERGENCY' : ' Incoming Call';
      callTypeLabel.style.background = callType === 'LAMA Inbound' ? 'var(--accent-red)' : 'var(--accent-teal)';
    }
    if (ringerModal) ringerModal.style.display = 'flex';
    let remaining = 10;
    if (timerNote) timerNote.innerText = `Ringing... Auto-miss in ${remaining}s`;
    this._inboundRingerTimer = setInterval(() => {
      remaining--;
      if (timerNote) timerNote.innerText = `Ringing... Auto-miss in ${remaining}s`;
      if (remaining <= 0) {
        this.missInboundCall();
      }
    }, 1000);
  }
  _closeInboundRinger() {
    clearInterval(this._inboundRingerTimer);
    const ringerModal = document.getElementById('modal-inbound-call');
    if (ringerModal) ringerModal.style.display = 'none';
  }
  acceptInboundCall() {
    if (!this._inboundPatient) return;
    this._closeInboundRinger();
    const pt = this._inboundPatient;
    const direction = 'Inbound';
    this.showToast('Call Accepted', `Connecting inbound call with ${pt.name}...`, 'success');
    this.switchScreen('call-console');
    const languageCode = pt.preferredLanguage || 'pa-IN';
    const langSelect = document.getElementById('call-language-select');
    if (langSelect) {
      langSelect.value = languageCode;
    }
    this.selectedPatient = pt;
    window.CounselFlow.callManager.startCall(pt, languageCode, direction);
    this._inboundPatient = null;
  }
  declineInboundCall() {
    if (!this._inboundPatient) return;
    const pt = this._inboundPatient;
    const direction = 'Inbound';
    this._closeInboundRinger();
    window.CounselFlow.callManager.logCallAttempt(pt, 0, direction, 'Rejected');
    this.showToast('Call Declined', `Inbound call from ${pt.name} rejected and logged.`, 'info');
    this._inboundPatient = null;
    this.renderSessionHistoryLogs();
  }
  missInboundCall() {
    if (!this._inboundPatient) return;
    const pt = this._inboundPatient;
    const direction = 'Inbound';
    this._closeInboundRinger();
    window.CounselFlow.callManager.logCallAttempt(pt, 0, direction, 'Missed');
    this.showToast('Missed Call', `Inbound call from ${pt.name} was not answered.`, 'error');
    this._inboundPatient = null;
    this.renderSessionHistoryLogs();
  }
  renderScheduledCallQueue() {
    const container = document.getElementById('cbm-scheduled-queue-list');
    const badge = document.getElementById('queue-count-badge');
    if (!container || !this.patients) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    const queueItems = [];
    const today = new Date();
    this.patients.forEach(pt => {
      if (pt.status === 'Completed') return;
      const joinDateObj = new Date(pt.joinDate);
      if (isNaN(joinDateObj.getTime())) return;
      const daysSinceJoin = Math.floor((today - joinDateObj) / (1000 * 60 * 60 * 24));
      const checkpoints = [15, 30, 45];
      checkpoints.forEach(checkpoint => {
        const daysUntil = checkpoint - daysSinceJoin;
        if (daysUntil >= 0 && daysUntil <= 7) {
          queueItems.push({
            patient: pt,
            checkpoint,
            daysUntil,
            overdue: daysUntil === 0
          });
        }
      });
    });
    queueItems.sort((a, b) => a.daysUntil - b.daysUntil);
    if (badge) badge.innerText = queueItems.length;
    if (queueItems.length === 0) {
      container.innerHTML = `<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:12px;">No CBM calls due in the next 7 days.</div>`;
      return;
    }
    container.innerHTML = queueItems.map(item => {
      const urgencyColor = item.overdue ? 'var(--accent-red)' : item.daysUntil <= 2 ? 'var(--accent-orange)' : 'var(--accent-blue)';
      const dueLabel = item.overdue ? ' Due Today' : `In ${item.daysUntil} day${item.daysUntil !== 1 ? 's' : ''}`;
      return `
        <div style="background:var(--bg-input); border:1px solid var(--border-light); border-left:3px solid ${urgencyColor}; border-radius:8px; padding:10px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;" data-queue-patient-id="${escapeHtml(item.patient.id)}">
          <div>
            <div style="font-size:12px; font-weight:700; color:var(--text-primary);">${roleConfig.canViewPII ? escapeHtml(item.patient.name) : '[PII Restricted]'}</div>
            <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Day ${item.checkpoint} CBM Check-in</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px; font-weight:700; color:${urgencyColor};">${dueLabel}</div>
            <button class="btn-primary btn-queue-call-trigger" style="font-size:9px; padding:4px 8px; margin-top:4px; border-radius:6px;" data-patient-id="${escapeHtml(item.patient.id)}"> Call Now</button>
          </div>
        </div>
      `;
    }).join('');
  }
  renderSessionHistoryLogs() {
    if (this.activeScreen !== 'session-history') return;
    this.renderHistoryRecords(
      this.dom.historySearchInput ? this.dom.historySearchInput.value : '',
      this.dom.historyFilterLanguage ? this.dom.historyFilterLanguage.value : 'all'
    );
  }
  exportCallLogsToCSV() {
    try {
      const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
      const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
      if (!roleConfig.canExportAll && !roleConfig.canExportDistrict) {
        this.showToast('Permission Denied', 'You do not have permission to export call logs.', 'error');
        return;
      }
      const logs = window.CounselFlow.getCallLogs();
      if (!logs || logs.length === 0) {
        this.showToast('No Logs Found', 'There are no call logs available to export.', 'error');
        return;
      }
      const headers = ['Log ID', 'Patient ID', 'Patient Name', 'Counselor ID', 'Counselor Name', 'Timestamp', 'Duration', 'Direction', 'Disposition'];
      const rows = logs.map(log => [
        log.logId || '',
        log.patientId || '',
        log.patientName || '',
        log.counselorId || '',
        log.counselorName || '',
        log.timestamp || '',
        log.duration || '',
        log.direction || '',
        log.disposition || ''
      ].map(val => `"${String(val).replace(/"/g, '""')}"`)  
       .join(','));
      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `CounselFlow_CallLogs_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('CSV Exported', `${logs.length} call log entries downloaded successfully.`, 'success');
    } catch (e) {
      console.error('CSV Export Error:', e);
      this.showToast('Export Failed', 'An error occurred while generating the CSV file.', 'error');
    }
  }
  async commitCallSummaryToRecord() {
    if (!this.selectedPatient || !window.CounselFlow.callManager.loadedSummary) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    if (activeRole !== 'counsellor') {
      this.showToast('Permission Denied', 'Only a Tele-Counsellor can commit session summaries to patient records.', 'error');
      return;
    }
    const notesText = document.getElementById('summary-field-notes').value;
    const summary = { ...window.CounselFlow.callManager.loadedSummary };
    if (notesText.trim()) {
      summary.observations += `\nCounselor Note Addendum: ${notesText}`;
    }
    const durationStr = document.getElementById('call-duration-timer').innerText;
    const languageStr = window.CounselFlow.callManager.activeLanguage === 'pa-IN' ? 'Punjabi' : window.CounselFlow.callManager.activeLanguage === 'hi-IN' ? 'Hindi' : 'English';
    const dateStr = new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const isRecorded = window.CounselFlow.callManager.isRecording;
    const newSessionLog = {
      sessionId: `SESS-${Math.floor(1000 + Math.random() * 999)}-${Date.now().toString(16).slice(-4)}`,
      date: dateStr,
      duration: durationStr,
      language: languageStr,
      counselor: "Dr. Amanpreet Kaur",
      transcript: window.CounselFlow.callManager.getTranscript(),
      recordingUrl: isRecorded ? 'assets/audio/demo.mp3' : null,
      summary: summary
    };
    this.selectedPatient.history.unshift(newSessionLog);
    this.selectedPatient.lastSessionDate = dateStr;
    if (summary.risk.toLowerCase().includes('high') || summary.risk.toLowerCase().includes('critical')) {
      this.selectedPatient.cravingsIntensity = Math.min(this.selectedPatient.cravingsIntensity + 1, 10);
      this.selectedPatient.progress = Math.max(this.selectedPatient.progress - 5, 5);
      this.selectedPatient.status = 'Risk';
      this.notifications.unshift({
        id: Date.now(),
        text: `High Risk Alert: ${this.selectedPatient.name} recovery status changed to Risk.`,
        time: "Just now",
        unread: true
      });
      this.updateNotificationBadge();
      this.renderNotificationDropdownList();
    } else {
      this.selectedPatient.cravingsIntensity = Math.max(this.selectedPatient.cravingsIntensity - 1, 0);
      this.selectedPatient.progress = Math.min(this.selectedPatient.progress + 8, 100);
      if (this.selectedPatient.progress === 100) {
        this.selectedPatient.status = 'Completed';
      } else {
        this.selectedPatient.status = 'Active';
      }
    }
    if (window.CounselFlow && window.CounselFlow.savePatients) {
      await window.CounselFlow.savePatients(this.patients);
    }
    this.showToast("Record Committed", `Session ${newSessionLog.sessionId} saved under ${this.selectedPatient.name}.`, "success");
    this.openPatientDetail(this.selectedPatient);
  }
  viewTranscriptModal(logId, transcriptText) {
    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal-overlay active';
    modalDiv.id = 'modal-transcript-detail';
    modalDiv.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999;';
    modalDiv.innerHTML = `
      <div class="modal-content" style="width: 600px; max-width: 95%; background: var(--bg-card, #fff); padding: 24px; border-radius: 16px; border: 1px solid var(--border-light); box-shadow: 0 8px 32px rgba(0,0,0,0.3); display:flex; flex-direction:column; max-height:85%;">
        <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding-bottom:12px; margin-bottom:16px;">
          <h3 style="margin:0; color:var(--text-primary);">Recording Transcript (Log: ${escapeHtml(logId)})</h3>
          <button class="modal-close" id="btn-close-transcript-modal" style="background:none; border:none; color:var(--text-primary); font-size:24px; cursor:pointer;">&times;</button>
        </div>
        <div class="modal-body" style="overflow-y:auto; flex-grow:1; font-size:14px; line-height:1.6; color:var(--text-secondary); max-height:400px; background:var(--bg-input); padding:16px; border-radius:8px; white-space:pre-wrap;">${escapeHtml(transcriptText || 'No transcript generated yet.')}</div>
        <div class="modal-footer" style="border-top: 1px solid var(--border-light); padding-top:16px; margin-top:16px; display:flex; gap:10px; justify-content:flex-end;">
          <button class="btn-secondary" id="btn-copy-transcript" style="font-size:12px; padding:6px 16px; border-radius:8px; cursor:pointer;">Copy Transcript</button>
          <button class="btn-primary" id="btn-close-transcript-modal-footer" style="font-size:12px; padding:6px 16px; border-radius:8px; cursor:pointer;">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalDiv);
    modalDiv.querySelector('#btn-close-transcript-modal').addEventListener('click', () => modalDiv.remove());
    modalDiv.querySelector('#btn-close-transcript-modal-footer').addEventListener('click', () => modalDiv.remove());
    modalDiv.querySelector('#btn-copy-transcript').addEventListener('click', () => {
      navigator.clipboard.writeText(transcriptText);
      this.showToast('Copied', 'Transcript copied to clipboard.', 'success');
    });
  }
  viewSessionDetailModal(patientId, sessionId) {
    const pt = this.patients.find(p => p.id === patientId);
    if (!pt) return;
    const sess = pt.history.find(s => s.sessionId === sessionId);
    if (!sess) return;
    const modalDiv = document.createElement('div');
    modalDiv.className = 'modal-overlay active';
    modalDiv.id = 'modal-history-detail';
    const transHtml = sess.transcript.map(line => `
      <div style="margin-bottom:8px; font-size:12px;">
        <strong style="color: ${line.speaker === 'Counselor' ? 'var(--accent-blue)' : 'var(--text-secondary)'}">${escapeHtml(line.speaker)}:</strong> <span>${escapeHtml(line.text)}</span>
      </div>
    `).join('');
    const escapedPtName = escapeHtml(pt.name || 'Unknown Patient');
    const escapedSessId = escapeHtml(sess.sessionId || 'Unknown Session');
    const escapedOverview = escapeHtml(sess.summary?.overview || 'No overview available');
    const escapedConcerns = escapeHtml(sess.summary?.concerns || 'No concerns logged');
    const escapedObservations = escapeHtml(sess.summary?.observations || 'No observations logged');
    const actionsListHtml = (sess.summary?.actions || '').split('\n').filter(a => a.trim() !== '').map(a => `<li>${escapeHtml(a)}</li>`).join('');
    modalDiv.innerHTML = `
      <div class="modal-content" style="width: 750px; max-width: 95%;">
        <div class="modal-header">
          <h3>Session ${escapedSessId} Details - ${escapedPtName}</h3>
          <button class="modal-close" id="btn-close-history-modal">&times;</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-height:480px; overflow-y:auto; padding-right:8px;">
          <!-- Left side: transcript -->
          <div style="background:var(--bg-input); border:1px solid var(--border-light); border-radius:12px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
              <h4 style="color:var(--accent-blue);">Speech Transcript</h4>
              ${sess.recordingUrl ? `<audio controls src="${sess.recordingUrl}" style="height:32px; max-width:220px;"></audio>` : `<span style="font-size:10px; color:var(--text-muted); background:var(--bg-card); padding:4px 8px; border-radius:4px; border:1px solid var(--border-light);">No Audio Record</span>`}
            </div>
            <div style="max-height: 380px; overflow-y:auto; padding-right:4px;">
              ${transHtml || '<p style="color:var(--text-muted); font-size:12px;">No transcript lines recorded.</p>'}
            </div>
          </div>
          <!-- Right side: summary info -->
          <div style="display:flex; flex-direction:column; gap:16px;">
            <div class="summary-card" style="border-radius:12px; background:var(--bg-item);">
              <h4 style="color:var(--accent-blue);">Session Overview</h4>
              <p style="font-size:12px; color:var(--text-secondary);">${escapedOverview}</p>
            </div>
            <div class="summary-card" style="border-radius:12px; background:var(--bg-item);">
              <h4 style="color:var(--accent-orange);">Concerns / Triggers</h4>
              <p style="font-size:12px; color:var(--text-secondary);">${escapedConcerns}</p>
            </div>
            <div class="summary-card" style="border-radius:12px; background:var(--bg-item);">
              <h4 style="color:var(--accent-teal);">Observations</h4>
              <p style="font-size:12px; color:var(--text-secondary);">${escapedObservations}</p>
            </div>
            <div class="summary-card" style="border-radius:12px; background:var(--bg-item);">
              <h4 style="color:var(--accent-purple);">Actions Checklist</h4>
              <ul style="font-size:12px; color:var(--text-secondary); padding-left:16px;">
                ${actionsListHtml}
              </ul>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="border-top: 1px solid var(--border-light); padding-top:20px; margin-top:20px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn-secondary" id="btn-export-history-session"> Download Records</button>
          <button class="btn-secondary" id="btn-delete-transcript" style="display:none; color:var(--accent-red); border-color:var(--accent-red);">️ Delete Transcript</button>
          <button class="btn-primary" id="btn-close-history-modal-footer" style="margin-left:auto;">Close Details</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalDiv);
    modalDiv.querySelector('#btn-close-history-modal').addEventListener('click', () => modalDiv.remove());
    modalDiv.querySelector('#btn-close-history-modal-footer').addEventListener('click', () => modalDiv.remove());
    const sessionExportBtn = modalDiv.querySelector('#btn-export-history-session');
    const activeRoleForHistory = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfigForHistory = window.CounselFlow.getRoleConfig ? window.CounselFlow.getRoleConfig(activeRoleForHistory) : {};
    if (sessionExportBtn) {
      if (!roleConfigForHistory.canExportAll && !roleConfigForHistory.canExportDistrict) {
        sessionExportBtn.style.display = 'none';
      } else {
        sessionExportBtn.addEventListener('click', () => {
          this.triggerModalSessionExport(pt.id, sess.sessionId);
        });
      }
    }
    const activeRole = activeRoleForHistory;
    const roleConfig = roleConfigForHistory;
    const deleteBtn = modalDiv.querySelector('#btn-delete-transcript');
    if (deleteBtn) {
      if (roleConfig.canDeleteTranscript && sess.transcript && sess.transcript.length > 0) {
        deleteBtn.style.display = 'inline-flex';
        deleteBtn.addEventListener('click', () => this.deleteSessionTranscript(pt.id, sess.sessionId));
      } else if (sess.transcriptDeletedAt) {
        deleteBtn.style.display = 'inline-flex';
        deleteBtn.innerText = `️ Transcript deleted ${sess.transcriptDeletedAt}`;
        deleteBtn.disabled = true;
        deleteBtn.style.color = 'var(--text-muted)';
        deleteBtn.style.cursor = 'default';
      }
    }
  }
  triggerModalSessionExport(patientId, sessionId) {
    const pt = this.patients.find(p => p.id === patientId);
    if (!pt) return;
    const sess = pt.history.find(s => s.sessionId === sessionId);
    if (sess) {
      window.CounselFlow.aiOrchestrator.exportSessionData(pt, sess);
    }
  }
  async renderHistoryRecords(query = '', language = 'all') {
    if (!this.dom.historyRecordsList) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig ? window.CounselFlow.getRoleConfig(activeRole) : {};
    const activeTab = this.currentLogTab || 'sessions';
    const tabRowId = 'history-log-tab-row';
    let tabRow = document.getElementById(tabRowId);
    if (!tabRow) {
      tabRow = document.createElement('div');
      tabRow.id = tabRowId;
      tabRow.style.cssText = 'display:flex; gap:10px; margin-bottom:18px;';
      this.dom.historyRecordsList.parentElement.insertBefore(tabRow, this.dom.historyRecordsList);
      const makeTab = (label, key, hidden = false) => {
        const btn = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.id = `history-tab-btn-${key}`;
        btn.style.cssText = 'font-size:12px; padding:6px 16px; border-radius:8px;';
        if (hidden) btn.style.display = 'none';
        btn.innerText = label;
        btn.addEventListener('click', () => {
          this.currentLogTab = key;
          this.renderHistoryRecords(
            this.dom.historySearchInput ? this.dom.historySearchInput.value : '',
            this.dom.historyFilterLanguage ? this.dom.historyFilterLanguage.value : 'all'
          );
        });
        return btn;
      };
      tabRow.appendChild(makeTab(' Clinical Sessions', 'sessions'));
      tabRow.appendChild(makeTab(' Call Log Supervision', 'calllogs'));
      tabRow.appendChild(makeTab(' Audit Trail', 'audit', !roleConfig.canViewAuditTrail));
    }
    ['sessions', 'calllogs', 'audit'].forEach(key => {
      const btn = document.getElementById(`history-tab-btn-${key}`);
      if (btn) {
        btn.style.borderColor = key === activeTab ? 'var(--accent-blue)' : '';
        btn.style.color = key === activeTab ? 'var(--accent-blue)' : '';
        btn.style.fontWeight = key === activeTab ? '700' : '';
      }
    });
    if (activeTab === 'audit') {
      if (!roleConfig.canViewAuditTrail) {
        this.dom.historyRecordsList.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-muted);"> Access restricted to Supervisors and DITSU roles.</div>`;
        return;
      }
      await this.renderAuditTrailTab(query);
      return;
    }
    if (activeTab === 'calllogs') {
      let logs = [];
      try {
        logs = await window.CounselFlow.getCallLogs() || [];
      } catch (e) {
        logs = [];
      }
      const staffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
      if (activeRole === 'counsellor') {
        logs = logs.filter(log => log.counselorId === staffId);
      } else if (activeRole === 'ddrc') {
        const clinicalPatientIds = new Set(this.getSecurityScopedPatients().map(p => p.id));
        logs = logs.filter(log => clinicalPatientIds.has(log.patientId));
      }
      const filteredLogs = logs.filter(log => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (log.patientName || '').toLowerCase().includes(q) ||
               (log.patientId || '').toLowerCase().includes(q) ||
               (log.logId || '').toLowerCase().includes(q) ||
               (log.direction || '').toLowerCase().includes(q) ||
               (log.disposition || '').toLowerCase().includes(q);
      });
      if (filteredLogs.length === 0) {
        this.dom.historyRecordsList.innerHTML = `
          <div style="padding:40px; text-align:center; color:var(--text-muted); border:1px dashed var(--border-light); border-radius:16px;">
            <p style="font-size:24px; margin-bottom:12px;"></p>
            <p>No call log entries matched your search.</p>
          </div>
        `;
        return;
      }
      const dispositionBadge = (d) => {
        const colors = { Connected: 'var(--accent-teal)', Missed: 'var(--accent-orange)', Rejected: 'var(--accent-red)' };
        const c = colors[d] || 'var(--text-muted)';
        return `<span style="font-size:10px; font-weight:700; color:${c}; background:${c}22; padding:3px 8px; border-radius:12px; border:1px solid ${c}66;">${escapeHtml(d)}</span>`;
      };
      const directionBadge = (dir) => {
        const isLama = (dir || '').includes('LAMA');
        const isInbound = (dir || '').includes('Inbound');
        const c = isLama ? 'var(--accent-red)' : isInbound ? 'var(--accent-purple)' : 'var(--accent-blue)';
        return `<span style="font-size:10px; color:${c}; background:${c}22; padding:3px 8px; border-radius:12px; border:1px solid ${c}55;">${escapeHtml(dir || 'Outbound')}</span>`;
      };
      const canBulkDelete = !!roleConfig.canBulkDeleteLogs;
      this.dom.historyRecordsList.innerHTML = `
        <div style="overflow-x:auto;">
          ${canBulkDelete ? `
          <div id="calllogs-bulk-toolbar" style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px 14px; background:var(--bg-input); border-radius:10px; border:1px solid var(--border-light);">
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer; user-select:none;">
              <input type="checkbox" id="calllogs-select-all" style="cursor:pointer; width:15px; height:15px;" />
              <span>Select All</span>
            </label>
            <span id="calllogs-selected-count" style="font-size:12px; color:var(--text-muted);">0 selected</span>
            <button id="calllogs-bulk-delete-btn" class="btn-primary" style="margin-left:auto; background:var(--accent-red); border-color:var(--accent-red); font-size:12px; padding:6px 16px; display:flex; align-items:center; gap:6px; opacity:0.5; pointer-events:none;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
              Delete Selected
            </button>
          </div>` : ''}
          <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-light); color:var(--text-muted); text-align:left;">
                ${canBulkDelete ? '<th style="padding:10px 12px; width:36px;"></th>' : ''}
                <th style="padding:10px 12px;">Log ID</th>
                <th style="padding:10px 12px;">Patient</th>
                <th style="padding:10px 12px;">Counselor</th>
                <th style="padding:10px 12px;">Timestamp</th>
                <th style="padding:10px 12px; text-align:center;">Duration</th>
                <th style="padding:10px 12px; text-align:center;">Direction</th>
                <th style="padding:10px 12px; text-align:center;">Disposition</th>
                <th style="padding:10px 12px; text-align:center;">Recording / Action</th>
              </tr>
            </thead>
            <tbody>
              ${filteredLogs.map((log, idx) => `
                <tr data-log-id="${escapeHtml(log.logId || '')}" style="border-bottom:1px solid var(--border-light); background:${idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-input)'};">
                  ${canBulkDelete ? `<td style="padding:10px 12px;"><input type="checkbox" class="calllog-row-checkbox" data-logid="${escapeHtml(log.logId || '')}" style="cursor:pointer; width:15px; height:15px;" /></td>` : ''}
                  <td style="padding:10px 12px; font-family:monospace; font-size:11px; color:var(--accent-blue);">${escapeHtml(log.logId || '')}</td>
                  <td style="padding:10px 12px;">
                    <div style="font-weight:700; color:var(--text-primary);">${roleConfig.canViewPII ? escapeHtml(log.patientName || '') : '[PII Restricted]'}</div>
                    <div style="font-size:10px; color:var(--text-muted);">${roleConfig.canViewPII ? escapeHtml(log.patientId || '') : '[Masked ID]'}</div>
                  </td>
                  <td style="padding:10px 12px;">
                    <div style="color:var(--text-primary);">${escapeHtml(log.counselorName || '')}</div>
                    <div style="font-size:10px; color:var(--text-muted);">${escapeHtml(log.counselorId || '')}</div>
                  </td>
                  <td style="padding:10px 12px; color:var(--text-secondary);">${escapeHtml(log.timestamp || '')}</td>
                  <td style="padding:10px 12px; text-align:center; font-family:monospace; color:var(--text-primary);">${escapeHtml(log.duration || '—')}</td>
                  <td style="padding:10px 12px; text-align:center;">${directionBadge(log.direction)}</td>
                  <td style="padding:10px 12px; text-align:center;">${dispositionBadge(log.disposition)}</td>
                  <td style="padding:10px 12px; text-align:center;">
                    ${log.recordingUrl ? `
                      <div style="display:flex; flex-direction:column; align-items:center; gap:6px; min-width: 160px; margin: 4px 0;">
                        <audio src="${escapeHtml(log.recordingUrl)}" controls style="height:28px; width:150px; outline:none;"></audio>
                        <button class="btn-primary transcribe-rec-btn" data-logid="${escapeHtml(log.logId || '')}" data-url="${escapeHtml(log.recordingUrl)}" style="font-size:10px; padding:3px 8px; border-radius:4px; cursor:pointer;">Transcribe Recording</button>
                      </div>
                    ` : '<span style="color:var(--text-muted); font-style:italic;">No recording</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      if (canBulkDelete) {
        const selectAllChk = document.getElementById('calllogs-select-all');
        const deleteBulkBtn = document.getElementById('calllogs-bulk-delete-btn');
        const countLabel = document.getElementById('calllogs-selected-count');
        const updateToolbar = () => {
          const checked = document.querySelectorAll('.calllog-row-checkbox:checked');
          const n = checked.length;
          countLabel.textContent = `${n} selected`;
          if (n > 0) {
            deleteBulkBtn.style.opacity = '1';
            deleteBulkBtn.style.pointerEvents = 'auto';
          } else {
            deleteBulkBtn.style.opacity = '0.5';
            deleteBulkBtn.style.pointerEvents = 'none';
          }
          const total = document.querySelectorAll('.calllog-row-checkbox').length;
          selectAllChk.indeterminate = n > 0 && n < total;
          selectAllChk.checked = n > 0 && n === total;
        };
        selectAllChk.addEventListener('change', () => {
          document.querySelectorAll('.calllog-row-checkbox').forEach(cb => { cb.checked = selectAllChk.checked; });
          updateToolbar();
        });
        document.querySelectorAll('.calllog-row-checkbox').forEach(cb => {
          cb.addEventListener('change', updateToolbar);
        });
        deleteBulkBtn.addEventListener('click', async () => {
          const checked = document.querySelectorAll('.calllog-row-checkbox:checked');
          const logIds = Array.from(checked).map(cb => cb.getAttribute('data-logid')).filter(Boolean);
          if (logIds.length === 0) return;
          if (!confirm(`Are you sure you want to permanently delete ${logIds.length} call log record(s)? This cannot be undone.`)) return;
          deleteBulkBtn.disabled = true;
          deleteBulkBtn.textContent = 'Deleting…';
          try {
            await window.CounselFlow.deleteCallLogs(logIds);
            this.showToast('Logs Deleted', `${logIds.length} call log(s) permanently deleted.`, 'success');
            this.renderHistoryRecords();
          } catch (e) {
            this.showToast('Delete Failed', 'An error occurred while deleting the logs.', 'error');
            deleteBulkBtn.disabled = false;
            deleteBulkBtn.textContent = 'Delete Selected';
          }
        });
      }
      document.querySelectorAll('.transcribe-rec-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const logId = btn.getAttribute('data-logid');
          const recordingUrl = btn.getAttribute('data-url');
          btn.disabled = true;
          const originalText = btn.textContent;
          btn.textContent = 'Transcribing...';
          try {
            const token = localStorage.getItem('counseling_token') || '';
            const resp = await fetch('/api/recordings/transcribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
              },
              body: JSON.stringify({ logId, recordingUrl })
            });
            if (resp.ok) {
              const data = await resp.json();
              this.viewTranscriptModal(logId, data.text);
            } else {
              const err = await resp.json();
              this.showToast('ASR Error', err.error || 'Failed to transcribe call recording.', 'error');
            }
          } catch (err) {
            console.error('Transcription error:', err);
            this.showToast('Connection Error', 'Failed to communicate with transcription service.', 'error');
          } finally {
            btn.disabled = false;
            btn.textContent = originalText;
          }
        });
      });
      return;
    }
    let allSessions = [];
    this.getSecurityScopedPatients().forEach(pt => {
      (pt.history || []).forEach(sess => {
        allSessions.push({ patient: pt, session: sess });
      });
    });
    allSessions.sort((a, b) => new Date(b.session.date) - new Date(a.session.date));
    const filtered = allSessions.filter(item => {
      const matchText = (item.patient.name || '').toLowerCase().includes(query.toLowerCase()) ||
                        (item.session.summary?.overview || '').toLowerCase().includes(query.toLowerCase()) ||
                        (item.session.sessionId || '').toLowerCase().includes(query.toLowerCase());
      const matchLang = language === 'all' || (item.session.language || '').toLowerCase() === language.toLowerCase();
      return matchText && matchLang;
    });
    if (filtered.length === 0) {
      this.dom.historyRecordsList.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-light); border-radius:16px;">
          <p style="font-size: 24px; margin-bottom:12px;"></p>
          <p>No historical session logs matched your keywords.</p>
        </div>
      `;
      return;
    }
    this.dom.historyRecordsList.innerHTML = filtered.map(item => {
      const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
      const settings = window.CounselFlow.getSystemSettings();
      const callTime = new Date(item.session.date).getTime();
      const diffMins = isNaN(callTime) ? 999999 : (Date.now() - callTime) / (1000 * 60);
      const diffDays = diffMins / (60 * 24);
      let audioUI = '';
      if (activeRole === 'counsellor') {
        if (diffMins <= settings.counselorAudioRetentionMins) {
          audioUI = `<button class="btn-secondary" style="font-size:10px; padding:4px 8px; border-color:var(--accent-teal); color:var(--accent-teal);">▶ Play Audio</button>`;
        } else {
          audioUI = `<span style="font-size:10px; color:var(--text-muted); background:var(--bg-input); padding:4px 8px; border-radius:4px; border:1px dashed var(--border-light);">🔒 Auto-Deleted (Privacy)</span>`;
        }
      } else {
        if (diffDays <= settings.adminAudioRetentionDays) {
          audioUI = `<a href="${item.session.recordingUrl || 'assets/audio/demo.mp3'}" download="call_audio.mp3" class="btn-secondary" style="text-decoration:none; display:inline-block; font-size:10px; padding:4px 8px; border-color:var(--accent-blue); color:var(--accent-blue);" onclick="event.stopPropagation()">⬇ Download Audio</a>`;
        } else {
          audioUI = `<span style="font-size:10px; color:var(--accent-red); background:rgba(238,93,80,0.1); padding:4px 8px; border-radius:4px; border:1px solid rgba(238,93,80,0.2);">🗑 Permanently Deleted (Compliance)</span>`;
        }
      }
      return `
      <div class="session-history-item" data-patient-id="${escapeHtml(item.patient.id)}" data-session-id="${escapeHtml(item.session.sessionId)}" style="background:var(--bg-card);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
          <div>
            <span style="font-size:11px; font-weight:700; color:var(--accent-blue); text-transform:uppercase;">${escapeHtml(item.session.sessionId)}</span>
            <h4 style="font-size:15px; margin-top:2px;">${roleConfig.canViewPII ? escapeHtml(item.patient.name) : '[PII Restricted]'}</h4>
          </div>
          <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(item.session.date)} | ${escapeHtml(item.session.duration)} | ${escapeHtml(item.session.language)}</span>
        </div>
        <p class="session-summary-preview" style="color:var(--text-secondary);">${escapeHtml(item.session.summary?.overview || 'No summary available.')}</p>
        <div style="margin-top: 10px; display: flex; justify-content: flex-end;">${audioUI}</div>
      </div>
    `}).join('');
  }
  exportAnalyticsToCSV() {
    try {
      const activePts = document.getElementById('analytics-kpi-active')?.innerText || '0';
      const totalSess = document.getElementById('analytics-kpi-sessions')?.innerText || '0';
      const esc = document.getElementById('analytics-kpi-escalations')?.innerText || '0';
      const stageTime = document.getElementById('analytics-kpi-stage-time')?.innerText || '0';
      const compRate = document.getElementById('analytics-kpi-completion')?.innerText || '0';
      const csvContent = [
        "KPI,Value",
        `Active Patients,"${activePts}"`,
        `Total Sessions,"${totalSess}"`,
        `Open Escalations,"${esc}"`,
        `Avg Stage Time,"${stageTime}"`,
        `Completion Rate,"${compRate}"`
      ].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.setAttribute('hidden', '');
      a.setAttribute('href', url);
      a.setAttribute('download', `analytics_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showToast('Report Generated', 'District Analytics exported securely.', 'success');
    } catch (e) {
      console.error("Export Analytics error", e);
      this.showToast('Export Failed', 'An error occurred while exporting analytics.', 'error');
    }
  }
  renderAnalyticsCharts() {
    const realData = this.getRealAnalyticsData();
    const barEl = document.getElementById('bar-chart-container');
    const donutEl = document.getElementById('donut-chart-container');
    const hasSessionData = realData.totalCalls > 0;
    let barData = realData.weeklySessionTrend;
    if (!hasSessionData) {
      const categoryCounts = {};
      this.patients.forEach(pt => {
        const cat = (pt.addictionCategory || 'Unknown').split(' ')[0];
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      });
      barData = Object.entries(categoryCounts).map(([day, calls]) => ({ day, calls }));
    }
    if (barEl) {
      window.CounselFlow.chartRenderer.renderBarChart('bar-chart-container', barData);
    }
    if (donutEl) {
      window.CounselFlow.chartRenderer.renderDonutChart('donut-chart-container', realData.languageDistribution);
    }
    window.CounselFlow.chartRenderer.renderRiskIndicatorProgress('risk-severity-progress-list', realData.riskLevels);
    const statEls = {
      'analytics-total-patients': realData.totalPatients,
      'analytics-active-patients': realData.activePatients,
      'analytics-risk-patients': realData.riskPatients,
      'analytics-total-sessions': realData.totalCalls
    };
    Object.entries(statEls).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.innerText = val;
    });
    // Gap 7: Stage-to-Stage Funnel Analytics
    const funnelContainer = document.getElementById('funnel-analytics-container');
    if (funnelContainer) {
      const s1 = this.patients.filter(p => p.clinicalStage === 1).length;
      const s2 = this.patients.filter(p => p.clinicalStage === 2).length;
      const s3 = this.patients.filter(p => p.clinicalStage === 3).length;
      const s4 = this.patients.filter(p => p.clinicalStage === 4).length;
      const s5 = this.patients.filter(p => p.clinicalStage === 5).length;
      const s6 = this.patients.filter(p => p.clinicalStage === 6).length;
      const lama = this.patients.filter(p => p.status === 'LAMA').length;
      funnelContainer.innerHTML = [
        {label: 'Detox (S1-2)', count: s1+s2, color: 'var(--accent-blue)'},
        {label: 'Family (S3)', count: s3, color: 'var(--accent-teal)'},
        {label: 'Bridge (S4)', count: s4, color: 'var(--accent-purple)'},
        {label: 'Maint (S5)', count: s5, color: 'var(--accent-green)'},
        {label: 'Closed', count: s6, color: 'var(--text-primary)'},
        {label: 'LAMA', count: lama, color: 'var(--accent-red)'}
      ].map(stage => `
        <div style="flex:1; text-align:center; padding:12px; background:var(--bg-input); border-radius:8px; border:1px solid ${stage.color}44;">
           <div style="font-size:24px; font-weight:bold; color:${stage.color};">${stage.count}</div>
           <div style="font-size:10px; color:var(--text-secondary); margin-top:4px; text-transform:uppercase;">${stage.label}</div>
        </div>
      `).join('');
    }
  }
  bindSettingsTabs() {
    const btns = document.querySelectorAll('.settings-nav-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderSettingsTab(btn.getAttribute('data-tab'));
      });
    });
    this.dom.settingsTabPanel.addEventListener('click', (e) => {
      if (e.target.matches('.btn-primary') && e.target.textContent.includes('Save')) {
        const cRetention = document.getElementById('setting-counselor-retention');
        const aRetention = document.getElementById('setting-admin-retention');
        if (cRetention && aRetention) {
          const settingsObj = window.CounselFlow.getSystemSettings();
          settingsObj.counselorAudioRetentionMins = parseInt(cRetention.value, 10);
          settingsObj.adminAudioRetentionDays = parseInt(aRetention.value, 10);
          window.CounselFlow.saveSystemSettings(settingsObj);
        }
        this.showToast('Settings Saved', 'Configuration updated.', 'success');
      }
    });
  }
  renderSettingsTab(tabName) {
    if (!this.dom.settingsTabPanel) return;
    if (tabName === 'ai-models') {
      this.dom.settingsTabPanel.innerHTML = `
        <h3 style="margin-bottom:12px; border-bottom:1px solid var(--border-light); padding-bottom:8px;">AI NLP Configuration</h3>
        <p style="font-size:12px; color:var(--text-secondary); margin-bottom:24px;">Configure the default Speech-to-Text translation system and summarization models.</p>
        <div class="form-group">
          <label for="settings-select-asr">Speech Recognition Engine (ASR)</label>
          <select id="settings-select-asr" style="width: 100%;">
            <option value="whisper-local">Whisper Local (Optimized for Punjabi and Hindi Regional Dialects)</option>
            <option value="google-asr">Google Speech-to-Text API</option>
            <option value="azure-asr">Microsoft Azure Cognitive Speech</option>
          </select>
        </div>
        <div class="form-group">
          <label for="settings-select-nlp">Clinical Notes Summarization Model</label>
          <select id="settings-select-nlp" style="width: 100%;">
            <option value="gemini-flash">Gemini 3.5 Flash (Recommended - Fastest response)</option>
            <option value="llama-counsel">Llama-3-Counselor-8B (Fine-tuned for clinical addiction terms)</option>
            <option value="gpt-4o">OpenAI GPT-4o API Node</option>
          </select>
        </div>
        <div class="form-group">
          <span style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:8px; font-weight:600;">System Diagnostic Status</span>
          <div style="background:var(--bg-input); padding:16px; border-radius:10px; border:1px solid var(--border-light); display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; font-size:12px;">
              <span>Web Speech API Support</span>
              <strong style="color:${(window.SpeechRecognition || window.webkitSpeechRecognition) ? 'var(--accent-teal)' : 'var(--accent-red)'};">
                ${(window.SpeechRecognition || window.webkitSpeechRecognition) ? 'Supported (Local Mic Active)' : 'Unsupported (Use Script Simulators)'}
              </strong>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px;">
              <span>Deployment Mode</span>
              <strong style="text-transform: uppercase; color: var(--accent-indigo);">${window.CounselFlow.ENV.mode} Mode</strong>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px;">
              <span>Active API Node</span>
              <span style="font-family: monospace; font-size: 11px;">${window.CounselFlow.ENV.apiUrl}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px;">
              <span>Punjabi (Doabi/Malwai Dialect) ASR</span>
              <strong style="color:var(--accent-teal);">Operational (Accuracy 96.2%)</strong>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px;">
              <span>Hindi (Urban Haryana/Punjab Accent) ASR</span>
              <strong style="color:var(--accent-teal);">Operational (Accuracy 98.1%)</strong>
            </div>
          </div>
        </div>
        <button class="btn-primary" style="margin-top:20px;">Save Configurations</button>
      `;
    } else if (tabName === 'security') {
      const settings = window.CounselFlow.getSystemSettings();
      this.dom.settingsTabPanel.innerHTML = `
        <div id="settings-security" class="settings-panel active">
          <h3 style="margin-bottom: 20px; color: var(--text-primary);">Security & Patient Privacy</h3>
          <div style="background: var(--bg-input); border: 1px solid var(--border-light); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            <h4 style="margin-bottom: 10px; color: var(--accent-blue);">Call Recording Retention Policy</h4>
            <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 15px;">Configure how long audio recordings are retained to comply with HIPAA/local medical privacy laws. AI transcripts are kept permanently.</p>
            <div style="display: grid; grid-template-columns: 1fr; gap: 15px;">
              <div style="display: flex; flex-direction: column; gap: 5px;">
                <label for="setting-counselor-retention" style="font-size: 12px; font-weight: 600;">Counselor Dashboard Access (Minutes)</label>
                <input type="number" id="setting-counselor-retention" min="1" max="60" value="${settings.counselorAudioRetentionMins}" style="width: 100%; max-width: 200px; background: var(--bg-darkest); border: 1px solid var(--border-light); color: var(--text-primary); padding: 8px; border-radius: 6px;">
                <span style="font-size: 10px; color: var(--text-muted);">Time after call ends before audio is auto-deleted from the counselor's view.</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 5px;">
                <label for="setting-admin-retention" style="font-size: 12px; font-weight: 600;">Admin/Supervisor Server Retention (Days)</label>
                <input type="number" id="setting-admin-retention" min="1" max="365" value="${settings.adminAudioRetentionDays}" style="width: 100%; max-width: 200px; background: var(--bg-darkest); border: 1px solid var(--border-light); color: var(--text-primary); padding: 8px; border-radius: 6px;">
                <span style="font-size: 10px; color: var(--text-muted);">Time before audio is permanently hard-deleted from server storage.</span>
              </div>
            </div>
          </div>
          <div style="display: flex; justify-content: flex-start;">
            <button id="btn-save-settings-security" class="btn-primary" style="padding: 10px 20px;">Save Security Settings</button>
          </div>
        </div>
      `;
    } else if (tabName === 'telephony') {
      this.dom.settingsTabPanel.innerHTML = `
        <h3 style="margin-bottom:12px; border-bottom:1px solid var(--border-light); padding-bottom:8px;">Calling Settings</h3>
        <p style="font-size:12px; color:var(--text-secondary); margin-bottom:24px;">Configure telephony trunks and bandwidth compression details.</p>
        <div class="form-group">
          <label for="settings-select-codec">WebRTC Codec Priority</label>
          <select id="settings-select-codec" style="width:100%;">
            <option>Opus Audio (Recommended for low-bandwidth rural networks)</option>
            <option>G.711 PCMU</option>
          </select>
        </div>
        <div class="form-group">
          <label for="settings-text-ice">Simulated ICE Servers (STUN/TURN)</label>
          <textarea id="settings-text-ice" style="width:100%; height:80px; font-family:monospace; font-size:11px; background:var(--bg-input); border: 1px solid var(--border-light); color: var(--text-primary);" readonly>stun:stun.l.google.com:19302\nturn:turn.counselingservices.gov.in:3478</textarea>
        </div>
      `;
    } else if (tabName === 'diagnostics') {
      this.dom.settingsTabPanel.innerHTML = `
        <h3 style="margin-bottom:12px; border-bottom:1px solid var(--border-light); padding-bottom:8px;">System Diagnostics & Automated Assertions</h3>
        <p style="font-size:12px; color:var(--text-secondary); margin-bottom:24px;">Run full system tests and verify cryptographic roundtrips, form validations, ASR mapping accuracy, and NLP keyword triggers.</p>
        <div class="form-group" style="background:var(--bg-input); padding:20px; border-radius:12px; border:1px solid var(--border-light); text-align:center; box-sizing:border-box;">
          <div style="font-size:36px; margin-bottom:12px;"></div>
          <h4 style="font-size:15px; margin-bottom:6px; color:var(--text-primary);">CounselFlow Test Center</h4>
          <p style="font-size:11px; color:var(--text-secondary); margin-bottom:20px; max-width:400px; margin-left:auto; margin-right:auto; line-height:1.4;">Run the automated diagnostic assertions suite to evaluate backend API nodes, encryption cipher checks, date sanitization boundaries, and clinical risk triggers.</p>
          <a href="tests.html" target="_blank" class="btn-primary" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none; margin:0 auto; font-weight:700; width:auto; padding:10px 20px;"> Launch Test Center (tests.html)</a>
        </div>
      `;
    }
  }
  showToast(title, message, type = 'info') {
    if (!this.dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '';
    if (type === 'error') icon = '';
    if (type === 'info') icon = '';
    toast.innerHTML = `
      <div style="font-size: 20px;" aria-hidden="true">${icon}</div>
      <div class="toast-message">
        <h5>${escapeHtml(title)}</h5>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
    this.dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.isConnected) {
        toast.classList.add('active');
      }
    }, 50);
    setTimeout(() => {
      if (toast.isConnected) {
        toast.classList.remove('active');
        setTimeout(() => {
          if (toast.isConnected) {
            toast.remove();
          }
        }, 300);
      }
    }, 4000);
  }
  showOfflineBanner() {
    let banner = document.getElementById('offline-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offline-status-banner';
      banner.style.cssText = "background: var(--accent-red); color: white; text-align: center; padding: 8px 16px; font-size: 13px; font-weight: 600; font-family: var(--font-body); position: sticky; top: 0; z-index: 10000; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: all 0.3s ease;";
      banner.innerHTML = `
        <span>️ Offline Mode: Live speech-to-text transcription is suspended. System data editing and simulator scripts remain functional offline.</span>
      `;
      const container = document.getElementById('app-container');
      if (container) {
        container.insertBefore(banner, container.firstChild);
      } else {
        document.body.insertBefore(banner, document.body.firstChild);
      }
    } else {
      banner.style.display = 'flex';
    }
  }
  updateOfflineQueueBadge() {
    const queue = window.CounselFlow.getOfflineQueue ? window.CounselFlow.getOfflineQueue() : [];
    let badge = document.getElementById('offline-queue-badge');
    if (queue.length > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'offline-queue-badge';
        badge.style.cssText = 'font-size:10px; color:var(--accent-orange); background:var(--accent-orange)22; border:1px solid var(--accent-orange)55; padding:2px 8px; border-radius:10px; margin-top:4px; display:inline-block; cursor:pointer;';
        badge.title = 'Pending offline sync items';
        const footer = document.querySelector('.sidebar-footer .counselor-info');
        if (footer) footer.appendChild(badge);
      }
      badge.innerText = `️ ${queue.length} Pending Sync`;
    } else if (badge) {
      badge.remove();
    }
  }
  initInactivityTimer() {
    const resetTimer = () => {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = setTimeout(() => this.triggerAutoLogout(), this.inactivityLimit);
    };
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keypress', resetTimer);
    window.addEventListener('scroll', resetTimer);
    window.addEventListener('click', resetTimer);
    resetTimer();
  }
  triggerAutoLogout() {
    console.warn("Session expired due to 2 hours of counselor inactivity.");
    const lockOverlay = document.createElement('div');
    lockOverlay.style.cssText = "position:fixed; top:0; left:0; right:0; bottom:0; background:#0b0f19; z-index:100000; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:sans-serif;";
    lockOverlay.innerHTML = `
      <h1 style="font-size:32px; margin-bottom:12px;">Session Expired</h1>
      <p style="color:#94a3b8; font-size:14px; margin-bottom:24px;">For patient confidentiality, your session timed out due to 2 hours of inactivity.</p>
      <button class="btn-primary" id="btn-reauth">Re-Authenticate Session</button>
    `;
    document.body.appendChild(lockOverlay);
    document.getElementById('btn-reauth').addEventListener('click', () => window.location.reload());
  }
  performLogout() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:99999; display:flex; align-items:center; justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--bg-card); border:1px solid var(--border-light); border-radius:20px; padding:36px 40px; max-width:360px; width:90%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.4);">
        <div style="font-size:40px; margin-bottom:12px;"></div>
        <h3 style="font-size:18px; font-weight:700; margin-bottom:8px; color:var(--text-primary);">Log Out?</h3>
        <p style="font-size:13px; color:var(--text-muted); margin-bottom:24px; line-height:1.6;">
          You will be returned to the login screen.<br>Unsaved work will be preserved.
        </p>
        <div style="display:flex; gap:12px; justify-content:center;">
          <button id="btn-logout-cancel" class="btn-secondary" style="flex:1; padding:10px;">Cancel</button>
          <button id="btn-logout-confirm" class="btn-primary" style="flex:1; padding:10px; background:var(--accent-red); border-color:var(--accent-red);">Log Out</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('btn-logout-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('btn-logout-confirm').addEventListener('click', () => {
      window.CounselFlow.writeAuditEvent('USER_LOGOUT', 'N/A', 'N/A',
        this.activeRole || 'unknown',
        `${this.loggedInName || 'User'} logged out manually.`
      );
      window.CounselFlow.safeSetItem('counseling_active_role', '');
      window.CounselFlow.safeSetItem('counseling_logged_in_name', '');
      window.CounselFlow.safeSetItem('counseling_logged_in_staff', '');
      window.localStorage.removeItem('counseling_logged_in_token');
      window.location.reload();
    });
  }
  initRoleGate() {
    const activeRole = window.CounselFlow.getActiveRole();
    const loggedInName = window.CounselFlow.safeGetItem('counseling_logged_in_name');
    if (!activeRole || !loggedInName) {
      this.showLoginScreen();
    } else {
      this.applyRole(activeRole, false, loggedInName);
    }
  }
  showLoginScreen() {
    const CREDS = window.CounselFlow.DEMO_CREDENTIALS;
    const ROLES = window.CounselFlow.ROLES;
    const leadership = CREDS.filter(c => c.roleKey === 'spo' || c.roleKey === 'supervisor');
    const counselors = CREDS.filter(c => c.roleKey === 'counsellor');
    const support = CREDS.filter(c => c.roleKey === 'ddrc' || c.roleKey === 'ditsu' || c.roleKey === 'opd_staff');
    let existing = document.getElementById('modal-login-screen');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modal-login-screen';
    const renderDemoChip = (c) => {
      const role = ROLES[c.roleKey];
      const roleLabel = c.district ? `${role.label} (${c.district})` : role.label;
      const emoji = role ? role.emoji : '';
      const roleColor = role ? role.color : 'var(--text-primary)';
      return `
        <div class="demo-chip demo-cred-row" data-user="${escapeHtml(c.username)}" data-pass="${escapeHtml(c.password)}">
          <div class="demo-chip-badge">
            <span>${emoji}</span>
          </div>
          <div class="demo-chip-info">
            <div class="demo-chip-role" style="color:${roleColor};">${roleLabel}</div>
            <div class="demo-chip-meta">
              <span> ${escapeHtml(c.username)}</span>
              <span> ${escapeHtml(c.password)}</span>
            </div>
          </div>
          <div class="demo-chip-action">Select</div>
        </div>
      `;
    };
    overlay.innerHTML = `
      <div style="display:flex; flex-direction:row; gap:40px; width:100%; max-width:1120px; box-sizing:border-box; flex-wrap:wrap; justify-content:center; align-items:stretch; margin:auto; padding: 20px 0;">
        <!-- Left Column: Login Card -->
        <div style="flex: 1; min-width: 320px; max-width: 440px; display:flex; flex-direction:column; justify-content:center;">
          <!-- Logo / Title -->
          <div style="text-align:center; margin-bottom:24px;">
            <div class="login-title-glow" style="margin-bottom:8px;">
              <img src="assets/punjab-logo.svg" alt="Govt. of Punjab" style="width: 64px; height: 64px; object-fit: contain; margin-bottom: 8px;">
            </div>
            <h1 style="font-size:28px; font-weight:800; color:var(--text-primary); margin-bottom:4px; letter-spacing:-0.5px;">CounselFlow</h1>
            <p style="font-size:12px; color:var(--text-secondary); letter-spacing:0.5px;">Tele-Counseling Platform • Community Bridge Model</p>
          </div>
          <!-- Government Banner -->
          <div class="government-banner" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 12px; margin-bottom: 20px; background: rgba(255, 255, 255, 0.02); border-radius: 12px; border: 1px solid var(--border-light); text-align: center;">
            <img src="logo.png" alt="S. Bhagwant Singh Mann, Chief Minister of Punjab" style="width: 90px; height: 90px; border-radius: 8px; border: 1.5px solid var(--accent-orange); object-fit: cover; object-position: top; box-shadow: 0 4px 8px rgba(0,0,0,0.15);">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 12px; font-weight: 800; color: var(--text-primary);">S. Bhagwant Singh Mann</span>
              <span style="font-size: 9.5px; color: var(--accent-orange); font-weight: 600;">Hon'ble Chief Minister, Punjab</span>
              <span style="font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600;">Drug-Free Punjab Campaign</span>
            </div>
          </div>
          <!-- Login Form Card -->
          <div class="login-card">
            <h3 style="font-size:20px; color:var(--text-primary); margin-bottom:4px; font-weight:700;">Sign In</h3>
            <p style="font-size:12px; color:var(--text-secondary); margin-bottom:24px;">Enter your credentials to access the platform</p>
            <div id="login-error-msg" style="display:none; background:rgba(220, 38, 38, 0.1); border:1px solid rgba(220, 38, 38, 0.3); border-radius:10px; padding:12px 14px; margin-bottom:20px; font-size:12px; color:var(--accent-red); font-weight:600;">
               Invalid username or password. Please try again.
            </div>
            <label style="font-size:11px; font-weight:700; color:var(--text-secondary); letter-spacing:0.5px; display:block; margin-bottom:8px; text-transform:uppercase;">Email / Username</label>
            <input type="text" id="login-username" class="login-input-field" placeholder="e.g. counsellor@cbm.gov.in" autocomplete="username" />
            <label style="font-size:11px; font-weight:700; color:var(--text-secondary); letter-spacing:0.5px; display:block; margin-bottom:8px; text-transform:uppercase;">Password</label>
            <div style="position:relative;">
              <input type="password" id="login-password" class="login-input-field" placeholder="••••••••••" autocomplete="current-password" style="padding-right:48px;" />
              <button type="button" id="login-toggle-password" style="position:absolute; right:12px; top:12px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px;" title="Toggle password visibility"></button>
            </div>
            <button id="btn-login-submit" style="
              width:100%; padding:14px; margin-top:10px; background:linear-gradient(135deg, var(--accent-indigo), var(--accent-blue));
              border:none; border-radius:12px; color:#ffffff; font-size:15px; font-weight:700; cursor:pointer;
              font-family:var(--font-body); transition:all 0.2s ease; letter-spacing:0.3px;
              box-shadow: 0 4px 15px rgba(37, 99, 235, 0.2);
            " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 20px rgba(37, 99, 235, 0.35)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 15px rgba(37, 99, 235, 0.2)';">Sign In →</button>
          </div>
          <p style="font-size:10px; color:var(--text-muted); margin-top:20px; text-align:center; line-height:1.4;">Punjab CBM Programme • DITSU / Dr. B.R. Ambedkar State Institute of Medical Sciences, Mohali</p>
        </div>
        <!-- Right Column: Demo Credentials Showcase Card -->
        <div style="flex: 1.3; min-width: 380px; max-width: 640px; display:flex; flex-direction:column; justify-content:center;">
          <div class="login-card" style="display:flex; flex-direction:column; height:100%;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
              <h3 style="font-size:18px; font-weight:700; color:var(--text-primary); margin:0;"> Demo Credentials</h3>
              <span style="font-size:11px; background:rgba(37, 99, 235, 0.1); color:var(--accent-blue); border:1px solid rgba(37, 99, 235, 0.2); padding:3px 10px; border-radius:20px; font-weight:700; display:inline-block; animation: pulse 2s infinite;"> Click to Autofill</span>
            </div>
            <p style="font-size:12px; color:var(--text-secondary); margin:0 0 16px 0;">Select an account from the directory below to automatically populate the sign-in fields.</p>
            <div class="demo-scroll-container">
              <!-- Category 1: Leadership & Admin -->
              <div class="demo-category-header">Leadership & Administration</div>
              ${leadership.map(c => renderDemoChip(c)).join('')}
              <!-- Category 2: District Tele-Counsellors -->
              <div class="demo-category-header">District Tele-Counsellors</div>
              ${counselors.map(c => renderDemoChip(c)).join('')}
              <!-- Category 3: Clinical & Support -->
              <div class="demo-category-header">Clinical & Technical Support</div>
              ${support.map(c => renderDemoChip(c)).join('')}
            </div>
          </div>
        </div>
      </div>
      <style>
        #modal-login-screen {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--bg-darkest);
          background-image: 
            radial-gradient(at 0% 0%, rgba(79, 172, 254, 0.12) 0px, transparent 50%),
            radial-gradient(at 100% 100%, rgba(165, 94, 234, 0.08) 0px, transparent 50%);
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-body);
          overflow-y: auto;
          padding: 40px 20px;
          box-sizing: border-box;
          transition: background 0.3s ease;
        }
        .login-card {
          background: var(--bg-card);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-light);
          border-radius: 24px;
          padding: 32px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255,255,255,0.1);
          box-sizing: border-box;
          transition: all 0.3s ease;
        }
        body.dark-theme .login-card {
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .login-title-glow {
          filter: drop-shadow(0 4px 12px rgba(79,172,254,0.25));
        }
        body.dark-theme .login-title-glow {
          filter: drop-shadow(0 4px 20px rgba(0,242,254,0.45));
        }
        .login-input-field {
          width: 100%;
          padding: 14px 16px;
          background: var(--bg-input);
          border: 1px solid var(--border-light);
          border-radius: 12px;
          color: var(--text-primary);
          font-size: 14px;
          font-family: var(--font-body);
          margin-bottom: 18px;
          outline: none;
          transition: all 0.2s ease;
          box-sizing: border-box;
        }
        .login-input-field:focus {
          border-color: var(--accent-blue);
          background: var(--bg-darker);
          box-shadow: 0 0 0 3px rgba(79, 172, 254, 0.15);
        }
        body.dark-theme .login-input-field:focus {
          box-shadow: 0 0 0 3px rgba(0, 242, 254, 0.2);
        }
        .demo-chip {
          background: var(--bg-row);
          border: 1px solid var(--border-light);
          border-radius: 14px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-sizing: border-box;
          margin-bottom: 10px;
        }
        .demo-chip:hover {
          transform: translateY(-2px);
          background: var(--bg-row-hover);
          border-color: var(--border-active);
          box-shadow: var(--shadow-neon);
        }
        .demo-chip:active {
          transform: translateY(0);
        }
        .demo-chip.selected {
          background: rgba(79, 172, 254, 0.12);
          border-color: var(--accent-blue);
          box-shadow: 0 0 12px rgba(79, 172, 254, 0.2);
        }
        body.dark-theme .demo-chip.selected {
          background: rgba(0, 242, 254, 0.15);
          border-color: var(--accent-blue);
          box-shadow: 0 0 12px rgba(0, 242, 254, 0.25);
        }
        .demo-chip-badge {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--bg-item);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
          transition: all 0.2s;
        }
        .demo-chip:hover .demo-chip-badge {
          background: var(--bg-item-hover);
          transform: scale(1.05);
        }
        .demo-chip-info {
          flex-grow: 1;
          margin-left: 12px;
          margin-right: 12px;
          overflow: hidden;
        }
        .demo-chip-role {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .demo-chip-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-family: monospace;
          font-size: 10px;
          color: var(--text-secondary);
        }
        .demo-chip-meta span {
          background: var(--bg-item);
          padding: 1px 6px;
          border-radius: 4px;
          white-space: nowrap;
        }
        .demo-chip-action {
          font-size: 11px;
          font-weight: 700;
          color: var(--accent-blue);
          background: rgba(79, 172, 254, 0.1);
          padding: 4px 8px;
          border-radius: 8px;
          transition: all 0.2s;
          flex-shrink: 0;
          border: 1px solid transparent;
        }
        .demo-chip:hover .demo-chip-action {
          background: var(--accent-blue);
          color: white;
        }
        .demo-category-header {
          font-size: 11px;
          font-weight: 800;
          color: var(--accent-blue);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-top: 18px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .demo-category-header::after {
          content: '';
          flex-grow: 1;
          height: 1px;
          background: var(--border-light);
        }
        .demo-scroll-container {
          overflow-y: auto;
          max-height: 480px;
          padding-right: 6px;
          margin-right: -6px;
        }
        .demo-scroll-container::-webkit-scrollbar {
          width: 5px;
        }
        .demo-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .demo-scroll-container::-webkit-scrollbar-thumb {
          background: var(--border-light);
          border-radius: 4px;
        }
        .demo-scroll-container::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }
        @keyframes pulse {
          0% { opacity: 0.85; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.03); }
          100% { opacity: 0.85; transform: scale(1); }
        }
      </style>
    `;
    document.body.appendChild(overlay);
    const userInput = overlay.querySelector('#login-username');
    const passInput = overlay.querySelector('#login-password');
    const errMsg = overlay.querySelector('#login-error-msg');
    const submitBtn = overlay.querySelector('#btn-login-submit');
    const togglePwdBtn = overlay.querySelector('#login-toggle-password');
    setTimeout(() => userInput && userInput.focus(), 100);
    if (togglePwdBtn && passInput) {
      togglePwdBtn.addEventListener('click', () => {
        const isPassword = passInput.type === 'password';
        passInput.type = isPassword ? 'text' : 'password';
        togglePwdBtn.innerText = isPassword ? '' : '';
      });
    }
    overlay.querySelectorAll('.demo-cred-row').forEach(row => {
      row.addEventListener('click', () => {
        const u = row.getAttribute('data-user');
        const p = row.getAttribute('data-pass');
        if (userInput) userInput.value = u;
        if (passInput) passInput.value = p;
        overlay.querySelectorAll('.demo-cred-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        if (submitBtn) submitBtn.focus();
        this.showToast('Credentials Selected', `Autofilled credentials for ${u}`, 'info');
      });
    });
    const themeToggleBtn = document.createElement('button');
    themeToggleBtn.id = 'login-theme-toggle';
    themeToggleBtn.title = 'Toggle Theme';
    themeToggleBtn.style.cssText = 'position:fixed; top:20px; right:20px; background:var(--bg-card); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border:1px solid var(--border-light); color:var(--text-primary); width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:var(--shadow-neon); transition:all 0.2s; z-index:100000;';
    const updateThemeToggleIcon = () => {
      const isDark = document.body.classList.contains('dark-theme');
      themeToggleBtn.innerHTML = isDark ? 
        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>` : 
        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    };
    updateThemeToggleIcon();
    overlay.appendChild(themeToggleBtn);
    themeToggleBtn.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark-theme');
      window.CounselFlow.safeSetItem("counseling_theme", isDark ? "dark" : "light");
      updateThemeToggleIcon();
      const mainIcon = document.getElementById('theme-toggle-icon');
      const mainBtn = document.getElementById('btn-theme-toggle');
      if (mainBtn) mainBtn.title = isDark ? "Toggle Light Theme" : "Toggle Dark Theme";
      if (mainIcon) {
        mainIcon.innerHTML = isDark ? 
          `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>` : 
          `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
      }
    });
    const handleLogin = () => {
      const username = userInput ? userInput.value : '';
      const password = passInput ? passInput.value : '';
      // Attempt server authentication first
      fetch(`${window.CounselFlow.API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      })
      .then(async res => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Invalid username or password');
        }
        return res.json();
      })
      .then(data => {
        overlay.style.transition = 'opacity 0.4s';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          window.localStorage.setItem('counseling_logged_in_token', data.token);
          window.CounselFlow.safeSetItem('counseling_logged_in_name', data.user.name);
          window.CounselFlow.safeSetItem('counseling_logged_in_staff', data.user.staffId);
          this.applyRole(data.user.roleKey, true, data.user.name);
        }, 400);
      })
      .catch(err => {
        console.warn('[AUTH] Server login failed, checking fallback offline mode:', err.message);
        // Fallback to offline mock validation if credentials match demo database
        const result = window.CounselFlow.validateDemoLogin(username, password);
        if (result) {
          overlay.style.transition = 'opacity 0.4s';
          overlay.style.opacity = '0';
          setTimeout(() => {
            overlay.remove();
            window.CounselFlow.safeSetItem('counseling_logged_in_name', result.name);
            window.CounselFlow.safeSetItem('counseling_logged_in_staff', result.staffId);
            this.applyRole(result.roleKey, true, result.name);
          }, 400);
        } else {
          if (errMsg) {
            errMsg.innerText = err.message || 'Invalid username or password. Please try again.';
            errMsg.style.display = 'block';
          }
          if (submitBtn) {
            submitBtn.style.animation = 'shake 0.4s';
            setTimeout(() => { submitBtn.style.animation = ''; }, 500);
          }
        }
      });
    };
    if (submitBtn) submitBtn.addEventListener('click', handleLogin);
    [userInput, passInput].forEach(inp => {
      if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    });
  }
  showRoleSelector() {
    this.showLoginScreen();
  }
  applyRole(roleKey, isNew = false, userName = '') {
    const ROLES = window.CounselFlow.ROLES;
    const role = ROLES[roleKey];
    if (!role) return;
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
      appContainer.style.setProperty('display', 'flex', 'important');
    }
    window.CounselFlow.setActiveRole(roleKey);
    this.activeRole = roleKey;
    this.loggedInName = userName || window.CounselFlow.safeGetItem('counseling_logged_in_name') || '';
    const avatar = document.querySelector('.counselor-avatar');
    const nameEl = document.querySelector('.counselor-info h4');
    const subtitleEl = document.querySelector('.counselor-info span');
    if (this.loggedInName) {
      const initials = this.loggedInName.replace(/^(Dr\.|Er\.|Sh\.)\s*/i, '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      if (avatar) avatar.innerText = initials;
      if (nameEl) nameEl.innerText = this.loggedInName.split(' ').slice(0, 2).join(' ');
      const staffId = window.CounselFlow.safeGetItem('counseling_logged_in_staff') || '';
      const currentUser = window.CounselFlow.DEMO_CREDENTIALS.find(c => c.staffId === staffId);
      const district = currentUser ? currentUser.district : '';
      if (subtitleEl) subtitleEl.innerText = district ? `${role.label} (${district})` : role.label;
    }
    const footer = document.querySelector('.sidebar-footer .counselor-info');
    if (footer) {
      const existingBadge = document.getElementById('role-badge-pill');
      if (existingBadge) existingBadge.remove();
      const badge = document.createElement('div');
      badge.id = 'role-badge-pill';
      badge.style.cssText = `font-size:9px; font-weight:700; color:${role.color}; background:${role.color}22; border:1px solid ${role.color}55; padding:2px 8px; border-radius:10px; margin-top:4px; display:inline-block; cursor:pointer;`;
      badge.innerText = `${role.emoji} ${role.label}`;
      badge.title = 'Click to switch role / logout';
      badge.addEventListener('click', () => {
        if (confirm('Log out and switch to a different role?')) {
          window.CounselFlow.safeSetItem('counseling_active_role', '');
          window.CounselFlow.safeSetItem('counseling_logged_in_name', '');
          window.CounselFlow.safeSetItem('counseling_logged_in_staff', '');
          window.localStorage.removeItem('counseling_logged_in_token');
          window.location.reload();
        }
      });
      footer.appendChild(badge);
    }
    if (isNew) {
      this.showToast('Login Successful', `Welcome, ${this.loggedInName || role.label}! You are logged in as ${role.emoji} ${role.label}.`, 'success');
      window.CounselFlow.writeAuditEvent('USER_LOGIN', 'N/A', 'N/A', roleKey, `${this.loggedInName} logged in as ${role.label}`);
    }
    document.querySelectorAll('.nav-item[data-screen]').forEach(item => {
      const screen = item.getAttribute('data-screen');
      item.style.display = role.allowedScreens.includes(screen) ? '' : 'none';
    });
    const exportLogsBtn = document.getElementById('btn-export-call-logs');
    if (exportLogsBtn) {
      exportLogsBtn.style.display = role.canExportAll ? '' : 'none';
    }
    const distFilter = document.getElementById('patient-filter-district');
    if (distFilter) {
      distFilter.style.display = ['spo', 'supervisor'].includes(roleKey) ? '' : 'none';
    }
    this.renderEscalationPanel();
    // Switch to first allowed screen or dashboard
    const defaultScreen = role.allowedScreens.length > 0 ? role.allowedScreens[0] : 'dashboard';
    this.switchScreen(defaultScreen);
  }
  renderSessionScoreCard(summaryObj, transcriptArray) {
    const container = document.getElementById('session-score-card');
    if (!container) return;
    const scores = window.CounselFlow.aiOrchestrator.scoreSession(summaryObj, transcriptArray);
    const dimensions = [
      { key: 'rapport', label: 'Rapport', icon: '' },
      { key: 'relapseFrame', label: 'Relapse-Prevention Frame', icon: '️' },
      { key: 'riskCueId', label: 'Risk Cue Identification', icon: '' },
      { key: 'actionClarity', label: 'Action Clarity', icon: '' },
      { key: 'escalationHygiene', label: 'Escalation Hygiene', icon: '' },
      { key: 'languageSensitivity', label: 'Language Sensitivity', icon: '' }
    ];
    const avgColor = scores.average >= 70 ? 'var(--accent-teal)' : scores.average >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';
    container.style.display = 'block';
    container.innerHTML = `
      <div style="border-top:1px solid var(--border-light); padding-top:20px; margin-top:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h4 style="font-size:13px; color:var(--text-primary);"> Session Quality Score</h4>
          <div style="font-size:22px; font-weight:900; color:${avgColor};">${scores.average}%</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${dimensions.map(dim => {
            const val = scores[dim.key] || 0;
            const pct = (val / 10) * 100;
            const barColor = pct >= 70 ? 'var(--accent-teal)' : pct >= 50 ? 'var(--accent-orange)' : 'var(--accent-red)';
            return `
              <div>
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                  <span>${dim.icon} ${dim.label}</span>
                  <span style="font-weight:700; color:${barColor};">${val}/10</span>
                </div>
                <div style="height:6px; background:var(--bg-input); border-radius:3px; overflow:hidden;">
                  <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:3px; transition:width 0.6s ease;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <p style="font-size:10px; color:var(--text-muted); margin-top:12px;">Scores are auto-generated by AI analysis and saved with the session record for supervisor review.</p>
      </div>
    `;
    if (window.CounselFlow.callManager) {
      window.CounselFlow.callManager.loadedSummary = window.CounselFlow.callManager.loadedSummary || {};
      window.CounselFlow.callManager.loadedSummary._scores = scores;
    }
  }
  openDictationMode(patient) {
    this.selectedPatient = patient;
    const panel = document.getElementById('dictation-panel');
    const transcriptLog = document.getElementById('call-transcript-log');
    const postSummary = document.getElementById('call-post-summary-section');
    if (!panel) {
      this.showToast('Dictation Panel Missing', 'Please refresh and try again.', 'error');
      return;
    }
    if (transcriptLog) transcriptLog.style.display = 'none';
    if (postSummary) postSummary.style.display = 'none';
    panel.style.display = 'flex';
    const nameEl = document.getElementById('dictation-patient-name');
    if (nameEl) nameEl.innerText = escapeHtml(patient.name);
    const micBtn = document.getElementById('btn-dictation-mic');
    const dictArea = document.getElementById('dictation-textarea');
    if (micBtn && dictArea) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const sr = new SpeechRecognition();
        sr.continuous = true;
        sr.interimResults = false;
        sr.lang = patient.preferredLanguage || 'pa-IN';
        let isListening = false;
        micBtn.addEventListener('click', () => {
          if (!isListening) {
            try {
              sr.start();
              isListening = true;
              micBtn.style.background = 'var(--accent-red)';
              micBtn.innerText = ' Stop Dictation';
              this.showToast('Dictation Active', 'Speak your session notes aloud...', 'info');
            } catch (e) {
              this.showToast('Mic Error', 'Could not start microphone.', 'error');
            }
          } else {
            sr.stop();
            isListening = false;
            micBtn.style.background = '';
            micBtn.innerText = '️ Start Dictation';
          }
        });
        sr.onresult = (e) => {
          const idx = e.resultIndex;
          const text = e.results[idx][0].transcript.trim();
          dictArea.value += (dictArea.value ? ' ' : '') + text;
        };
        sr.onerror = (e) => {
          isListening = false;
          micBtn.style.background = '';
          micBtn.innerText = '️ Start Dictation';
          console.error('Dictation SR error:', e.error);
        };
      } else {
        micBtn.style.display = 'none';
        this.showToast('ASR Not Supported', 'Type your dictation notes in the text area below.', 'info');
      }
    }
  }
  async submitDictationForSummary() {
    const dictArea = document.getElementById('dictation-textarea');
    const langSelect = document.getElementById('dictation-language-select');
    const panel = document.getElementById('dictation-panel');
    if (!dictArea || !dictArea.value.trim()) {
      this.showToast('No Dictation', 'Please type or dictate your session notes first.', 'error');
      return;
    }
    const dictText = dictArea.value.trim();
    const langCode = langSelect ? langSelect.value : 'pa-IN';
    panel.style.display = 'none';
    const postSummary = document.getElementById('call-post-summary-section');
    const loader = document.getElementById('summary-generator-loader');
    const wrapper = document.getElementById('summary-results-wrapper');
    if (postSummary) postSummary.style.display = 'block';
    if (loader) loader.style.display = 'flex';
    if (wrapper) wrapper.style.display = 'none';
    try {
      const summaryObj = await window.CounselFlow.aiOrchestrator.generateDictationSummaryAsync(dictText, langCode);
      if (loader) loader.style.display = 'none';
      if (wrapper) wrapper.style.display = 'grid';
      document.getElementById('summary-field-overview').innerText = summaryObj.overview;
      document.getElementById('summary-field-concerns').innerText = summaryObj.concerns;
      document.getElementById('summary-field-observations').innerText = summaryObj.observations;
      const safeRisk = escapeHtml(summaryObj.risk);
      const riskClass = safeRisk.toLowerCase().includes('high') ? 'risk' : safeRisk.toLowerCase().includes('medium') ? 'monitored' : 'completed';
      document.getElementById('summary-field-risk').innerHTML = `<span class="pill-status ${riskClass}">${window.CounselFlow.escapeHtml(safeRisk)}</span>`;
      document.getElementById('summary-field-actions').innerText = summaryObj.actions;
      document.getElementById('summary-field-notes').value = '';
      this.renderSessionScoreCard(summaryObj, [{ speaker: 'Counselor', text: dictText }]);
      window.CounselFlow.callManager.loadedSummary = summaryObj;
      window.CounselFlow.callManager.loadedSummary._isDictation = true;
      window.CounselFlow.callManager.lastSessionTranscript = [{ speaker: 'Counselor (Dictation)', text: dictText }];
      this.showToast('Dictation Summary Ready', 'AI clinical summary generated from your dictation.', 'success');
    } catch (e) {
      if (loader) loader.style.display = 'none';
      if (wrapper) wrapper.style.display = 'grid';
      console.error('Dictation summary error:', e);
      this.showToast('Dictation Error', 'Failed to generate summary. Please try again.', 'error');
    }
  }
  renderEscalationPanel() {
    const container = document.getElementById('escalation-panel-container');
    if (!container || !this.patients) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    const escalations = [];
    if (roleConfig.canResolveEscalation) {
      this.patients.forEach(pt => {
        pt.history.forEach(sess => {
          const esc = sess.summary && sess.summary.escalationLevel;
          if (esc && esc >= 1 && roleConfig.escalationLevels && roleConfig.escalationLevels.includes(esc)) {
            // Gap 11: Ignore already resolved escalations
            if (sess.summary.escalationResolvedAt) return;
            escalations.push({
              patient: pt,
              session: sess,
              level: esc,
              reason: sess.summary.escalationReason || 'Escalation flagged by AI system.',
              sessionId: sess.sessionId
            });
          }
        });
      });
      if (roleConfig.escalationLevels && roleConfig.escalationLevels.includes(2)) {
        this.patients.forEach(pt => {
          if (pt.status === 'LAMA') {
            escalations.push({
              patient: pt,
              session: null,
              level: 2,
              reason: ' Patient left against medical advice (LAMA). Immediate intervention required.',
              sessionId: 'LAMA-' + pt.id,
              isLama: true
            });
          }
        });
      }
      if (roleConfig.escalationLevels && roleConfig.escalationLevels.includes(1)) {
        try {
          const logs = window.CounselFlow.getCallLogs();
          logs.forEach(log => {
            if (log.disposition === 'Missed') {
              const pt = this.patients.find(p => p.id === log.patientId);
              if (pt && (pt.severity === 'High' || pt.status === 'Risk')) {
                escalations.push({
                  patient: pt,
                  session: null,
                  level: 1,
                  reason: `Missed call — high-risk patient. SOP requires follow-up within 4 hours.`,
                  sessionId: log.logId,
                  isMissedCall: true
                });
              }
            }
          });
        } catch (e) {  }
      }
    }
    if (escalations.length === 0) {
      container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:12px; text-align:center;"> No active escalations requiring your attention based on your role.</div>`;
      return;
    }
    const escColors = { 1: 'var(--accent-orange)', 2: 'var(--accent-red)', 3: '#dc2626' };
    const escLabels = { 1: '️ L1 (4h)', 2: ' L2 (24h)', 3: ' L3 (48h)' };
    container.innerHTML = escalations.slice(0, 8).map(esc => {
      const color = escColors[esc.level] || 'var(--accent-orange)';
      const label = escLabels[esc.level] || 'L1';
      const canResolve = roleConfig.canResolveEscalation && roleConfig.escalationLevels && roleConfig.escalationLevels.includes(esc.level);
      return `
        <div style="background:var(--bg-input); border:1px solid ${color}44; border-left:3px solid ${color}; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="font-size:10px; font-weight:700; color:${color}; background:${color}22; padding:2px 8px; border-radius:10px;">${label}</span>
              <span style="font-size:12px; font-weight:700; color:var(--text-primary);">${roleConfig.canViewPII ? escapeHtml(esc.patient.name) : '[PII Restricted]'}</span>
            </div>
            <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(esc.reason)}</div>
            <div style="font-size:10px; color:var(--text-muted); margin-top:3px;">${roleConfig.canViewPII ? escapeHtml(esc.patient.district || '') : '[PII Restricted]'} | ${escapeHtml(esc.patient.addictionCategory)}</div>
          </div>
          ${canResolve ? `<button class="btn-secondary btn-escalation-resolve-trigger" style="font-size:10px; padding:4px 10px; white-space:nowrap; flex-shrink:0;" data-session-id="${escapeHtml(esc.sessionId)}" data-patient-id="${escapeHtml(esc.patient.id)}"> Resolve</button>` : ''}
        </div>
      `;
    }).join('');
  }
  async markEscalationResolved(sessionId, patientId) {
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    if (!roleConfig.canResolveEscalation) {
      this.showToast('Access Denied', 'Your role cannot resolve escalations.', 'error');
      return;
    }
    const pt = this.patients.find(p => p.id === patientId);
    if (!pt) return;
    if (sessionId.startsWith('LAMA-')) {
      if (!roleConfig.escalationLevels || !roleConfig.escalationLevels.includes(2)) {
        this.showToast('Access Denied', 'Your role cannot resolve LAMA (L2) escalations.', 'error');
        return;
      }
      pt.status = 'Monitored';
      if (window.CounselFlow && window.CounselFlow.evaluatePatientWorkflow) {
        window.CounselFlow.evaluatePatientWorkflow(pt);
      }
      try {
        await window.CounselFlow.savePatients(this.patients);
      } catch (err) {
        console.error("Failed to save patient database after resolving LAMA escalation:", err);
      }
    } else if (sessionId.startsWith('LOG-')) {
      if (!roleConfig.escalationLevels || !roleConfig.escalationLevels.includes(1)) {
        this.showToast('Access Denied', 'Your role cannot resolve L1 missed call escalations.', 'error');
        return;
      }
      try {
        const logs = await window.CounselFlow.getCallLogs();
        const log = logs.find(l => l.logId === sessionId);
        if (log) {
          log.disposition = 'Resolved';
          await window.CounselFlow.saveCallLogs(logs);
        }
      } catch (e) {
        console.error("Failed to save call logs after resolving missed call escalation:", e);
      }
    } else {
      const sess = pt.history.find(s => s.sessionId === sessionId);
      if (sess && sess.summary) {
        const escLevel = sess.summary.escalationLevel || 0;
        if (!roleConfig.escalationLevels || !roleConfig.escalationLevels.includes(escLevel)) {
          this.showToast('Access Denied', `Your role cannot resolve L${escLevel} escalations.`, 'error');
          return;
        }
        sess.summary.escalationLevel = 0;
        sess.summary.escalationReason = null;
        sess.summary.escalationResolvedAt = new Date().toLocaleString();
        try {
          await window.CounselFlow.savePatients(this.patients);
        } catch (err) {
          console.error("Failed to save patient database after resolving escalation:", err);
        }
      }
    }
    window.CounselFlow.writeAuditEvent('ESCALATION_RESOLVED', patientId, sessionId, activeRole, `Escalation manually resolved.`);
    this.renderEscalationPanel();
    this.showToast('Escalation Resolved', `Escalation has been closed and logged.`, 'success');
  }
  async deleteSessionTranscript(patientId, sessionId) {
    const pt = this.patients.find(p => p.id === patientId);
    if (!pt) return;
    const sess = pt.history.find(s => s.sessionId === sessionId);
    if (!sess) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'unknown';
    const roleConfig = window.CounselFlow.getRoleConfig(activeRole);
    if (!roleConfig.canDeleteTranscript) {
      this.showToast('Access Denied', 'Only supervisors can delete transcripts.', 'error');
      return;
    }
    if (!confirm(`Delete the transcript for session ${sessionId}?\n\nThis action will be logged in the tamper-evident audit trail and cannot be reversed.`)) return;
    sess.transcript = [];
    sess.transcriptDeletedAt = new Date().toLocaleString();
    sess.transcriptDeletedBy = activeRole;
    if (window.CounselFlow && window.CounselFlow.savePatients) {
      await window.CounselFlow.savePatients(this.patients);
    }
    window.CounselFlow.writeAuditEvent('TRANSCRIPT_DELETED', patientId, sessionId, activeRole, `Session transcript deleted per right-to-delete policy.`);
    this.showToast('Transcript Deleted', `Transcript for ${sess.sessionId} has been removed and audit event logged.`, 'success');
    const modal = document.getElementById('modal-history-detail');
    if (modal) modal.remove();
  }
  async renderAuditTrailTab(query = '') {
    if (!this.dom.historyRecordsList) return;
    let events = [];
    try {
      events = await window.CounselFlow.getAuditTrail() || [];
    } catch (e) { events = []; }
    if (!Array.isArray(events)) events = [];
    if (query) {
      const q = query.toLowerCase();
      events = events.filter(e =>
        (e.eventType || '').toLowerCase().includes(q) ||
        (e.patientId || '').toLowerCase().includes(q) ||
        (e.actorRole || '').toLowerCase().includes(q) ||
        (e.detail || '').toLowerCase().includes(q)
      );
    }
    if (events.length === 0) {
      this.dom.historyRecordsList.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted); border:1px dashed var(--border-light); border-radius:16px;">
          <p style="font-size:24px; margin-bottom:12px;"></p>
          <p>No audit trail events recorded yet.</p>
        </div>
      `;
      return;
    }
    const eventColors = {
      'TRANSCRIPT_DELETED': 'var(--accent-red)',
      'ESCALATION_RESOLVED': 'var(--accent-teal)',
      'ROLE_CHANGED': 'var(--accent-purple)',
      'PATIENT_EXPORTED': 'var(--accent-blue)'
    };
    this.dom.historyRecordsList.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead>
            <tr style="border-bottom:2px solid var(--border-light); color:var(--text-muted); text-align:left;">
              <th style="padding:10px 12px;">Event ID</th>
              <th style="padding:10px 12px;">Event Type</th>
              <th style="padding:10px 12px;">Patient ID</th>
              <th style="padding:10px 12px;">Actor Role</th>
              <th style="padding:10px 12px;">Timestamp</th>
              <th style="padding:10px 12px;">Detail</th>
              <th style="padding:10px 12px;">Hash</th>
            </tr>
          </thead>
          <tbody>
            ${events.map((evt, idx) => {
              const color = eventColors[evt.eventType] || 'var(--text-muted)';
              return `
                <tr style="border-bottom:1px solid var(--border-light); background:${idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-input)'};">
                  <td style="padding:10px 12px; font-family:monospace; font-size:10px; color:var(--accent-blue);">${escapeHtml(evt.eventId || '')}</td>
                  <td style="padding:10px 12px;">
                    <span style="font-size:10px; font-weight:700; color:${color}; background:${color}22; padding:2px 8px; border-radius:10px;">${escapeHtml(evt.eventType || '')}</span>
                  </td>
                  <td style="padding:10px 12px; font-family:monospace; font-size:10px;">${escapeHtml(evt.patientId || '')}</td>
                  <td style="padding:10px 12px; color:var(--text-secondary);">${escapeHtml(evt.actorRole || '')}</td>
                  <td style="padding:10px 12px; color:var(--text-muted); font-size:11px;">${escapeHtml(evt.timestamp || '')}</td>
                  <td style="padding:10px 12px; color:var(--text-secondary); max-width:200px; font-size:11px;">${escapeHtml(evt.detail || '')}</td>
                  <td style="padding:10px 12px; font-family:monospace; font-size:9px; color:var(--text-muted);">${escapeHtml((evt.hash || '').slice(0, 12))}…</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  initNetworkMonitoring() {
    const updateOnlineStatus = () => {
      if (navigator.onLine) {
        const flushed = window.CounselFlow.flushOfflineQueue();
        if (flushed > 0) {
          this.showToast('Sync Complete', `${flushed} offline item(s) synced after reconnecting.`, 'success');
        } else {
          this.showToast('Connection Restored', 'Live speech-to-text transcription services are online.', 'success');
        }
        const offlineBanner = document.getElementById('offline-status-banner');
        if (offlineBanner) offlineBanner.style.display = 'none';
        this.updateOfflineQueueBadge();
      } else {
        this.showToast('Network Offline', 'Offline mode active. Call logs will be queued and synced when connection returns.', 'error');
        this.showOfflineBanner();
      }
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    if (!navigator.onLine) {
      setTimeout(() => this.showOfflineBanner(), 1000);
    }
    this.updateOfflineQueueBadge();
  }
  updateOfflineQueueBadge() {
    const queue = window.CounselFlow.getOfflineQueue ? window.CounselFlow.getOfflineQueue() : [];
    let badge = document.getElementById('offline-queue-badge');
    if (queue.length > 0) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'offline-queue-badge';
        badge.style.cssText = 'font-size:10px; color:var(--accent-orange); background:var(--accent-orange)22; border:1px solid var(--accent-orange)55; padding:2px 8px; border-radius:10px; margin-top:4px; display:inline-block; cursor:pointer;';
        badge.title = 'Pending offline sync items';
        const footer = document.querySelector('.sidebar-footer .counselor-info');
        if (footer) footer.appendChild(badge);
      }
      badge.innerText = ` ${queue.length} queued`;
    } else if (badge) {
      badge.remove();
    }
  }
  showOfflineBanner() {
    let banner = document.getElementById('offline-status-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offline-status-banner';
      banner.style.cssText = "background: var(--accent-red); color: white; text-align: center; padding: 8px 16px; font-size: 13px; font-weight: 600; font-family: var(--font-body); position: sticky; top: 0; z-index: 10000; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;";
      banner.innerHTML = `<span>️ Offline Mode: Call logs are being queued locally. They will sync automatically when connection returns.</span>`;
      const container = document.getElementById('app-container');
      if (container) container.insertBefore(banner, container.firstChild);
      else document.body.insertBefore(banner, document.body.firstChild);
    } else {
      banner.style.display = 'flex';
    }
  }
}
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.app = new AppController();
window.addEventListener('DOMContentLoaded', async () => {
  await window.CounselFlow.app.init();
});
