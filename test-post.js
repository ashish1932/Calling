const newPt = {
        id: `PT-${Math.floor(8000 + Math.random() * 999)}-${Date.now().toString(16).slice(-4)}`, 
        name: 'Test Patient',
        age: 30,
        gender: 'Male',
        phone: '1234567890',
        address: 'Test Address',
        district: 'Amritsar',
        counselorId: 'STAFF-003',
        assignedCounselor: 'Dr. Amanpreet Kaur',
        addictionCategory: 'Alcohol',
        ngoPartner: 'Test NGO',
        severity: 'Medium',
        status: "Active",
        progress: 10,
        admissionDate: '2026-06-08',
        clinicalStage: 1,
        checkpoints: { withdrawalStabilised: false, layer1And2Ready: false, familyPsychoedAttended: false, day30ReviewPassed: false },
        preferredLanguage: "hi-IN", 
        joinDate: '2026-06-08',
        lastSessionDate: "Never",
        cravingsIntensity: 5,
        recoveryPhase: "Stabilization (Month 1)",
        notes: "New profile created.",
        avatarColor: '#00f2fe',
        history: []
      };

fetch('http://localhost:5001/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify([newPt])
})
.then(r => r.json().then(data => ({status: r.status, data})))
.then(console.log)
.catch(console.error);
