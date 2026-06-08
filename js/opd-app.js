document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'http://localhost:5001/api';
  
  // Tab Navigation
  const navItems = document.querySelectorAll('.nav-item-opd');
  const tabContents = document.querySelectorAll('.tab-content-opd');
  const pageTitle = document.getElementById('page-title-text') || document.getElementById('header-title');
  const pageSubtitle = document.getElementById('page-subtitle-text') || document.getElementById('header-subtitle');

  const titles = {
    'queue': { title: 'Patient Queue', sub: 'Manage today\'s scheduled visits' },
    'all-patients': { title: 'All Patients', sub: 'View all active patients' },
    'dispense': { title: 'Dispense Medicine', sub: 'Verify patient and dispense medications' },
    'inventory': { title: 'Medicine Inventory', sub: 'Track stock and expiry dates' },
    'upload': { title: 'Bulk Upload', sub: 'Upload medication dispensation sheets' }
  };

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Update Active Tab
      navItems.forEach(nav => {
        nav.classList.remove('active');
        // Let CSS handle the active state in sidebar
      });
      item.classList.add('active');

      const targetTab = item.getAttribute('data-tab');
      
      // Update Titles
      pageTitle.textContent = titles[targetTab].title;
      pageSubtitle.textContent = titles[targetTab].sub;

      // Show target content
      tabContents.forEach(tab => {
        tab.style.display = tab.id === `tab-${targetTab}` ? 'block' : 'none';
      });

      // Load data for specific tabs
      if (targetTab === 'queue') loadQueue();
      if (targetTab === 'all-patients') loadAllPatients();
      if (targetTab === 'inventory') loadInventory();
      if (targetTab === 'dispense') {
        loadMedicinesForDropdown();
        loadHistory();
      }
    });
  });

  // Global Alert Helper
  const opdAlerts = document.getElementById('opd-alerts');
  const showAlert = (msg, isError = false) => {
    opdAlerts.innerHTML = `
      <div style="padding: 16px; border-radius: 8px; background: ${isError ? 'rgba(220,38,38,0.1)' : 'rgba(5,205,153,0.1)'}; color: ${isError ? 'var(--accent-red)' : 'var(--accent-green)'}; border: 1px solid ${isError ? 'var(--accent-red)' : 'var(--accent-green)'}; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        ${msg}
      </div>
    `;
    setTimeout(() => { opdAlerts.innerHTML = ''; }, 5000);
  };

  const getAuthHeaders = () => {
    return {
      'Content-Type': 'application/json'
    };
  };

  // ==========================
  // HEADER STATS
  // ==========================
  const loadStats = async () => {
    try {
      const res = await fetch(`${API_URL}/opd/stats/today`, { headers: getAuthHeaders() });
      if (res.ok) {
        const stats = await res.json();
        const statToday = document.getElementById('stat-opd-today');
        const statDispensed = document.getElementById('stat-opd-dispensed');
        const statPending = document.getElementById('stat-opd-pending');
        const statDefaulters = document.getElementById('stat-opd-defaulters');
        
        if(statToday) statToday.textContent = stats.totalVisits;
        if(statDispensed) statDispensed.textContent = stats.dispensed;
        if(statPending) statPending.textContent = stats.pending;
        if(statDefaulters) statDefaulters.textContent = stats.defaulters;
      }
    } catch (err) {
      console.warn("Failed to load header stats", err);
    }
  };

  // Run on load and periodically
  loadStats();
  setInterval(loadStats, 60000);

  // ==========================
  // QUEUE TAB LOGIC
  // ==========================
  let currentQueue = [];
  let currentQueueFilter = 'all';

  const btnOpdSearch = document.getElementById('btn-opd-search');
  if (btnOpdSearch) {
    btnOpdSearch.addEventListener('click', async () => {
      const query = document.getElementById('opd-patient-search').value.trim();
      if (!query) return;
      
      try {
        const res = await fetch(`${API_URL}/opd/patients/${query}`, { headers: getAuthHeaders() });
        const resultDiv = document.getElementById('opd-patient-result');
        if (res.ok) {
          const patients = await res.json();
          let html = '';
          // Backend returns array of patients now
          const patientArray = Array.isArray(patients) ? patients : [patients];
          
          patientArray.forEach(p => {
            html += `
              <div style="margin-top: 10px; padding: 15px; background: rgba(5,205,153,0.1); border-radius: 8px; border: 1px solid var(--accent-green);">
                <div style="font-weight: 600;">${p.name} (${p.id})</div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 5px;">Phone: ${p.phone} | Status: ${p.status}</div>
                <button class="btn-primary btn-dispense-direct" data-patid="${p.id}" style="margin-top: 10px; padding: 6px 12px; font-size: 12px;">Dispense Medication</button>
              </div>
            `;
          });
          resultDiv.innerHTML = html;
          
          // Rebind dispense button
          const dispenseBtns = resultDiv.querySelectorAll('.btn-dispense-direct');
          dispenseBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
              const patId = e.target.getAttribute('data-patid');
              document.querySelector('[data-tab="dispense"]').click();
              document.getElementById('dispense-patient-id').value = patId;
              document.getElementById('btn-verify-patient').click();
            });
          });
        } else {
          resultDiv.innerHTML = `<div style="margin-top: 10px; padding: 10px; color: var(--accent-red);">Patient not found.</div>`;
        }
      } catch (err) {
        console.error(err);
      }
    });
  }

  // Queue Filters
  const loadAllPatients = async () => {
    const tbody = document.getElementById('opd-all-patients-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" style="padding: 16px; text-align: center; color: var(--text-muted);">Loading...</td></tr>';
    
    try {
      const res = await fetch(`${API_URL}/patients`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load patients');
      const patients = await res.json();
      
      if (patients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 16px; text-align: center; color: var(--text-muted);">No patients found</td></tr>';
        return;
      }
      
      tbody.innerHTML = '';
      patients.forEach(p => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';
        tr.innerHTML = `
          <td style="padding: 16px; font-family: monospace;">${p.id}</td>
          <td style="padding: 16px; font-weight: 500;">${p.name}</td>
          <td style="padding: 16px;">${p.phone || 'N/A'}</td>
          <td style="padding: 16px;">
            <span style="padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(5,205,153,0.1); color: var(--accent-green);">
              ${p.status || 'Active'}
            </span>
          </td>
          <td style="padding: 16px; color: var(--text-secondary);">${p.nextOpdVisitDate || 'Not Scheduled'}</td>
          <td style="padding: 16px;">
            <button class="btn-primary btn-dispense-direct" data-patid="${p.id}" style="padding: 6px 12px; font-size: 12px;">Dispense</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind dispense buttons
      tbody.querySelectorAll('.btn-dispense-direct').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const patId = e.target.getAttribute('data-patid');
          document.querySelector('[data-tab="dispense"]').click();
          document.getElementById('dispense-patient-id').value = patId;
          document.getElementById('btn-verify-patient').click();
        });
      });
      
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 16px; text-align: center; color: var(--accent-red);">${err.message}</td></tr>`;
    }
  };

  const bindQueueFilters = () => {
    const btnAll = document.getElementById('filter-all');
    const btnPending = document.getElementById('filter-pending');
    const btnDispensed = document.getElementById('filter-dispensed');
    
    if (!btnAll || !btnPending || !btnDispensed) return;
    
    const setFilter = (filter, activeBtn) => {
      currentQueueFilter = filter;
      [btnAll, btnPending, btnDispensed].forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-secondary');
      });
      activeBtn.classList.remove('btn-secondary');
      activeBtn.classList.add('btn-primary');
      renderQueue();
    };
    
    btnAll.addEventListener('click', () => setFilter('all', btnAll));
    btnPending.addEventListener('click', () => setFilter('pending', btnPending));
    btnDispensed.addEventListener('click', () => setFilter('dispensed', btnDispensed));
  };
  bindQueueFilters();

  const renderQueue = () => {
    const tbody = document.getElementById('queue-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let filtered = currentQueue;
    if (currentQueueFilter === 'pending') {
      filtered = currentQueue.filter(v => v.status === 'Waiting' || v.status === 'In Progress');
    } else if (currentQueueFilter === 'dispensed') {
      filtered = currentQueue.filter(v => v.status === 'Completed');
    }
    
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">No patients in queue match the filter.</td></tr>';
      return;
    }
    
    filtered.forEach(visit => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-light)';
      
      let statusColor = 'var(--text-secondary)';
      if (visit.status === 'Waiting') statusColor = 'var(--accent-red)';
      if (visit.status === 'In Progress') statusColor = 'var(--accent-blue)';
      if (visit.status === 'Completed') statusColor = 'var(--accent-green)';

      tr.innerHTML = `
        <td style="padding: 16px;">
          <div style="font-weight: 500;">${visit.time || 'Scheduled'}</div>
          <div style="font-size: 12px; color: ${statusColor}; font-weight: 600; margin-top: 4px;">${visit.status}</div>
        </td>
        <td style="padding: 16px;">
          <div style="font-weight: 600;">${visit.patientName}</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; font-family: monospace;">${visit.patientId}</div>
        </td>
        <td style="padding: 16px;">
          <span style="padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: ${visit.isWalkIn ? 'rgba(255,152,0,0.1)' : 'rgba(5,205,153,0.1)'}; color: ${visit.isWalkIn ? '#ff9800' : 'var(--accent-green)'};">
            ${visit.isWalkIn ? 'Walk-in' : 'Scheduled'}
          </span>
        </td>
        <td style="padding: 16px; text-align: right;">
          ${visit.status !== 'Completed' ? `<button class="btn-secondary btn-update-status" data-id="${visit.visitId}" data-status="In Progress" style="padding: 6px 12px; font-size: 12px;">Call</button>` : ''}
          <button class="btn-secondary btn-dispense-direct" data-patid="${visit.patientId}" style="padding: 6px 12px; font-size: 12px; background: rgba(5,205,153,0.1); color: var(--accent-green); border-color: var(--accent-green);">Dispense</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Attach event listeners for status updates
    document.querySelectorAll('.btn-update-status').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const visitId = e.target.getAttribute('data-id');
        const status = e.target.getAttribute('data-status');
        await updateVisitStatus(visitId, status);
      });
    });

    document.querySelectorAll('.btn-dispense-direct').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const patId = e.target.getAttribute('data-patid');
        // Switch to dispense tab and auto-fill
        document.querySelector('[data-tab="dispense"]').click();
        document.getElementById('dispense-patient-id').value = patId;
        document.getElementById('btn-verify-patient').click();
      });
    });
  };

  const loadQueue = async () => {
    try {
      const res = await fetch(`${API_URL}/opd/patients/today`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load queue');
      currentQueue = await res.json();
      renderQueue();
    } catch (err) {
      console.error(err);
      showAlert('Failed to load patient queue', true);
    }
  };

  const updateVisitStatus = async (visitId, status) => {
    try {
      const res = await fetch(`${API_URL}/opd/visit/${visitId}/status`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        showAlert(`Patient status updated to ${status}`);
        loadQueue();
      }
    } catch (err) {
      showAlert('Failed to update status', true);
    }
  };

  // Walk-in Modal Logic
  const walkinModal = document.getElementById('walkin-modal');
  document.getElementById('btn-walkin').addEventListener('click', () => {
    walkinModal.style.display = 'flex';
  });
  document.getElementById('btn-close-walkin').addEventListener('click', () => {
    walkinModal.style.display = 'none';
  });
  document.getElementById('walkin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      patientId: document.getElementById('walkin-id').value,
      name: document.getElementById('walkin-name').value,
      phone: document.getElementById('walkin-phone').value
    };
    try {
      const res = await fetch(`${API_URL}/opd/walkin`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        showAlert('Walk-in patient registered and added to queue');
        walkinModal.style.display = 'none';
        e.target.reset();
        loadQueue();
      } else {
        throw new Error('Failed to register walk-in');
      }
    } catch (err) {
      showAlert(err.message, true);
    }
  });


  // ==========================
  // DISPENSE TAB LOGIC
  // ==========================
  const btnVerifyPatient = document.getElementById('btn-verify-patient');
  const patientVerifyResult = document.getElementById('patient-verify-result');
  let currentVerifiedPatient = null;

  btnVerifyPatient.addEventListener('click', async () => {
    const id = document.getElementById('dispense-patient-id').value;
    if (!id) return;
    
    btnVerifyPatient.textContent = 'Verifying...';
    try {
      const res = await fetch(`${API_URL}/opd/verify`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ patientId: id })
      });
      const data = await res.json();
      
      if (res.ok && data.verified) {
        const patient = data.patient;
        currentVerifiedPatient = patient;
        patientVerifyResult.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 600; font-size: 16px;">${patient.name}</div>
              <div style="font-size: 13px; margin-top: 4px;">Phone: ${patient.phone || 'N/A'} | Category: ${patient.addictionCategory || 'N/A'}</div>
            </div>
            <div style="text-align: right;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-green);"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              <div style="font-size: 12px; font-weight: 600; margin-top: 4px; color: var(--accent-green);">Verified</div>
            </div>
          </div>
        `;
        patientVerifyResult.style.display = 'block';
      } else {
        patientVerifyResult.innerHTML = `<div style="color: var(--accent-red);">${data.error || 'Patient not found.'} If walk-in, please register first.</div>`;
        patientVerifyResult.style.display = 'block';
        currentVerifiedPatient = null;
      }
    } catch (err) {
      showAlert('Verification failed', true);
    } finally {
      btnVerifyPatient.textContent = 'Verify';
    }
  });

  const loadMedicinesForDropdown = async () => {
    try {
      const res = await fetch(`${API_URL}/opd/medicines`, { headers: getAuthHeaders() });
      const meds = await res.json();
      const select = document.getElementById('dispense-medicine');
      select.innerHTML = '<option value="">Select Medicine...</option>';
      meds.forEach(m => {
        select.innerHTML += `<option value="${m.id}">${m.name} (${m.stock} ${m.unit} left)</option>`;
      });
    } catch (err) {}
  };

  document.getElementById('btn-mock-signature').addEventListener('click', (e) => {
    e.target.style.display = 'none';
    document.getElementById('signature-status').style.display = 'block';
  });

  document.getElementById('dispense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentVerifiedPatient) {
      showAlert('Please verify a patient first', true);
      return;
    }

    const payload = {
      patientId: currentVerifiedPatient.id,
      medicineId: document.getElementById('dispense-medicine').value,
      quantity: parseInt(document.getElementById('dispense-qty').value),
      nextVisitDate: document.getElementById('dispense-next-visit').value,
      notes: document.getElementById('dispense-notes').value
    };

    const submitBtn = document.getElementById('btn-submit-dispense');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Dispensing...';

    try {
      const res = await fetch(`${API_URL}/opd/dispense`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showAlert('Medicine dispensed successfully!');
        e.target.reset();
        currentVerifiedPatient = null;
        patientVerifyResult.style.display = 'none';
        document.getElementById('btn-mock-signature').style.display = 'block';
        document.getElementById('signature-status').style.display = 'none';
        
        loadMedicinesForDropdown();
        loadHistory();
      } else {
        throw new Error(data.error || 'Failed to dispense');
      }
    } catch (err) {
      showAlert(err.message, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Complete Dispensing';
    }
  });

  const loadHistory = async () => {
     // Mocking recent history by fetching queue or patient history
     // Actually we don't have a global history endpoint, only /api/opd/logs/:patientId
     // For demo purposes, we will leave it empty unless we want to query a specific patient.
     const tbody = document.getElementById('history-tbody');
     if (currentVerifiedPatient) {
       try {
         const res = await fetch(`${API_URL}/opd/logs/${currentVerifiedPatient.id}`, { headers: getAuthHeaders() });
         const logs = await res.json();
         tbody.innerHTML = '';
         logs.forEach(log => {
           tbody.innerHTML += `
             <tr style="border-bottom: 1px solid var(--border-light);">
               <td style="padding: 16px;">${log.date}</td>
               <td style="padding: 16px; font-family: monospace;">${log.patientId}</td>
               <td style="padding: 16px; font-weight: 600;">${log.medicineName}</td>
               <td style="padding: 16px;">${log.quantity}</td>
               <td style="padding: 16px; color: var(--accent-blue);">${log.nextVisitDate || 'N/A'}</td>
             </tr>
           `;
         });
       } catch (e) {}
     } else {
       tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">Verify a patient to see their history</td></tr>';
     }
  };


  // ==========================
  // INVENTORY TAB LOGIC
  // ==========================
  const loadInventory = async () => {
    try {
      const res = await fetch(`${API_URL}/opd/medicines`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load inventory');
      const meds = await res.json();
      
      const tbody = document.getElementById('inventory-tbody');
      tbody.innerHTML = '';
      
      if (meds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">No medicines found in inventory.</td></tr>';
        return;
      }
      
      meds.forEach(med => {
        const isLowStock = med.stock <= (med.lowStockThreshold || 0);
        const isExpired = new Date(med.expiryDate) < new Date();
        
        let statusBadge = `<span style="padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(5,205,153,0.1); color: var(--accent-green);">In Stock</span>`;
        if (isExpired) {
          statusBadge = `<span style="padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(220,38,38,0.1); color: var(--accent-red);">Expired</span>`;
        } else if (isLowStock) {
          statusBadge = `<span style="padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: rgba(255,152,0,0.1); color: #ff9800;">Low Stock</span>`;
        }

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';
        tr.innerHTML = `
          <td style="padding: 16px; font-family: monospace;">${med.id}</td>
          <td style="padding: 16px; font-weight: 600;">${med.name}</td>
          <td style="padding: 16px; font-weight: bold; color: ${isLowStock ? 'var(--accent-red)' : 'inherit'};">${med.stock} <span style="font-weight: normal; color: var(--text-secondary); font-size: 12px;">${med.unit}</span></td>
          <td style="padding: 16px; color: ${isExpired ? 'var(--accent-red)' : 'inherit'};">${med.expiryDate}</td>
          <td style="padding: 16px; text-align: right;">${statusBadge}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      showAlert('Failed to load inventory', true);
    }
  };

  const medicineModal = document.getElementById('medicine-modal');
  document.getElementById('btn-add-medicine').addEventListener('click', () => {
    medicineModal.style.display = 'flex';
  });
  document.getElementById('btn-close-medicine').addEventListener('click', () => {
    medicineModal.style.display = 'none';
  });
  document.getElementById('medicine-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('med-name').value,
      stock: parseInt(document.getElementById('med-stock').value),
      unit: document.getElementById('med-unit').value,
      expiryDate: document.getElementById('med-expiry').value,
      lowStockThreshold: parseInt(document.getElementById('med-threshold').value)
    };
    try {
      const res = await fetch(`${API_URL}/opd/medicines`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        showAlert('Medicine added successfully');
        medicineModal.style.display = 'none';
        e.target.reset();
        loadInventory();
      } else {
        throw new Error('Failed to add medicine');
      }
    } catch (err) {
      showAlert(err.message, true);
    }
  });


  // ==========================
  // UPLOAD TAB LOGIC (Legacy)
  // ==========================
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const previewSection = document.getElementById('preview-section');
  const previewTbody = document.getElementById('preview-tbody');
  const recordCount = document.getElementById('record-count');
  const btnSync = document.getElementById('btn-sync-data');
  let parsedData = [];

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.background = 'rgba(67,24,255,0.05)'; });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.style.background = 'rgba(0,0,0,0.02)'; });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.background = 'rgba(0,0,0,0.02)';
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  const handleFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { raw: false });
        processExcelData(json);
      } catch (err) {
        showAlert('Error parsing Excel file.', true);
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const processExcelData = (rows) => {
    parsedData = [];
    previewTbody.innerHTML = '';
    
    if (!rows || rows.length === 0) {
      showAlert('The uploaded file is empty.', true);
      return;
    }
    
    rows.forEach(row => {
      const patientId = row['Patient ID'] || row['Patient_ID'] || row['PatientID'];
      const date = row['Date of Visit'] || row['Date'] || row['Visit Date'];
      const medicine = row['Medicine Given'] || row['Medicine'] || row['Drug'];
      const qty = row['Quantity'] || row['Qty'] || 0;
      const nextVisit = row['Next Scheduled Visit'] || row['Next Visit'] || row['NextVisit'];
      
      if (patientId) {
        parsedData.push({ patientId, date, medicineName: medicine, quantity: parseInt(qty) || 0, nextVisitDate: nextVisit || null });
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
    });
    
    if (parsedData.length > 0) {
      recordCount.textContent = parsedData.length;
      previewSection.style.display = 'block';
      showAlert(`Successfully parsed ${parsedData.length} records.`);
    } else {
      showAlert('No valid records found.', true);
      previewSection.style.display = 'none';
    }
  };
  
  btnSync.addEventListener('click', async () => {
    if (parsedData.length === 0) return;
    btnSync.disabled = true;
    btnSync.textContent = 'Syncing...';
    try {
      const response = await fetch(`${API_URL}/opd/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(parsedData)
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(`Successfully synced ${result.processed} records!`);
        previewSection.style.display = 'none';
        parsedData = [];
      } else {
        showAlert(result.error || 'Failed to sync data.', true);
      }
    } catch (err) {
      showAlert('Network error.', true);
    } finally {
      btnSync.disabled = false;
      btnSync.textContent = 'Confirm & Sync';
    }
  });

  // Initialize
  loadQueue();

});
