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
  
  function getLocalCounselors() {
    let local = [];
    try {
      const stored = localStorage.getItem('counseling_counselors');
      if (stored) local = JSON.parse(stored);
    } catch(e) {}
    
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
  
  function saveLocalCounselor(data) {
     let local = [];
     try {
       const stored = localStorage.getItem('counseling_counselors');
       if (stored) local = JSON.parse(stored);
     } catch(e) {}
     
     const idx = local.findIndex(l => l.id === data.id);
     if (idx >= 0) local[idx] = data;
     else local.push(data);
     
     localStorage.setItem('counseling_counselors', JSON.stringify(local));
  }
  
  function deleteLocalCounselor(id) {
     let local = [];
     try {
       const stored = localStorage.getItem('counseling_counselors');
       if (stored) local = JSON.parse(stored);
     } catch(e) {}
     
     local = local.filter(l => l.id !== id);
     localStorage.setItem('counseling_counselors', JSON.stringify(local));
  }

  function renderUI() {
     updateExportButton();
     if (currentTab === 'patients') renderPatientsProfileUI();
     else renderCounselorsProfileUI();
  }

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
    let counselors = getLocalCounselors();

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

  container.addEventListener('click', (e) => {
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
      const c = getLocalCounselors().find(x => x.id === id);
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
         deleteLocalCounselor(id);
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
       data.id = data.staffId || generateId('C');
    }
    
    saveLocalCounselor(data);
    window.CounselFlow.writeAuditEvent('COUNSELOR_PROFILE_UPDATED', data.id, 'N/A', getActiveRole(), 'Updated counselor profile via Profiles Management');
    
    document.getElementById('counselor-form-modal').style.display = 'none';
    document.getElementById('counselor-overlay').style.display = 'none';
    renderUI();
  });
});
