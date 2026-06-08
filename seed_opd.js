const { Patient, Medicine, OpdVisit } = require('./server/models');
const mongoose = require('./server/node_modules/mongoose');

const MONGO_URI = 'mongodb://localhost:27017/counselflow';

const seedData = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    // 1. Seed Medicines
    await Medicine.deleteMany({});
    const medicines = [
      { id: 'MED-001', name: 'Buprenorphine', stock: 1200, unit: 'Tablets', expiryDate: '2026-12-01', lowStockThreshold: 100 },
      { id: 'MED-002', name: 'Methadone', stock: 450, unit: 'Bottles', expiryDate: '2027-05-15', lowStockThreshold: 50 },
      { id: 'MED-003', name: 'Naloxone', stock: 300, unit: 'Kits', expiryDate: '2025-11-20', lowStockThreshold: 20 },
      { id: 'MED-004', name: 'Diazepam', stock: 800, unit: 'Tablets', expiryDate: '2026-08-10', lowStockThreshold: 100 },
      { id: 'MED-005', name: 'Clonidine', stock: 600, unit: 'Tablets', expiryDate: '2027-01-05', lowStockThreshold: 80 },
      { id: 'MED-006', name: 'Naltrexone', stock: 250, unit: 'Tablets', expiryDate: '2026-03-12', lowStockThreshold: 30 }
    ];
    await Medicine.insertMany(medicines);
    console.log(`Seeded ${medicines.length} medicines.`);

    // 2. Seed Patients
    await Patient.deleteMany({});
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const patients = [
      { id: 'PT-1001', name: 'Ramesh Singh', phone: '9876543210', district: 'Ludhiana', status: 'Active', addictionCategory: 'Opioids', nextOpdVisitDate: todayStr },
      { id: 'PT-1002', name: 'Gurpreet Kaur', phone: '9876543211', district: 'Amritsar', status: 'Active', addictionCategory: 'Alcohol', nextOpdVisitDate: todayStr },
      { id: 'PT-1003', name: 'Harjit Singh', phone: '9876543212', district: 'Jalandhar', status: 'Active', addictionCategory: 'Opioids', nextOpdVisitDate: todayStr },
      { id: 'PT-1004', name: 'Manpreet Singh', phone: '9876543213', district: 'Patiala', status: 'Active', addictionCategory: 'Cannabis', nextOpdVisitDate: todayStr },
      { id: 'PT-1005', name: 'Sandeep Sharma', phone: '9876543214', district: 'Ludhiana', status: 'Defaulter', addictionCategory: 'Opioids', nextOpdVisitDate: yesterdayStr },
      { id: 'PT-1006', name: 'Amit Kumar', phone: '9876543215', district: 'Bathinda', status: 'Defaulter', addictionCategory: 'Alcohol', nextOpdVisitDate: yesterdayStr },
      { id: 'PT-1007', name: 'Kawaljeet Singh', phone: '9876543216', district: 'Mohali', status: 'Active', addictionCategory: 'Opioids', nextOpdVisitDate: tomorrowStr },
      { id: 'PT-1008', name: 'Daljit Kaur', phone: '9876543217', district: 'Amritsar', status: 'Active', addictionCategory: 'Opioids', nextOpdVisitDate: tomorrowStr },
      { id: 'PT-1009', name: 'Kuldeep Singh', phone: '9876543218', district: 'Jalandhar', status: 'Active', addictionCategory: 'Alcohol', nextOpdVisitDate: '2026-06-15' },
      { id: 'PT-1010', name: 'Vikram Batra', phone: '9876543219', district: 'Patiala', status: 'Active', addictionCategory: 'Cannabis', nextOpdVisitDate: '2026-06-20' },
      { id: 'PT-1011', name: 'Pooja Verma', phone: '9876543220', district: 'Ludhiana', status: 'Active', addictionCategory: 'Opioids', nextOpdVisitDate: todayStr }
    ];
    await Patient.insertMany(patients);
    console.log(`Seeded ${patients.length} patients.`);

    // 3. Queue explicitly in OpdVisit? Let server.js generate them dynamically
    // Wait, the backend endpoint uses OpdVisit for the queue explicitly, so let's insert a couple
    await OpdVisit.deleteMany({});
    const visits = [
       { visitId: 'VISIT-101', patientId: 'PT-1001', date: todayStr, time: '10:00', status: 'Pending', priority: 'Normal', isWalkIn: false },
       { visitId: 'VISIT-102', patientId: 'PT-1002', date: todayStr, time: '10:30', status: 'Dispensed', priority: 'High', isWalkIn: true },
       { visitId: 'VISIT-103', patientId: 'PT-1003', date: todayStr, time: '11:00', status: 'Pending', priority: 'Normal', isWalkIn: false }
    ];
    await OpdVisit.insertMany(visits);
    console.log(`Seeded ${visits.length} opd visits.`);

    console.log('Seeding complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedData();
