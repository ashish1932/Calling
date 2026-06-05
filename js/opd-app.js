document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const previewSection = document.getElementById('preview-section');
  const previewTbody = document.getElementById('preview-tbody');
  const recordCount = document.getElementById('record-count');
  const btnSync = document.getElementById('btn-sync-data');
  const opdAlerts = document.getElementById('opd-alerts');
  
  let parsedData = [];

  // API config
  const API_URL = 'http://localhost:5001/api';
  
  const showAlert = (msg, isError = false) => {
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
    previewTbody.innerHTML = '';
    
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
      showAlert(`Successfully parsed ${parsedData.length} records. Please verify and sync.`);
    } else {
      showAlert('No valid records found. Ensure the "Patient ID" column exists.', true);
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
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(parsedData)
      });
      
      const result = await response.json();
      
      if (response.ok) {
        showAlert(`Successfully synced ${result.processed} records to the database!`);
        previewSection.style.display = 'none';
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
});
