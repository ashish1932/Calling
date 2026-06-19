const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Staff, Counselor, Patient, Session } = require('../models');
const validate = require('../middleware/validate');
const { loginSchema, patientLoginSchema, authLoginSchema } = require('../validations');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-for-dev';
const JWT_EXPIRY = '12h';
const REFRESH_EXPIRY = '7d';

function escapeRegex(text) { return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'); }

// Helper: issue access + refresh tokens and persist session
async function issueTokens(payload, res) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRY });

  // Store refresh token in Session collection
  await Session.create({
    staffId: payload.staffId,
    token: refreshToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  });

  return { accessToken, refreshToken };
}

// ==========================================
// GET /api/staff — public endpoint for login screen
// ==========================================
router.get('/staff', async (req, res, next) => {
  try {
    const staff = await Staff.find({}, '-password');
    res.json(staff);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /api/login — main login
// ==========================================
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { id, role, username, password } = req.body;

    // Username+password → Staff DB lookup
    if (username && password) {
      const escaped = escapeRegex(username.trim());
      const staffMatch = await Staff.findOne({ username: { $regex: new RegExp(`^${escaped}$`, 'i') } });
      if (staffMatch && await bcrypt.compare(password.trim(), staffMatch.password)) {
        const payload = { staffId: staffMatch.staffId, name: staffMatch.name, roleKey: staffMatch.roleKey };
        const { accessToken, refreshToken } = await issueTokens(payload, res);
        return res.json({
          success: true,
          name: staffMatch.name,
          role: staffMatch.roleKey,
          token: accessToken,
          refreshToken,
          user: payload
        });
      }
    }

    // Legacy id+role lookup
    if (id && role) {
      if (role === 'counselor') {
        const counselor = await Counselor.findOne({ $or: [{ id }, { email: id }] });
        if (counselor) {
          const payload = { staffId: counselor.id, name: counselor.name || id, roleKey: counselor.roleKey || (counselor.specialization === 'DDRC Admin' ? 'ddrc' : 'counsellor') };
          const { accessToken, refreshToken } = await issueTokens(payload, res);
          return res.json({
            success: true,
            name: payload.name,
            role: 'counsellor',
            token: accessToken,
            refreshToken,
            user: payload
          });
        }
      } else if (role === 'patient') {
        const patient = await Patient.findOne({ id });
        if (patient) {
          const payload = { staffId: patient.id, name: patient.name || id, roleKey: 'patient' };
          const { accessToken, refreshToken } = await issueTokens(payload, res);
          return res.json({
            success: true,
            name: payload.name,
            role: 'patient',
            token: accessToken,
            refreshToken,
            user: payload
          });
        }
      }
    }

    return res.status(401).json({ error: 'Invalid credentials. User not found.' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /api/auth/patient-login — mobile patient login
// ==========================================
router.post('/auth/patient-login', validate(patientLoginSchema), async (req, res, next) => {
  try {
    const { patientId, preferredLanguage } = req.body;

    const patient = await Patient.findOne({ id: patientId });
    if (patient) {
      if (preferredLanguage) {
        patient.preferredLanguage = preferredLanguage;
        await patient.save();
      }
      const payload = { staffId: patient.id, name: patient.name || patientId, roleKey: 'patient' };
      const { accessToken, refreshToken } = await issueTokens(payload, res);
      return res.json({
        success: true,
        name: payload.name,
        role: 'patient',
        token: accessToken,
        refreshToken,
        user: payload
      });
    }

    return res.status(401).json({ error: 'Invalid credentials. User not found.' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /api/auth/login — alternative auth login
// ==========================================
router.post('/auth/login', validate(authLoginSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // 1. Check Staff DB
    const escaped = escapeRegex(username.trim());
    const staffMatch = await Staff.findOne({ username: { $regex: new RegExp(`^${escaped}$`, 'i') } });
    if (staffMatch && password && await bcrypt.compare(password.trim(), staffMatch.password)) {
      const payload = { staffId: staffMatch.staffId, name: staffMatch.name, roleKey: staffMatch.roleKey };
      const { accessToken, refreshToken } = await issueTokens(payload, res);
      return res.json({
        success: true,
        name: staffMatch.name,
        role: staffMatch.roleKey,
        token: accessToken,
        refreshToken,
        user: payload
      });
    }

    // 2. Fallback: check DB by email or id
    const counselor = await Counselor.findOne({ $or: [{ id: username }, { email: username }] });
    if (counselor) {
      const payload = { staffId: counselor.id, name: counselor.name || username, roleKey: counselor.roleKey || (counselor.specialization === 'DDRC Admin' ? 'ddrc' : 'counsellor') };
      const { accessToken, refreshToken } = await issueTokens(payload, res);
      return res.json({
        success: true,
        name: payload.name,
        role: 'counsellor',
        token: accessToken,
        refreshToken,
        user: payload
      });
    }

    const patient = await Patient.findOne({ id: username });
    if (patient) {
      const payload = { staffId: patient.id, name: patient.name || username, roleKey: 'patient' };
      const { accessToken, refreshToken } = await issueTokens(payload, res);
      return res.json({
        success: true,
        name: payload.name,
        role: 'patient',
        token: accessToken,
        refreshToken,
        user: payload
      });
    }

    return res.status(401).json({ error: 'Invalid credentials. User not found.' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /api/auth/refresh — refresh token
// ==========================================
router.post('/auth/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken is required' });
    }

    // Verify the refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    if (decoded.type !== 'refresh') {
      return res.status(403).json({ error: 'Invalid token type' });
    }

    // Check if the session exists (not logged out)
    const session = await Session.findOne({ token: refreshToken });
    if (!session) {
      return res.status(403).json({ error: 'Session has been invalidated. Please log in again.' });
    }

    // Issue new access token
    const payload = { staffId: decoded.staffId, name: decoded.name, roleKey: decoded.roleKey };
    const newAccessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    res.json({ success: true, token: newAccessToken });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /api/auth/logout — invalidate session
// ==========================================
router.post('/auth/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await Session.deleteOne({ token: refreshToken });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

export {};
