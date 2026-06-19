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
    this.whisperQueue = Promise.resolve(); // Issue 2: Initialize whisperQueue
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
      // Only attempt to play remoteAudio if a source is set
      if (this.remoteAudio && (this.remoteAudio.srcObject || this.remoteAudio.src)) {
        if (typeof this.remoteAudio.play === 'function') {
          this.remoteAudio.play().catch(e => {
            console.warn('[WebRTC] Audio autoplay blocked:', e);
            if (!document.getElementById('autoplay-unlock-banner')) {
              this.addWarningToTranscriptLog(
                "Audio Blocked", 
                "Browser blocked autoplay. Click anywhere on the screen to enable audio."
              );
            }
          });
        }
      }
      // Resume any suspended AudioContexts (Relay or STT)
      if (this.relayAudioCtx && this.relayAudioCtx.state === 'suspended') {
        this.relayAudioCtx.resume().catch(e => console.warn('[Relay] Failed to resume AudioContext:', e));
      }
      for (const speaker of Object.keys(this.sttAudioContexts)) {
        const ctx = this.sttAudioContexts[speaker];
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(e => console.warn(`[STT] Failed to resume AudioContext for ${speaker}:`, e));
        }
      }
      // Play all other audio elements (like LiveKit ones) to unlock them
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(el => {
        if (el !== this.remoteAudio && el.paused) {
          el.play().catch(e => console.warn('[LiveKit] Failed to play attached audio element on gesture:', e));
        }
      });
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

    // Sarvam Streaming STT state
    this.sttAudioContexts = {};      // speaker -> AudioContext used for PCM extraction
    this.sttProcessors = {};         // speaker -> ScriptProcessorNode
    this.sttStreamsActive = {};       // speaker -> boolean

    this.initSocket();
  }

  // Initialize Socket.io connection for Counselor
  initSocket() {
    if (typeof io !== 'undefined') {
      // Always connect to the same origin (serve.js proxies /socket.io → port 5001)
      // This works locally (localhost:3001) AND via ngrok without any URL changes.
      const socketUrl = window.location.origin;
      this.socket = io(socketUrl, { transports: ['polling', 'websocket'] });

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
            this.activePatient?.id,
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

      this.socket.on('dashboard-observe-call', async (data) => {
         if (!this.isActive && !this.room && data.roomName) {
             const isSdp = data.roomName.includes('v=0') || data.roomName.includes('\n') || data.roomName.length > 128;
             console.log('[LiveKit] Auto-observing mobile-to-mobile call. Is WebRTC SDP:', isSdp, 'Room:', data.roomName);
             
             let patientName = 'Patient ' + data.patientId;
             let targetPatient = null;
             if (window.CounselFlow && window.CounselFlow.app && window.CounselFlow.app.patients) {
                 const pt = window.CounselFlow.app.patients.find(p => p.id === data.patientId);
                 if (pt) {
                     targetPatient = pt;
                     patientName = pt.name || patientName;
                 }
             }

             if (isSdp) {
                 // WebRTC Peer-to-Peer / Relay Mode
                 this.isActive = true;
                 this.isObserver = true;
                 this.activePatient = targetPatient || { id: data.patientId, name: patientName };
                 this.callDirection = "Mobile Call";
                 
                 // Update UI to active call state
                 this.setupObserverUI(this.activePatient);
                 
                 if (window.CounselFlow && window.CounselFlow.app) {
                     window.CounselFlow.app.selectedPatient = this.activePatient;
                 }
                 window.CounselFlow.app.switchScreen('call-console');
                 
                 this.duration = 0;
                 if (this.timerInterval) clearInterval(this.timerInterval);
                 this.timerInterval = setInterval(() => {
                   this.duration++;
                   const hrs = Math.floor(this.duration / 3600).toString();
                   const mins = Math.floor((this.duration % 3600) / 60).toString().padStart(2, '0');
                   const secs = (this.duration % 60).toString().padStart(2, '0');
                   const timerEl = document.getElementById('call-duration-timer');
                   if (timerEl) timerEl.innerText = `${hrs}:${mins}:${secs}`;
                 }, 1000);
                 
                 window.CounselFlow.app.showToast("Call Observer Active", "Live transcription enabled for mobile WebRTC call.", "info");
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
      // Only attempt to play remoteAudio if a source is set
      if (this.remoteAudio && (this.remoteAudio.srcObject || this.remoteAudio.src)) {
        if (typeof this.remoteAudio.play === 'function') {
          this.remoteAudio.play().catch(e => {
            console.warn('[WebRTC] Audio autoplay blocked:', e);
            if (!document.getElementById('autoplay-unlock-banner')) {
              this.addWarningToTranscriptLog(
                "Audio Blocked", 
                "Browser blocked autoplay. Click anywhere on the screen to enable audio."
              );
            }
          });
        }
      }
      // Resume any suspended AudioContexts (Relay or STT)
      if (this.relayAudioCtx && this.relayAudioCtx.state === 'suspended') {
        this.relayAudioCtx.resume().catch(e => console.warn('[Relay] Failed to resume AudioContext:', e));
      }
      for (const speaker of Object.keys(this.sttAudioContexts)) {
        const ctx = this.sttAudioContexts[speaker];
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(e => console.warn(`[STT] Failed to resume AudioContext for ${speaker}:`, e));
        }
      }
      // Play all other audio elements (like LiveKit ones) to unlock them
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach(el => {
        if (el !== this.remoteAudio && el.paused) {
          el.play().catch(e => console.warn('[LiveKit] Failed to play attached audio element on gesture:', e));
        }
      });
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

    // Sarvam Streaming STT state
    this.sttAudioContexts = {};      // speaker -> AudioContext used for PCM extraction
    this.sttProcessors = {};         // speaker -> ScriptProcessorNode
    this.sttStreamsActive = {};       // speaker -> boolean

    this.initSocket();
  }

  // Initialize Socket.io connection for Counselor
  initSocket() {
    if (typeof io !== 'undefined') {
      // Always connect to the same origin (serve.js proxies /socket.io → port 5001)
      // This works locally (localhost:3001) AND via ngrok without any URL changes.
      const socketUrl = window.location.origin;
      this.socket = io(socketUrl, { transports: ['polling', 'websocket'] });

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
            this.activePatient?.id,
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

      this.socket.on('dashboard-observe-call', async (data) => {
         if (!this.isActive && !this.room && data.roomName) {
             const isSdp = data.roomName.includes('v=0') || data.roomName.includes('\n') || data.roomName.length > 128;
             console.log('[LiveKit] Auto-observing mobile-to-mobile call. Is WebRTC SDP:', isSdp, 'Room:', data.roomName);
             
             let patientName = 'Patient ' + data.patientId;
             let targetPatient = null;
             if (window.CounselFlow && window.CounselFlow.app && window.CounselFlow.app.patients) {
                 const pt = window.CounselFlow.app.patients.find(p => p.id === data.patientId);
                 if (pt) {
                     targetPatient = pt;
                     patientName = pt.name || patientName;
                 }
             }

             if (isSdp) {
                 // WebRTC Peer-to-Peer / Relay Mode
                 this.isActive = true;
                 this.isObserver = true;
                 this.activePatient = targetPatient || { id: data.patientId, name: patientName };
                 this.callDirection = "Mobile Call";
                 
                 // Update UI to active call state
                 this.setupObserverUI(this.activePatient);
                 
                 if (window.CounselFlow && window.CounselFlow.app) {
                     window.CounselFlow.app.selectedPatient = this.activePatient;
                 }
                 window.CounselFlow.app.switchScreen('call-console');
                 
                 this.duration = 0;
                 if (this.timerInterval) clearInterval(this.timerInterval);
                 this.timerInterval = setInterval(() => {
                   this.duration++;
                   const hrs = Math.floor(this.duration / 3600).toString();
                   const mins = Math.floor((this.duration % 3600) / 60).toString().padStart(2, '0');
                   const secs = (this.duration % 60).toString().padStart(2, '0');
                   const timerEl = document.getElementById('call-duration-timer');
                   if (timerEl) timerEl.innerText = `${hrs}:${mins}:${secs}`;
                 }, 1000);
                 
                 window.CounselFlow.app.showToast("Call Observer Active", "Live transcription enabled for mobile WebRTC call.", "info");
             } else {
                 // LiveKit Mode
                 try {
                     const participantName = `Dashboard-Observer-${Math.random().toString(36).substr(2, 5)}`;
                     const resp = await fetch('/api/livekit/token', {
                         method: 'POST',
                         headers: { 
                           'Content-Type': 'application/json',
                           'Authorization': 'Bearer ' + ((window.CounselFlow && typeof window.CounselFlow.safeGetItem === 'function') ? (window.CounselFlow.safeGetItem('token') || '') : (localStorage.getItem('token') || '')),
                           'X-Requested-With': 'XMLHttpRequest'
                         },
                         body: JSON.stringify({ roomName: data.roomName, participantName, isCounselor: true })
                     });
                     const tokenData = await resp.json();
                     if (tokenData.token && window.LivekitClient) {
                         this.isActive = true;
                         this.isObserver = true;
                         this.activePatient = targetPatient || { id: data.patientId, name: patientName };
                         this.callDirection = "Mobile Call";
                         
                         // Update UI to active call state
                         this.setupObserverUI(this.activePatient);
                         
                         if (window.CounselFlow && window.CounselFlow.app) {
                             window.CounselFlow.app.selectedPatient = this.activePatient;
                         }
                         window.CounselFlow.app.switchScreen('call-console');
                         
                         this.duration = 0;
                         if (this.timerInterval) clearInterval(this.timerInterval);
                         this.timerInterval = setInterval(() => {
                           this.duration++;
                           const hrs = Math.floor(this.duration / 3600).toString();
                           const mins = Math.floor((this.duration % 3600) / 60).toString().padStart(2, '0');
                           const secs = (this.duration % 60).toString().padStart(2, '0');
                           const timerEl = document.getElementById('call-duration-timer');
                           if (timerEl) timerEl.innerText = `${hrs}:${mins}:${secs}`;
                         }, 1000);
                         
                         this.room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
                         this.room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
                             if (track.kind === 'audio' || track.kind === LivekitClient.Track.Kind.Audio) {
                                  const element = track.attach();
                                  document.body.appendChild(element);
                                  if (typeof element.play === 'function') {
                                      element.play().catch(e => {
                                          console.warn('[LiveKit] Audio autoplay blocked:', e);
                                          this.showAutoplayUnlockBanner();
                                      });
                                  }
                                 
                                 const stream = new MediaStream([track.mediaStreamTrack]);
                                 const speakerName = (participant.name || "").toLowerCase().includes("counselor") ? "Counselor" : "Patient";
                                 this.setupStreamingSTT(stream, speakerName);

                                 if (this.callRecordCtx && this.callRecordDest) {
                                   try {
                                     const remoteSource = this.callRecordCtx.createMediaStreamSource(stream);
                                     remoteSource.connect(this.callRecordDest);
                                   } catch(e) {}
                                 }
                              }
                          });
                          this.room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
                              console.log('[LiveKit] Participant disconnected:', participant.identity);
                              window.CounselFlow.app.showToast("Call Ended", "Participant ended the call.", "info");
                              this.endCall();
                          });
                          
                          this.room.on(LivekitClient.RoomEvent.Disconnected, () => {
                              console.log('[LiveKit] Room disconnected.');
                              this.endCall();
                          });

                          // Listen for transcription from mobile clients
                          this.socket.on('transcription', (transcriptData) => {
                              if (transcriptData && transcriptData.roomName === data.roomName && transcriptData.text) {
                                  const speaker = transcriptData.speaker === 'counselor' ? 'Counselor' : 'Patient';
                                  this.addTranscriptLine(speaker, transcriptData.text);
                              }
                          });

                          await this.room.connect(tokenData.url, tokenData.token);
                          window.CounselFlow.app.showToast("Call Observer Active", "Live transcription enabled for mobile call.", "info");
                      }
                  } catch (err) {
                      console.error('[LiveKit] Failed to observe call:', err);
                  }
             }
         }
        });

       // Handle inbound call notifications (patient calling counselor)
       this.socket.on('incoming-call', (data) => {
         console.log('[WebRTC] Incoming call from patient:', data.patientName || data.patientId);
         if (!this.isActive) {
           this.showIncomingCallPopup(data.patientId, data.patientName, data.roomName);
         }
       });

       // Handle transcript updates during LiveKit calls
       this.socket.on('transcript-update', (data) => {
         if (data && data.text && this.isActive) {
           const speaker = data.sender === 'counselor' ? 'Counselor' : 'Patient';
           this.addTranscriptLine(speaker, data.text);
         }
       });

       // ── Sarvam Streaming STT Events ──
       this.socket.on('stt-transcript', (data) => {
         if (data && data.text && this.isActive) {
           // Apply hallucination guard
           const t = data.text.trim();
           if (t.length < 2) return;
           if (/(\S+)(\s+\1){2,}/i.test(t)) return;
           const HALLUCINATIONS = [
             'thank you for watching', 'thank you', 'thanks for watching',
             'please subscribe', 'like and subscribe',
             'bye bye', 'goodbye', 'see you', 'okay okay okay',
             '.   .', '. . .', '...',
           ];
           const tLower = t.toLowerCase().replace(/[.,!?;*"]/g, '').trim();
           if (HALLUCINATIONS.some(h => tLower === h)) return;

           this.addTranscriptLine(data.speaker, data.text);
         }
       });

       this.socket.on('stt-vad-event', (data) => {
         if (!this.isActive || !data) return;
         const indicator = document.getElementById(`vad-indicator-${data.speaker}`);
         if (indicator) {
           if (data.signalType === 'START_SPEECH') {
             indicator.classList.add('speaking');
             indicator.textContent = `${data.speaker}: Speaking...`;
           } else {
             indicator.classList.remove('speaking');
             indicator.textContent = `${data.speaker}: Silent`;
           }
         }
       });

       this.socket.on('stt-stream-ready', (data) => {
         console.log(`[Sarvam STT] Stream ready for ${data.speaker}`);
       });

       
       this.socket.on('mobile-call-finished', (data) => {
          if (this.isObserver && this.activePatient && data.patientId === this.activePatient.id) {
             console.log('[Observer] Mobile call finished. Saving logs.');
             this.finalRecordingUrl = data.url;
             this.lastSessionTranscript = data.transcript || [];
             if (window.CounselFlow && window.CounselFlow.app) {
                window.CounselFlow.app.saveCallLog(this.activePatient, "Mobile Call", this.duration, this.lastSessionTranscript, data.url, "Completed");
             }
          }
       });

       this.socket.on('stt-error', (data) => {
         console.error('[Sarvam STT] Error:', data.message);
         if (window.CounselFlow && window.CounselFlow.app) {
           window.CounselFlow.app.showToast('STT Error', data.message || 'Transcription error.', 'error');
         }
       });
    } else {
      console.warn("Socket.io is not loaded.");
    }
  }

  // Init LiveKit for In-App Calling (App-to-App Architecture)
  
  async setupWebRTC(patient) {
    console.log('[WebRTC] Initiating P2P Call to', patient.id);
    
    // Create standard WebRTC PeerConnection
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    this.peerConnection = new RTCPeerConnection(configuration);
    
    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle incoming audio
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Remote track received');
      if (this.remoteAudio) {
        this.remoteAudio.srcObject = event.streams[0];
      }
      
      // Wire up Sarvam Streaming STT!
      const speakerName = "Patient";
      this.setupStreamingSTT(event.streams[0], speakerName);
      
      if (this.callRecordCtx && this.callRecordDest) {
         try {
           const remoteSource = this.callRecordCtx.createMediaStreamSource(event.streams[0]);
           remoteSource.connect(this.callRecordDest);
         } catch(e) {}
      }
    };

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        if (this.patientAnswered && this.patientSocketId) {
          this.socket.emit('ice-candidate', {
            to: this.patientSocketId,
            candidate: event.candidate
          });
        } else {
          this.iceCandidateQueue.push(event.candidate);
        }
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'failed' || this.peerConnection.connectionState === 'disconnected') {
        // Fallback to relay
        this.startSocketAudioRelay();
      }
    };

    // Create and send offer
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      this.socket.emit('call-user', {
        to: patient.id,
        offer: this.peerConnection.localDescription,
        callerInfo: { name: "Dr. Amanpreet (Counselor)" }
      });
      window.CounselFlow.app.showToast("Ringing", `Calling ${patient.name} via WebRTC...`, "info");
    } catch (e) {
      console.error('[WebRTC] Error creating offer', e);
      throw e;
    }
  }


           const data = await res.json();
           if (data.success && data.url) {
              this.finalRecordingUrl = data.url;
              console.log('[Recorder] Saved full call recording to', data.url);
              
              if (audioContainer) {
                audioContainer.style.display = 'block';
                audioContainer.innerHTML = `
                  <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; background:rgba(16,185,129,0.05); border-top:1px solid var(--border-light); flex-wrap:wrap; border-radius: 0 0 8px 8px;">
                    <div style="display:flex; align-items:center; gap:8px; font-size:13px; color:var(--accent-teal);">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                      <strong>Call Recording Saved</strong>
                    </div>
                    <audio controls src="${data.url}" style="height:32px; max-width:100%; border-radius:4px;"></audio>
                  </div>
                `;
              }
           } else {
              throw new Error("Invalid response");
           }
         } catch(e) {
           console.error("[Recorder] Upload failed", e);
           if (audioContainer) {
             audioContainer.style.display = 'block';
             audioContainer.innerHTML = `
               <div style="display:flex; align-items:center; gap:8px; padding:12px 16px; background:rgba(239,68,68,0.05); color:var(--accent-red); font-size:12px; border-top:1px solid var(--border-light); border-radius: 0 0 8px 8px;">
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                 <span>Failed to upload call recording: ${e.message || e}</span>
               </div>
             `;
           }
         }
      };
      this.fullCallRecorder.start(1000); 
      console.log('[Recorder] Full call recording started');
    } catch(e) {
      console.warn("[Recorder] Could not start full call recording", e);
    }
  }
}


// Namespace consolidation (Architecture #32)
window.CounselFlow = window.CounselFlow || {};
window.CounselFlow.callManager = new CallManager();
