const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const { SarvamAIClient } = require('sarvamai');

const upload = multer({ storage: multer.memoryStorage() });

const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = process.env.UPLOAD_DIR || path.join(__dirname, '../../frontend/assets/audio/sessions');
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, `call-${Date.now()}-${Math.floor(Math.random() * 1000)}.webm`);
  }
});
const uploadDisk = multer({ storage: diskStorage });

// ==========================================
// UPLOAD RECORDING
// ==========================================

router.post('/upload-recording', uploadDisk.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `assets/audio/sessions/${req.file.filename}`;
  res.json({ success: true, url: url });
});

// ==========================================
// GROQ CHAT COMPLETIONS PROXY
// ==========================================

router.post('/ai/chat/completions', async (req, res, next) => {
  try {
    let apiKey = process.env.GROQ_API_KEY;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const headerKey = req.headers.authorization.split(' ')[1];
      if (headerKey && headerKey.trim() !== '' && headerKey.startsWith('gsk_')) {
        apiKey = headerKey;
      }
    }

    if (!apiKey || apiKey === 'your_groq_api_key_here') {
      return res.status(401).json({ error: { message: "GROQ_API_KEY not configured or provided" } });
    }

    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', req.body, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error("AI Proxy Error (chat):", error.response?.data || error.message);
    let status = error.response?.status || 500;
    if (status === 401) status = 502;
    res.status(status).json(error.response?.data || { error: { message: error.message } });
  }
});

// ==========================================
// SARVAM AUDIO TRANSCRIPTION PROXY
// ==========================================

router.post('/ai/audio/transcriptions', upload.single('file'), async (req, res, next) => {
  try {
    let apiKey = process.env.SARVAM_API_KEY || 'sk_lst0lo51_JTbjepcAbL4GGeDbtzRXigsS';

    if (!req.file) {
      return res.status(400).json({ error: { message: "No file provided" } });
    }

    let contentType = req.file.mimetype || 'audio/webm';
    if (contentType === 'audio/m4a') {
      contentType = 'audio/x-m4a';
    } else if (contentType === 'application/octet-stream' || contentType === 'application/x-www-form-urlencoded') {
      if (req.file.originalname && req.file.originalname.endsWith('.m4a')) contentType = 'audio/x-m4a';
      else if (req.file.originalname && req.file.originalname.endsWith('.wav')) contentType = 'audio/wav';
      else contentType = 'audio/webm';
    }

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'chunk.webm',
      contentType: contentType
    });

    const inputLang = req.body.language || 'en';
    const langMap = { 'en': 'en-IN', 'hi': 'hi-IN', 'pa': 'pa-IN' };
    const sarvamLang = langMap[inputLang] || 'hi-IN';

    form.append('model', 'saaras:v3');
    form.append('language_code', sarvamLang);

    const response = await axios.post('https://api.sarvam.ai/speech-to-text', form, {
      headers: {
        ...form.getHeaders(),
        'api-subscription-key': apiKey
      }
    });

    res.json({ text: response.data.transcript || '' });
  } catch (error) {
    console.error("AI Proxy Error (audio):", error.response?.data || error.message);
    let status = error.response?.status || 500;
    if (status === 401) status = 502;
    res.status(status).json(error.response?.data || { error: { message: error.message } });
  }
});

// ==========================================
// GEMINI CHAT PROXY
// ==========================================

router.post('/ai/gemini/chat', async (req, res, next) => {
  try {
    let apiKey = process.env.GEMINI_API_KEY;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      const headerKey = req.headers.authorization.split(' ')[1];
      if (headerKey && headerKey.trim() !== '' && headerKey.startsWith('AIza')) {
        apiKey = headerKey;
      }
    }

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      return res.status(401).json({ error: { message: "GEMINI_API_KEY not configured or provided" } });
    }

    const messages = req.body.messages || [];
    const geminiContents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        geminiContents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    }

    const model = req.body.geminiModel || 'gemini-2.0-flash';
    const geminiPayload: any = {
      contents: geminiContents,
      generationConfig: {
        temperature: req.body.temperature ?? 0.2,
        maxOutputTokens: req.body.max_tokens || 4096
      }
    };

    if (systemInstruction) {
      geminiPayload.systemInstruction = systemInstruction;
    }

    if (req.body.response_format && req.body.response_format.type === 'json_object') {
      geminiPayload.generationConfig.responseMimeType = 'application/json';
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await axios.post(geminiUrl, geminiPayload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const geminiData = response.data;
    const textContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const openaiResponse = {
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent
        },
        finish_reason: geminiData.candidates?.[0]?.finishReason || 'stop'
      }],
      model: model,
      provider: 'gemini'
    };

    res.json(openaiResponse);
  } catch (error) {
    console.error("Gemini Proxy Error:", error.response?.data || error.message);
    let status = error.response?.status || 500;
    if (status === 401) status = 502;
    res.status(status).json(
      error.response?.data || { error: { message: error.message } }
    );
  }
});

module.exports = router;

export {};
