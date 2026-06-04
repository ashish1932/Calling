// WebRTC Tele-Calling, Waveform Visualizer, and Speech Recognition Script

class CallManager {
  // Private field declaration (Architecture #36)
  #currentTranscript = [];

  constructor() {
    this.isActive = false;
    this.isMuted = false;
    this.isRecording = false;
    this.isHeld = false; // UX #47: Hold state toggle
    this.duration = 0;
    this.timerInterval = null;
    this.canvas = null;
    this.ctx = null;
    this.animationFrame = null;
    this.counselorRecorder = null;
    this.patientRecorder = null;
    this.activePatient = null;
    this.activeLanguage = 'pa-IN';
    
    
    this.lastSessionTranscript = []; // Cache for post-call summaries (Bug #2)
    this.asrSupportWarned = false; // ASR browser support warning flag (Error Handling #4)
    this.asrRetryCount = 0; // ASR network retry attempt counter (Error Handling #4)
    
    // Performance #67: FPS Throttling variables
    this.lastFrameTime = 0;
    this.fpsInterval = 1000 / 60; // Limit to 60 FPS
    
    // Bind event listeners for visibility change
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    
    // Bind Keyboard Shortcuts (UX #53)
    this.bindKeyboardShortcuts();

    // WebRTC & Socket properties
    this.socket = null;
    this.peerConnection = null;
    this.localStream = null;
    this.patientSocketId = null; // Store actual socket ID for routing ICE & end-call
    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    // Unlock autoplay: browsers need a user gesture
    this.audioUnlockHandler = () => {
      if (this.remoteAudio && typeof this.remoteAudio.play === 'function') {
        this.remoteAudio.play().catch(e => {
          console.warn('[WebRTC] Audio autoplay blocked:', e);
          // Show persistent unlock instruction
          this.addWarningToTranscriptLog(
            "Audio Blocked", 
            "Browser blocked autoplay. Click anywhere on the screen to enable audio."
          );
        });
      }
    };
    // Add persistent handler that doesn't remove itself
    document.addEventListener('click', this.audioUnlockHandler);
    document.addEventListener('touchstart', this.audioUnlockHandler);
    // Also try to unlock on keydown for keyboard accessibility
    document.addEventListener('keydown', this.audioUnlockHandler);
    
    this.iceCandidateQueue = [];
    this.patientAnswered = false;

    // Socket Audio Relay fallback (activated when WebRTC P2P fails)
    this.isRelayMode = false;
    this.relayRecorder = null;       // MediaRecorder capturing local mic for relay
    this.relayAudioCtx = null;       // AudioContext for playing received relay chunks
    this.relaySourceQueue = [];      // Queue of scheduled audio sources
    this.relayNextPlayTime = 0;      // Gapless scheduling clock

    this.initSocket();
  }

  // Initialize Socket.io connection for Counselor
  initSocket() {
    if (typeof io !== 'undefined') {
      // Always connect to the same origin (serve.js proxies /socket.io → port 5001)
      // This works locally (localhost:3001) AND via ngrok without any URL changes.
      const socketUrl = window.location.origin;
      this.socket = io(socketUrl, { transports: ['websocket', 'polling'] });

      this.socket.on('connect', () => {
        console.log('[WebRTC] Connected to Signaling Server:', this.socket.id);
        const counselorId = 'counselor-' + Math.random().toString(36).substr(2, 9);
        this.socket.emit('register', { role: 'counselor', id: counselorId });
      });

      this.socket.on('answer-made', async (data) => {
        // Save patient's SOCKET ID for ICE and end-call routing
        this.patientSocketId = data.socket;
        this.patientAnswered = true;
        console.log('[WebRTC] Patient answered. Patient socket:', this.patientSocketId);
        if (this.peerConnection) {
          try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('[WebRTC] Remote description (answer) set successfully.');
            
            // Flush buffered ICE candidates now that the remote description is set
            for (let candidate of this.iceCandidateQueue) {
              this.socket.emit('ice-candidate', {
                to: this.patientSocketId,
                candidate: candidate
              });
            }
            this.iceCandidateQueue = [];
          } catch (err) {
            console.error('[WebRTC] Failed to set remote description:', err);
          }
        }
      });

      this.socket.on('ice-candidate-received', async (data) => {
      if (this.peerConnection && data.candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          window.CounselFlow.writeAuditEvent(
            'ICE_CANDIDATE_RECEIVED',
            this.currentPatientId,
            null,
            window.CounselFlow.getActiveRole(),
            `Received ICE candidate from ${data.source || 'patient'}`
          );
        } catch (e) {
          console.error('[WebRTC] Error adding received ICE candidate', e);
        }
      }
    });

      this.socket.on('call-failed', (data) => {
        const reason = data && data.reason === 'patient-offline'
          ? 'Patient is not connected to the mobile app.'
          : 'Call could not be connected.';
        window.CounselFlow.app.showToast('Call Failed', reason, 'error');
        this.endCall();
      });

      this.socket.on('call-rejected', () => {
        window.CounselFlow.app.showToast("Call Rejected", "Patient declined the call.", "error");
        this.patientSocketId = null;
        this.endCall();
      });

      this.socket.on('call-ended', () => {
        window.CounselFlow.app.showToast("Call Ended", "Patient ended the call.", "info");
        this.patientSocketId = null;
        this.endCall();
      });
    } else {
      console.warn("Socket.io is not loaded.");
    }
  }

  // Init LiveKit for In-App Calling (Replaces WebRTC P2P)
  async initLiveKit(patient) {
    if (!window.LivekitClient) {
      window.CounselFlow.app.showToast('Error', 'LiveKit SDK not loaded', 'error');
      return;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[LiveKit] Microphone access granted.');

      const roomName = `counselflow-room-${patient.id}`;
      const participantName = `counselor-${Math.random().toString(36).substr(2, 5)}`;
      
      const resp = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (localStorage.getItem('token') || ''),
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ roomName, participantName, isCounselor: true })
      });
      
      const data = await resp.json();
      if (!data.token) throw new Error(data.error || "Could not get LiveKit token");
      
      this.room = new LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
      });

      this.room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === LivekitClient.Track.Kind.Audio || track.kind === 'audio') {
          console.log('[LiveKit] Remote audio track subscribed');
          const element = track.attach();
          document.body.appendChild(element);
          if (typeof element.play === 'function') {
            element.play().catch(e => console.warn('[LiveKit] Audio autoplay blocked:', e));
          }
        }
      });

      this.room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        track.detach();
      });

      // Use the LiveKit URL from the .env, which the backend should expose. Since frontend doesn't have it, we hardcode it for now based on your keys.
      await this.room.connect('wss://ai-assistant-ommd272n.livekit.cloud', data.token);
      console.log('[LiveKit] Connected to room');
      
      // Publish local mic track
      const localAudioTrack = this.localStream.getAudioTracks()[0];
      await this.room.localParticipant.publishTrack(localAudioTrack);

      // Notify patient via socket (since FCM is skipped for now)
      this.socket.emit('call-user', {
         to: patient.id,
         offer: { type: 'livekit', roomName: roomName },
         callerInfo: { name: "Dr. Amanpreet (Counselor)" }
      });
      
      window.CounselFlow.app.showToast("Ringing", `Calling ${patient.name} via Patient Portal...`, "info");
      
    } catch (error) {
      console.error("LiveKit Setup failed:", error);
      this.endCall();
      window.CounselFlow.app.showToast("Call Setup Failed", error.message || "Could not set up LiveKit audio.", "error");
      throw error;
    }
  }


  // Getter for private transcript field supporting inactive fallback (Bug #2)
  getTranscript() {
    return this.isActive ? this.#currentTranscript : this.lastSessionTranscript;
  }

  // Keyboard Shortcuts (UX #53)
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Only trigger shortcuts if a call is actively running
      if (!this.isActive) return;
      
      // Prevent shortcut interference inside input fields or textareas
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        return;
      }
      
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.endCall();
      } else if (key === 'm') {
        e.preventDefault();
        this.toggleMute();
      } else if (key === 'r') {
        e.preventDefault();
        this.toggleRecording();
      } else if (key === 'h') {
        e.preventDefault();
        this.toggleHold();
      }
    });
  }

  // Initialize Live Transcription using Groq Whisper (Replaces flaky Web Speech API)
  initLiveTranscription() {
    try {
      // Helper function to create a chunked recorder that stops/starts to rewrite WebM headers
      const setupChunkedRecorder = (stream, speaker) => {
        if (!stream || !window.MediaRecorder) return null;
        let options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options = { mimeType: 'audio/webm', audioBitsPerSecond: 16000 };
          if (!MediaRecorder.isTypeSupported(options.mimeType)) {
             options = {}; // fallback for Safari
          }
        }
        
        const recorder = new MediaRecorder(stream, options);
        recorder.ondataavailable = async (event) => {
          if (event.data.size > 0 && this.isActive && (!this.isMuted || speaker === "Patient") && !this.isHeld) {
            this.whisperQueue = (this.whisperQueue || Promise.resolve()).then(async () => {
              const transcript = await window.CounselFlow.aiOrchestrator.transcribeAudioChunkAsync(event.data, this.activeLanguage);
              if (transcript && this.isActive) {

                //  Hallucination Guard 
                const isHallucination = (text) => {
                  const t = text.trim();

                  // 2. Repetition loop detection (same word ≥3 times in a row)
                  if (/(\S+)(\s+\1){2,}/i.test(t)) return true;

                  // 3. Known Whisper hallucination blocklist (English / Hindi / Punjabi)
                  const HALLUCINATIONS = [
                    "what's going on", "everything is fine", "i'm feeling a bit anxious",
                    "thank you for watching", "thank you", "thanks for watching",
                    "please subscribe", "like and subscribe",
                    "कर दो", "झाल", "अलवूँ", "जरूर जो",
                    "ਸੁਣੋ", "ਹਾਂ ਜੀ", "ਜੀ ਹਾਂ",
                    "bye bye", "goodbye", "see you", "okay okay okay",
                    ".   .", ". . .", "...",
                  ];
                  const tLower = t.toLowerCase();
                  if (HALLUCINATIONS.some(h => tLower === h || tLower.startsWith(h + " ") || tLower.endsWith(" " + h))) return true;

                  return false;
                };

                if (isHallucination(transcript)) {
                  console.debug('[ASR] Filtered hallucination:', transcript);
                  return;
                }
                // 

                this.addTranscriptLine(speaker, transcript);

              }
            }).catch(e => console.error("Whisper transcription error:", e));
          }
        };

        recorder.start();
        
        // Interval to stop and restart so headers are rewritten for the Whisper API
        const intervalId = setInterval(() => {
          if (this.isActive && recorder.state === 'recording') {
            recorder.stop();
            recorder.start();
          } else if (!this.isActive) {
            clearInterval(intervalId);
            if (recorder.state === 'recording') recorder.stop();
          }
        }, 4000);
        
        return recorder;
      };

      // 1. Setup Counselor Mic Recorder
      if (this.localStream) {
        this.counselorRecorder = setupChunkedRecorder(this.localStream, "Counselor");
        console.log('[ASR] Counselor live transcription started.');
      } else {
        console.warn('[ASR] Local stream or MediaRecorder not available for counselor.');
      }

      // 2. Setup Patient Remote Stream Recorder (if peer connection has streams)
      if (this.peerConnection) {
        const attachRemoteRecorder = (stream) => {
          if (!stream || this.patientRecorder) return;
          this.patientRecorder = setupChunkedRecorder(stream, "Patient");
          console.log('[ASR] Patient live transcription started.');
        };

        // Otherwise listen for the track event
        this.peerConnection.addEventListener('track', (e) => {
          attachRemoteRecorder(e.streams[0]);
        });
        
        // Ensure we try again when the connection is fully established
        this.peerConnection.addEventListener('connectionstatechange', () => {
          if (this.peerConnection.connectionState === 'connected') {
            let retries = 0;
            const checkReceivers = () => {
              const receivers = this.peerConnection.getReceivers();
              const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
              if (audioReceiver && audioReceiver.track.readyState === 'live') {
                const remoteStream = new MediaStream([audioReceiver.track]);
                attachRemoteRecorder(remoteStream);
              } else if (retries < 10) {
                retries++;
                setTimeout(checkReceivers, 500);
              }
            };
            checkReceivers();
          }
        });
      }

    } catch (e) {
      console.error("[ASR] Live transcription setup failed:", e);
      window.CounselFlow.app.showToast("Transcription Error", "Could not start live transcription engine.", "error");
    }
  }

  // ── Socket Audio Relay — activated automatically when WebRTC P2P fails
  // Streams mic audio as 250ms WebM chunks through Socket.IO → server → patient
  // Incoming chunks from patient are decoded & played via AudioContext (gapless queue)
  startSocketAudioRelay() {
    if (this.isRelayMode || !this.patientSocketId || !this.localStream) return;
    this.isRelayMode = true;
    console.log('[Relay] Starting Socket audio relay to patient:', this.patientSocketId);

    // Tell the server to create a relay pair with the patient socket
    this.socket.emit('audio-relay-start', { to: this.patientSocketId });

    // 1. Capture and stream local mic → server → patient
    try {
      const options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 };
      this.relayRecorder = new MediaRecorder(this.localStream, options);
      this.relayRecorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 100 && this.isRelayMode && this.isActive && !this.isMuted) {
          const buf = await event.data.arrayBuffer();
          this.socket.emit('audio-chunk', buf);
        }
      };
      this.relayRecorder.start(1000); // 1000ms chunks
      console.log('[Relay] Mic relay recorder started (1000ms chunks)');
    } catch (e) {
      console.error('[Relay] Could not start relay recorder:', e);
    }

    // 2. Receive and play incoming audio chunks from patient
    this.relayAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    this.relayNextPlayTime = this.relayAudioCtx.currentTime;

    // Add unlock handler for relay audio
    const unlockRelayAudio = () => {
      // Resume audio context if it's suspended
      if (this.relayAudioCtx && this.relayAudioCtx.state === 'suspended') {
        this.relayAudioCtx.resume().then(() => {
          console.log('[Relay] Audio context resumed');
        }).catch(e => {
          console.warn('[Relay] Failed to resume audio context:', e);
        });
      }
    };
    document.addEventListener('click', unlockRelayAudio);
    document.addEventListener('touchstart', unlockRelayAudio);

    this.socket.on('audio-chunk', async (data) => {
      if (!this.isRelayMode || !this.relayAudioCtx) return;
      try {
        // data arrives as ArrayBuffer from the server
        const arrayBuf = data instanceof ArrayBuffer ? data : await new Response(data).arrayBuffer();
        const audioBuf = await this.relayAudioCtx.decodeAudioData(arrayBuf);
        const source = this.relayAudioCtx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(this.relayAudioCtx.destination);
        // Gapless playback scheduling
        const now = this.relayAudioCtx.currentTime;
        const startAt = Math.max(now, this.relayNextPlayTime);
        source.start(startAt);
        this.relayNextPlayTime = startAt + audioBuf.duration;
      } catch (e) {
        // Ignore decode errors for partial/tiny chunks
      }
    });

    console.log('[Relay] Socket audio relay fully active — audio routing through server.');
  }

  stopSocketAudioRelay() {
    if (!this.isRelayMode) return;
    this.isRelayMode = false;
    if (this.relayRecorder && this.relayRecorder.state !== 'inactive') {
      try { this.relayRecorder.stop(); } catch(e) {}
    }
    this.relayRecorder = null;
    if (this.relayAudioCtx) {
      this.relayAudioCtx.close().catch(() => {});
      this.relayAudioCtx = null;
    }
    if (this.socket) {
      this.socket.emit('audio-relay-stop');
      this.socket.off('audio-chunk');
    }
    // Note: We don't remove the unlock handlers here as they're removed in endCall cleanup
    console.log('[Relay] Socket audio relay stopped.');
  }

  // Visual warning banner inside call transcript feed (Error Handling #4)
  addWarningToTranscriptLog(title, message) {
    requestAnimationFrame(() => {
      try {
        const container = document.getElementById('call-transcript-log');
        if (!container) return;
        
        // Remove placeholder text if exists
        const placeholder = document.getElementById('transcript-placeholder-text');
        if (placeholder) placeholder.remove();

        const warningDiv = document.createElement('div');
        warningDiv.className = 'transcript-warning';
        warningDiv.style.cssText = "padding: 12px; margin: 10px 0; background: rgba(239, 68, 68, 0.08); border-left: 4px solid var(--accent-red); border-radius: 4px; font-size: 12px; color: var(--text-primary);";
        // Use textContent for safe rendering — no raw HTML interpolation
        const strong = document.createElement('strong');
        strong.style.cssText = 'color: var(--accent-red); display: flex; align-items: center; gap: 6px; margin-bottom: 4px;';
        strong.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        strong.appendChild(document.createTextNode(title));
        const span = document.createElement('span');
        span.style.color = 'var(--text-secondary)';
        span.textContent = message;
        warningDiv.appendChild(strong);
        warningDiv.appendChild(span);
        container.appendChild(warningDiv);
        container.scrollTop = container.scrollHeight;
      } catch (e) {
        console.error("DOM rendering error in addWarningToTranscriptLog:", e);
      }
    });
  }

  // Show a visible, working "Enable Audio" banner when browser blocks remote audio autoplay
  // This fixes the broken recovery mechanism — the button directly calls if (this.remoteAudio && typeof this.remoteAudio.play === 'function') { this.remoteAudio.play().catch(e => console.warn('Autoplay prevented:', e)); }
  // instead of referencing a non-existent DOM element (#remote-audio is absent in index.html)
  showAutoplayUnlockBanner() {
    requestAnimationFrame(() => {
      try {
        const container = document.getElementById('call-transcript-log');
        if (!container) return;

        // Avoid showing duplicate banners
        if (document.getElementById('autoplay-unlock-banner')) return;

        const placeholder = document.getElementById('transcript-placeholder-text');
        if (placeholder) placeholder.remove();

        const bannerDiv = document.createElement('div');
        bannerDiv.id = 'autoplay-unlock-banner';
        bannerDiv.style.cssText = [
          'padding: 14px 16px',
          'margin: 10px 0',
          'background: rgba(239, 68, 68, 0.08)',
          'border-left: 4px solid var(--accent-red)',
          'border-radius: 4px',
          'font-size: 12px',
          'color: var(--text-primary)',
          'display: flex',
          'align-items: center',
          'gap: 12px',
          'flex-wrap: wrap',
        ].join(';');

        const label = document.createElement('span');
        label.style.flex = '1';
        label.innerHTML = `<strong style="color:var(--accent-red);">⚠ Audio Blocked</strong> — Your browser blocked remote audio autoplay. Click the button to hear the patient.`;

        const btn = document.createElement('button');
        btn.textContent = '🔊 Enable Audio';
        btn.className = 'btn-primary';
        btn.style.cssText = 'padding: 5px 12px; font-size: 11px; white-space: nowrap; flex-shrink: 0;';
        btn.addEventListener('click', () => {
          // Re-attach srcObject in case it was set before the banner appeared
          // Then call play() directly on the in-memory Audio object (no DOM lookup)
          if (this.peerConnection) {
            const receivers = this.peerConnection.getReceivers();
            const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
            if (audioReceiver) {
              this.remoteAudio.srcObject = new MediaStream([audioReceiver.track]);
            }
          }
          if (this.remoteAudio && typeof this.remoteAudio.play === 'function') {
            this.remoteAudio.play()
              .then(() => {
                this._audioUnlocked = true;
                bannerDiv.remove();
                window.CounselFlow.app.showToast('Audio Enabled', 'Remote audio is now playing.', 'success');
              })
              .catch(err => {
                console.error('[WebRTC] Manual audio unlock failed:', err);
                btn.textContent = '⚠ Retry — Click Again';
                window.CounselFlow.app.showToast('Audio Error', 'Click the Enable Audio button again.', 'error');
              });
          }
        });

        bannerDiv.appendChild(label);
        bannerDiv.appendChild(btn);
        container.insertBefore(bannerDiv, container.firstChild);
        container.scrollTop = 0;
      } catch (e) {
        console.error('[WebRTC] showAutoplayUnlockBanner error:', e);
      }
    });
  }

  setCanvas(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    if (this.canvas) {
      this.canvas.width = this.canvas.parentElement.clientWidth;
      this.canvas.height = this.canvas.parentElement.clientHeight || 80;
    }
  }

  // Draw WebRTC audio waveforms with FPS capping and visibility checks (Performance #67, UX #46, UX #47)
  drawWaveform(timestamp) {
    if (!this.isActive) {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      return;
    }
    if (document.hidden) {
      this.animationFrame = requestAnimationFrame((t) => this.drawWaveform(t));
      return;
    }
    
    // Throttle frames to 60 FPS max
    if (!timestamp) timestamp = performance.now();
    const elapsed = timestamp - this.lastFrameTime;
    
    if (elapsed > this.fpsInterval) {
      this.lastFrameTime = timestamp - (elapsed % this.fpsInterval);
      
      if (!this.canvas) return;
      
      const width = this.canvas.width;
      const height = this.canvas.height;
      
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.beginPath();
      
      // Determine stroke color by status
      const isDark = document.body.classList.contains("dark-theme");
      if (this.isHeld) {
        this.ctx.strokeStyle = isDark ? 'rgba(165, 94, 234, 0.4)' : 'rgba(139, 92, 246, 0.5)';
      } else if (!this.isRecording) {
        this.ctx.strokeStyle = isDark ? 'rgba(239, 68, 68, 0.4)' : 'rgba(220, 38, 38, 0.5)';
      } else {
        this.ctx.strokeStyle = this.isMuted 
          ? (isDark ? 'rgba(255, 159, 67, 0.4)' : 'rgba(234, 88, 12, 0.6)') 
          : (isDark ? 'rgba(0, 242, 254, 0.6)' : 'rgba(79, 172, 254, 0.8)');
      }
      
      this.ctx.lineWidth = 3;
      this.ctx.lineCap = 'round';

      const pointsCount = 40;
      const sliceWidth = width / pointsCount;
      let x = 0;

      // Draw visual flatline or overlay if muted/held/not recording (UX #46, UX #47, Phase 2)
      const isFlatLine = this.isMuted || this.isHeld || !this.isRecording;

      for (let i = 0; i < pointsCount; i++) {
        let amplitude = 0;
        if (!isFlatLine) {
          amplitude = Math.sin(i * 0.15 + Date.now() * 0.01) * 20 + Math.cos(i * 0.3 + Date.now() * 0.015) * 10;
          // Dampen ends
          const factor = Math.sin((i / pointsCount) * Math.PI);
          amplitude *= factor;
        }

        const y = (height / 2) + amplitude;

        if (i === 0) {
          this.ctx.moveTo(x, y);
        } else {
          this.ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }
      
      this.ctx.stroke();

      // Draw TEXT overlay on flatline (UX #46, UX #47, Phase 2)
      if (isFlatLine) {
        this.ctx.font = '10px sans-serif';
        this.ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
        this.ctx.textAlign = 'center';
        
        let label = 'MICROPHONE MUTED';
        if (this.isHeld) {
          label = 'CALL ON HOLD';
        } else if (!this.isRecording) {
          label = 'RECORDING DISABLED - NO CONSENT';
        }
        this.ctx.fillText(label, width / 2, height / 2 - 10);
      }
    }
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = requestAnimationFrame((t) => this.drawWaveform(t));
  }

  // Handle Tab visibility switches (Performance #67)
  handleVisibilityChange() {
    if (this.isActive) {
      if (document.hidden) {
        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      } else {
        this.lastFrameTime = performance.now();
        this.drawWaveform();
      }
    }
  }

  clearCanvas() {
    if (this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
  }


  // Begin Tele-Counseling session call
  async startCall(patient, languageCode, direction = "Outbound") {
    if (this.isActive) return;
    
    this.isActive = true;
    this.isMuted = false;
    this.isHeld = false;
    this.duration = 0;
    this.activePatient = patient;
    this.activeLanguage = languageCode;
    this.callDirection = direction;
    this.#currentTranscript = []; // Clean private transcripts array (Bug #2)
    this.lastSessionTranscript = []; // Reset cache (Bug #2)
    this.asrRetryCount = 0; // Reset ASR network retry count (Error Handling #4)
    this.iceCandidateQueue = [];
    this.patientAnswered = false;

    // Initiate LiveKit Call (Replaces WebRTC)
    try {
      await this.initLiveKit(patient);
    } catch (e) {
      return; // initLiveKit already called endCall() and showed a toast
    }
    
    // Gate call recording by patient consent status (Phase 2, Solution Scope #3)
    this.isRecording = !!patient.consentCaptured;
    
    // Update UI elements
    const statusDot = document.getElementById('call-status-dot');
    const statusLabel = document.getElementById('call-status-label');
    const recordBtn = document.getElementById('btn-call-record');
    
    if (this.isRecording) {
      statusDot.className = 'status-dot rec';
      statusLabel.innerText = `${direction} Call - Recording Active`;
      recordBtn.className = 'call-btn record recording';
    } else {
      statusDot.className = 'status-dot';
      statusLabel.innerText = `${direction} Call - Recording Disabled (No Consent)`;
      recordBtn.className = 'call-btn record';
    }
    
    document.getElementById('call-recipient-name').innerText = escapeHtml(patient.name);
    document.getElementById('call-recipient-details').innerText = `${escapeHtml(patient.id)} | ${escapeHtml(patient.addictionCategory)}`;
    document.getElementById('call-recipient-avatar').innerText = patient.name.split(' ').map(n => n[0]).join('');
    document.getElementById('call-recipient-avatar').classList.add('active-call');
    
    // Add hold call button toggle if missing in original index layout
    this.injectHoldButtonIfNeeded();
    
    document.getElementById('btn-call-start').style.display = 'none';
    document.getElementById('btn-call-end').style.display = 'flex';
    document.getElementById('btn-call-mute').className = 'call-btn mute';
    
    document.getElementById('call-transcript-log').innerHTML = '';
    document.getElementById('call-duration-timer').innerText = '0:00:00'; // Expanded timer default
    
    document.getElementById('call-post-summary-section').style.display = 'none';
    document.getElementById('call-transcript-log').style.display = 'flex';

    // Reset post-call actions panel
    const postCallPanel = document.getElementById('post-call-actions-panel');
    if (postCallPanel) postCallPanel.style.display = 'none';

    // Show active language indicator bar
    const langBar = document.getElementById('active-language-bar');
    const langLabel = document.getElementById('active-language-label');
    if (langBar && langLabel) {
      const langNames = { 'pa-IN': 'Punjabi (ਪੰਜਾਬੀ)', 'hi-IN': 'Hindi (हिंदी)', 'en-US': 'English' };
      langLabel.innerText = langNames[languageCode] || languageCode;
      langBar.style.display = 'flex';
    }
    
    // Start canvas waveforms
    this.lastFrameTime = performance.now();
    this.drawWaveform();
    
    // Start duration timer supporting hours layout (UX #51)
    this.timerInterval = setInterval(() => {
      this.duration++;
      const hrs = Math.floor(this.duration / 3600).toString();
      const mins = Math.floor((this.duration % 3600) / 60).toString().padStart(2, '0');
      const secs = (this.duration % 60).toString().padStart(2, '0');
      
      document.getElementById('call-duration-timer').innerText = `${hrs}:${mins}:${secs}`;
    }, 1000);

    // Initialize Live Transcription when call connects (using Groq Whisper chunking)
    if (!this.isRecording) {
      this.addWarningToTranscriptLog(
        "Recording Consent Denied", 
        "This call is not being recorded or transcribed because the patient has not provided consent. Only manual clinical notes will be saved."
      );
    } else if (this.localStream) {
      this.initLiveTranscription();
    } else {
      this.addWarningToTranscriptLog(
        "Microphone Error",
        "Could not access microphone stream. Transcription cannot start."
      );
    }

    window.CounselFlow.app.showToast("Call Connected", `Tele-counseling call started with ${patient.name}.`, "success");
  }

  // End Tele-Counseling session call and trigger AI processing
  endCall() {
    if (!this.isActive) return;
    
    // Log call attempt (Connected) (Phase 2, Solution Scope #2)
    this.logCallAttempt(this.activePatient, this.duration, this.callDirection || "Outbound", "Connected");

    // Copy active transcript to cache and clear (Bug #2)
    this.lastSessionTranscript = JSON.parse(JSON.stringify(this.#currentTranscript));
    this.#currentTranscript = [];
    
    this.isActive = false;
    clearInterval(this.timerInterval);
    this.clearCanvas();
    
    // End WebRTC Connection — use patientSocketId (not patient.id) for socket routing
    if (this.socket) {
      const targetId = this.patientSocketId || (this.activePatient ? this.activePatient.id : null);
      if (targetId) {
        this.socket.emit('end-call', { to: targetId });
      }
    }
    this.patientSocketId = null;
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

     // Stop Whisper Transcribers
     if (this.counselorRecorder && this.counselorRecorder.state !== "inactive") {
       try { this.counselorRecorder.stop(); } catch(e){}
     }
     if (this.patientRecorder && this.patientRecorder.state !== "inactive") {
       try { this.patientRecorder.stop(); } catch(e){}
     }

     // Remove audio unlock handlers
     if (this.audioUnlockHandler) {
       document.removeEventListener('click', this.audioUnlockHandler);
       document.removeEventListener('touchstart', this.audioUnlockHandler);
       document.removeEventListener('keydown', this.audioUnlockHandler);
     }

     // Stop socket audio relay if active
    this.stopSocketAudioRelay();

    // Reset hold button UI status
    const holdBtn = document.getElementById('btn-call-hold');
    if (holdBtn) holdBtn.classList.remove('active');

    // Update Control State UI
    document.getElementById('call-status-dot').className = 'status-dot';
    document.getElementById('call-status-label').innerText = 'Idle';
    document.getElementById('call-recipient-avatar').classList.remove('active-call');
    
    document.getElementById('btn-call-start').style.display = 'flex';
    document.getElementById('btn-call-end').style.display = 'none';
    document.getElementById('btn-call-record').className = 'call-btn record';
    document.getElementById('btn-call-mute').className = 'call-btn mute';
    
    window.CounselFlow.app.showToast("Call Disconnected", "Review the transcript below, then generate your AI summary.", "info");

    // Keep the live transcript visible for review — do NOT swap to summary panel yet
    document.getElementById('call-transcript-log').style.display = 'block';
    document.getElementById('call-post-summary-section').style.display = 'none';

    // Show the Post-Call Actions panel beneath the transcript
    const postCallPanel = document.getElementById('post-call-actions-panel');
    if (postCallPanel) {
      postCallPanel.style.display = 'flex';
    }
  }

  // Record connected/missed/rejected call attempts into global localstorage call logs (Phase 2, Solution Scope #2)
  async logCallAttempt(patient, durationSec, direction, disposition) {
    if (!patient) return;
    
    const hrs = Math.floor(durationSec / 3600).toString();
    const mins = Math.floor((durationSec % 3600) / 60).toString().padStart(2, '0');
    const secs = (durationSec % 60).toString().padStart(2, '0');
    const formattedDuration = `${hrs}:${mins}:${secs}`;
    
    const logId = `LOG-${Math.floor(10000 + Math.random() * 90000)}`;
    const newLog = {
      logId: logId,
      patientId: patient.id,
      patientName: patient.name,
      counselorId: patient.counselorId || "CO-101",
      counselorName: patient.assignedCounselor || "Dr. Amanpreet Kaur",
      timestamp: new Date().toLocaleString(),
      duration: formattedDuration,
      direction: direction || "Outbound",
      disposition: disposition || "Connected"
    };
    
    try {
      const logs = await window.CounselFlow.getCallLogs();
      logs.unshift(newLog);
      window.CounselFlow.saveCallLogs(logs);
      
      // Update the patient's cbmContacts for Stage 4 tracking
      if (!patient.cbmContacts) patient.cbmContacts = [];
      patient.cbmContacts.push({
        date: newLog.timestamp,
        type: newLog.direction,
        counselorId: newLog.counselorId,
        outcome: disposition === 'Connected' ? 'connected' : (disposition === 'Missed' ? 'missed' : 'rejected')
      });
      // Try to save patient changes (assumes we have access to app.patients)
      if (window.CounselFlow.app && window.CounselFlow.app.patients) {
         const ptRef = window.CounselFlow.app.patients.find(p => p.id === patient.id);
         if (ptRef) {
           ptRef.cbmContacts = patient.cbmContacts;
           await window.CounselFlow.savePatients(window.CounselFlow.app.patients);
         }
      }

      // If the app controller is running, refresh the supervisor tables
      if (window.CounselFlow.app && typeof window.CounselFlow.app.renderSessionHistoryLogs === 'function') {
        window.CounselFlow.app.renderSessionHistoryLogs();
      }
    } catch (e) {
      console.error("Failed to write call log attempt:", e);
    }
  }

  // Mute audio stream toggler
  toggleMute() {
    if (!this.isActive) return;
    this.isMuted = !this.isMuted;
    
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }

    const btn = document.getElementById('btn-call-mute');
    if (this.isMuted) {
      btn.classList.add('active');
      window.CounselFlow.app.showToast("Mic Muted", "Microphone audio feeds suspended.", "info");
    } else {
      btn.classList.remove('active');
      window.CounselFlow.app.showToast("Mic Active", "Microphone audio feeds restored.", "success");
    }
  }

  // Hold Call handler (UX #47)
  toggleHold() {
    if (!this.isActive) return;
    this.isHeld = !this.isHeld;
    
    const btn = document.getElementById('btn-call-hold');
    if (btn) {
      if (this.isHeld) {
        btn.classList.add('active');
        window.CounselFlow.app.showToast("Call Held", "Tele-counseling call has been placed on hold.", "info");
      } else {
        btn.classList.remove('active');
        window.CounselFlow.app.showToast("Call Restored", "Tele-counseling call has been resumed.", "success");
      }
    }
  }

  // Recording status toggler
  toggleRecording() {
    if (!this.isActive) return;
    this.isRecording = !this.isRecording;
    
    const btn = document.getElementById('btn-call-record');
    if (this.isRecording) {
      btn.classList.add('recording');
      document.getElementById('call-status-dot').className = 'status-dot rec';
      document.getElementById('call-status-label').innerText = 'Call Recording Active';
      window.CounselFlow.app.showToast("Recording Resumed", "ASR pipeline is running.", "info");
    } else {
      btn.classList.remove('recording');
      document.getElementById('call-status-dot').className = 'status-dot';
      document.getElementById('call-status-label').innerText = 'Recording Suspended';
      window.CounselFlow.app.showToast("Recording Paused", "Speech transcription temporarily paused.", "info");
    }
  }

  // Populate line on current visual transcript feed with batched/requestAnimationFrame frames
  addTranscriptLine(speaker, text) {
    if (!text || !text.trim()) return;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.#currentTranscript.push({ speaker, text, timestamp: time });
    // Relay to patient portal for live transcript feature
    if (this.socket && this.patientSocketId) {
      this.socket.emit('transcript-update', {
        to: this.patientSocketId,
        text: text,
        sender: speaker.toLowerCase() === 'counselor' ? 'counselor' : 'patient'
      });
    }

    
    // Performance #62: requestAnimationFrame scheduling
    requestAnimationFrame(() => {
      try {
        const container = document.getElementById('call-transcript-log');
        if (!container) return;
        
        // Remove placeholder text if exists
        const placeholder = document.getElementById('transcript-placeholder-text');
        if (placeholder) placeholder.remove();

        const bubble = document.createElement('div');
        bubble.className = `transcript-bubble ${speaker.toLowerCase()}`;
        
        // UX #52: Speaker avatars or initials next to bubble speaker names
        const initials = speaker === 'Counselor' ? 'C' : (this.activePatient ? this.activePatient.name.charAt(0) : 'P');
        const color = speaker === 'Counselor' ? 'var(--accent-blue)' : 'var(--text-secondary)';
        
        bubble.innerHTML = `
          <div class="bubble-speaker ${speaker.toLowerCase()}" style="display:flex; align-items:center; gap:8px;">
            <span style="display:inline-block; width:16px; height:16px; font-size:10px; font-weight:700; border-radius:50%; background:${color}; color:white; text-align:center; line-height:16px;">${initials}</span>
            <span>${speaker === 'Counselor' ? 'Dr. Amanpreet (Counselor)' : escapeHtml(this.activePatient.name)}</span>
            <span class="bubble-time">${time}</span>
          </div>
          <p>${escapeHtml(text)}</p>
        `;
        
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;
      } catch (e) {
        console.error("DOM rendering error in addTranscriptLine:", e);
      }
    });
  }

  // Load and play a dialogue scenario to demonstrate multi-language speech capabilities (Bug #3, Issue #30)
  async playScenarioScript(langKey, targetPatient = null) {
    // Bug #3: Clear old scenario intervals before triggering a new one
    if (this.scenarioInterval) {
      clearInterval(this.scenarioInterval);
    }
    
    const scenario = CALL_SCENARIOS[langKey];
    if (!scenario) return;

    const patientObj = targetPatient || window.CounselFlow.app.patients.find(p => p.id === scenario.patientId);
    if (!patientObj) return;

    this.activeScenarioKey = langKey;
    await this.startCall(patientObj, scenario.langCode, "Outbound", true);

    // Disable audio track instead of pausing the recorder
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => track.enabled = false);
    }
    this.addTranscriptLine("System", "[Counselor placed call on Hold]");
    const scriptLines = scenario.transcript;
    this.scenarioIndex = 0;

    const playNextTurn = () => {
      if (this.scenarioIndex < scriptLines.length) {
        const line = scriptLines[this.scenarioIndex];
        this.addTranscriptLine(line.speaker, line.text);
        this.scenarioIndex++;
        
        // Issue #30: Replace robotic fixed interval with dynamic text length delay
        const nextDelay = Math.max(1500, line.text.length * 60);
        this.scenarioInterval = setTimeout(playNextTurn, nextDelay);
      } else {
        setTimeout(() => this.endCall(), 1200);
      }
    };

    // Trigger the dynamic recursive timeout sequence
    this.scenarioInterval = setTimeout(playNextTurn, 1000);
  }

  async compileAISummary() {
    let summaryObj;
    try {
      summaryObj = await window.CounselFlow.aiOrchestrator.generateSummaryAsync(this.getTranscript(), this.activeLanguage);
    } catch (e) {
      console.error("Failed to generate summary asynchronously, falling back to local NLP:", e);
      summaryObj = window.CounselFlow.aiOrchestrator.generateSummary(this.getTranscript(), this.activeLanguage);
    }
    
    // Draw fields safely escaping outputs
    document.getElementById('summary-field-overview').innerText = summaryObj.overview;
    document.getElementById('summary-field-concerns').innerText = summaryObj.concerns;
    document.getElementById('summary-field-observations').innerText = summaryObj.observations;
    
    // Bug #4: Safely escape risk content before rendering inside unescaped status HTML
    const safeRisk = escapeHtml(summaryObj.risk);
    const riskClass = safeRisk.toLowerCase().includes('high') ? 'risk' : safeRisk.toLowerCase().includes('medium') ? 'monitored' : 'completed';
    document.getElementById('summary-field-risk').innerHTML = `<span class="pill-status ${riskClass}">${safeRisk}</span>`;
    
    document.getElementById('summary-field-actions').innerText = summaryObj.actions;
    document.getElementById('summary-field-notes').value = "";

    //  Escalation Badge (Req 4, Req 9) 
    const escLevel = summaryObj.escalationLevel || 0;
    const escReason = summaryObj.escalationReason || null;
    const escConfigs = {
      0: { label: 'L0 — No Escalation', color: 'var(--accent-teal)', deadline: null },
      1: { label: '️ L1 Escalation — Supervisor (4h)', color: 'var(--accent-orange)', deadline: '4 hours' },
      2: { label: ' L2 Escalation — DDRC Clinical (24h)', color: 'var(--accent-red)', deadline: '24 hours' },
      3: { label: ' L3 Escalation — State Programme (48h)', color: '#dc2626', deadline: '48 hours' }
    };
    const escCfg = escConfigs[escLevel] || escConfigs[0];

    // Inject or update escalation badge in summary header
    let escBadge = document.getElementById('summary-escalation-badge');
    if (!escBadge) {
      const summaryHeader = document.querySelector('#call-post-summary-section h3');
      if (summaryHeader) {
        escBadge = document.createElement('div');
        escBadge.id = 'summary-escalation-badge';
        escBadge.style.cssText = 'margin-top:10px; padding:8px 14px; border-radius: 4px; font-size:12px; font-weight:700; display:inline-flex; align-items:center; gap:8px;';
        summaryHeader.insertAdjacentElement('afterend', escBadge);
      }
    }
    if (escBadge) {
      escBadge.style.background = escLevel > 0 ? `${escCfg.color}22` : 'var(--bg-input)';
      escBadge.style.border = `1px solid ${escLevel > 0 ? escCfg.color : 'var(--border-light)'}`;
      escBadge.style.color = escLevel > 0 ? escCfg.color : 'var(--text-muted)';
      escBadge.innerHTML = `<span>${escCfg.label}</span>${escReason ? `<span style="font-weight:400; font-size:11px;">— ${escapeHtml(escReason)}</span>` : ''}`;
    }

    // Auto-push notification if escalation needed (Req 9)
    if (escLevel >= 1 && window.CounselFlow.app && this.activePatient) {
      const patName = this.activePatient.name;
      const deadline = escCfg.deadline;
      window.CounselFlow.app.notifications.unshift({
        id: Date.now(),
        text: `${escCfg.label}: ${patName} — SOP response required within ${deadline}. ${escReason || ''}`,
        time: 'Just now',
        unread: true
      });
      window.CounselFlow.app.updateNotificationBadge();
      window.CounselFlow.app.renderNotificationDropdownList();
    }

    //  Session Score Card (Req 5) 
    if (window.CounselFlow.app && typeof window.CounselFlow.app.renderSessionScoreCard === 'function') {
      window.CounselFlow.app.renderSessionScoreCard(summaryObj, this.getTranscript());
    }

    this.loadedSummary = summaryObj;
  }

  injectHoldButtonIfNeeded() {
    let holdBtn = document.getElementById('btn-call-hold');
    if (!holdBtn) {
      const controls = document.querySelector('.call-controls');
      if (controls) {
        holdBtn = document.createElement('button');
        holdBtn.id = 'btn-call-hold';
        holdBtn.className = 'call-btn mute';
        holdBtn.title = 'Hold Call (Press H)';
        holdBtn.style.marginRight = '8px';
        holdBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;
        
        // Append hold button in the controls row before record button
        const recordBtn = document.getElementById('btn-call-record');
        controls.insertBefore(holdBtn, recordBtn);
        
        holdBtn.addEventListener('click', () => this.toggleHold());
      }
    }
  }

  // Stop active scenario loops if user navigates away (Architecture #43)
  cleanup() {
    if (this.scenarioInterval) {
      clearTimeout(this.scenarioInterval);
      this.scenarioInterval = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.clearCanvas();
  }
}

// Namespace consolidation (Architecture #32)
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.callManager = new CallManager();
