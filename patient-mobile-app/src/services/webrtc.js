import { io } from 'socket.io-client';
let cachedWebRTCModule = null;
let cachedWebRTCModuleLoaded = false;

const getWebRTCModule = () => {
  if (cachedWebRTCModuleLoaded) return cachedWebRTCModule || {};
  cachedWebRTCModuleLoaded = true;
  try {
    const { Platform } = require('react-native');
    if (Platform.OS !== 'web') {
      cachedWebRTCModule = require('react-native-webrtc');
    }
  } catch (e) {
    console.warn('[WebRTCService] Native WebRTC module not available:', e.message);
  }
  return cachedWebRTCModule || {};
};

const RTCPeerConnection = new Proxy(class {}, {
  construct(target, args) {
    const module = getWebRTCModule();
    if (module.RTCPeerConnection) {
      return new module.RTCPeerConnection(...args);
    }
    throw new Error('RTCPeerConnection not supported');
  }
});

const RTCSessionDescription = new Proxy(class {}, {
  construct(target, args) {
    const module = getWebRTCModule();
    if (module.RTCSessionDescription) {
      return new module.RTCSessionDescription(...args);
    }
    throw new Error('RTCSessionDescription not supported');
  }
});

const RTCIceCandidate = new Proxy(class {}, {
  construct(target, args) {
    const module = getWebRTCModule();
    if (module.RTCIceCandidate) {
      return new module.RTCIceCandidate(...args);
    }
    throw new Error('RTCIceCandidate not supported');
  }
});

const mediaDevices = new Proxy({}, {
  get(target, prop) {
    const module = getWebRTCModule();
    if (module.mediaDevices && module.mediaDevices[prop]) {
      return typeof module.mediaDevices[prop] === 'function'
        ? module.mediaDevices[prop].bind(module.mediaDevices)
        : module.mediaDevices[prop];
    }
    return undefined;
  }
});

// Backend URL — all traffic (signaling + audio relay) goes through this single ngrok tunnel
export const SERVER_URL = 'https://altitude-quintuple-compile.ngrok-free.dev';

class WebRTCService {
  constructor() {
    this.socket = null;
    this.peerConnection = null;
    this.localStream = null;
    this.currentOffer = null;
    this.counselorSocket = null; // Stores target peer's socket ID

    // ICE candidate buffering (fix for race condition)
    this._iceCandidateBuffer = [];
    this._localIceCandidates = [];
    this._remoteDescSet = false;

    // Socket audio relay fallback (when WebRTC P2P fails on mobile NAT)
    this.isRelayMode = false;
    this.relayRecorder = null;
    this._relayCallbacks = {};
    this.qualityInterval = null;
    this._callbacks = {};
    this.heartbeatInterval = null;
    this.userId = null;
    this.role = 'patient';
  }

  async getIceConfig() {
    const fallback = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 10,
    };
    try {
      const resp = await fetch(`${SERVER_URL}/api/ice-servers`);
      if (resp.ok) {
        const data = await resp.json();
        return { iceServers: data.iceServers, iceCandidatePoolSize: data.iceCandidatePoolSize || 10 };
      }
    } catch (e) {
      console.warn('[MobileWebRTC] Could not fetch ICE config, using fallback:', e.message);
    }
    return fallback;
  }

  connect(userId, role = 'patient', callbacks) {
    this.userId = userId;
    this.role = role;
    this._relayCallbacks = callbacks;
    this._callbacks = callbacks;
    this.socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      console.log(`[MobileWebRTC] Socket connected: ${this.socket.id} as ${this.role}`);
      this.socket.emit('register', { role: this.role, id: this.userId });
      if (callbacks.onConnect) callbacks.onConnect();

      // Start periodic registration heartbeat (every 10s) to maintain online status
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = setInterval(() => {
        if (this.socket && this.socket.connected) {
          this.socket.emit('register', { role: this.role, id: this.userId });
        }
      }, 10000);
    });

    this.socket.on('disconnect', () => {
      console.log('[MobileWebRTC] Disconnected from server');
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      if (callbacks.onDisconnect) callbacks.onDisconnect();
    });

    // --- Patient Specific Events ---
    this.socket.on('call-made', async (data) => {
      console.log('[MobileWebRTC] Incoming call from:', data.socket);

      // Reset ICE candidate buffer for this new call
      this._iceCandidateBuffer = [];
      this._localIceCandidates = [];
      this._remoteDescSet = false;
      this.isRelayMode = false;
      if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }

      const iceConfig = await this.getIceConfig();
      try {
        this.peerConnection = new RTCPeerConnection(iceConfig);

        this.peerConnection.ontrack = (event) => {
          console.log('[MobileWebRTC] Remote track received');
          if (callbacks.onRemoteTrack) {
            callbacks.onRemoteTrack(event.streams[0]);
          }
        };

        this.peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            this.socket.emit('ice-candidate', {
              to: data.socket,
              candidate: event.candidate
            });
          }
        };

        this.peerConnection.onconnectionstatechange = () => {
          const state = this.peerConnection?.connectionState;
          console.log('[MobileWebRTC] Connection state:', state);
          if (state === 'connected') {
            this.startQualityMonitor(callbacks);
            if (callbacks.onCallConnected) callbacks.onCallConnected();
          } else if (state === 'failed' || state === 'disconnected') {
            console.warn('[MobileWebRTC] WebRTC P2P failed — switching to Socket audio relay');
            this.startSocketAudioRelay(data.socket, callbacks);
          }
        };
      } catch (err) {
        console.warn('[MobileWebRTC] WebRTC native module not supported (running in Expo Go fallback mode)');
        this.peerConnection = null;
        
        setTimeout(() => {
          if (callbacks.onRelayStarted) callbacks.onRelayStarted();
          if (callbacks.onCallConnected) callbacks.onCallConnected();
        }, 800);
      }

      this.currentOffer = data.offer;
      this.counselorSocket = data.socket;

      const callerName = data.callerInfo?.name || 'Your Counselor';
      if (callbacks.onIncomingCall) callbacks.onIncomingCall(callerName);
    });

    // --- Counselor Specific Events ---
    this.socket.on('answer-made', async (data) => {
      console.log('[MobileWebRTC] Patient answered call, peer socket:', data.socket);
      this.counselorSocket = data.socket;
      this._remoteDescSet = false;

      if (this.peerConnection) {
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          this._remoteDescSet = true;
          console.log('[MobileWebRTC] Remote description (answer) set successfully.');

          // Flush buffered remote ICE candidates
          console.log('[MobileWebRTC] Flushing', this._iceCandidateBuffer.length, 'buffered remote ICE candidates');
          for (const candidate of this._iceCandidateBuffer) {
            try {
              await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.warn('[MobileWebRTC] Buffered ICE add failed:', err.message);
            }
          }
          this._iceCandidateBuffer = [];

          // Send local ICE candidates that were generated before answer
          console.log('[MobileWebRTC] Sending', this._localIceCandidates.length, 'buffered local ICE candidates');
          for (const candidate of this._localIceCandidates) {
            this.socket.emit('ice-candidate', {
              to: this.counselorSocket,
              candidate: candidate
            });
          }
          this._localIceCandidates = [];

          if (callbacks.onCallConnected) callbacks.onCallConnected();
        } catch (err) {
          console.error('[MobileWebRTC] Failed to set remote description:', err);
          if (callbacks.onCallFailed) callbacks.onCallFailed();
        }
      } else {
        // Expo Go fallback simulation
        setTimeout(() => {
          if (callbacks.onRelayStarted) callbacks.onRelayStarted();
          if (callbacks.onCallConnected) callbacks.onCallConnected();
        }, 800);
      }
    });

    this.socket.on('call-failed', (data) => {
      console.log('[MobileWebRTC] Call failed socket event received:', data?.reason);
      if (callbacks.onCallFailed) callbacks.onCallFailed(data?.reason);
    });

    this.socket.on('call-rejected', () => {
      console.log('[MobileWebRTC] Call was rejected by the user');
      this.cleanupCall();
      if (callbacks.onCallEnded) callbacks.onCallEnded();
    });

    // --- Shared Call Events ---
    this.socket.on('ice-candidate-received', async (data) => {
      if (!data.candidate) return;
      if (this._remoteDescSet && this.peerConnection) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.warn('[MobileWebRTC] ICE add failed:', err.message);
        }
      } else {
        this._iceCandidateBuffer.push(data.candidate);
        console.log('[MobileWebRTC] Buffered remote ICE candidate, total:', this._iceCandidateBuffer.length);
      }
    });

    this.socket.on('audio-relay-start', (data) => {
      console.log('[MobileWebRTC] Server requested audio relay mode');
      if (!this.isRelayMode) {
        this.startSocketAudioRelay(this.counselorSocket, callbacks);
      }
    });

    this.socket.on('transcript-update', (data) => {
      if (this._callbacks.onTranscriptUpdate) this._callbacks.onTranscriptUpdate(data);
    });

    this.socket.on('audio-chunk', (data) => {
      if (!this.isRelayMode) return;
      if (callbacks.onRelayAudioChunk) callbacks.onRelayAudioChunk(data);
    });

    this.socket.on('call-ended', () => {
      console.log('[MobileWebRTC] Call ended by peer');
      this.cleanupCall();
      if (callbacks.onCallEnded) callbacks.onCallEnded();
    });
  }

  // Define quality monitor to prevent crash
  startQualityMonitor(callbacks) {
    if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }
    this.qualityInterval = setInterval(async () => {
      if (this.peerConnection) {
        try {
          const stats = await this.peerConnection.getStats();
          let rtt = null;
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              rtt = report.currentRoundTripTime;
            }
          });
          const rating = rtt === null ? '🟢🟢🟢' : rtt < 0.1 ? '🟢🟢🟢' : rtt < 0.25 ? '🟡🟡' : '🔴';
          if (callbacks.onCallQualityUpdate) callbacks.onCallQualityUpdate(rating);
        } catch (e) {
          if (callbacks.onCallQualityUpdate) callbacks.onCallQualityUpdate('🟢🟢🟢');
        }
      }
    }, 2000);
  }

  // --- Counselor Outgoing Call Initiation ---
  async startCall(targetPatientId, callerInfo = { name: 'Dr. Amanpreet' }) {
    console.log('[MobileWebRTC] Initiating call to patient:', targetPatientId);
    this.counselorSocket = null;
    this.targetPatientId = targetPatientId;
    this._iceCandidateBuffer = [];
    this._localIceCandidates = [];
    this._remoteDescSet = false;
    this.isRelayMode = false;
    if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }

    const iceConfig = await this.getIceConfig();
    try {
      this.peerConnection = new RTCPeerConnection(iceConfig);

      this.peerConnection.ontrack = (event) => {
        console.log('[MobileWebRTC] Remote track received (counselor)');
        if (this._callbacks.onRemoteTrack) {
          this._callbacks.onRemoteTrack(event.streams[0]);
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          if (this.counselorSocket) {
            this.socket.emit('ice-candidate', {
              to: this.counselorSocket,
              candidate: event.candidate
            });
          } else {
            this._localIceCandidates.push(event.candidate);
          }
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        console.log('[MobileWebRTC] Connection state (counselor):', state);
        if (state === 'connected') {
          this.startQualityMonitor(this._callbacks);
          if (this._callbacks.onCallConnected) this._callbacks.onCallConnected();
        } else if (state === 'failed' || state === 'disconnected') {
          console.warn('[MobileWebRTC] WebRTC P2P failed — switching to Socket audio relay');
          this.startSocketAudioRelay(this.counselorSocket, this._callbacks);
        }
      };

      // Get local stream and add tracks
      this.localStream = await mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      // Create WebRTC Offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Send call request to server
      this.socket.emit('call-user', {
        to: targetPatientId,
        offer: offer,
        callerInfo: callerInfo
      });

      return true;
    } catch (err) {
      console.warn('[MobileWebRTC] Native WebRTC not supported or failed (Expo Go fallback mode)');
      this.peerConnection = null;

      // Simulated fallback mode: Send a mock offer
      this.socket.emit('call-user', {
        to: targetPatientId,
        offer: { type: 'offer', sdp: 'mock-sdp-expo-go-fallback-counselor' },
        callerInfo: callerInfo
      });
      return true;
    }
  }

  async acceptCall() {
    if (!this.peerConnection) {
      console.log('[MobileWebRTC] Expo Go fallback: accepting simulated call session');
      this.socket.emit('make-answer', {
        to: this.counselorSocket,
        answer: { type: 'answer', sdp: 'mock-sdp-expo-go-fallback' }
      });
      return true;
    }

    try {
      this.localStream = await mediaDevices.getUserMedia({ audio: true, video: false });

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this.currentOffer));

      // Mark remote description set and flush all buffered ICE candidates
      this._remoteDescSet = true;
      console.log('[MobileWebRTC] Flushing', this._iceCandidateBuffer.length, 'buffered ICE candidates');
      for (const candidate of this._iceCandidateBuffer) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[MobileWebRTC] Buffered ICE add failed:', err.message);
        }
      }
      this._iceCandidateBuffer = [];

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.socket.emit('make-answer', {
        to: this.counselorSocket,
        answer: answer
      });

      return true;
    } catch (error) {
      console.error('[MobileWebRTC] Error accepting call:', error);
      this.cleanupCall();
      return false;
    }
  }

  // Socket audio relay — streams mic audio as chunks through the server
  startSocketAudioRelay(targetSocket, callbacks) {
    if (this.isRelayMode) return;
    this.isRelayMode = true;
    console.log('[Relay] Starting socket audio relay');

    // Tell server to create relay pair
    this.socket.emit('audio-relay-start', { to: targetSocket || this.counselorSocket });

    if (callbacks.onRelayStarted) callbacks.onRelayStarted();
    console.log('[Relay] Socket audio relay active — routing audio through server');
  }

  // Send a binary audio chunk
  sendAudioChunk(arrayBuffer) {
    if (this.isRelayMode && this.socket) {
      this.socket.emit('audio-chunk', arrayBuffer);
    }
  }

  declineCall() {
    if (this.socket && this.counselorSocket) {
      this.socket.emit('reject-call', { to: this.counselorSocket });
    }
    this.cleanupCall();
  }

  endCall() {
    try {
      if (this.socket) {
        if (this.counselorSocket) {
          this.socket.emit('end-call', { to: this.counselorSocket });
        } else if (this.targetPatientId) {
          this.socket.emit('end-call', { toPatientId: this.targetPatientId });
        }
      }
    } catch (e) {
      console.warn('[MobileWebRTC] Error emitting end-call signal:', e.message);
    }
    try {
      if (this.isRelayMode && this.socket) {
        this.socket.emit('audio-relay-stop');
      }
    } catch (e) {
      console.warn('[MobileWebRTC] Error emitting audio-relay-stop signal:', e.message);
    }
    this.cleanupCall();
  }

  cleanupCall() {
    this._remoteDescSet = false;
    this._iceCandidateBuffer = [];
    this._localIceCandidates = [];
    this.isRelayMode = false;
    this.targetPatientId = null;
    if (this.qualityInterval) { 
      try { clearInterval(this.qualityInterval); } catch (e) {}
      this.qualityInterval = null; 
    }

    if (this.relayRecorder) {
      try { this.relayRecorder.stop(); } catch(e) {}
      this.relayRecorder = null;
    }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch(e) {}
      this.peerConnection = null;
    }
    if (this.localStream) {
      try {
        if (typeof this.localStream.getTracks === 'function') {
          this.localStream.getTracks().forEach(t => {
            if (t && typeof t.stop === 'function') t.stop();
          });
        }
      } catch (e) {
        console.warn('[MobileWebRTC] Failed to stop local tracks:', e.message);
      }
      this.localStream = null;
    }
  }
}

export const webrtcService = new WebRTCService();
