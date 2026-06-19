const express = require('express');
const router = express.Router();
const { AccessToken } = require('livekit-server-sdk');
const validate = require('../middleware/validate');
const { livekitTokenSchema, notifyCallSchema } = require('../validations');
const { authorizeRoles } = require('../middleware/rbac');

// Firebase admin is passed in via factory function
let admin = null;
let fcmInitialized = false;

router.setFirebase = (firebaseAdmin, isInitialized) => {
  admin = firebaseAdmin;
  fcmInitialized = isInitialized;
};

// ==========================================
// ICE / TURN SERVER CONFIG
// ==========================================

router.get('/ice-servers', authorizeRoles('spo', 'counsellor', 'patient'), (req, res) => {
  const iceServers: any[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
    console.log('[ICE] Using custom TURN server from .env');
  } else {
    iceServers.push({
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
    console.log('[ICE] No custom TURN configured, using default openrelay.metered.ca');
  }

  res.json({ iceServers, iceCandidatePoolSize: 10 });
});

// ==========================================
// LIVEKIT TOKEN GENERATION
// ==========================================

router.post('/livekit/token', authorizeRoles('spo', 'counsellor'), validate(livekitTokenSchema), async (req, res, next) => {
  try {
    const { roomName, participantName } = req.body;

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: 'LiveKit API keys not configured in .env' });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
    });
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    const jwtToken = await at.toJwt();
    res.json({
      token: jwtToken,
      url: process.env.LIVEKIT_URL
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// FCM PUSH NOTIFICATION
// ==========================================

router.post('/livekit/notify-call', authorizeRoles('spo', 'counsellor'), validate(notifyCallSchema), async (req, res, next) => {
  try {
    const { fcmToken, roomName, callerName } = req.body;

    if (!fcmInitialized) {
      return res.status(500).json({ error: 'Firebase Admin not initialized. Check credentials.' });
    }

    const message = {
      notification: {
        title: 'Incoming Call',
        body: `${callerName || 'Your Counselor'} is calling you.`
      },
      data: {
        type: 'incoming_call',
        roomName: roomName || 'default_room'
      },
      token: fcmToken
    };

    const response = await admin.messaging().send(message);
    res.json({ success: true, messageId: response });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

export {};
