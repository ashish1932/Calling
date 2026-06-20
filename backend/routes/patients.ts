const express = require('express');
const router = express.Router();
const { Patient, Counselor, CallLog, AuditTrail } = require('../models');
const { authorizeRoles, authorizePatientAccess } = require('../middleware/rbac');

// ==========================================
// PATIENTS CRUD
// ==========================================

router.get('/patients', authorizeRoles('spo', 'supervisor', 'ddrc', 'counsellor', 'ditsu', 'opd_staff'), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000; // Large default for backwards compatibility
    const skip = (page - 1) * limit;

    let query: any = {};
    if (req.user && req.user.roleKey === 'counsellor') {
      const counselor = await Counselor.findOne({ id: req.user.staffId });
      if (counselor && counselor.district && counselor.district.toLowerCase() !== 'all') {
        query.district = counselor.district;
      }
    }

    const total = await Patient.countDocuments(query);
    const patients = await Patient.find(query).skip(skip).limit(limit);

    res.json({
      data: patients,
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

router.post('/patients', authorizeRoles('spo', 'supervisor', 'ditsu', 'ddrc'), async (req, res, next) => {
  try {
    const patients = req.body;
    if (!Array.isArray(patients)) {
      return res.status(400).json({ error: 'Expected an array of patients' });
    }
    for (const p of patients) {
      if (!p || typeof p !== 'object' || !p.id) {
        return res.status(400).json({ error: 'Invalid patient object. Missing id field.' });
      }
    }
    const operations = patients.map(p => {
      const updateData = { ...p };
      delete updateData._id;
      return {
        updateOne: {
          filter: { id: p.id },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await Patient.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Patients saved successfully' });
  } catch (error) {
    next(error);
  }
});

router.patch('/patients/:id', authorizeRoles('spo', 'supervisor', 'ddrc', 'counsellor'), authorizePatientAccess, async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.id;
    const patient = await Patient.findOneAndUpdate(
      { id },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json({ success: true, message: 'Patient updated successfully', patient });
  } catch (error) {
    next(error);
  }
});

router.put('/patients/:id/records/:type', authorizeRoles('spo', 'ddrc', 'supervisor'), authorizePatientAccess, async (req, res, next) => {
  try {
    const { id, type } = req.params;
    const data = req.body;

    const validTypes = ['vitals', 'medicalHistory', 'familyHistory', 'cowsAssessment', 'doctorsAssessment'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid record type' });
    }

    const updateObj = {};
    updateObj[type] = data;

    const patient = await Patient.findOneAndUpdate(
      { id },
      { $push: updateObj },
      { new: true }
    );

    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json({ success: true, patient });
  } catch (error) {
    next(error);
  }
});

router.delete('/patients/:id', authorizeRoles('spo'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await Patient.deleteOne({ id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json({ success: true, message: 'Patient deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// COUNSELORS CRUD
// ==========================================

router.get('/counselors', authorizeRoles('spo', 'supervisor', 'ddrc', 'ditsu', 'counsellor'), async (req, res, next) => {
  try {
    const counselors = await Counselor.find({});
    res.json(counselors);
  } catch (error) {
    next(error);
  }
});

router.get('/counselors/:id/patients', authorizeRoles('spo', 'supervisor', 'ddrc', 'ditsu'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const patients = await Patient.find({
      $or: [
        { counselorId: id },
        { assignedCounselor: id }
      ]
    });
    res.json(patients);
  } catch (error) {
    next(error);
  }
});

router.post('/counselors', authorizeRoles('spo'), async (req, res, next) => {
  try {
    const counselors = req.body;
    if (!Array.isArray(counselors)) {
      return res.status(400).json({ error: 'Expected an array of counselors' });
    }
    const operations = counselors.map(c => {
      const updateData = { ...c };
      delete updateData._id;
      return {
        updateOne: {
          filter: { id: c.id },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await Counselor.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Counselors saved successfully' });
  } catch (error) {
    next(error);
  }
});

router.delete('/counselors/:id', authorizeRoles('spo'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await Counselor.deleteOne({ id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Counselor not found' });
    }
    res.json({ success: true, message: 'Counselor deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// CALL LOGS CRUD
// ==========================================

router.get('/call-logs', authorizeRoles('spo', 'supervisor', 'counsellor', 'ddrc', 'ditsu', 'opd_staff'), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    const total = await CallLog.countDocuments();
    const logs = await CallLog.find({}).sort({ timestamp: -1 }).skip(skip).limit(limit);

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

router.post('/call-logs', authorizeRoles('spo', 'counsellor', 'supervisor', 'ddrc'), async (req, res, next) => {
  try {
    const logs = req.body;
    if (!Array.isArray(logs)) {
      return res.status(400).json({ error: 'Expected an array of logs' });
    }
    for (const l of logs) {
      if (!l || typeof l !== 'object' || !l.logId) {
        return res.status(400).json({ error: 'Invalid log object. Missing logId field.' });
      }
    }
    const operations = logs.map(l => {
      const updateData = { ...l };
      delete updateData._id;
      return {
        updateOne: {
          filter: { logId: l.logId },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await CallLog.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Call logs saved successfully' });
  } catch (error) {
    next(error);
  }
});

router.delete('/call-logs', authorizeRoles('spo', 'supervisor'), async (req, res, next) => {
  try {
    const { logIds } = req.body;
    if (!Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({ error: 'Expected { logIds: [...] }' });
    }
    const result = await CallLog.deleteMany({ logId: { $in: logIds } });
    console.log(`🗑️ Deleted ${result.deletedCount} call log(s)`);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// AUDIT TRAIL CRUD
// ==========================================

router.get('/audit-trail', authorizeRoles('spo', 'supervisor', 'ditsu'), async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;

    const total = await AuditTrail.countDocuments();
    const auditEvents = await AuditTrail.find({}).sort({ timestamp: -1 }).skip(skip).limit(limit);

    res.json({
      data: auditEvents,
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

router.post('/audit-trail', authorizeRoles('spo', 'supervisor', 'counsellor', 'ddrc', 'ditsu', 'opd_staff'), async (req, res, next) => {
  try {
    const auditEvents = req.body;
    if (!Array.isArray(auditEvents)) {
      return res.status(400).json({ error: 'Expected an array of audit events' });
    }
    for (const e of auditEvents) {
      if (!e || typeof e !== 'object' || !e.eventId) {
        return res.status(400).json({ error: 'Invalid event object. Missing eventId field.' });
      }
    }
    const operations = auditEvents.map(e => {
      const updateData = { ...e };
      delete updateData._id;
      return {
        updateOne: {
          filter: { eventId: e.eventId },
          update: { $set: updateData },
          upsert: true
        }
      };
    });
    if (operations.length > 0) {
      await AuditTrail.bulkWrite(operations);
    }
    res.json({ success: true, message: 'Audit trail saved successfully' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PATIENTS ONLINE STATUS (public — no auth)
// ==========================================

// This is injected at mount time by server.js via router.getPatientSockets
let _getPatientSockets = () => ({});
router.setPatientSocketsGetter = (fn) => { _getPatientSockets = fn; };

router.get('/patients/online', authorizeRoles('spo', 'supervisor', 'ddrc', 'ditsu', 'counsellor', 'opd_staff'), async (req, res, next) => {
  try {
    res.json({ onlinePatientIds: Object.keys(_getPatientSockets()) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

export {};
