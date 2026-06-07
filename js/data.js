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
      return window.localStorage.getItem("counseling_ai_provider") || "groq";
    } catch (e) {
      return "groq";
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
  if (typeof resource === 'string' && resource.includes(API_BASE)) {
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
  return originalFetch(resource, config);
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
      await fetch(`${API_BASE}/patients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(patients)
      });
    } catch (err) {
      console.error("Failed to sync patients to backend:", err);
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
