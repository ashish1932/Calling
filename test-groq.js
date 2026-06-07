const axios = require('axios');
const fs = require('fs');

async function test() {
  try {
    require('dotenv').config();
    const apiKey = process.env.GROQ_API_KEY;
    console.log("Testing Groq API...");
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.1-8b-instant',
      messages: [{role: 'user', content: 'hello'}]
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    console.log("Success:", response.data);
  } catch (e) {
    console.error("Error status:", e.response ? e.response.status : e.message);
    console.error("Error data:", e.response ? e.response.data : '');
  }
}

test();
