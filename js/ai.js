// AI Summarization and NLP Parsing Engine for Tele-Counseling

class AIOrchestrator {
  constructor() {
    this.languagesSupported = {
      "pa-IN": "Punjabi (Gurmukhi ASR)",
      "hi-IN": "Hindi (Devanagari ASR)",
      "en-US": "English (Standard ASR)"
    };
  }

  // Returns { endpoint, headers, model } based on the active AI provider (Groq or Gemini)
  _getChatConfig() {
    const provider = (window.CounselFlow.CONFIG.AI_PROVIDER || 'groq').toLowerCase();
    const headers = { 
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "ngrok-skip-browser-warning": "1"
    };

    if (provider === 'gemini') {
      return {
        endpoint: `${window.CounselFlow.API_BASE}/ai/gemini/chat`,
        headers,
        model: 'gemini-2.0-flash',
        provider: 'gemini'
      };
    }

    return {
      endpoint: `${window.CounselFlow.API_BASE}/ai/chat/completions`,
      headers,
      model: 'llama-3.1-8b-instant',
      provider: 'groq'
    };
  }

  // Detect language based on transcript contents or user selection
  detectLanguage(transcriptText) {
    const containsPunjabiChar = /[\u0A00-\u0A7F]/.test(transcriptText);
    const containsHindiChar = /[\u0900-\u097F]/.test(transcriptText);
    
    if (containsPunjabiChar) return "pa-IN";
    if (containsHindiChar) return "hi-IN";
    return "en-US";
  }

  // Clean raw transcript text
  cleanTranscription(transcriptArray) {
    try {
      return transcriptArray.map(line => {
        return {
          speaker: line.speaker || "Speaker",
          text: (line.text || "").trim(),
          timestamp: line.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      });
    } catch (e) {
      console.error("Transcription cleaning failure:", e);
      return [];
    }
  }

  // Generate intelligent summary based on transcripts (supports dynamic keyword-based input)
  generateSummary(transcriptArray, languageCode = 'en-US') {
    try {
      // Join transcript lines into a single string to parse keywords
      const textBlob = transcriptArray.map(t => t.text).join(" ").toLowerCase();
      
      // Default fallback clinical points
      let overview = "Counseling session focused on general recovery milestones, check-in on patient's mood, and relapse prevention guidelines.";
      let concernsParts = [];
      let observationsParts = ["Patient presents a cooperative, stable mood and exhibits progressive engagement in rehabilitation work."];
      
      // Risk hierarchy: 0 = Stable/Low, 1 = Medium, 2 = High, 3 = Critical
      let maxRiskScore = 0;
      
      let actions = [
        "Continue standard daily sobriety routine.",
        "Engage in supportive family activities.",
        "Attend the next scheduled support group meeting."
      ];
      let nextFollowUp = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      // Multi-lingual word boundary regex patterns
      const cravingsRegex = /(?:\b(crav|urge|desire|want|trigger)\b)|(?:ਤਲਬ|ਮਨ ਡੋਲ|ਮਨ ਕੀਤਾ)|(?:तलब|मन डोल|मन किया|इच्छा)/i;
      const peersRegex = /(?:\b(friend|peer|circle|group|crowd|associate)\b)|(?:ਦੋਸਤ|ਸਾਥੀ|ਯਾਰ)|(?:दोस्त|साथी|यार)/i;
      const sleepRegex = /(?:\b(sleep|insomnia|wake|awake|night|rest)\b)|(?:ਨੀਂਦ|ਸੌਣ|ਰਾਤ)|(?:नींद|सोना|रात)/i;
      const withdrawalRegex = /(?:\b(pain|ache|vomit|nausea|sick|weak|hurt|sweat|tremor)\b)|(?:ਦਰਦ|ਦੁਖ|ਕਮਜ਼ੋਰੀ)|(?:दर्द|दुख|कमजोरी|उल्टी|बीमार)/i;

      // 1. Craving detection
      if (cravingsRegex.test(textBlob)) {
        handleCravings();
      }
      
      // 2. Peer group triggers
      if (peersRegex.test(textBlob)) {
        handlePeers();
      }
      
      // 3. Insomnia and sleep struggles
      if (sleepRegex.test(textBlob)) {
        handleSleep();
      }

      // 4. Withdrawal / Physical aches
      if (withdrawalRegex.test(textBlob)) {
        handleWithdrawal();
      }

      // Helpers to populate fields and scale the risk score hierarchy
      function handleCravings() {
        concernsParts.push("Patient experienced moderate-to-strong cravings since the last check-in.");
        concernsParts.push("The craving episode was successfully managed through self-control and coping tools.");
        maxRiskScore = Math.max(maxRiskScore, 1); // Medium Risk
        actions.unshift("Develop written daily triggers journal to track and anticipate craving spikes.");
      }

      function handlePeers() {
        concernsParts.push("Encountered active peer circles associated with previous substance use triggers.");
        maxRiskScore = Math.max(maxRiskScore, 2); // High Risk
        observationsParts.push("Patient demonstrates high accountability by immediately removing themselves from triggering environments, but social vulnerability remains.");
        actions.unshift("Avoid physical travel along high-risk routes frequented by former active circles.");
      }

      function handleSleep() {
        concernsParts.push("Significant insomnia or disturbed sleeping patterns reported.");
        concernsParts.push("Patient struggles to sleep prior to midnight.");
        observationsParts.push("Appears slightly fatigued due to sleep deficit. Alert but low energy.");
        actions.push("Implement sleep-hygiene routine (avoid screens 1 hour before sleep, discontinue caffeine past 4 PM).");
      }

      function handleWithdrawal() {
        concernsParts.push("Persistent physical discomfort, including muscle aches or mild nausea, associated with active detox.");
        
        // Critical escalation trigger: severe symptoms mentioned
        const severeRegex = /\b(vomit|tremor|sweat|shak|severe|ਬਹੁਤ ਬੁਰਾ|ਉਲਟੀ|ਬਹੁਤ ਜ਼ਿਆਦਾ|ਤੀਬਰ)\b/i;
        if (severeRegex.test(textBlob)) {
          concernsParts.push("Severe clinical withdrawal tremors, vomiting, or excessive perspiration observed.");
          maxRiskScore = Math.max(maxRiskScore, 3); // Critical Risk
        } else {
          maxRiskScore = Math.max(maxRiskScore, 2); // High Risk
        }
        
        actions.unshift("Coordinate with medical detox officer for checking pharmacotherapy or medication dosage adjustments.");
      }

      // Map numerical risk score back to clinical string tags
      const riskMapping = {
        0: "Stable / Low Risk",
        1: "Medium Risk",
        2: "High Risk",
        3: "Critical Risk"
      };
      const riskLevel = riskMapping[maxRiskScore];

      // Join and clean concerns using sentence-based clause deduplication
      let finalConcerns = "No severe cravings or critical medical withdrawal symptoms reported.";
      if (concernsParts.length > 0) {
        const uniqueClauses = [];
        const seen = new Set();
        concernsParts.forEach(part => {
          const clauses = part.split(/[.;,]+/).map(c => c.trim()).filter(c => c.length > 0);
          clauses.forEach(clause => {
            const normalized = clause.toLowerCase().replace(/\s+/g, ' ');
            if (!seen.has(normalized)) {
              seen.add(normalized);
              uniqueClauses.push(clause);
            }
          });
        });
        finalConcerns = uniqueClauses.join(". ") + ".";
      }

      // Join and clean observations
      let finalObservations = observationsParts.join(" ");

      // Deduplicate actions array elements
      actions = [...new Set(actions)];

      // Derive escalation level from risk score
      const escalationMap = { 0: 0, 1: 0, 2: 1, 3: 2 };
      const escalationLevel = escalationMap[maxRiskScore] || 0;
      const escalationReasonMap = {
        0: null,
        1: "High craving intensity or peer-association trigger detected.",
        2: "Critical withdrawal symptoms or extreme craving episode reported."
      };

      return {
        overview: overview,
        concerns: finalConcerns,
        observations: finalObservations,
        risk: riskLevel,
        actions: actions.map((act, i) => `${i+1}. ${act}`).join("\n"),
        followUp: nextFollowUp,
        escalationLevel: escalationLevel,
        escalationReason: escalationReasonMap[escalationLevel] || null
      };
    } catch (e) {
      console.error("AI summarization failure:", e);
      return {
        overview: "Error compiling session summary automatically.",
        concerns: "Error parsing transcript keywords.",
        observations: "Error reading emotional markers.",
        risk: "Medium Risk",
        actions: "1. Monitor patient stability closely.",
        followUp: nextFollowUp,
        escalationLevel: 0,
        escalationReason: null
      };
    }
  }

  // Generate intelligent summary using Groq API llama-3.1-8b-instant (supports JSON mode)
  async generateSummaryAsync(transcriptArray, languageCode = 'en-US') {

    // Convert transcript array into readable text representation
    const transcriptText = transcriptArray
      .map(line => `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}`)
      .join('\n');

    if (!transcriptText.trim()) {
      return this.generateSummary(transcriptArray, languageCode);
    }

    const chatConfig = this._getChatConfig();

    const payload = {
      model: chatConfig.model,
      messages: [
        {
          role: "system",
          content: `You are a clinical counseling AI assistant specializing in addiction recovery for the Punjab CBM (Community Bridge Model) programme.
Summarize the tele-counseling session below.
You MUST respond with a valid JSON object only. No intro text, no markdown fences.
The JSON object must have EXACTLY these fields:
{
  "overview": "Clinical summary of session, recovery progress, key topics discussed.",
  "concerns": "Cravings, social triggers, insomnia, physical withdrawal, or psychosocial stressors reported.",
  "observations": "Counselor observations: patient mood, engagement level, attitude, body language cues if mentioned.",
  "risk": "Exactly one of: 'Stable / Low Risk', 'Medium Risk', 'High Risk', 'Critical Risk'.",
  "actions": "Numbered list of next-step recommendations, newline-separated.",
  "escalationLevel": "Integer 0-3. 0=no escalation needed. 1=L1 supervisor alert within 4 hours (missed session or language risk cues). 2=L2 DDRC clinical alert within 24 hours (high risk, relapse indicators). 3=L3 emergency state programme owner within 48 hours (critical risk, active relapse or safety concern).",
  "escalationReason": "Short one-sentence reason for the escalation level, or null if level 0."
}`
        },
        {
          role: "user",
          content: `Here is the conversation transcript (language: ${languageCode}):\n\n${transcriptText}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    };

    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP error ${response.status}`);
      }

      const responseData = await response.json();
      const content = responseData.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from AI engine");
      }

      const summaryObj = JSON.parse(content);
      
      // Map actions safely to strings
      let actionsStr = "";
      if (Array.isArray(summaryObj.actions)) {
        actionsStr = summaryObj.actions.map((act, i) => `${i + 1}. ${act}`).join("\n");
      } else if (typeof summaryObj.actions === 'string') {
        const lines = summaryObj.actions.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(l => l.length > 0);
        actionsStr = lines.map((act, i) => `${i + 1}. ${act}`).join("\n");
      } else {
        actionsStr = "1. Continue standard daily sobriety routine.";
      }

      const rawEscLevel = parseInt(summaryObj.escalationLevel);
      const escalationLevel = isNaN(rawEscLevel) ? 0 : Math.min(3, Math.max(0, rawEscLevel));

      return {
        overview: summaryObj.overview || "No overview provided.",
        concerns: summaryObj.concerns || "No concerns reported.",
        observations: summaryObj.observations || "No observations recorded.",
        risk: summaryObj.risk || "Stable / Low Risk",
        actions: actionsStr,
        followUp: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        escalationLevel: escalationLevel,
        escalationReason: summaryObj.escalationReason || null
      };
    } catch (e) {
      console.error(`${chatConfig.provider} API Summary generation failed:`, e);
      if (window.CounselFlow && window.CounselFlow.app) {
        window.CounselFlow.app.showToast("AI Error", "Failed to generate summary. Using fallback.", "error");
      }
      throw e;
    }
  }

  // ── Live Whisper Transcription (Replaces flaky Web Speech API)
  async transcribeAudioChunkAsync(audioBlob, languageCode = 'en') {

    // Skip sending if the audio chunk is too small (prevents 400 Bad Requests and reduces hallucinations on silence)
    if (audioBlob.size < 3000) return null;

    // ── Client-side Voice Activity Detection (VAD) ──────────────────────
    // Decode the audio and check RMS energy; skip silent chunks to prevent
    // Whisper from hallucinating on ambient noise / silence.
    try {
      const vadCtx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuf = await audioBlob.arrayBuffer();
      const audioBuf = await vadCtx.decodeAudioData(arrayBuf);
      const samples = audioBuf.getChannelData(0);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      vadCtx.close();
      // RMS below 0.005 ≈ silence / ambient room noise — skip this chunk
      if (rms < 0.005) {
        console.debug('[ASR/VAD] Chunk is silence (RMS=' + rms.toFixed(5) + '), skipping.');
        return null;
      }
    } catch (vadErr) {
      // If VAD fails (unsupported codec, etc.), proceed with transcription anyway
      console.warn('[ASR/VAD] VAD check failed, sending chunk anyway:', vadErr.message);
    }

    try {
      const formData = new FormData();
      // Groq Whisper supports flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
      formData.append("file", audioBlob, "chunk.webm");
      // whisper-large-v3-turbo: same multilingual quality, ~2x faster latency
      formData.append("model", "whisper-large-v3-turbo");
      formData.append("response_format", "json");
      formData.append("temperature", "0");

      // ── Smart language hinting ─────────────────────────────────────
      // Only pass a language hint when we're confident of the dominant language.
      // Whisper auto-detect works well for English but benefits from hints
      // for Indic languages. Map BCP-47 codes to ISO-639-1.
      const langMap = { 'pa-IN': 'pa', 'hi-IN': 'hi', 'en-US': null };
      const langHint = langMap[languageCode] || null;
      if (langHint) {
        formData.append("language", langHint);
      }

      // Rich trilingual domain prompt — gives Whisper vocabulary hints for
      // medical/counseling terminology in English, Hindi, and Punjabi
      const domainPrompt =
        'This is a telemedicine counseling session for addiction recovery in Punjab, India. ' +
        'The speakers freely mix English, Hindi and Punjabi (Gurmukhi script). ' +
        'Hindi: नशा, दवाई, इलाज, समस्या, मदद, परिवार, स्वास्थ्य, उपचार, नशामुक्ति, ठीक. ' +
        'Punjabi: ਨਸ਼ਾ, ਦਵਾਈ, ਇਲਾਜ, ਸਿਹਤ, ਮਦਦ, ਮੁਕਤੀ, ਸ਼ਰਾਬ, ਪਰਿਵਾਰ, ਠੀਕ, ਹਾਂ, ਜੀ. ' +
        'Transcribe each word in its ORIGINAL spoken language and script. Do NOT translate.';
      formData.append("prompt", domainPrompt);

      const headers = {
        "X-Requested-With": "XMLHttpRequest",
        "ngrok-skip-browser-warning": "1"
      };

      const response = await fetch(`${window.CounselFlow.API_BASE}/ai/audio/transcriptions`, {
        method: "POST",
        headers: headers,
        body: formData
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP error ${response.status}`);
      }

      const data = await response.json();
      return data.text ? data.text.trim() : null;
    } catch (e) {
      console.error("Whisper Transcription failed:", e);
      return null;
    }
  }

  // ── Dictation Mode: Convert counsellor's post-call narration to structured summary (Req 6)
  async generateDictationSummaryAsync(dictationText, languageCode = 'en-US') {
    if (!dictationText || !dictationText.trim()) throw new Error("No dictation text provided.");

    const chatConfig = this._getChatConfig();

    const payload = {
      model: chatConfig.model,
      messages: [
        {
          role: "system",
          content: `You are a clinical documentation AI for addiction recovery counselling (Punjab CBM programme).
The following is a post-call verbal dictation by a counsellor describing a session they just conducted — the call was NOT recorded.
Convert this dictation into a structured clinical summary.
Respond ONLY with a valid JSON object with these EXACT fields:
{
  "overview": "Summary of session as described by the counsellor.",
  "concerns": "Patient concerns, triggers, cravings, or risk factors mentioned.",
  "observations": "Counsellor's clinical observations of the patient.",
  "risk": "Exactly one of: 'Stable / Low Risk', 'Medium Risk', 'High Risk', 'Critical Risk'.",
  "actions": "Numbered list of next-step recommendations, newline-separated.",
  "escalationLevel": "Integer 0-3 as defined: 0=none, 1=L1(4h), 2=L2(24h), 3=L3(48h).",
  "escalationReason": "One sentence reason or null."
}`
        },
        {
          role: "user",
          content: `Counsellor dictation (language code: ${languageCode}):\n\n${dictationText}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    };

    const response = await fetch(chatConfig.endpoint, {
      method: "POST",
      headers: chatConfig.headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP error ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty dictation summary response.");

    const obj = JSON.parse(content);
    let actionsStr = "";
    if (Array.isArray(obj.actions)) {
      actionsStr = obj.actions.map((a, i) => `${i+1}. ${a}`).join("\n");
    } else if (typeof obj.actions === 'string') {
      actionsStr = obj.actions;
    } else {
      actionsStr = "1. Monitor patient progress at next check-in.";
    }
    const rawEsc = parseInt(obj.escalationLevel);
    return {
      overview: obj.overview || "",
      concerns: obj.concerns || "",
      observations: obj.observations || "",
      risk: obj.risk || "Stable / Low Risk",
      actions: actionsStr,
      followUp: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      escalationLevel: isNaN(rawEsc) ? 0 : Math.min(3, Math.max(0, rawEsc)),
      escalationReason: obj.escalationReason || null,
      isDictation: true
    };
  }

  // ── Session Scoring Engine: 6-dimension quality rubric (Req 5)
  scoreSession(summaryObj, transcriptArray) {
    const text = transcriptArray.map(t => t.text || '').join(' ').toLowerCase();
    const summary = JSON.stringify(summaryObj).toLowerCase();
    const combined = text + ' ' + summary;

    // 1. Rapport (0-10): engagement language, greeting, empathy
    const rapportMatches = (combined.match(/(?:बहुत अच्छा|ਬਹੁਤ ਵਧੀਆ|great|well done|understand|feel|listen|empathy|support|ਧੰਨਵਾਦ|धन्यवाद|thank)/gi) || []).length;
    const rapport = Math.min(10, 4 + rapportMatches);

    // 2. Relapse-Prevention Frame (0-10): coping strategies mentioned
    const copingMatches = (combined.match(/(?:coping|breathing|exercise|routine|strategy|plan|avoid|distract|support group|ਸਾਹ|ਕਸਰਤ|सांस|कसरत|दिनचर्या)/gi) || []).length;
    const relapseFrame = Math.min(10, 3 + copingMatches * 2);

    // 3. Risk Cue Identification (0-10): based on escalation level detected
    const riskMapping = { 'stable / low risk': 8, 'medium risk': 6, 'high risk': 4, 'critical risk': 2 };
    const riskCueId = riskMapping[(summaryObj.risk || '').toLowerCase()] || 5;

    // 4. Action Clarity (0-10): numbered actions present
    const actionLines = (summaryObj.actions || '').split('\n').filter(l => l.trim().length > 3);
    const actionClarity = Math.min(10, actionLines.length * 2);

    // 5. Escalation Hygiene (0-10): correctly identified escalation vs risk
    const esc = summaryObj.escalationLevel || 0;
    const riskStr = (summaryObj.risk || '').toLowerCase();
    const escalationHygiene = (() => {
      if (esc === 0 && (riskStr.includes('stable') || riskStr.includes('low'))) return 10;
      if (esc >= 1 && (riskStr.includes('high') || riskStr.includes('critical'))) return 9;
      if (esc === 0 && riskStr.includes('medium')) return 7;
      return 6;
    })();

    // 6. Language Sensitivity (0-10): multilingual handling
    const hasPunjabi = /[\u0A00-\u0A7F]/.test(text);
    const hasHindi = /[\u0900-\u097F]/.test(text);
    const hasEnglish = /[a-z]{4,}/.test(text);
    const langScore = (hasPunjabi ? 3 : 0) + (hasHindi ? 3 : 0) + (hasEnglish ? 2 : 0) + 2;
    const languageSensitivity = Math.min(10, langScore);

    const scores = { rapport, relapseFrame, riskCueId, actionClarity, escalationHygiene, languageSensitivity };
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const average = Math.round((total / 60) * 100); // percentage

    return { ...scores, total, average };
  }

  // Export clinical session detail as a text file for counselor records
  exportSessionData(patient, session) {
    try {
      const divider = "=========================================================\n";
      let text = `${divider}  CLINICAL TELE-COUNSELING SESSION HISTORY RECORD\n${divider}`;
      text += `Patient Name  : ${patient.name}\n`;
      text += `Age / Gender  : ${patient.age} / ${patient.gender}\n`;
      text += `Phone No      : ${patient.phone}\n`;
      text += `Addiction Cat : ${patient.addictionCategory}\n`;
      text += `Session Date  : ${session.date}\n`;
      text += `Duration      : ${session.duration}\n`;
      text += `Language      : ${session.language}\n`;
      text += `Counselor     : ${session.counselor}\n`;
      text += `${divider}  SPEECH-TO-TEXT TRANSCRIPT\n${divider}`;
      
      session.transcript.forEach(line => {
        text += `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}\n`;
      });
      
      text += `\n${divider}  AI-GENERATED CLINICAL SUMMARY\n${divider}`;
      text += `[Session Overview]\n${session.summary.overview}\n\n`;
      text += `[Key Concerns / Triggers]\n${session.summary.concerns}\n\n`;
      text += `[Counselor Observations]\n${session.summary.observations}\n\n`;
      text += `[Risk Indicators]\n${session.summary.risk || session.summary.riskIndicators}\n\n`;
      text += `[Recommended Actions]\n${session.summary.actions}\n\n`;
      text += `[Follow-up Date]\n${session.summary.followUp}\n`;
      text += `${divider}`;
      
      // Trigger download in browser
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Session_${session.sessionId || 'SESS'}_${patient.name.replace(/\s+/g, '_')}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to export session record:", e);
    }
  }

  // ── Translate non-English input to English
  async translateToEnglishAsync(text) {
    if (!text || text.trim() === '') return text;

    const chatConfig = this._getChatConfig();

    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify({
          model: chatConfig.model,
          messages: [
            {
              role: "system",
              content: "You are a professional translator. Translate the following text exactly to English. If it is already in English, return it exactly as is. Output ONLY the translated English text, with no explanations, no quotes, and no intro."
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.1,
          max_tokens: 200
        })
      });
      
      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content.trim();
      }
    } catch (e) {
      console.error("Translation failed:", e);
    }
    return text;
  }

  // ── Translate entire transcript array to a target language post-call
  async translateFullTranscriptAsync(transcriptArray, targetLanguage = 'English') {
    if (!transcriptArray || transcriptArray.length === 0) return transcriptArray;

    const rawText = transcriptArray
      .map(line => `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}`)
      .join('\n');

    const chatConfig = this._getChatConfig();

    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify({
          model: chatConfig.model,
          messages: [
            {
              role: "system",
              content: `You are a professional translator for medical and counseling conversations. Translate each line of the following dialogue to ${targetLanguage}. Keep the exact format: [timestamp] Speaker: translated text. Do NOT change timestamps or speaker names. Translate ONLY the text after the speaker name.`
            },
            {
              role: "user",
              content: rawText
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`${chatConfig.provider} API rate limit reached (429 Too Many Requests). Translation skipped.`);
          if (window.CounselFlow && window.CounselFlow.app && window.CounselFlow.app.showToast) {
            window.CounselFlow.app.showToast("Rate Limit Hit", "Translation skipped due to API rate limits.", "warning");
          }
        }
        return transcriptArray;
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        const translatedRaw = data.choices[0].message.content.trim();
        // Parse the translated lines back into the transcript array format
        const lines = translatedRaw.split('\n').filter(l => l.trim() && !l.toLowerCase().startsWith('here is the'));
        return lines.map((line, idx) => {
          const orig = transcriptArray[idx] || { timestamp: '00:00', speaker: 'Unknown', text: '' };
          const match = line.match(/^\[(.*?)\]\s*(.*?):\s*(.*)$/);
          if (match) {
            return {
              timestamp: match[1],
              speaker: orig.speaker, // Always preserve the original English speaker name for UI consistency
              text: match[3].trim().replace(/^["']|["']$/g, '')
            };
          }
          // Fallback: If formatting broke but we have line parity, salvage the text.
          let cleanedText = line
            .replace(/^\[.*?\]\s*/, '') // Remove timestamps like [00:00]
            .replace(/^(?:\*\*.*?\*\*|.*?)\s*[:-]\s*/, '') // Remove speaker names like **Counselor**: or Counselor -
            .replace(/^["']|["']$/g, '')
            .trim();
            
          return {
            timestamp: orig.timestamp,
            speaker: orig.speaker,
            text: cleanedText || line // Use cleaned text, or whole line if it's completely malformed
          };
        });
      }
    } catch (e) {
      console.error("Bulk transcript translation failed:", e);
    }
    return transcriptArray;
  }

  // ── Demo Simulator: Generate natural human-like responses for the patient (Req 7)
  async generatePatientResponseAsync(transcriptArray, patientObj, languageCode = 'en-US') {

    const transcriptText = transcriptArray
      .map(line => `[${line.timestamp || '00:00'}] ${line.speaker}: ${line.text}`)
      .join('\n');

    const patientDetails = patientObj ? `You are ${patientObj.name}, recovering from ${patientObj.addictionCategory}. Your risk level is ${patientObj.riskLevel}.` : "You are a patient in an addiction recovery tele-counseling session.";

    const chatConfig = this._getChatConfig();

    const payload = {
      model: chatConfig.model,
      messages: [
        {
          role: "system",
          content: `${patientDetails}
You are talking to your counselor over a phone call.
Respond to the counselor's latest statement naturally, conversationally, and concisely as a human would. Do NOT write long paragraphs. A few short sentences at most.
Respond naturally in the same language as the conversation. If Punjabi, use Punjabi. If Hindi, use Hindi. If English, use English.
DO NOT include any JSON, prefixes, or speaker tags in your response. Just the raw text of what you say.`
        },
        {
          role: "user",
          content: `Here is the conversation so far:\n\n${transcriptText}\n\nWhat do you say next as the patient? Respond naturally in the same language the counselor is using.`
        }
      ],
      temperature: 0.7
    };

    try {
      const response = await fetch(chatConfig.endpoint, {
        method: "POST",
        headers: chatConfig.headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const responseData = await response.json();
      const content = responseData.choices?.[0]?.message?.content;
      return content ? content.trim() : "I'm not sure what to say.";
    } catch (e) {
      console.error("Patient response generation failed:", e);
      if (window.CounselFlow && window.CounselFlow.app) {
        window.CounselFlow.app.showToast("AI Error", "Failed to generate patient response.", "error");
      }
      return "I'm having trouble hearing you.";
    }
  }
}

// Namespace consolidation
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.aiOrchestrator = new AIOrchestrator();
