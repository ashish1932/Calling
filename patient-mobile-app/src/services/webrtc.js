import { io } from 'socket.io-client';
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, mediaDevices } from 'react-native-webrtc';

// Backend URL — all traffic (signaling + audio relay) goes through this single ngrok tunnel
export const SERVER_URL = 'https://economist-slideshow-flannels.ngrok-free.dev';

class WebRTCService {
  constructor() {
    this.socket = null;
    this.peerConnection = null;
    this.localStream = null;
    this.currentOffer = null;
    this.counselorSocket = null;

    // ICE candidate buffering (fix for race condition)
    this._iceCandidateBuffer = [];
    this._remoteDescSet = false;

    // Socket audio relay fallback (when WebRTC P2P fails on mobile NAT)
    this.isRelayMode = false;
    if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }
    this.relayRecorder = null;
    this._relayCallbacks = {};
    this.qualityInterval = null;
    this._callbacks = {};
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
      console.warn('[MobilePatient] Could not fetch ICE config, using fallback:', e.message);
    }
    return fallback;
  }

  connect(patientId, callbacks) {
    this._relayCallbacks = callbacks;
    this._callbacks = callbacks;
    this.socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      console.log('[MobilePatient] Socket connected:', this.socket.id);
      this.socket.emit('register', { role: 'patient', id: patientId });
      if (callbacks.onConnect) callbacks.onConnect();
    });

    this.socket.on('disconnect', () => {
      console.log('[MobilePatient] Disconnected from server');
      if (callbacks.onDisconnect) callbacks.onDisconnect();
    });

    this.socket.on('call-made', async (data) => {
      console.log('[MobilePatient] Incoming call from:', data.socket);

      // Reset ICE candidate buffer for this new call
      this._iceCandidateBuffer = [];
      this._remoteDescSet = false;
      this.isRelayMode = false;
    if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }

      const iceConfig = await this.getIceConfig();
      this.peerConnection = new RTCPeerConnection(iceConfig);

      this.peerConnection.ontrack = (event) => {
        console.log('[MobilePatient] Remote track received');
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
        console.log('[MobilePatient] Connection state:', state);
        if (state === 'connected') {
          this.startQualityMonitor(callbacks);
          if (callbacks.onCallConnected) callbacks.onCallConnected();
        } else if (state === 'failed' || state === 'disconnected') {
          console.warn('[MobilePatient] WebRTC P2P failed — switching to Socket audio relay');
          this.startSocketAudioRelay(data.socket, callbacks);
        }
      };

      this.currentOffer = data.offer;
      this.counselorSocket = data.socket;

      const callerName = data.callerInfo?.name || 'Your Counselor';
      if (callbacks.onIncomingCall) callbacks.onIncomingCall(callerName);
    });

    // CRITICAL FIX: Buffer ICE candidates arriving before acceptCall() sets remote description
    this.socket.on('ice-candidate-received', async (data) => {
      if (!data.candidate) return;
      if (this._remoteDescSet && this.peerConnection) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.warn('[MobilePatient] ICE add failed:', err.message);
        }
      } else {
        this._iceCandidateBuffer.push(data.candidate);
        console.log('[MobilePatient] Buffered ICE candidate, total:', this._iceCandidateBuffer.length);
      }
    });

    // Server instructs us to switch to relay mode (counselor side triggered it)
    this.socket.on('audio-relay-start', (data) => {
      console.log('[MobilePatient] Server requested audio relay mode');
      if (!this.isRelayMode) {
        this.startSocketAudioRelay(this.counselorSocket, callbacks);
      }
    });

    // Receive audio chunks from counselor via server relay
    this.socket.on('transcript-update', (data) => {
      if (this._callbacks.onTranscriptUpdate) this._callbacks.onTranscriptUpdate(data);
    });

    this.socket.on('audio-chunk', (data) => {
      if (!this.isRelayMode) return;
      // Notify App.js so it can play the audio
      if (callbacks.onRelayAudioChunk) callbacks.onRelayAudioChunk(data);
    });

    this.socket.on('call-ended', () => {
      console.log('[MobilePatient] Call ended by counselor');
      this.cleanupCall();
      if (callbacks.onCallEnded) callbacks.onCallEnded();
    });
  }

  async acceptCall() {
    try {
      this.localStream = await mediaDevices.getUserMedia({ audio: true, video: false });

      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this.currentOffer));

      // Mark remote description set and flush all buffered ICE candidates
      this._remoteDescSet = true;
      console.log('[MobilePatient] Flushing', this._iceCandidateBuffer.length, 'buffered ICE candidates');
      for (const candidate of this._iceCandidateBuffer) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[MobilePatient] Buffered ICE add failed:', err.message);
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
      console.error('[MobilePatient] Error accepting call:', error);
      this.cleanupCall();
      return false;
    }
  }

  // Socket audio relay — streams mic audio as chunks through the server
  // Activated automatically when WebRTC P2P fails (mobile carrier NAT/CGNAT)
  startSocketAudioRelay(targetSocket, callbacks) {
    if (this.isRelayMode) return;
    this.isRelayMode = true;
    console.log('[Relay] Starting socket audio relay');

    // Tell server to create relay pair
    this.socket.emit('audio-relay-start', { to: targetSocket || this.counselorSocket });

    // Start sending mic audio chunks
    if (this.localStream) {
      console.warn('[Relay] Audio upload not supported on React Native WebRTC natively without expo-av.');
    }

    if (callbacks.onRelayStarted) callbacks.onRelayStarted();
    console.log('[Relay] Socket audio relay active — routing audio through server');
  }

  // Send a binary audio chunk (called from App.js if using expo-av recording)
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
    if (this.socket && this.counselorSocket) {
      this.socket.emit('end-call', { to: this.counselorSocket });
    }
    if (this.isRelayMode && this.socket) {
      this.socket.emit('audio-relay-stop');
    }
    this.cleanupCall();
  }

  cleanupCall() {
    this._remoteDescSet = false;
    this._iceCandidateBuffer = [];
    this.isRelayMode = false;
    if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }

    if (this.relayRecorder) {
      try { this.relayRecorder.stop(); } catch(e) {}
      this.relayRecorder = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
  }
}

export const webrtcService = new WebRTCService();
