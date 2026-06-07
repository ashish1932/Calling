const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function test() {
  try {
    const form = new FormData();
    form.append('file', Buffer.from('fake audio data'), 'chunk.webm');
    form.append('model', 'whisper-large-v3');

    console.log("Testing transcription endpoint...");
    const response = await axios.post('http://localhost:5001/api/ai/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    console.log("Success:", response.data);
  } catch (e) {
    console.error("Error status:", e.response ? e.response.status : e.message);
    console.error("Error data:", e.response ? e.response.data : '');
  }
}

test();
