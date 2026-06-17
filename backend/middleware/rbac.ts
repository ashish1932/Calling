const { Patient } = require('../models');

/**
 * Middleware factory to authorize users based on their roles.
 * SPO always has access, bypassing this check.
 * @param {...string} allowedRoles Roles that are permitted to access the route.
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roleKey) {
      return res.status(401).json({ error: 'Unauthorized: No role assigned' });
    }
    
    // SPO is super admin, always has access
    if (req.user.roleKey === 'spo') {
      return next();
    }
    
    if (allowedRoles.includes(req.user.roleKey)) {
      return next();
    }
    
    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
  };
};

/**
 * Middleware to authorize patient access based on district.
 * If the user is a counselor, they can only access patients within their assigned district.
 * Other roles bypass this restriction.
 */
const authorizePatientAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user.roleKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Admins and roles that aren't restricted by district bypass this
    if (req.user.roleKey !== 'counsellor' && req.user.roleKey !== 'ddrc') {
      return next();
    }
    
    // If user is restricted but doesn't have a district assigned, deny access
    if (!req.user.district || req.user.district.toLowerCase() === 'all') {
       if (req.user.district?.toLowerCase() === 'all') return next(); // In case some counsellors are set to 'all'
       return res.status(403).json({ error: 'Forbidden: No district assigned to counselor' });
    }

    const patientId = req.params.id || req.body.patientId;
    if (!patientId) {
      // If there's no patient ID to check, let the next handler deal with it
      return next();
    }

    const patient = await Patient.findOne({ id: patientId });
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    if (patient.district && patient.district.toLowerCase() !== req.user.district.toLowerCase()) {
      return res.status(403).json({ error: 'Forbidden: Patient belongs to a different district' });
    }

    // Attach patient to req so downstream handlers don't need to fetch it again if they don't want to
    req.patient = patient;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  authorizeRoles,
  authorizePatientAccess
};
