const translations = {
  en: {
    dashboard: "Dashboard",
    patients: "Patients",
    clinicalWorkflow: "Clinical Workflow",
    activeSession: "Active Session",
    sessionHistory: "Session History",
    analytics: "Analytics",
    settings: "Settings",
    profilesManagement: "Profiles Management",
    opdDispensation: "OPD Dispensation",
    patientQueue: "Patient Queue",
    allPatients: "All Patients",
    dispenseMedicine: "Dispense Medicine",
    inventory: "Inventory",
    bulkUpload: "Bulk Upload",
    searchPlaceholder: "Search by name, phone or addiction category...",
    addProfile: "+ Add Profile",
    totalSessions: "Total Sessions",
    activePatients: "Active Patients",
    avgCallDuration: "Avg Call Duration",
    counselorScore: "Counselor Score"
  },
  hi: {
    dashboard: "डैशबोर्ड",
    patients: "मरीज़",
    clinicalWorkflow: "नैदानिक ​​कार्यप्रवाह",
    activeSession: "सक्रिय सत्र",
    sessionHistory: "सत्र इतिहास",
    analytics: "एनालिटिक्स",
    settings: "सेटिंग्स",
    profilesManagement: "प्रोफ़ाइल प्रबंधन",
    opdDispensation: "ओपीडी वितरण",
    patientQueue: "मरीज़ कतार",
    allPatients: "सभी मरीज़",
    dispenseMedicine: "दवा वितरण",
    inventory: "इन्वेंटरी",
    bulkUpload: "थोक अपलोड",
    searchPlaceholder: "नाम, फोन या लत श्रेणी से खोजें...",
    addProfile: "+ प्रोफ़ाइल जोड़ें",
    totalSessions: "कुल सत्र",
    activePatients: "सक्रिय मरीज़",
    avgCallDuration: "औसत कॉल अवधि",
    counselorScore: "काउंसलर स्कोर"
  },
  pa: {
    dashboard: "ਡੈਸ਼ਬੋਰਡ",
    patients: "ਮਰੀਜ਼",
    clinicalWorkflow: "ਕਲੀਨਿਕਲ ਵਰਕਫਲੋ",
    activeSession: "ਸਰਗਰਮ ਸੈਸ਼ਨ",
    sessionHistory: "ਸੈਸ਼ਨ ਇਤਿਹਾਸ",
    analytics: "ਵਿਸ਼ਲੇਸ਼ਣ",
    settings: "ਸੈਟਿੰਗਾਂ",
    profilesManagement: "ਪ੍ਰੋਫਾਈਲ ਪ੍ਰਬੰਧਨ",
    opdDispensation: "ਓਪੀਡੀ ਵੰਡ",
    patientQueue: "ਮਰੀਜ਼ ਕਤਾਰ",
    allPatients: "ਸਾਰੇ ਮਰੀਜ਼",
    dispenseMedicine: "ਦਵਾਈ ਵੰਡ",
    inventory: "ਵਸਤੂ ਸੂਚੀ",
    bulkUpload: "ਥੋਕ ਅੱਪਲੋਡ",
    searchPlaceholder: "ਨਾਮ, ਫ਼ੋਨ ਜਾਂ ਨਸ਼ਾ ਸ਼੍ਰੇਣੀ ਦੁਆਰਾ ਖੋਜੋ...",
    addProfile: "+ ਪ੍ਰੋਫਾਈਲ ਸ਼ਾਮਲ ਕਰੋ",
    totalSessions: "ਕੁੱਲ ਸੈਸ਼ਨ",
    activePatients: "ਸਰਗਰਮ ਮਰੀਜ਼",
    avgCallDuration: "ਔਸਤ ਕਾਲ ਅਵਧੀ",
    counselorScore: "ਕੌਂਸਲਰ ਸਕੋਰ"
  }
};

let currentLang = (window.CounselFlow && typeof window.CounselFlow.safeGetItem === 'function')
  ? (window.CounselFlow.safeGetItem('appLang') || 'en')
  : (() => { try { return localStorage.getItem('appLang') || 'en'; } catch(e) { return 'en'; } })();

function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
    if (window.CounselFlow && typeof window.CounselFlow.safeSetItem === 'function') {
      window.CounselFlow.safeSetItem('appLang', lang);
    } else {
      try { localStorage.setItem('appLang', lang); } catch(e) {}
    }
    applyTranslations();
  }
}

function applyTranslations() {
  const t = translations[currentLang];
  
  // Update sidebar
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    const textNode = Array.from(item.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
    if (textNode) {
      const key = item.getAttribute('data-i18n-key');
      if (key && t[key]) {
        textNode.textContent = ' ' + t[key];
      }
    }
  });

  // Update specific elements if they have data-i18n-key
  document.querySelectorAll('[data-i18n-key]').forEach(el => {
    const key = el.getAttribute('data-i18n-key');
    if (t[key]) {
      if (el.tagName === 'INPUT' && el.type === 'text') {
        el.placeholder = t[key];
      } else {
        el.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
             node.textContent = ' ' + t[key];
          }
        });
      }
    }
  });
}

// Add a language toggle UI to the header dynamically
document.addEventListener('DOMContentLoaded', () => {
  const headerActions = document.querySelector('.header-actions');
  if (headerActions) {
    const langSelect = document.createElement('select');
    langSelect.id = 'ui-lang-select';
    langSelect.style.cssText = 'background:var(--bg-input); border:1px solid var(--border-light); color:var(--text-primary); padding:4px 8px; border-radius:6px; font-size:12px; margin-right:8px; cursor:pointer;';
    
    langSelect.innerHTML = `
      <option value="en" ${currentLang === 'en' ? 'selected' : ''}>English</option>
      <option value="hi" ${currentLang === 'hi' ? 'selected' : ''}>हिंदी</option>
      <option value="pa" ${currentLang === 'pa' ? 'selected' : ''}>ਪੰਜਾਬੀ</option>
    `;
    
    langSelect.addEventListener('change', (e) => {
      setLanguage(e.target.value);
    });
    
    headerActions.prepend(langSelect);
  }
  
  applyTranslations();
});
