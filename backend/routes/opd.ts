const express = require('express');
const router = express.Router();
const { Patient, OpdVisit, MedicationLog, Medicine } = require('../models');
const validate = require('../middleware/validate');
const { dispenseSchema, walkinSchema } = require('../validations');
const { authorizeRoles } = require('../middleware/rbac');

function escapeRegex(text) { return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'); }

// ==========================================
// OPD DATA UPLOAD
// ==========================================

router.post('/opd/upload', authorizeRoles('spo', 'opd_staff'), async (req, res, next) => {
  try {
    const records = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Expected an array of OPD records' });
    }

    let processed = 0;
    for (const record of records) {
      if (!record.patientId || !record.date || !record.medicineName) continue;

      const logId = `OPD-${Date.now()}-${Math.floor(Math.random()*10000)}`;

      await MedicationLog.create({
        logId,
        patientId: record.patientId,
        date: record.date,
        medicineName: record.medicineName,
        quantity: record.quantity || 0,
        nextVisitDate: record.nextVisitDate || null,
        uploadedBy: req.user?.staffId || 'OPD_STAFF'
      });

      if (record.nextVisitDate) {
        await Patient.updateOne(
          { id: record.patientId },
          { $set: { nextOpdVisitDate: record.nextVisitDate } }
        );
      }
      processed++;
    }

    res.json({ success: true, processed, message: 'OPD data uploaded successfully' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD MEDICATION LOGS
// ==========================================

router.get('/opd/logs/:patientId', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const { patientId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    const total = await MedicationLog.countDocuments({ patientId });
    const logs = await MedicationLog.find({ patientId }).sort({ date: -1 }).skip(skip).limit(limit);

    res.json({
      data: logs,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD DEFAULTERS
// ==========================================

router.get('/opd/defaulters', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    const today = new Date().toISOString().split('T')[0];
    const query = { nextOpdVisitDate: { $lt: today, $ne: null } };

    const total = await Patient.countDocuments(query);
    const defaulters = await Patient.find(query).skip(skip).limit(limit);

    res.json({
      data: defaulters,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD TODAY'S QUEUE
// ==========================================

router.get('/opd/patients/today', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const queue = await OpdVisit.find({ date: today });

    const scheduledPatients = await Patient.find({ nextOpdVisitDate: today });
    const existingPatientIds = new Set(queue.map(v => v.patientId));

    for (const p of scheduledPatients) {
      if (!existingPatientIds.has(p.id)) {
        const newVisit = await OpdVisit.create({
          visitId: `V-${Date.now()}-${p.id}`,
          patientId: p.id,
          date: today,
          status: 'Waiting',
          priority: 'Normal',
          isWalkIn: false
        });
        queue.push(newVisit);
        existingPatientIds.add(p.id);
      }
    }

    const enrichedQueue = [];
    for (const visit of queue) {
      const patient = await Patient.findOne({ id: visit.patientId });
      enrichedQueue.push({
        ...visit.toObject(),
        patientName: patient ? patient.name : 'Unknown',
        patientPhone: patient ? patient.phone : ''
      });
    }

    res.json(enrichedQueue);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD PATIENT SEARCH
// ==========================================

router.get('/opd/patients/:query', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const { query } = req.params;
    const regex = new RegExp(escapeRegex(query), 'i');
    const patients = await Patient.find({
      $or: [
        { id: regex },
        { name: regex },
        { phone: regex }
      ]
    }).limit(10);
    if (!patients || patients.length === 0) return res.status(404).json({ error: 'Patient not found' });
    res.json(patients);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD STATISTICS
// ==========================================

router.get('/opd/stats/today', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const totalVisits = await OpdVisit.countDocuments({ date: today });
    const dispensed = await OpdVisit.countDocuments({ date: today, status: 'Completed' });
    const pending = await OpdVisit.countDocuments({ date: today, status: { $in: ['Waiting', 'In Progress'] } });

    const defaulters = await Patient.countDocuments({
      nextOpdVisitDate: { $lt: today, $ne: null }
    });

    res.json({ totalVisits, dispensed, pending, defaulters });
  } catch (error) {
    next(error);
  }
});

router.get('/opd/stats/weekly', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    const weeklyData = [];
    for (const dateStr of days) {
      const count = await MedicationLog.countDocuments({ date: dateStr });
      const dayLabel = new Date(dateStr).toLocaleDateString([], { weekday: 'short' });
      weeklyData.push({ day: dayLabel, calls: count });
    }
    res.json(weeklyData);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD VERIFY PATIENT
// ==========================================

router.post('/opd/verify', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const { patientId } = req.body;
    const patient = await Patient.findOne({ id: patientId });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json({ verified: true, patient });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD MEDICINES
// ==========================================

router.get('/opd/medicines', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    const total = await Medicine.countDocuments();
    const medicines = await Medicine.find({}).skip(skip).limit(limit);

    res.json({
      data: medicines,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/opd/medicines', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const { id, name, stock, unit, expiryDate, lowStockThreshold } = req.body;
    if (name) {
      const regexName = escapeRegex(name.trim());
      const existing = await Medicine.findOne({ name: { $regex: new RegExp(`^${regexName}$`, 'i') } });
      if (existing && existing.id !== id) {
        return res.status(400).json({ error: 'A medicine with this name already exists' });
      }
    }
    const targetId = id || `MED-${Date.now()}`;
    const med = await Medicine.findOneAndUpdate(
      { id: targetId },
      { name, stock, unit, expiryDate, lowStockThreshold },
      { upsert: true, new: true }
    );
    res.json(med);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD DISPENSE
// ==========================================

router.post('/opd/dispense', authorizeRoles('ddrc', 'opd_staff', 'spo'), validate(dispenseSchema), async (req, res, next) => {
  try {
    const { patientId, medicineId, quantity, nextVisitDate, notes } = req.body;

    if (nextVisitDate) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (nextVisitDate <= todayStr) {
        return res.status(400).json({ error: 'Next visit date must be in the future (tomorrow or later)' });
      }
    }

    const medicine = await Medicine.findOne({ id: medicineId });
    if (!medicine) return res.status(404).json({ error: 'Medicine not found' });

    if (medicine.stock < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    medicine.stock -= quantity;
    await medicine.save();

    const date = new Date().toISOString().split('T')[0];
    const logId = `OPD-${Date.now()}-${Math.floor(Math.random()*10000)}`;

    const medLog = await MedicationLog.create({
      logId,
      patientId,
      date,
      medicineName: medicine.name,
      quantity,
      nextVisitDate,
      notes,
      uploadedBy: req.user?.staffId || 'OPD_STAFF'
    });

    if (nextVisitDate) {
      await Patient.updateOne(
        { id: patientId },
        { $set: { nextOpdVisitDate: nextVisitDate } }
      );
    }

    await OpdVisit.updateMany(
      { patientId, date, status: { $in: ['Waiting', 'In Progress'] } },
      { $set: { status: 'Completed' } }
    );

    res.json({ success: true, log: medLog });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD VISIT STATUS
// ==========================================

router.put('/opd/visit/:visitId/status', authorizeRoles('spo', 'ddrc', 'opd_staff'), async (req, res, next) => {
  try {
    const { visitId } = req.params;
    const { status } = req.body;

    const visit = await OpdVisit.findOneAndUpdate(
      { visitId },
      { status },
      { new: true }
    );

    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    res.json(visit);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// OPD WALK-IN
// ==========================================

router.post('/opd/walkin', authorizeRoles('ddrc', 'opd_staff', 'spo'), validate(walkinSchema), async (req, res, next) => {
  try {
    const { patientId, name, phone } = req.body;

    let patient = await Patient.findOne({ id: patientId });
    if (!patient) {
      patient = await Patient.create({
        id: patientId || `PAT-${Date.now()}`,
        name: name || 'Walk-in Patient',
        phone,
        status: 'Active'
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const time = new Date().toLocaleTimeString();

    const newVisit = await OpdVisit.create({
      visitId: `V-${Date.now()}-${patient.id}`,
      patientId: patient.id,
      date: today,
      time,
      status: 'Waiting',
      priority: 'Normal',
      isWalkIn: true
    });

    res.json({ visit: newVisit, patient });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

export {};
