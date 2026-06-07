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
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.getAttribute('data-screen') === screenId) {
        el.classList.add('active');
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
    if (!board) return;
    const activeRole = this.activeRole || window.CounselFlow.getActiveRole() || 'counsellor';
    const filteredPatients = this.getSecurityScopedPatients();
    const detoxPatients = filteredPatients.filter(p => (p.clinicalStage === 1 || p.clinicalStage === 2) && p.status !== 'Completed' && p.status !== 'LAMA');
    const stage3Patients = filteredPatients.filter(p => p.clinicalStage === 3 && p.status !== 'Completed' && p.status !== 'LAMA');
    const stage4Patients = filteredPatients.filter(p => p.clinicalStage === 4 && p.status !== 'Completed' && p.status !== 'LAMA');
    const stage5Patients = filteredPatients.filter(p => p.clinicalStage === 5 && p.status !== 'Completed' && p.status !== 'LAMA');
    const lamaPatients = filteredPatients.filter(p => p.status === 'LAMA' || p.clinicalStage === 0);
    const columns = [
      {
        id: 'detox',
        title: ' Detox & Clearance',
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
              <label class="workflow-check-item" style="opacity: ${canEdit ? '1' : '0.5'};">
                <input type="checkbox" class="chk-workflow-checkpoint" data-id="${pt.id}" data-field="withdrawalStabilised" ${wChecked} ${disabledAttr}>
                Withdrawal Stabilised
              </label>
              <label class="workflow-check-item" style="opacity: ${canEdit ? '1' : '0.5'};">
                <input type="checkbox" class="chk-workflow-checkpoint" data-id="${pt.id}" data-field="layer1And2Ready" ${lChecked} ${disabledAttr}>
                Layer 1+2 Ready
              </label>
            </div>
            ${(canEdit && pt.checkpoints?.withdrawalStabilised && pt.checkpoints?.layer1And2Ready) ? `
              <button class="workflow-action-btn primary btn-workflow-promote" data-id="${pt.id}" data-target-stage="3" style="margin-top:8px;">Request MO Clearance</button>
            ` : ''}
          `;
        }
      },
      {
        id: 'family',
        title: '‍‍‍ Family Activation',
        subtitle: 'Stage 3',
        count: stage3Patients.length,
        patients: stage3Patients,
        renderChecklist: (pt) => {
          const fChecked = pt.checkpoints?.familyPsychoedAttended ? 'checked' : '';
          const canEdit = ['spo', 'supervisor', 'ddrc'].includes(activeRole);
          const disabledAttr = canEdit ? '' : 'disabled';
          // Gap 5: Family Anchor Unavailable logic
          const anchorStatus = pt.familyAnchorStatus || 'pending';
          let anchorHtml = '';
          if (anchorStatus === 'unavailable') {
             anchorHtml = `<div style="font-size:10px; color:var(--accent-orange); margin-top:4px; font-weight:bold;">⚠️ No Family Anchor. Reference card issued.</div>`;
          } else if (canEdit && !pt.checkpoints?.familyPsychoedAttended) {
             anchorHtml = `<button class="workflow-action-btn secondary btn-workflow-no-family" data-id="${pt.id}" style="margin-top:4px; font-size:10px; border-color:var(--accent-orange); color:var(--accent-orange);">Mark No Family Anchor</button>`;
          }
          return `
            <div class="workflow-check-list">
              <label class="workflow-check-item" style="opacity: ${canEdit ? '1' : '0.5'};">
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
        title: ' 30-Day Bridge',
        subtitle: 'Stage 4',
        count: stage4Patients.length,
        patients: stage4Patients,
        renderChecklist: (pt) => {
          const bChecked = pt.checkpoints?.day30ReviewPassed ? 'checked' : '';
          const canEdit = ['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole);
          const canFail = ['spo', 'supervisor', 'ddrc'].includes(activeRole);
          const disabledAttr = canEdit ? '' : 'disabled';
          
          // Gap 1: Stage 4 Contact Frequency Tracker
          const contactsThisWeek = window.CounselFlow.getStage4ContactsThisWeek ? window.CounselFlow.getStage4ContactsThisWeek(pt) : 0;
          const contactAlert = contactsThisWeek < 3 ? `<div style="font-size:10px; color:var(--accent-red); margin-top:4px; font-weight:bold;">⚠️ Contacts this week: ${contactsThisWeek}/3 (L1 Alert)</div>` : `<div style="font-size:10px; color:var(--accent-teal); margin-top:4px;">Contacts this week: ${contactsThisWeek}/3</div>`;
          
          // Gap 6: NGO Partner Field
          const ngoHtml = pt.ngoPartner ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">NGO: ${escapeHtml(pt.ngoPartner)}</div>` : `<div style="font-size:10px; color:var(--accent-orange); margin-top:2px;">⚠️ No NGO Partner Assigned</div>`;
          
          return `
            <div class="workflow-check-list">
              ${contactAlert}
              ${ngoHtml}
              <label class="workflow-check-item" style="opacity: ${canEdit ? '1' : '0.5'}; margin-top:8px;">
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
        title: ' 90-Day Maintenance',
        subtitle: 'Stage 5',
        count: stage5Patients.length,
        patients: stage5Patients,
        renderChecklist: (pt) => {
          const day = window.CounselFlow.calculateTreatmentDay(pt.admissionDate);
          const canEdit = ['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole);
          
          // Gap 10: Step-down cadence indicator
          // Gap 3: Dual sign-off buttons
          const counselorSigned = pt.stage6SignoffCounsellor ? '✅' : '❌';
          const supervisorSigned = pt.stage6SignoffSupervisor ? '✅' : '❌';
          
          return `
            <div style="font-size:11px; color:var(--text-muted); background:var(--bg-card); padding:8px; border-radius:8px; border:1px solid var(--border-light); margin-bottom:8px;">
              Day ${day} on maintenance. Ready for closeout at Day 90.
              <div style="margin-top:4px; font-weight:bold; color:var(--accent-blue);">📉 Reduced Cadence: Weekly Calls</div>
            </div>
            ${(canEdit && day >= 90) ? `
              <div style="font-size:10px; margin-bottom:4px; color:var(--text-secondary);">Final Review Sign-offs:</div>
              <div style="display:flex; gap:4px; margin-bottom:8px;">
                <button class="workflow-action-btn secondary btn-workflow-signoff-counsellor" data-id="${pt.id}" style="font-size:9px; padding:4px;" ${pt.stage6SignoffCounsellor ? 'disabled' : ''}>Counsellor ${counselorSigned}</button>
                <button class="workflow-action-btn secondary btn-workflow-signoff-supervisor" data-id="${pt.id}" style="font-size:9px; padding:4px;" ${pt.stage6SignoffSupervisor ? 'disabled' : ''}>Supervisor ${supervisorSigned}</button>
              </div>
            ` : ''}
          `;
        }
      },
      {
        id: 'lama',
        title: ' LAMA Cases',
        subtitle: 'Stage 0 Discharge',
        count: lamaPatients.length,
        patients: lamaPatients,
        renderChecklist: (pt) => {
          const canEdit = ['spo', 'supervisor', 'ddrc', 'counsellor'].includes(activeRole);
          return `
            <div style="font-size:11px; color:var(--accent-red); background:rgba(220,38,38,0.05); padding:8px; border-radius:8px; border:1px solid rgba(220,38,38,0.2); margin-bottom:8px;">
              Left Against Medical Advice. Monitor safety-net protocols.
            </div>
            ${canEdit ? `
            <button class="workflow-action-btn secondary btn-workflow-re-enroll" data-id="${pt.id}" style="border-color:var(--accent-blue); color:var(--accent-blue); background:rgba(0,242,254,0.05);">Re-Enroll Patient</button>
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
          <div style="font-size:10px; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.02em;">${col.subtitle}</div>
          <div class="workflow-cards-container" style="display:flex; flex-direction:column; gap:12px;">
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
                      <h4 class="workflow-card-nav" style="cursor:pointer; text-decoration:underline;">${escapedName}</h4>
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
        if (!['counsellor', 'spo', 'supervisor'].includes(activeRole)) {
          this.showToast('Access Denied', 'Only the Tele-Counsellor can provide counsellor sign-off.', 'error');
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
    board.querySelectorAll('.workflow-card-nav').forEach(nav => {
      nav.addEventListener('click', async (e) => {
        const card = e.target.closest('.workflow-card');
        const id = card.getAttribute('data-id');
        await this.switchScreen('patients');
        const pt = this.patients.find(p => p.id === id);
        if (pt) {
          this.openPatientDetail(pt);
        }
      });
    });
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
            ${roleConfig.allowedScreens.includes('call-console') ? `
            <button class="btn-primary btn-call-trigger" data-patient-id="${escapedId}" style="background: var(--accent-red); font-size:12px; padding: 8px 16px;">
               Call Back Now
            </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
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
        ${roleConfig.allowedScreens.includes('call-console') ? `
        <div style="width:80px; flex-shrink:0; display:flex; align-items:center; justify-content:center;" role="cell">
          <button class="btn-primary btn-call-trigger" data-patient-id="${escapedId}" style="font-size:12px; padding:8px 16px;" aria-label="Call ${escapedName}"> Call</button>
        </div>` : '<div style="width:80px; flex-shrink:0;" role="cell"></div>'}
      </div>
    `;
  }
  openPatientDetail(patient) {
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
    const support = CREDS.filter(c => c.roleKey === 'ddrc' || c.roleKey === 'ditsu');
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
            <div class="login-title-glow" style="font-size:52px; margin-bottom:8px;"></div>
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
    this.switchScreen('dashboard');
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