import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  SafeAreaView, 
  ActivityIndicator, 
  AppState, 
  Platform, 
  PermissionsAndroid, 
  ScrollView,
  Animated,
  Easing,
  Modal,
  Image
} from 'react-native';
import { webrtcService, SERVER_URL } from './src/services/webrtc';
import * as Notifications from 'expo-notifications';

let cachedInCallManager = null;
let cachedInCallManagerLoaded = false;
const getOriginalInCallManager = () => {
  if (cachedInCallManagerLoaded) return cachedInCallManager;
  cachedInCallManagerLoaded = true;
  try {
    if (Platform.OS !== 'web') {
      cachedInCallManager = require('react-native-incall-manager').default;
    }
  } catch (e) {
    console.warn('[SafeInCallManager] Failed to require native module:', e.message);
  }
  return cachedInCallManager;
};

let cachedRTCView = null;
let cachedRTCViewLoaded = false;
const getOriginalRTCView = () => {
  if (cachedRTCViewLoaded) return cachedRTCView;
  cachedRTCViewLoaded = true;
  try {
    if (Platform.OS !== 'web') {
      cachedRTCView = require('react-native-webrtc').RTCView;
    }
  } catch (e) {
    console.warn('[SafeRTCView] Failed to require native module:', e.message);
  }
  return cachedRTCView;
};

const InCallManager = {
  start: (opts) => {
    try {
      const OriginalInCallManager = getOriginalInCallManager();
      if (OriginalInCallManager && typeof OriginalInCallManager.start === 'function') {
        OriginalInCallManager.start(opts);
      }
    } catch (e) {
      console.warn('[SafeInCallManager] start failed:', e.message);
    }
  },
  stop: () => {
    try {
      const OriginalInCallManager = getOriginalInCallManager();
      if (OriginalInCallManager && typeof OriginalInCallManager.stop === 'function') {
        OriginalInCallManager.stop();
      }
    } catch (e) {}
  },
  startRingtone: (ring) => {
    try {
      const OriginalInCallManager = getOriginalInCallManager();
      if (OriginalInCallManager && typeof OriginalInCallManager.startRingtone === 'function') {
        OriginalInCallManager.startRingtone(ring);
      }
    } catch (e) {}
  },
  stopRingtone: () => {
    try {
      const OriginalInCallManager = getOriginalInCallManager();
      if (OriginalInCallManager && typeof OriginalInCallManager.stopRingtone === 'function') {
        OriginalInCallManager.stopRingtone();
      }
    } catch (e) {}
  },
  setForceSpeakerphoneOn: (val) => {
    try {
      const OriginalInCallManager = getOriginalInCallManager();
      if (OriginalInCallManager && typeof OriginalInCallManager.setForceSpeakerphoneOn === 'function') {
        OriginalInCallManager.setForceSpeakerphoneOn(val);
      }
    } catch (e) {}
  },
  setMicrophoneMute: (val) => {
    try {
      const OriginalInCallManager = getOriginalInCallManager();
      if (OriginalInCallManager && typeof OriginalInCallManager.setMicrophoneMute === 'function') {
        OriginalInCallManager.setMicrophoneMute(val);
      }
    } catch (e) {}
  }
};

const RTCView = (props) => {
  try {
    const OriginalRTCView = getOriginalRTCView();
    if (OriginalRTCView) {
      return <OriginalRTCView {...props} />;
    }
    return null;
  } catch (e) {
    return null;
  }
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});



let mobileAuthToken = '';

export default function App() {
  const [uiState, setUiState] = useState('login'); // login, dashboard, incoming, active
  const [userRole, setUserRole] = useState('patient'); // patient, counselor
  const [patientId, setPatientId] = useState('PT-8885-b20d');
  const [counselorId, setCounselorId] = useState('counsellor_amritsar@cbm.gov.in');
  const [targetPatientId, setTargetPatientId] = useState('PT-8885-b20d');
  const [statusMsg, setStatusMsg] = useState('');
  const [callerName, setCallerName] = useState('Dr. Amanpreet');
  const [callSeconds, setCallSeconds] = useState(0);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isRelayMode, setIsRelayMode] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [callQuality, setCallQuality] = useState('🟢🟢🟢');
  const [showReconnect, setShowReconnect] = useState(false);
  const [patients, setPatients] = useState([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  
  // Interactive feature states
  const [activeModal, setActiveModal] = useState(null); // 'breathing', 'mood', 'chat', 'reminder', null
  const [selectedMood, setSelectedMood] = useState(null);
  const [moodLog, setMoodLog] = useState([]);
  const [breathText, setBreathText] = useState('Inhale');
  const [reminderTime, setReminderTime] = useState('09:00 AM');
  
  // Chat messaging
  const [chatMessage, setChatMessage] = useState('');
  const [chatLogs, setChatLogs] = useState([]);

  const timerRef = useRef(null);
  const recordingRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const transcriptionLoopIdRef = useRef(0);
  const appState = useRef(AppState.currentState);

  const isHallucination = (text) => {
    if (!text) return true;
    const t = text.trim();
    if (t.length < 2) return true;

    // --- SCRIPT FILTER ---
    // Allow: Latin (English), Devanagari (Hindi), Gurmukhi (Punjabi)
    // Block: Thai, Arabic/Urdu, Cyrillic, CJK, Japanese, Korean
    // NOTE: \u0600-\u06FF is Arabic/Urdu range — valid Punjabi is Gurmukhi (\u0A00-\u0A7F)
    const disallowedScriptRegex = /[\u0E00-\u0E7F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u31F0-\u31FF]/;
    if (disallowedScriptRegex.test(t)) return true;

    // Block if text is ONLY numbers/punctuation with no speech content
    if (/^[\d\s.,!?।-]+$/.test(t)) return true;

    // Block repeated word patterns (e.g. "ha ha ha ha")
    if (/(\S+)(\s+\1){2,}/i.test(t)) return true;

    // Block extremely short single characters that aren't real words
    if (t.length < 3 && /^[a-z]+$/i.test(t)) return true;

    // --- PHRASE HALLUCINATIONS (YouTube/ambient noise artefacts) ---
    // Only block EXACT known Whisper hallucination phrases, NOT common short words
    const HALLUCINATION_PHRASES = [
      "thank you for watching", "thanks for watching",
      "please subscribe", "like and subscribe", "subscribe to my channel",
      "bye bye", "see you next time", "see you in the next video",
      // Specific nonsense phrases seen in testing
      "लेकिन मेरे में क्यों नहीं होना चाहिए",
      "तुक बोले गया तब ना बोल तो रहा है",
      "तो डेस्पोर्ट चेक करना",
      "सब्सक्राइब करो", "लाइक करो", "चैनल सब्सक्राइब",
    ];

    // Silence / breath sounds that Whisper often emits
    const SILENCE_TOKENS = new Set([
      "um", "uh", "ah", "hmm", "mm", "hm",
    ]);

    const cleanT = t.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?।\s]+/g, " ").trim();

    // Block EXACT silence tokens (single word)
    if (SILENCE_TOKENS.has(cleanT)) return true;

    // Block known hallucination phrases
    if (HALLUCINATION_PHRASES.some(h => cleanT.includes(h))) return true;

    return false;
  };

  const logErrorToServer = (context, err) => {
    const msg = err.message || String(err);
    console.warn(`[ASR Error] ${context}:`, msg);
    if (webrtcService.socket && webrtcService.socket.connected) {
      webrtcService.socket.emit('log-message', {
        level: 'error',
        message: `[Mobile ASR] ${context}: ${msg}`
      });
    }
  };

  const startRealLiveTranscription = async () => {
    stopRealLiveTranscription();

    console.log('[ASR] Starting real live transcription loop...');
    if (webrtcService.socket && webrtcService.socket.connected) {
      webrtcService.socket.emit('log-message', {
        level: 'info',
        message: `[Mobile ASR] Starting transcription loop on platform: ${Platform.OS}`
      });
    }
    
    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        let options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options = { mimeType: 'audio/webm', audioBitsPerSecond: 16000 };
          if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = {};
          }
        }
        
        const recorder = new MediaRecorder(stream, options);
        recordingRef.current = recorder;

        recorder.ondataavailable = async (event) => {
          if (event.data.size > 0) {
            try {
              const formData = new FormData();
              formData.append("file", event.data, "chunk.webm");
              formData.append("model", "whisper-large-v3");
              formData.append("temperature", "0");
              formData.append("prompt", "This is a telemedicine counseling session for addiction recovery in Punjab. The speakers use a mix of English, Hindi (जैसे नशा, दवाई, इलाज, समस्या, मदद), and Punjabi (ਜਿਵੇਂ ਕਿ ਨਸ਼ਾ, ਦਵਾਈ, ਇਲਾਜ, ਸਿਹਤ, ਮਦਦ, ਮੁਕਤੀ, ਸ਼ਰਾਬ, ਠੀਕ). Transcribe the spoken words exactly as they are pronounced in their respective scripts (English in Latin, Hindi in Devanagari, Punjabi in Gurmukhi).");

              const response = await fetch(`${SERVER_URL}/api/ai/audio/transcriptions`, {
                method: "POST",
                headers: {
                  "X-Requested-With": "XMLHttpRequest",
                  "ngrok-skip-browser-warning": "1",
                  "Authorization": mobileAuthToken ? `Bearer ${mobileAuthToken}` : ""
                },
                body: formData
              });
              
              if (response.status === 401) {
                handleSessionExpired();
                return;
              }

              if (response.ok) {
                const resData = await response.json();
                const text = resData.text;
                if (text && !isHallucination(text)) {
                  const newTranscript = { sender: userRole, text: text.trim() };
                  setTranscripts(prev => [...prev, newTranscript]);

                  if (webrtcService.socket && webrtcService.socket.connected && webrtcService.counselorSocket) {
                    webrtcService.socket.emit('transcript-update', {
                      to: webrtcService.counselorSocket,
                      text: text.trim(),
                      sender: userRole
                    });
                  }
                }
              } else {
                const errText = await response.text();
                logErrorToServer("Web transcription response not OK", new Error(`Status ${response.status}: ${errText.substring(0, 100)}`));
              }
            } catch (err) {
              logErrorToServer("Web transcription fetch", err);
            }
          }
        };

        recorder.start();

        recordingIntervalRef.current = setInterval(() => {
          if (recorder.state === 'recording') {
            recorder.stop();
            recorder.start();
          }
        }, 4000);

      } catch (e) {
        logErrorToServer("Web recording stream init", e);
      }
    } else {
      try {
        const { Audio } = require('expo-av');
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          logErrorToServer("Permission", new Error("Microphone permission denied"));
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldRouteThroughEarpieceAndroid: false,
          staysActiveInBackground: true,
        });

        // Increment the unique loop ID to invalidate any prior running loop instances
        const currentLoopId = ++transcriptionLoopIdRef.current;
        recordingIntervalRef.current = true;

        const ASR_AUDIO_OPTIONS = {
          isMeteringEnabled: true,
          android: {
            extension: '.m4a',
            outputFormat: 2,   // MPEG_4
            audioEncoder: 3,   // AAC
            sampleRate: 16000, // Whisper's native sample rate
            numberOfChannels: 1, // Mono - halves file size vs stereo
            bitRate: 16000,    // 16kbps: good quality for speech at 16kHz mono
          },
          ios: {
            extension: '.m4a',
            outputFormat: 'm4af',
            audioQuality: 96,  // Medium quality - better than LOW for accented speech
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 16000,
          },
        };

        const processAudioChunk = async (uri, loopId, maxDb) => {
          // Skip silent chunks to save API costs & requests (threshold: -45 dB)
          if (maxDb > -160 && maxDb < -45) {
            console.log(`[Mobile ASR] Skipping silent chunk (max volume: ${maxDb} dB)`);
            return;
          }

          try {
            const formData = new FormData();
            formData.append('file', {
              uri: uri,
              type: 'audio/m4a',
              name: 'chunk.m4a',
            });
            // Note: model, language, temperature, prompt are all set server-side
            // for consistent quality control and anti-hallucination

            const response = await fetch(`${SERVER_URL}/api/ai/audio/transcriptions`, {
              method: 'POST',
              headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'ngrok-skip-browser-warning': '1',
                'Authorization': mobileAuthToken ? `Bearer ${mobileAuthToken}` : ""
              },
              body: formData
            });

            if (response.status === 401) {
              handleSessionExpired();
              return;
            }

            if (response.ok) {
              const resData = await response.json();
              const text = resData.text;
              
              if (webrtcService.socket && webrtcService.socket.connected) {
                webrtcService.socket.emit('log-message', {
                  level: 'info',
                  message: `[Mobile ASR] Successfully transcribed chunk: "${text?.trim()}"`
                });
              }

              if (text && !isHallucination(text) && transcriptionLoopIdRef.current === loopId) {
                const newTranscript = { sender: userRole, text: text.trim() };
                setTranscripts(prev => [...prev, newTranscript]);

                if (webrtcService.socket && webrtcService.socket.connected && webrtcService.counselorSocket) {
                  webrtcService.socket.emit('transcript-update', {
                    to: webrtcService.counselorSocket,
                    text: text.trim(),
                    sender: userRole
                  });
                }
              }
            } else {
              const errText = await response.text();
              logErrorToServer("Native ASR response not OK", new Error(`Status ${response.status}: ${errText.substring(0, 100)}`));
            }
          } catch (err) {
            logErrorToServer("Native ASR process failed", err);
          }
        };

        const recordAndProcess = async () => {
          if (!recordingIntervalRef.current || transcriptionLoopIdRef.current !== currentLoopId) {
            return;
          }
          
          let currentRecording = null;
          try {
            currentRecording = new Audio.Recording();
            recordingRef.current = currentRecording;
            
            await currentRecording.prepareToRecordAsync(ASR_AUDIO_OPTIONS);
            
            // Monitor metering/volume status
            let maxDb = -160;
            currentRecording.setOnRecordingStatusUpdate((status) => {
              if (status && status.metering !== undefined) {
                maxDb = Math.max(maxDb, status.metering);
              }
            });

            await currentRecording.startAsync();
            
            // 5-second chunks: longer context = better Whisper sentence completion
            // and fewer mid-word cuts at chunk boundaries
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            if (!recordingIntervalRef.current || transcriptionLoopIdRef.current !== currentLoopId) {
              await currentRecording.stopAndUnloadAsync();
              return;
            }

            await currentRecording.stopAndUnloadAsync();
            const uri = currentRecording.getURI();
            recordingRef.current = null;

            // Start the next recording immediately to prevent audio capture gaps
            if (recordingIntervalRef.current && transcriptionLoopIdRef.current === currentLoopId) {
              recordAndProcess();
            }

            // Transcribe the completed chunk asynchronously
            if (uri && transcriptionLoopIdRef.current === currentLoopId) {
              processAudioChunk(uri, currentLoopId, maxDb);
            }
          } catch (err) {
            logErrorToServer("Native recording chunk failed", err);
            if (currentRecording) {
              try { await currentRecording.stopAndUnloadAsync(); } catch (e) {}
            }
            // If failed, wait 1s before retrying to prevent rapid error loops
            if (recordingIntervalRef.current && transcriptionLoopIdRef.current === currentLoopId) {
              setTimeout(recordAndProcess, 1000);
            }
          }
        };

        recordAndProcess();

      } catch (e) {
        logErrorToServer("Native audio recording init", e);
      }
    }
  };

  const stopRealLiveTranscription = () => {
    console.log('[ASR] Stopping real live transcription loop...');
    transcriptionLoopIdRef.current = 0; // invalidate any active loops
    if (Platform.OS === 'web') {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      if (recordingRef.current) {
        try {
          recordingRef.current.stop();
        } catch (e) {}
        recordingRef.current = null;
      }
    } else {
      recordingIntervalRef.current = null;
      if (recordingRef.current) {
        const temp = recordingRef.current;
        recordingRef.current = null;
        try {
          temp.stopAndUnloadAsync();
        } catch (e) {}
      }
    }
  };

  // Animations
  const breathAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // Waveform bars animations
  const waveAnims = useRef([
    new Animated.Value(20),
    new Animated.Value(45),
    new Animated.Value(30),
    new Animated.Value(60),
    new Animated.Value(25),
    new Animated.Value(50)
  ]).current;

  // Quotes List
  const quotes = [
    "One day at a time. You are stronger than you think.",
    "Every step forward, no matter how small, is progress.",
    "Your present circumstances don't determine where you can go; they merely determine where you start.",
    "Taking care of your mind is just as important as taking care of your body.",
    "Breathe in strength, breathe out doubt. You've got this."
  ];
  const [currentQuote] = useState(() => quotes[Math.floor(Math.random() * quotes.length)]);

  useEffect(() => {
    // Request Notifications and Microphone permissions on load
    const setupPermissions = async () => {
      if (Platform.OS === 'android') {
        try {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          ]);
        } catch (err) {
          console.warn('[App] Permission request failed:', err);
        }
      }
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[App] Notification permissions not granted');
      }
    };
    setupPermissions();

    const subscription = AppState.addEventListener('change', nextAppState => {
      appState.current = nextAppState;
    });

    // Pulse animation for online indicator
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true
        })
      ])
    ).start();

    return () => {
      subscription.remove();
      if (timerRef.current) clearInterval(timerRef.current);
      InCallManager.stopRingtone();
      InCallManager.stop();
    };
  }, []);

  // Breathing Guide Animation Loop
  useEffect(() => {
    let breathingInterval;
    if (activeModal === 'breathing') {
      const runBreathing = () => {
        setBreathText('Inhale');
        Animated.timing(breathAnim, {
          toValue: 2.2,
          duration: 4000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        }).start(() => {
          setBreathText('Hold');
          setTimeout(() => {
            setBreathText('Exhale');
            Animated.timing(breathAnim, {
              toValue: 1.0,
              duration: 4000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true
            }).start(() => {
              setTimeout(runBreathing, 1000);
            });
          }, 2000);
        });
      };
      runBreathing();
    } else {
      breathAnim.setValue(1);
    }
    return () => clearInterval(breathingInterval);
  }, [activeModal]);

  // Voice Waveform Pulsing Animation
  useEffect(() => {
    let waveInterval;
    if (uiState === 'active') {
      const animateWaves = () => {
        waveAnims.forEach(anim => {
          const targetHeight = Math.floor(Math.random() * 50) + 15;
          Animated.timing(anim, {
            toValue: targetHeight,
            duration: 250,
            useNativeDriver: false
          }).start();
        });
      };
      
      animateWaves();
      waveInterval = setInterval(animateWaves, 250);
    }
    return () => clearInterval(waveInterval);
  }, [uiState]);

  const playRingtone = () => {
    try {
      InCallManager.startRingtone('_DEFAULT_');
    } catch (err) {
      console.warn('[App] Failed to play ringtone:', err);
    }
  };

  const stopRingtone = () => {
    try {
      InCallManager.stopRingtone();
    } catch (err) {}
  };

  const handleSessionExpired = () => {
    mobileAuthToken = '';
    webrtcService.cleanupCall();
    setUiState('login');
    setTranscripts([]);
    alert('Session expired. Please log in again.');
  };

  const fetchPatients = async () => {
    setIsLoadingPatients(true);
    try {
      const response = await fetch(`${SERVER_URL}/api/patients`, {
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'ngrok-skip-browser-warning': '1',
          'Authorization': mobileAuthToken ? `Bearer ${mobileAuthToken}` : ""
        }
      });
      if (response.status === 401) {
        handleSessionExpired();
        return;
      }
      if (response.ok) {
        const data = await response.json();
        setPatients(data);
      } else {
        console.warn('Failed to fetch patients:', response.status);
      }
    } catch (err) {
      console.warn('Error fetching patients:', err.message);
    } finally {
      setIsLoadingPatients(false);
    }
  };

  useEffect(() => {
    if (uiState === 'dashboard' && userRole === 'counselor') {
      fetchPatients();
    }
  }, [uiState, userRole]);

  const handleLogin = async () => {
    const idToConnect = userRole === 'patient' ? patientId.trim() : counselorId.trim();
    if (!idToConnect) {
      alert(`Please enter a ${userRole === 'patient' ? 'Patient' : 'Counselor'} ID`);
      return;
    }
    
    setStatusMsg('Authenticating...');
    try {
      const authUrl = userRole === 'patient' ? `${SERVER_URL}/api/auth/patient-login` : `${SERVER_URL}/api/auth/login`;
      const authBody = userRole === 'patient' 
        ? { patientId: idToConnect } 
        : { username: idToConnect, password: 'CBM@Counsellor24' }; // Fallback password for counsellors

      const authRes = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'ngrok-skip-browser-warning': '1'
        },
        body: JSON.stringify(authBody)
      });

      if (!authRes.ok) {
        const errData = await authRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Authentication failed');
      }

      const authData = await authRes.json();
      mobileAuthToken = authData.token;
      console.log('[MobileApp] Authenticated successfully, token acquired.');
    } catch (err) {
      console.warn('[MobileApp] Auth failed:', err.message);
      alert(`Authentication failed: ${err.message}`);
      setStatusMsg('Auth failed.');
      return;
    }

    setUiState('dashboard');
    setStatusMsg('Connecting to signaling server...');

    webrtcService.connect(idToConnect, userRole, {
      onConnect: () => {
        if (userRole === 'patient') {
          setStatusMsg('Connected. Waiting for counselor call...');
        } else {
          setStatusMsg('Connected. Ready to call patient.');
        }
      },
      onDisconnect: () => {
        setStatusMsg('Disconnected. Network drop detected.');
        setShowReconnect(true);
      },
      onTranscriptUpdate: (data) => {
        setTranscripts(prev => [...prev, data]);
      },
      onCallQualityUpdate: (status) => {
        setCallQuality(status);
      },

      onIncomingCall: async (name) => {
        if (userRole === 'patient') {
          setCallerName(name);
          setUiState('incoming');
          playRingtone();

          if (appState.current.match(/inactive|background/)) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: "Incoming Call",
                body: `${name} is calling you on CounselFlow.`,
                sound: true,
                priority: Notifications.AndroidNotificationPriority.MAX,
              },
              trigger: null,
            });
          }
        }
      },

      onRemoteTrack: (stream) => {
        console.log('[App] Remote stream received');
        setRemoteStream(stream);
        setIsRelayMode(false);
        setTranscripts([]);
        setShowReconnect(false);
      },

      onRelayStarted: () => {
        console.log('[App] Socket relay mode active');
        setIsRelayMode(true);
        setStatusMsg('Audio connected via server relay');
        startRealLiveTranscription();
      },

      onRelayAudioChunk: (data) => {
        // Handled natively
      },

      onCallEnded: () => {
        setUiState('dashboard');
        setStatusMsg('Call ended. Ready.');
        stopRingtone();
        stopTimer();
        setRemoteStream(null);
        setIsRelayMode(false);
        setTranscripts([]);
        setShowReconnect(false);
        stopRealLiveTranscription();
      },

      onCallConnected: () => {
        setStatusMsg('Audio connected (P2P)');
        stopRingtone();
        startRealLiveTranscription();
      },

      onCallFailed: (reason) => {
        let msg = 'Call failed.';
        if (reason === 'patient-offline') {
          msg = 'Patient is offline.';
        } else if (reason === 'district-mismatch') {
          msg = 'Call blocked: Patient is not assigned to your district.';
        }
        setStatusMsg(msg);
        alert(msg);
        setUiState('dashboard');
        stopRingtone();
        stopTimer();
        stopRealLiveTranscription();
      },
    });
  };

  const handleStartCall = async () => {
    if (!targetPatientId.trim()) {
      alert('Please enter a Target Patient ID');
      return;
    }
    setCallerName(`Patient: ${targetPatientId}`);
    setUiState('active');
    setStatusMsg('Calling patient...');
    startTimer();
    
    InCallManager.start({ media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(true);
    InCallManager.setMicrophoneMute(false);

    const success = await webrtcService.startCall(targetPatientId.trim(), { name: `Counselor: ${counselorId}` });
    if (!success) {
      alert('Failed to initiate call.');
      setUiState('dashboard');
      setStatusMsg('Ready.');
      stopTimer();
      InCallManager.stop();
    }
  };

  const handleAcceptCall = async () => {
    stopRingtone();
    setUiState('active');
    setStatusMsg('Connecting audio...');
    startTimer();
    
    InCallManager.start({ media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(true);
    InCallManager.setMicrophoneMute(false);

    const success = await webrtcService.acceptCall();
    if (!success) {
      alert('Failed to connect to the call or access microphone.');
      setUiState('dashboard');
      setStatusMsg('Call failed. Ready for next call.');
      stopTimer();
      InCallManager.stop();
    }
  };

  const handleDeclineCall = () => {
    stopRingtone();
    webrtcService.declineCall();
    setUiState('dashboard');
    setStatusMsg('Call declined.');
  };

  const handleReconnect = () => {
    webrtcService.cleanupCall();
    setUiState('login');
    setShowReconnect(false);
    setTranscripts([]);
    setCallSeconds(0);
  };

  const handleEndCall = () => {
    try {
      webrtcService.endCall();
    } catch (err) {
      console.warn('[App] Error during webrtcService.endCall:', err.message);
    }
    setUiState('dashboard');
    setStatusMsg('Call ended.');
    stopTimer();
    setRemoteStream(null);
    setIsRelayMode(false);
    setTranscripts([]);
    setShowReconnect(false);
    stopRealLiveTranscription();
    InCallManager.stop();
  };

  const startTimer = () => {
    setCallSeconds(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCallSeconds(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const formatTime = (seconds) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const logMood = (mood, emoji) => {
    setSelectedMood(mood);
    setMoodLog(prev => [{ mood, emoji, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...prev]);
    setTimeout(() => {
      setActiveModal(null);
    }, 1200);
  };

  const scheduleDailyReminder = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Daily Check-in Reminder 🌸",
        body: "Take a moment to check your mood and breathe. Open CounselFlow.",
        sound: true,
      },
      trigger: {
        hour: 9,
        minute: 0,
        repeats: true
      },
    });
    alert('Daily reminder scheduled successfully for 9:00 AM!');
    setActiveModal(null);
  };

  const sendChatMessage = () => {
    if (!chatMessage.trim()) return;
    const msg = {
      text: chatMessage,
      sender: 'patient',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatLogs(prev => [...prev, msg]);
    
    // Send via socket signaling if counselor is connected
    if (webrtcService.socket) {
      webrtcService.socket.emit('chat-message', {
        to: webrtcService.counselorSocket,
        text: chatMessage
      });
    }
    setChatMessage('');
  };

  return (
    <SafeAreaView style={styles.container}>
      
      {/* LOGIN UI */}
      {uiState === 'login' && (
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <View style={styles.loginCard}>
            <View style={styles.iconContainer}>
              <Image 
                source={require('./assets/logo.png')} 
                style={{ width: 60, height: 60, borderRadius: 30 }} 
              />
            </View>
            <Text style={styles.loginTitle}>CounselFlow</Text>
            <Text style={styles.loginSubtitle}>Real-time mental health connection</Text>

            {/* Role selection tab */}
            <Text style={styles.label}>Log in as:</Text>
            <View style={styles.roleRow}>
              <TouchableOpacity
                onPress={() => setUserRole('patient')}
                style={[styles.roleBtn, userRole === 'patient' && styles.roleBtnActive]}
              >
                <Text style={[styles.roleBtnText, userRole === 'patient' && styles.roleBtnTextActive]}>Patient</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setUserRole('counselor')}
                style={[styles.roleBtn, userRole === 'counselor' && styles.roleBtnActive]}
              >
                <Text style={[styles.roleBtnText, userRole === 'counselor' && styles.roleBtnTextActive]}>Counselor</Text>
              </TouchableOpacity>
            </View>

            {userRole === 'patient' ? (
              <>
                <Text style={styles.label}>Enter Patient ID</Text>
                <TextInput
                  style={styles.input}
                  value={patientId}
                  onChangeText={setPatientId}
                  placeholder="e.g. PT-8885-b20d"
                  placeholderTextColor="#64748b"
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>Enter Counselor ID</Text>
                <TextInput
                  style={styles.input}
                  value={counselorId}
                  onChangeText={setCounselorId}
                  placeholder="e.g. counselor-1"
                  placeholderTextColor="#64748b"
                />
              </>
            )}

            <TouchableOpacity style={styles.btnPrimary} onPress={handleLogin}>
              <Text style={styles.btnText}>Login & Open Dashboard</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* DASHBOARD UI */}
      {uiState === 'dashboard' && (
        <ScrollView contentContainerStyle={styles.scrollContainer} style={{ width: '100%' }}>
          
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Welcome Back</Text>
              <Text style={styles.headerSubtitle}>
                {userRole === 'patient' ? `Patient: ${patientId}` : `Counselor: ${counselorId}`}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <View style={styles.badgeContainer}>
                <Animated.View style={[styles.pulseDot, { transform: [{ scale: pulseAnim }] }]} />
                <Text style={styles.badgeText}>Ready</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  webrtcService.cleanupCall();
                  mobileAuthToken = '';
                  setUiState('login');
                  setTranscripts([]);
                  setCallSeconds(0);
                }}
                style={styles.logoutBtn}
              >
                <Text style={styles.logoutBtnText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Connection Status Banner */}
          <View style={styles.statusBanner}>
            <Text style={styles.statusBannerText}>⚡ {statusMsg || 'Connecting to server...'}</Text>
          </View>

          {/* If Counselor: Show Calling Control Card */}
          {userRole === 'counselor' ? (
            <>
              <View style={styles.dashboardCard}>
                <Text style={styles.cardHeader}>Start Consultation Call</Text>
                <Text style={styles.label}>Enter Patient ID to Call</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: '#030712' }]}
                  value={targetPatientId}
                  onChangeText={setTargetPatientId}
                  placeholder="e.g. PT-8885-b20d"
                  placeholderTextColor="#64748b"
                />
                <TouchableOpacity 
                  style={[styles.btnPrimary, { backgroundColor: '#10b981', marginTop: 12 }]} 
                  onPress={handleStartCall}
                >
                  <Text style={styles.btnText}>📞 Call Patient</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.sectionTitle, { marginTop: 15 }]}>District Patients List</Text>
              {isLoadingPatients ? (
                <ActivityIndicator size="small" color="#14b8a6" style={{ marginVertical: 20 }} />
              ) : patients.length === 0 ? (
                <Text style={{ color: '#64748b', fontSize: 13, textAlign: 'center', marginVertical: 20 }}>
                  No patients found in your district.
                </Text>
              ) : (
                <View style={{ width: '100%', marginBottom: 30 }}>
                  {patients.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={{
                        backgroundColor: '#111827',
                        borderWidth: 1,
                        borderColor: targetPatientId === p.id ? '#14b8a6' : '#1f2937',
                        borderRadius: 12,
                        padding: 14,
                        marginBottom: 10,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                      onPress={() => setTargetPatientId(p.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#f8fafc', fontWeight: 'bold', fontSize: 15 }}>
                          {p.name || 'Anonymous Patient'}
                        </Text>
                        <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                          ID: {p.id} • {p.district || 'Unknown District'} • {p.addictionCategory || 'General'}
                        </Text>
                      </View>
                      <Text style={{ color: targetPatientId === p.id ? '#14b8a6' : '#94a3b8', fontSize: 12, fontWeight: '700' }}>
                        {targetPatientId === p.id ? 'Selected' : 'Select'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              {/* Counselor Info Card */}
              <View style={styles.dashboardCard}>
                <Text style={styles.cardHeader}>Your Assigned Counselor</Text>
                <View style={styles.counselorRow}>
                  <View style={styles.avatar}>
                    <Image source={require('./assets/logo.png')} style={{ width: 44, height: 44, borderRadius: 22 }} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.counselorName}>{callerName}</Text>
                    <Text style={styles.counselorRole}>Tele-Counsellor (Amritsar)</Text>
                  </View>
                  <View style={styles.onlineBadge}>
                    <View style={styles.greenDot} />
                    <Text style={styles.onlineText}>Connected</Text>
                  </View>
                </View>
              </View>

              {/* Quote Card */}
              <View style={[styles.dashboardCard, { backgroundColor: '#1e1b4b' }]}>
                <Text style={[styles.cardHeader, { color: '#c7d2fe' }]}>Self-Care Tip</Text>
                <Text style={styles.quoteText}>"{currentQuote}"</Text>
              </View>

              {/* Quick Action Grid */}
              <Text style={styles.sectionTitle}>Self-Care Tools</Text>
              <View style={styles.grid}>
                
                {/* Tool 1: Breathing */}
                <TouchableOpacity 
                  style={styles.gridItem} 
                  onPress={() => setActiveModal('breathing')}
                >
                  <View style={[styles.gridIcon, { backgroundColor: '#115e59' }]}>
                    <Text style={{ fontSize: 22 }}>🌬️</Text>
                  </View>
                  <Text style={styles.gridLabel}>Breathing</Text>
                  <Text style={styles.gridDesc}>Calm your mind</Text>
                </TouchableOpacity>

                {/* Tool 2: Mood Log */}
                <TouchableOpacity 
                  style={styles.gridItem} 
                  onPress={() => setActiveModal('mood')}
                >
                  <View style={[styles.gridIcon, { backgroundColor: '#854d0e' }]}>
                    <Text style={{ fontSize: 22 }}>📊</Text>
                  </View>
                  <Text style={styles.gridLabel}>Mood Log</Text>
                  <Text style={styles.gridDesc}>Record feelings</Text>
                </TouchableOpacity>

              </View>

              <View style={styles.grid}>
                
                {/* Tool 3: Chat */}
                <TouchableOpacity 
                  style={styles.gridItem} 
                  onPress={() => setActiveModal('chat')}
                >
                  <View style={[styles.gridIcon, { backgroundColor: '#1e1b4b' }]}>
                    <Text style={{ fontSize: 22 }}>💬</Text>
                  </View>
                  <Text style={styles.gridLabel}>Secure Chat</Text>
                  <Text style={styles.gridDesc}>Message counselor</Text>
                </TouchableOpacity>

                {/* Tool 4: Reminder */}
                <TouchableOpacity 
                  style={styles.gridItem} 
                  onPress={() => setActiveModal('reminder')}
                >
                  <View style={[styles.gridIcon, { backgroundColor: '#311042' }]}>
                    <Text style={{ fontSize: 22 }}>⏰</Text>
                  </View>
                  <Text style={styles.gridLabel}>Reminders</Text>
                  <Text style={styles.gridDesc}>Set check-ins</Text>
                </TouchableOpacity>

              </View>

              {/* Mood History Log */}
              {moodLog.length > 0 && (
                <View style={styles.dashboardCard}>
                  <Text style={styles.cardHeader}>Today's Mood Check-ins</Text>
                  {moodLog.map((log, index) => (
                    <View key={index} style={styles.moodLogItem}>
                      <Text style={{ fontSize: 20 }}>{log.emoji}</Text>
                      <Text style={styles.moodLogText}>{log.mood}</Text>
                      <Text style={styles.moodLogTime}>{log.time}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

        </ScrollView>
      )}

      {/* INCOMING CALL UI */}
      {uiState === 'incoming' && (
        <View style={styles.fullscreenCall}>
          <View style={styles.avatarLarge}>
            <Image source={require('./assets/logo.png')} style={{ width: 110, height: 110, borderRadius: 55 }} />
          </View>
          <Text style={styles.incomingTitle}>{callerName}</Text>
          <Text style={styles.incomingSubtitle}>Incoming Counselor Call...</Text>

          <View style={styles.callButtonRow}>
            <TouchableOpacity style={[styles.callBtn, styles.callBtnDecline]} onPress={handleDeclineCall}>
              <Text style={styles.callBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.callBtn, styles.callBtnAccept]} onPress={handleAcceptCall}>
              <Text style={styles.callBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ACTIVE CALL UI */}
      {uiState === 'active' && (
        <View style={styles.fullscreenActiveCall}>
          <Text style={styles.activeCallTitle}>In Consultation</Text>
          <Text style={styles.activeCallCounselor}>{callerName}</Text>
          <Text style={styles.activeCallTimer}>{formatTime(callSeconds)}</Text>

          {/* Dynamic Voice Visualizer Waveform */}
          <View style={styles.waveformContainer}>
            {waveAnims.map((anim, idx) => (
              <Animated.View 
                key={idx} 
                style={[
                  styles.waveformBar, 
                  { height: anim }
                ]} 
              />
            ))}
          </View>

          {/* Connection status badges */}
          <View style={styles.badgeRow}>
            <View style={[styles.modeBadge, isRelayMode ? styles.modeBadgeRelay : styles.modeBadgeP2P]}>
              <Text style={styles.modeBadgeText}>
                {isRelayMode ? '🔄 Server Relay' : '📡 Direct P2P'}
              </Text>
            </View>
            <View style={[styles.modeBadge, { backgroundColor: '#1e293b' }]}>
              <Text style={styles.modeBadgeText}>Signal: {callQuality}</Text>
            </View>
          </View>

          {showReconnect && (
            <TouchableOpacity onPress={handleReconnect} style={styles.reconnectBtn}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>⚠️ Signal Lost - Reconnect</Text>
            </TouchableOpacity>
          )}

          {/* Live Transcript View */}
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptHeader}>Live Conversation Transcript</Text>
            <ScrollView 
              style={{ flex: 1 }} 
              contentContainerStyle={{ paddingBottom: 15 }}
            >
              {transcripts.length === 0 ? (
                <Text style={styles.transcriptPlaceholder}>
                  Live transcript will show up here as your counselor talks...
                </Text>
              ) : (
                transcripts.map((t, i) => (
                  <View key={i} style={[
                    styles.transcriptBubble,
                    t.sender === 'counselor' ? styles.bubbleCounselor : styles.bubblePatient
                  ]}>
                    <Text style={styles.bubbleSender}>
                      {userRole === 'counselor'
                        ? (t.sender === 'counselor' ? 'You' : callerName)
                        : (t.sender === 'counselor' ? callerName : 'You')
                      }
                    </Text>
                    <Text style={styles.bubbleText}>{t.text}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>

          <TouchableOpacity style={styles.btnEndCall} onPress={handleEndCall}>
            <Text style={styles.btnText}>End Call</Text>
          </TouchableOpacity>

          {/* RTCView (Hidden, WebRTC requirement) */}
          {remoteStream && (
            <RTCView
              streamURL={remoteStream.toURL ? remoteStream.toURL() : remoteStream}
              style={{ width: 1, height: 1, position: 'absolute', opacity: 0 }}
            />
          )}
        </View>
      )}

      {/* BREATHING GUIDE MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={activeModal === 'breathing'}
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Breathing Guide</Text>
            <Text style={styles.modalSubtitle}>Follow the circle's rhythm to relax</Text>
            
            <View style={styles.breathingContainer}>
              <Animated.View style={[
                styles.breathingCircle,
                { transform: [{ scale: breathAnim }] }
              ]}>
                <Text style={styles.breathText}>{breathText}</Text>
              </Animated.View>
            </View>

            <TouchableOpacity 
              style={styles.modalCloseBtn} 
              onPress={() => setActiveModal(null)}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MOOD LOG MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={activeModal === 'mood'}
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Mood Check-in</Text>
            <Text style={styles.modalSubtitle}>How are you feeling right now?</Text>
            
            <View style={styles.moodGrid}>
              {[
                { mood: 'Calm', emoji: '😌' },
                { mood: 'Anxious', emoji: '😰' },
                { mood: 'Happy', emoji: '😊' },
                { mood: 'Sad', emoji: '😔' },
                { mood: 'Angry', emoji: '😠' },
                { mood: 'Tired', emoji: '🥱' }
              ].map(item => (
                <TouchableOpacity 
                  key={item.mood} 
                  style={[styles.moodItem, selectedMood === item.mood && styles.moodItemActive]}
                  onPress={() => logMood(item.mood, item.emoji)}
                >
                  <Text style={{ fontSize: 32, marginBottom: 4 }}>{item.emoji}</Text>
                  <Text style={styles.moodText}>{item.mood}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity 
              style={styles.modalCloseBtn} 
              onPress={() => setActiveModal(null)}
            >
              <Text style={styles.modalCloseBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SECURE CHAT MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={activeModal === 'chat'}
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '80%', justifyContent: 'space-between' }]}>
            <View style={{ width: '100%' }}>
              <Text style={styles.modalTitle}>Secure Chat Session</Text>
              <Text style={styles.modalSubtitle}>Ask questions directly to {callerName}</Text>
            </View>

            <ScrollView style={{ flex: 1, width: '100%', marginVertical: 15 }}>
              {chatLogs.length === 0 ? (
                <Text style={{ color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 50 }}>
                  No messages. Type below to start talking.
                </Text>
              ) : (
                chatLogs.map((c, i) => (
                  <View 
                    key={i} 
                    style={[
                      styles.chatBubble, 
                      c.sender === 'patient' ? styles.chatBubbleRight : styles.chatBubbleLeft
                    ]}
                  >
                    <Text style={{ color: '#fff', fontSize: 14 }}>{c.text}</Text>
                    <Text style={{ color: '#94a3b8', fontSize: 9, marginTop: 4, alignSelf: 'flex-end' }}>{c.time}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center' }}>
              <TextInput 
                style={[styles.input, { flex: 1, marginBottom: 0, marginRight: 8 }]} 
                placeholder="Type a message..."
                placeholderTextColor="#64748b"
                value={chatMessage}
                onChangeText={setChatMessage}
              />
              <TouchableOpacity style={[styles.btnPrimary, { width: 50, height: 50, padding: 0, justifyContent: 'center' }]} onPress={sendChatMessage}>
                <Text style={{ color: '#fff', fontSize: 18 }}>✈️</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={[styles.modalCloseBtn, { marginTop: 15 }]} 
              onPress={() => setActiveModal(null)}
            >
              <Text style={styles.modalCloseBtnText}>Close Chat</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* REMINDER SCHEDULER MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={activeModal === 'reminder'}
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Daily Reminders</Text>
            <Text style={styles.modalSubtitle}>Receive check-in prompts to pause & reflect</Text>

            <View style={{ backgroundColor: '#1e293b', width: '100%', padding: 20, borderRadius: 16, alignItems: 'center', marginVertical: 15 }}>
              <Text style={{ fontSize: 36 }}>⏰</Text>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 10 }}>Scheduled Check-in</Text>
              <Text style={{ color: '#14b8a6', fontSize: 24, fontWeight: '800', marginTop: 4 }}>9:00 AM Daily</Text>
            </View>

            <TouchableOpacity style={styles.btnPrimary} onPress={scheduleDailyReminder}>
              <Text style={styles.btnText}>Schedule Daily Reminder</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.modalCloseBtn} 
              onPress={() => setActiveModal(null)}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  scrollContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loginCard: {
    backgroundColor: '#111827',
    padding: 30,
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
    marginTop: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(20, 184, 166, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  loginSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 30,
    textAlign: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  input: {
    width: '100%',
    backgroundColor: '#030712',
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    fontSize: 16,
  },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 30,
  },
  langBtn: {
    backgroundColor: '#1f2937',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    flex: 1,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  langBtnActive: {
    backgroundColor: '#0d9488',
    borderColor: '#14b8a6',
  },
  langBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  btnPrimary: {
    backgroundColor: '#0d9488',
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#0d9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  btnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  logoutBtn: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#dc2626',
    alignSelf: 'flex-end',
  },
  logoutBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  // DASHBOARD STYLE DEFINITIONS
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginTop: 20,
    marginBottom: 15,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 2,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  badgeText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '700',
  },
  statusBanner: {
    width: '100%',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    borderRadius: 14,
    marginBottom: 20,
    alignItems: 'center',
  },
  statusBannerText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
  },
  dashboardCard: {
    width: '100%',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  counselorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  counselorName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  counselorRole: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  onlineText: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '600',
  },
  quoteText: {
    fontSize: 15,
    fontStyle: 'italic',
    color: '#e0e7ff',
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#94a3b8',
    alignSelf: 'flex-start',
    marginBottom: 12,
    marginTop: 10,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 12,
  },
  gridItem: {
    width: '48%',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
  },
  gridIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  gridLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 4,
  },
  gridDesc: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
  },
  moodLogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  moodLogText: {
    color: '#f8fafc',
    fontWeight: '600',
    marginLeft: 10,
    flex: 1,
  },
  moodLogTime: {
    color: '#64748b',
    fontSize: 12,
  },

  // CALL OVERLAYS AND PANELS
  fullscreenCall: {
    flex: 1,
    backgroundColor: '#090d16',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    padding: 30,
  },
  avatarLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1f2937',
    marginBottom: 30,
  },
  incomingTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 8,
  },
  incomingSubtitle: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 50,
  },
  callButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 320,
  },
  callBtn: {
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 30,
    width: '46%',
    alignItems: 'center',
  },
  callBtnAccept: {
    backgroundColor: '#10b981',
  },
  callBtnDecline: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1.5,
    borderColor: '#ef4444',
  },
  callBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // ACTIVE CALL SCREEN
  fullscreenActiveCall: {
    flex: 1,
    backgroundColor: '#090d16',
    alignItems: 'center',
    padding: 24,
    width: '100%',
  },
  activeCallTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0d9488',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 8,
  },
  activeCallCounselor: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 6,
  },
  activeCallTimer: {
    fontSize: 36,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 15,
  },
  
  // Waveform styling
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    width: '100%',
    marginBottom: 20,
  },
  waveformBar: {
    width: 6,
    backgroundColor: '#14b8a6',
    borderRadius: 3,
    marginHorizontal: 4,
  },

  badgeRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  modeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginHorizontal: 4,
  },
  modeBadgeP2P: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  modeBadgeRelay: {
    backgroundColor: 'rgba(13, 148, 136, 0.1)',
    borderWidth: 1,
    borderColor: '#0d9488',
  },
  modeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  reconnectBtn: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 15,
  },
  transcriptContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: '#111827',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 20,
    marginBottom: 20,
  },
  transcriptHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    paddingBottom: 8,
  },
  transcriptPlaceholder: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  transcriptBubble: {
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
    maxWidth: '85%',
  },
  bubbleCounselor: {
    backgroundColor: '#1f2937',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 4,
  },
  bubblePatient: {
    backgroundColor: '#0d9488',
    alignSelf: 'flex-end',
    borderTopRightRadius: 4,
  },
  bubbleSender: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#94a3b8',
    marginBottom: 3,
  },
  bubbleText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 18,
  },
  btnEndCall: {
    backgroundColor: '#ef4444',
    width: '100%',
    padding: 18,
    borderRadius: 30,
    alignItems: 'center',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    marginBottom: 20,
  },

  // MODAL UI
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 24,
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 24,
    textAlign: 'center',
  },
  modalCloseBtn: {
    backgroundColor: '#1f2937',
    width: '100%',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  modalCloseBtnText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: 'bold',
  },

  // breathing
  breathingContainer: {
    width: 240,
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
  },
  breathingCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(20, 184, 166, 0.2)',
    borderWidth: 3,
    borderColor: '#14b8a6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#14b8a6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
  },
  breathText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },

  // mood check-in
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
  },
  moodItem: {
    width: '30%',
    backgroundColor: '#1f2937',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  moodItemActive: {
    borderColor: '#14b8a6',
    backgroundColor: 'rgba(20, 184, 166, 0.1)',
  },
  moodText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  
  // chat style
  chatBubble: {
    padding: 12,
    borderRadius: 16,
    marginVertical: 4,
    maxWidth: '80%',
  },
  chatBubbleRight: {
    backgroundColor: '#0d9488',
    alignSelf: 'flex-end',
    borderTopRightRadius: 4,
  },
  chatBubbleLeft: {
    backgroundColor: '#1f2937',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 4,
  },
  roleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
    backgroundColor: '#030712',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  roleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  roleBtnActive: {
    backgroundColor: '#0d9488',
  },
  roleBtnText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  roleBtnTextActive: {
    color: '#ffffff',
  }
});
