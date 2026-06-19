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
  Image,
  Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { webrtcService, SERVER_URL, setServerUrl } from './src/services/webrtc';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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





let mobileAuthToken = '';

export default function App() {
  const [uiState, setUiState] = useState('login');
  const [activeTab, setActiveTab] = useState('home'); // login, dashboard, incoming, active
  const [userRole, setUserRole] = useState('patient'); // patient, counselor
  const [serverUrl, setLocalServerUrl] = useState(SERVER_URL);
  const [appConfig, setAppConfig] = useState({
    brandingName: 'Regional Initiative',
    brandingTitle: 'Department of Health',
    brandingInitiative: 'Public Health Campaign'
  });
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientData, setPatientData] = useState(null);
  const [counselorId, setCounselorId] = useState('');
  const [password, setPassword] = useState('');
  const [targetPatientId, setTargetPatientId] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callSeconds, setCallSeconds] = useState(0);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isRelayMode, setIsRelayMode] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [callQuality, setCallQuality] = useState('🟢🟢🟢');
  const [showReconnect, setShowReconnect] = useState(false);
  const [patients, setPatients] = useState([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [reportFilter, setReportFilter] = useState('Weekly');
  const [queueFilter, setQueueFilter] = useState('All');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [viewedPatient, setViewedPatient] = useState(null);
  
  // Interactive feature states
  const [activeModal, setActiveModal] = useState(null); // 'breathing', 'mood', 'chat', 'reminder', null
  const [selectedMood, setSelectedMood] = useState(null);
  const [moodLog, setMoodLog] = useState([]);
  const [breathText, setBreathText] = useState('Inhale');
  const [reminderTime, setReminderTime] = useState('09:00 AM');
  
  // Chat messaging
  const [chatMessage, setChatMessage] = useState('');
  const [chatLogs, setChatLogs] = useState([]);

  // CBT Journaling
  const [cbtJournalEntry, setCbtJournalEntry] = useState('');

  const fetchPatientProfile = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/patients`, {
        headers: {
          'Authorization': mobileAuthToken ? `Bearer ${mobileAuthToken}` : '',
          'ngrok-skip-browser-warning': '1'
        }
      });
      const resData = await res.json();
      const patientsList = resData && Array.isArray(resData.data) ? resData.data : (Array.isArray(resData) ? resData : []);
      const me = patientsList.find(p => p.id === patientId);
      if (me) {
        setPatientName(me.name || patientId);
        setSelectedLanguage(me.preferredLanguage || 'en');
        setPatientData(me);
      }
    } catch (e) {
      console.warn('Failed to fetch profile', e);
    }
  };

  useEffect(() => {
    if (userRole === 'counselor' && patientData?.name) {
        setCallerName(patientData.name);
    }
  }, [userRole, patientData]);

  const handleOpenProfile = async () => {
    setActiveModal('profile');
    await fetchPatientProfile();
  };

  const handleSaveProfile = async () => {
    try {
      await fetch(`${SERVER_URL}/api/patients/${patientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ name: patientName, preferredLanguage: selectedLanguage })
      });
      setIsEditingProfile(false);
    } catch (e) {
      console.warn('Failed to save profile', e);
    }
  };
  const timerRef = useRef(null);
  const recordingRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const transcriptionLoopIdRef = useRef(0);
  const appState = useRef(AppState.currentState);

  const isHallucination = (text) => {
    if (!text) return true;
    const t = text.trim();

    // Block if text is purely punctuation or spaces
    if (/^[\s.,…!?\-_।]+$/.test(t)) return true;

    // --- SCRIPT FILTER ---
    // Allow: Latin (English), Devanagari (Hindi), Gurmukhi (Punjabi)
    // Block: Thai, Arabic/Urdu, Cyrillic, CJK, Japanese, Korean
    const disallowedScriptRegex = /[\u0E00-\u0E7F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u31F0-\u31FF]/;
    if (disallowedScriptRegex.test(t)) return true;

    // Block repeated word patterns (e.g. "ha ha ha ha")
    if (/(\S+)(\s+\1){2,}/i.test(t)) return true;

    // Block extremely short single characters that aren't real words
    if (t.length < 2 && /^[a-z]+$/i.test(t)) return true;

    const cleanT = t.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?।\s]+/g, " ").trim();

    // Short phrases/words that should only be blocked if they are the EXACT transcript
    const EXACT_HALLUCINATIONS = new Set([
      "do not", "don't", "do not track", "pata", "pata ne",
      "thank you", "bye bye", "goodbye", "see you", "okay okay okay",
      "you", "so", "the", "and", "is", "it",
      "um", "uh", "ah", "hmm", "mm", "hm"
    ]);

    // Long unique phrases that can be blocked if they appear anywhere
    const SUBSTRING_HALLUCINATIONS = [
      "hello. i'm a 12-year-old", "hello. i'm a 12-year-old.", "i'm a 12-year-old", "i'm a 12-year-old.",
      "hello i'm a 12 year old", "i'm a 12 year old",
      "thank you for watching", "thanks for watching", "please subscribe",
      "like and subscribe", "subscribe to my channel", "don't forget to subscribe",
      "see you in the next video", "see you next time",
      "लेकिन मेरे में क्यों नहीं होना चाहिए",
      "तुक बोले गया तब ना बोल तो रहा है",
      "तो डेस्पोर्ट चेक करना",
      "सब्सक्राइब करो", "लाइक करो", "चैनल सब्सक्राइब"
    ];

    if (EXACT_HALLUCINATIONS.has(cleanT)) return true;
    if (SUBSTRING_HALLUCINATIONS.some(h => cleanT.includes(h.toLowerCase()))) return true;

    return false;
  };

  const cleanTranscriptForLanguage = (text, lang) => {
    if (!text) return '';
    if (lang === 'hi') {
      let cleaned = text.replace(/[\u0A00-\u0A7F]/g, '');
      if (!/[\u0900-\u097F]/.test(cleaned)) {
        return '';
      }
      return cleaned.trim();
    }
    return text;
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
    await stopRealLiveTranscription();

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
              formData.append("language", selectedLanguage);
              const promptMap = {
                en: "Hello doctor, I need help with my medication. My health is improving, thank you.",
                hi: "नमस्ते डॉक्टर साहब, मुझे बहुत मदद चाहिए। हाँ जी, दवाई ठीक समय पर खाओ।",
                pa: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਮੈਨੂੰ ਦਵਾਈ ਅਤੇ ਇਲਾਜ ਬਾਰੇ ਦੱਸੋ।"
              };
              formData.append("prompt", promptMap[selectedLanguage] || promptMap.en);

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
                const text = cleanTranscriptForLanguage(resData.text, selectedLanguage);
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
          // Skip silent chunks to save API costs & requests (threshold: -65 dB)
          if (maxDb > -160 && maxDb < -65) {
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
            formData.append('language', selectedLanguage);
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
              const text = cleanTranscriptForLanguage(resData.text, selectedLanguage);
              
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
            if (recordingRef.current) {
              try {
                await recordingRef.current.stopAndUnloadAsync();
              } catch (e) {}
              recordingRef.current = null;
            }

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

  const stopRealLiveTranscription = async () => {
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
          await temp.stopAndUnloadAsync();
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
        const patientsList = data && Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        setPatients(patientsList);
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
    
    setServerUrl(serverUrl);
    setStatusMsg('Authenticating...');
    try {
      const authUrl = userRole === 'patient' ? `${SERVER_URL}/api/auth/patient-login` : `${SERVER_URL}/api/auth/login`;
      const langMap = { en: 'en-US', pa: 'pa-IN', hi: 'hi-IN' };
      const authBody = userRole === 'patient' 
        ? { patientId: idToConnect, preferredLanguage: langMap[selectedLanguage] || 'en-US' } 
        : { username: idToConnect, password: password };

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

    if (userRole === 'patient') {
      await fetchPatientProfile();
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
        // Skip transcripts of our own voice relayed back from the counselor dashboard
        // to avoid duplicate entries (counselor dashboard may also transcribe our stream)
        if (data.sender === userRole) return;
        const text = cleanTranscriptForLanguage(data.text, selectedLanguage);
        if (text) {
          setTranscripts(prev => [...prev, { ...data, text }]);
        }
      },
      onChatMessage: (data) => {
        setChatLogs(prev => [...prev, { sender: data.sender, text: data.text }]);
        setActiveModal('chat');
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
    }, mobileAuthToken);
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

  const scheduleDailyMotivationalQuotes = async () => {
    try {
      if (Platform.OS === 'web') {
        alert('Reminders are only supported on native mobile devices.');
        setActiveModal(null);
        return;
      }
      
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        alert('Please enable notifications to receive reminders.');
        return;
      }
      
      await Notifications.cancelAllScheduledNotificationsAsync();
      
      // Schedule morning quote
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "☀️ Good Morning",
          body: "Every day is a fresh start. Take a deep breath and start again.",
          sound: true,
        },
        trigger: {
          hour: 9,
          minute: 0,
          repeats: true
        },
      });
      
      // Schedule evening check-in
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "🌙 Evening Check-in",
          body: "How are you feeling tonight? Take a moment to log your mood.",
          sound: true,
        },
        trigger: {
          hour: 20,
          minute: 0,
          repeats: true
        },
      });
      alert('Daily motivation and mood check-in reminders scheduled!');
    } catch (e) {
      console.warn('Notifications error:', e);
      alert('Reminders are only supported on native mobile devices.');
    }
    setActiveModal(null);
  };

  const sendChatMessage = () => {
    if (!chatMessage.trim()) return;
    const msg = {
      text: chatMessage,
      sender: userRole,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatLogs(prev => [...prev, msg]);
    
    // Send via socket signaling if connected
    if (webrtcService.socket) {
      let targetTo = webrtcService.counselorSocket;
      if (userRole === 'patient' && !targetTo) {
          targetTo = 'counselor';
      } else if (userRole === 'counselor' && !targetTo) {
          targetTo = targetPatientId;
      }
      
      webrtcService.socket.emit('chat-message', {
        to: targetTo,
        text: chatMessage,
        sender: userRole
      });
    }
    setChatMessage('');
  };

  const getDisplayDistrict = () => {
    if (userRole === 'counselor') {
      const match = counselorId.match(/_([a-z]+)@/i);
      if (match) return match[1].charAt(0).toUpperCase() + match[1].slice(1);
      return 'Assigned';
    }
    return patientData?.district || 'Assigned';
  };
  const currentDistrict = getDisplayDistrict();

  return (
    <SafeAreaView style={styles.container}>
      
      {/* LOGIN UI */}
      {uiState === 'login' && (
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <View style={styles.loginCard}>
            <View style={styles.iconContainer}>
              <Image 
                source={require('./assets/avatar.png')} 
                style={{ width: 60, height: 60, borderRadius: 30 }} 
              />
            </View>
            <Text style={styles.loginTitle}>CounselFlow</Text>
            <Text style={styles.loginSubtitle}>Real-time mental health connection</Text>

            <View style={styles.govBanner}>
              <Image 
                source={require('./assets/logo.png')} 
                style={styles.govImage} 
              />
              <View style={styles.govTextContainer}>
                <Text style={styles.govName}>{appConfig.brandingName}</Text>
                <Text style={styles.govTitle}>{appConfig.brandingTitle}</Text>
                <Text style={styles.govInitiative}>{appConfig.brandingInitiative}</Text>
              </View>
            </View>

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
                <Text style={styles.label}>Enter Counselor Email</Text>
                <TextInput
                  style={styles.input}
                  value={counselorId}
                  onChangeText={setCounselorId}
                  placeholder="e.g. counsellor_amritsar@cbm.gov.in"
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                />
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor="#64748b"
                  secureTextEntry={true}
                />
              </>
            )}



            {(userRole === 'patient' || userRole === 'counselor') && (
              <>
                <Text style={styles.label}>Preferred Language</Text>
                <View style={styles.langRow}>
                  {[
                    { code: 'en', name: 'English' },
                    { code: 'pa', name: 'ਪੰਜਾਬੀ' },
                    { code: 'hi', name: 'हिन्दी' }
                  ].map(lang => (
                    <TouchableOpacity 
                      key={lang.code} 
                      onPress={() => setSelectedLanguage(lang.code)}
                      style={[styles.langBtn, selectedLanguage === lang.code && styles.langBtnActive]}
                    >
                      <Text style={styles.langBtnText}>{lang.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity style={styles.btnPrimary} onPress={handleLogin}>
              <Text style={styles.btnText}>Login & Open Dashboard</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

{/* --- DASHBOARD UI --- */}
      {uiState === 'dashboard' && (
        <View style={{ flex: 1, backgroundColor: '#f8f7f4' }}>
          <ScrollView 
            contentContainerStyle={styles.dashboardScrollContent}
            style={{ flex: 1 }}
          >
            {userRole === 'counselor' ? (
              /* COUNSELOR DASHBOARD */
              <View style={{ paddingBottom: 80 }}>
                {activeTab === 'home' && (
                  <>
                {/* Header */}
                <View style={styles.headerContainer}>
                  <View>
                    <Text style={styles.headerSubtitle}>Tele-counselor</Text>
                    <Text style={styles.headerTitle}>{currentDistrict} district</Text>
                  </View>
                  <View style={styles.onDutyBadge}>
                    <Text style={styles.onDutyText}>On duty</Text>
                  </View>
                </View>

                {/* Metrics */}
                <View style={styles.metricsRow}>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>Caseload</Text>
                    <Text style={styles.metricValue}>{patients ? patients.length : 0}</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>Today</Text>
                    <Text style={styles.metricValue}>{patients ? patients.filter(p => p.lastSessionDate === new Date().toISOString().split('T')[0]).length : 0}</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.metricLabel}>Urgent</Text>
                    <Text style={[styles.metricValue, { color: '#dc2626' }]}>{patients ? patients.filter(p => p.severity === 'Severe').length : 0}</Text>
                  </View>
                </View>

                {/* Start Consultation Call */}
                <View style={styles.cardLight}>
                  <Text style={styles.cardLightTitle}>Start consultation call</Text>
                  <View style={styles.inputWrapper}>
                    <Text style={styles.inputIcon}>🪪</Text>
                    <TextInput
                      style={styles.inputLight}
                      value={targetPatientId}
                      onChangeText={setTargetPatientId}
                      placeholder="PT-002"
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
                    <TouchableOpacity 
                      style={[styles.callPatientBtn, { flex: 1, paddingHorizontal: 10 }]}
                      onPress={handleStartCall}
                    >
                      <Text style={styles.callPatientBtnText}>📞 Call</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.callPatientBtn, { flex: 1, backgroundColor: '#3b82f6', paddingHorizontal: 10 }]}
                      onPress={() => {
                        if (!targetPatientId) {
                          alert('Please select or enter a Patient ID first.');
                          return;
                        }
                        webrtcService.connect(targetPatientId, userRole, {
                          onChatMessage: (data) => {
                            setChatLogs(prev => [...prev, { sender: data.sender, text: data.text }]);
                            setActiveModal('chat');
                          }
                        }, mobileAuthToken);
                        setActiveModal('chat');
                      }}
                    >
                      <Text style={[styles.callPatientBtnText, { color: '#ffffff' }]}>💬 Chat</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Priority Queue */}
                <View style={styles.queueHeader}>
                  <Text style={styles.queueTitle}>Priority queue</Text>
                  <TouchableOpacity 
                    style={[styles.filterBtn, queueFilter === 'Urgent' && { backgroundColor: '#fee2e2', borderColor: '#ef4444' }]} 
                    onPress={() => setQueueFilter(prev => prev === 'All' ? 'Urgent' : 'All')}
                  >
                    <Text style={[styles.filterBtnText, queueFilter === 'Urgent' && { color: '#ef4444' }]}>
                      {queueFilter === 'Urgent' ? '⚲ Urgent Only' : '⚲ Filter'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Patient List (Mocked/Mapped) */}
                {(() => {
                  let filtered = patients || [];
                  if (queueFilter === 'Urgent') {
                    filtered = filtered.filter(p => p.severity === 'Severe' || p.urgent);
                  }
                  
                  if (!patients || patients.length === 0) {
                    return [{ name: 'Loading patients...', id: '...', last: '', category: '...', urgent: false }].map((p, idx) => (
                      <View key={idx} style={styles.patientQueueCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pqName}>{p.name}</Text>
                          <Text style={styles.pqDetails}>{p.id}</Text>
                        </View>
                      </View>
                    ));
                  }

                  if (filtered.length === 0) {
                     return (
                       <Text style={{ textAlign: 'center', color: '#64748b', marginVertical: 20 }}>No patients match the current filter.</Text>
                     );
                  }

                  return filtered.slice(0, 3).map((p, idx) => (
                    <View 
                      key={idx} 
                      style={[
                        styles.patientQueueCard,
                        targetPatientId === p.id && styles.patientQueueCardSelected
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pqName, targetPatientId === p.id && {color: '#1e3a8a'}]}>{p.name}</Text>
                        <Text style={[styles.pqDetails, targetPatientId === p.id && {color: '#3b82f6'}]}>{p.id} · Last session: {p.lastSessionDate || p.last || 'Recent'}</Text>
                        <View style={[styles.pqBadge, (p.severity === 'Severe' || p.urgent) ? styles.pqBadgeUrgent : styles.pqBadgeNormal]}>
                          <Text style={[styles.pqBadgeText, (p.severity === 'Severe' || p.urgent) && styles.pqBadgeTextUrgent]}>{p.addictionCategory || p.category || 'General check-in'}</Text>
                        </View>
                      </View>
                      <TouchableOpacity 
                        style={targetPatientId === p.id ? styles.pqSelectBtnActive : styles.pqSelectBtn}
                        onPress={() => setTargetPatientId(p.id)}
                      >
                        <Text style={targetPatientId === p.id ? styles.pqSelectBtnTextActive : styles.pqSelectBtnText}>
                          {targetPatientId === p.id ? '✓ Selected' : 'Call'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ));
                })()}

                  </>
                )}
                {activeTab === 'patients' && (
                  <View style={{ paddingTop: 10 }}>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20 }}>All Patients</Text>
                    {patients && patients.length > 0 ? patients.map((p, idx) => (
                      <View key={idx} style={styles.patientQueueCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pqName}>{p.name || p.id}</Text>
                          <Text style={styles.pqDetails}>{p.id} · Language: {p.preferredLanguage || 'en'}</Text>
                        </View>
                        <TouchableOpacity style={styles.pqSelectBtn} onPress={() => setViewedPatient(p)}>
                          <Text style={styles.pqSelectBtnText}>View Details</Text>
                        </TouchableOpacity>
                      </View>
                    )) : (
                      <Text style={{ color: '#64748b' }}>No patients found. Ensure backend is running and patients exist.</Text>
                    )}
                  </View>
                )}
                {activeTab === 'reports' && (() => {
                  const getFilteredPatients = (filter) => {
                    if (!patients) return [];
                    if (filter === 'All Time') return patients;
                    const cutoff = new Date();
                    if (filter === 'Weekly') cutoff.setDate(cutoff.getDate() - 7);
                    if (filter === 'Monthly') cutoff.setMonth(cutoff.getMonth() - 1);
                    return patients.filter(p => p.lastSessionDate && new Date(p.lastSessionDate) >= cutoff);
                  };
                  const reportPatients = getFilteredPatients(reportFilter);
                  const activeCases = reportPatients.length;
                  const emergencies = reportPatients.filter(p => p.severity === 'Severe').length;

                  const chartData = [6, 5, 4, 3, 2, 1, 0].map(daysAgo => {
                    const d = new Date();
                    d.setDate(d.getDate() - daysAgo);
                    const dateStr = d.toISOString().split('T')[0];
                    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
                    const count = patients ? patients.filter(p => p.lastSessionDate && p.lastSessionDate.startsWith(dateStr)).length : 0;
                    return { label: dayLabel, count, val: Math.max(5, Math.min(count * 30, 100)) };
                  });

                  return (
                  <View style={{ paddingTop: 10 }}>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20 }}>Analytics & Reports</Text>
                    
                    {/* Filters */}
                    <View style={{ flexDirection: 'row', backgroundColor: '#e2e8f0', borderRadius: 12, padding: 4, marginBottom: 20 }}>
                      {['Weekly', 'Monthly', 'All Time'].map(f => (
                        <TouchableOpacity 
                          key={f}
                          style={{ flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: reportFilter === f ? '#ffffff' : 'transparent', borderRadius: 8 }}
                          onPress={() => setReportFilter(f)}
                        >
                          <Text style={{ fontWeight: reportFilter === f ? 'bold' : '500', color: reportFilter === f ? '#0d9488' : '#64748b' }}>{f}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* KPI Cards */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20 }}>
                      <View style={{ width: '48%', backgroundColor: '#ffffff', borderRadius: 16, padding: 16, marginBottom: 15, borderWidth: 1, borderColor: '#e2e8f0' }}>
                        <Text style={{ fontSize: 12, color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Active Cases</Text>
                        <Text style={{ fontSize: 28, fontWeight: '800', color: '#1e293b', marginTop: 8 }}>{activeCases}</Text>
                        <Text style={{ fontSize: 12, color: '#10b981', marginTop: 4 }}>in selected period</Text>
                      </View>
                      <View style={{ width: '48%', backgroundColor: '#ffffff', borderRadius: 16, padding: 16, marginBottom: 15, borderWidth: 1, borderColor: '#e2e8f0' }}>
                        <Text style={{ fontSize: 12, color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>Emergencies</Text>
                        <Text style={{ fontSize: 28, fontWeight: '800', color: '#dc2626', marginTop: 8 }}>{emergencies}</Text>
                        <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>High severity cases</Text>
                      </View>
                    </View>

                    {/* Chart Area */}
                    <View style={styles.cardLight}>
                      <Text style={styles.cardLightTitle}>Sessions Per Day (Last 7 Days)</Text>
                      <View style={{ height: 180, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 20 }}>
                        {chartData.map((bar, i) => (
                          <View key={i} style={{ alignItems: 'center', width: '12%' }}>
                            <Text style={{ fontSize: 10, color: '#475569', marginBottom: 4, fontWeight: 'bold' }}>{bar.count}</Text>
                            <View style={{ width: '100%', height: bar.val + '%', backgroundColor: bar.count > 0 ? '#0d9488' : '#e2e8f0', borderRadius: 6, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} />
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 8 }}>{bar.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                  );
                })()}
              </View>
            ) : (
              /* PATIENT DASHBOARD */
              <View style={{ paddingBottom: 80 }}>
                {activeTab === 'home' && (
                  <>
                {/* Header */}
                <View style={styles.headerContainer}>
                  <View>
                    <Text style={styles.headerSubtitle}>Good morning</Text>
                    <Text style={styles.headerTitle}>{patientName || 'Patient ' + patientId}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => setActiveModal('notifications')}><Text>🔔</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={handleOpenProfile}><Text>👤</Text></TouchableOpacity>
                  </View>
                </View>

                {/* Connection Banner */}
                <View style={styles.connectedBanner}>
                  <Text style={styles.connectedBannerTitle}>Connected · Tele-counselor ({currentDistrict})</Text>
                  <Text style={styles.connectedBannerSub}>Waiting for counselor to start the call</Text>
                </View>


                {/* Metrics */}
                <View style={styles.metricsRow}>
                  <View style={[styles.metricCard, { flex: 1, marginRight: 5 }]}>
                    <Text style={styles.metricLabel}>Sessions{"\n"}completed</Text>
                    <Text style={[styles.metricValue, { fontSize: 28 }]}>{patientData && patientData.lastSessionDate ? '1' : '0'}</Text>
                  </View>
                  <View style={[styles.metricCard, { flex: 1, marginLeft: 5 }]}>
                    <Text style={styles.metricLabel}>Recovery streak{"\n"}</Text>
                    <Text style={[styles.metricValue, { fontSize: 28 }]}>{patientData && patientData.lastSessionDate ? '1 day' : '0 days'}</Text>
                  </View>
                </View>

                {/* Next Session */}
                <View style={styles.cardLight}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={styles.calendarIcon}><Text>📅</Text></View>
                    <View style={{ flex: 1, marginLeft: 15 }}>
                      <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Next session</Text>
                      <Text style={{ color: '#64748b', marginTop: 2 }}>{patientData && patientData.lastSessionDate ? 'Pending Scheduling' : 'Not Scheduled'}</Text>
                    </View>
                    <Text style={{ color: '#64748b', fontSize: 20 }}>›</Text>
                  </View>
                </View>

                {/* Self Care Tip */}
                <View style={[styles.cardLight, { borderColor: '#3b82f6', borderLeftWidth: 4 }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
                    Self-care tip
                  </Text>
                  <Text style={{ fontStyle: 'italic', fontSize: 16, color: '#1e293b', lineHeight: 22 }}>
                    "One day at a time. You are stronger than you think."
                  </Text>
                </View>

                <Text style={{ fontSize: 18, fontWeight: 'bold', marginTop: 20, marginBottom: 15 }}>Tools</Text>
                
                {/* Tools Grid */}
                <View style={styles.metricsRow}>
                  <TouchableOpacity style={[styles.metricCard, { flex: 1, marginRight: 5, alignItems: 'center', padding: 20 }]} onPress={() => setActiveModal('breathing')}>
                    <Text style={{ fontSize: 28, marginBottom: 8 }}>🌬️</Text>
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Breathing</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>Calm your mind</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.metricCard, { flex: 1, marginLeft: 5, alignItems: 'center', padding: 20 }]} onPress={() => setActiveModal('mood')}>
                    <Text style={{ fontSize: 28, marginBottom: 8 }}>📊</Text>
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Mood log</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>Record feelings</Text>
                  </TouchableOpacity>
                </View>
                
                <View style={styles.metricsRow}>
                  <TouchableOpacity style={[styles.metricCard, { flex: 1, marginRight: 5, alignItems: 'center', padding: 20 }]} onPress={() => setActiveModal('resources')}>
                    <Text style={{ fontSize: 28, marginBottom: 8 }}>📚</Text>
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Resources</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>Articles & audio</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.metricCard, { flex: 1, marginLeft: 5, alignItems: 'center', padding: 20 }]} onPress={() => setActiveModal('reminder')}>
                    <Text style={{ fontSize: 28, marginBottom: 8 }}>🔔</Text>
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>Reminders</Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>Set check-ins</Text>
                  </TouchableOpacity>
                </View>
                  </>
                )}
                {activeTab === 'sessions' && (
                  <View style={{ paddingTop: 10 }}>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20 }}>My Sessions</Text>
                    <View style={styles.cardLight}>
                      <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 5 }}>Last Session</Text>
                      <Text style={{ color: '#64748b' }}>{patientData && patientData.lastSessionDate ? `Date: ${patientData.lastSessionDate}` : 'No past sessions recorded'}</Text>
                      {patientData && patientData.lastSessionDate && <Text style={{ color: '#0d9488', marginTop: 10 }}>Completed successfully</Text>}
                    </View>
                  </View>
                )}
                {activeTab === 'discovery' && (
                  <View style={{ paddingTop: 10 }}>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20 }}>Discovery & Growth</Text>
                    
                    {/* Educational Videos */}
                    <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#1e293b' }}>Recommended Videos</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 25 }}>
                      <TouchableOpacity 
                        style={{ width: 220, marginRight: 15, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' }}
                        onPress={() => Platform.OS === 'web' ? window.open('https://www.youtube.com/watch?v=k-mWzJ-BwF4', '_blank') : Linking.openURL('https://www.youtube.com/watch?v=k-mWzJ-BwF4')}
                      >
                        <View style={{ height: 120, backgroundColor: '#94a3b8', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 40 }}>▶️</Text>
                        </View>
                        <View style={{ padding: 12 }}>
                          <Text style={{ fontWeight: 'bold', color: '#1e293b', marginBottom: 4 }} numberOfLines={2}>Understanding Addiction Triggers</Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>Dr. Amanpreet • 12 mins</Text>
                        </View>
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        style={{ width: 220, marginRight: 15, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' }}
                        onPress={() => Platform.OS === 'web' ? window.open('https://www.youtube.com/watch?v=v1ZGiwK4U7I', '_blank') : Linking.openURL('https://www.youtube.com/watch?v=v1ZGiwK4U7I')}
                      >
                        <View style={{ height: 120, backgroundColor: '#94a3b8', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 40 }}>▶️</Text>
                        </View>
                        <View style={{ padding: 12 }}>
                          <Text style={{ fontWeight: 'bold', color: '#1e293b', marginBottom: 4 }} numberOfLines={2}>Managing Severe Cravings</Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>Sobriety Center • 8 mins</Text>
                        </View>
                      </TouchableOpacity>
                    </ScrollView>

                    {/* Audio Guides */}
                    <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#1e293b' }}>Mindfulness Audio</Text>
                    <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 15, marginBottom: 25, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center' }}>
                      <TouchableOpacity 
                        style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center', marginRight: 15 }}
                        onPress={() => alert('Playing Mindful Breathing Audio...')}
                      >
                        <Text style={{ fontSize: 24, color: 'white', marginLeft: 4 }}>▶</Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#1e293b' }}>5-Min Urge Surfing</Text>
                        <Text style={{ fontSize: 13, color: '#64748b' }}>Audio guide to ride out a craving.</Text>
                      </View>
                    </View>

                    {/* CBT Journaling */}
                    <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#1e293b' }}>Daily Reflection (CBT)</Text>
                    <View style={{ backgroundColor: '#f8fafc', borderRadius: 12, padding: 15, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 20 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#334155', marginBottom: 10 }}>What triggered you today, and how did you overcome it?</Text>
                      <TextInput 
                        style={[styles.input, { height: 100, textAlignVertical: 'top', backgroundColor: '#ffffff' }]}
                        multiline={true}
                        placeholder="Write your thoughts here..."
                        value={cbtJournalEntry}
                        onChangeText={setCbtJournalEntry}
                      />
                      <TouchableOpacity 
                        style={[styles.btnPrimary, { marginTop: 0 }]}
                        onPress={() => {
                          if (!cbtJournalEntry.trim()) { alert('Please write something before saving.'); return; }
                          alert('Journal entry saved successfully!');
                          setCbtJournalEntry('');
                        }}
                      >
                        <Text style={styles.btnPrimaryText}>Save Entry</Text>
                      </TouchableOpacity>
                    </View>

                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Bottom Navigation Bar */}
          <View style={styles.bottomNav}>
            {userRole === 'counselor' ? (
              <>
                <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
                  <Text style={[styles.navIcon, activeTab === 'home' && { color: '#2563eb' }]}>🏠</Text>
                  <Text style={[styles.navText, activeTab === 'home' && { color: '#2563eb' }]}>Home</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navItem} onPress={() => { setActiveTab('patients'); fetchPatients(); }}>
                  <Text style={[styles.navIcon, activeTab === 'patients' && { color: '#2563eb' }]}>👥</Text>
                  <Text style={[styles.navText, activeTab === 'patients' && { color: '#2563eb' }]}>Patients</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('reports')}>
                  <Text style={[styles.navIcon, activeTab === 'reports' && { color: '#2563eb' }]}>📊</Text>
                  <Text style={[styles.navText, activeTab === 'reports' && { color: '#2563eb' }]}>Reports</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navItem} onPress={() => { webrtcService.cleanupCall(); setUiState('login'); }}>
                  <View style={{ backgroundColor: '#ef4444', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 4 }}>
                    <Ionicons name="log-out" size={14} color="white" style={{ marginLeft: 2 }} />
                  </View>
                  <Text style={styles.navText}>Logout</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
                  <Text style={[styles.navIcon, activeTab === 'home' && { color: '#2563eb' }]}>🏠</Text>
                  <Text style={[styles.navText, activeTab === 'home' && { color: '#2563eb' }]}>Home</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('discovery')}>
                  <Text style={[styles.navIcon, activeTab === 'discovery' && { color: '#2563eb' }]}>🧭</Text>
                  <Text style={[styles.navText, activeTab === 'discovery' && { color: '#2563eb' }]}>Discovery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('sessions')}>
                  <Text style={[styles.navIcon, activeTab === 'sessions' && { color: '#2563eb' }]}>📅</Text>
                  <Text style={[styles.navText, activeTab === 'sessions' && { color: '#2563eb' }]}>Sessions</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navItem} onPress={() => setActiveModal('chat')}>
                  <Text style={styles.navIcon}>💬</Text>
                  <Text style={styles.navText}>Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.navItem} onPress={() => { webrtcService.cleanupCall(); setUiState('login'); }}>
                  <View style={{ backgroundColor: '#ef4444', width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 4 }}>
                    <Ionicons name="log-out" size={14} color="white" style={{ marginLeft: 2 }} />
                  </View>
                  <Text style={styles.navText}>Logout</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}
{/* --- DASHBOARD UI END --- */}


      {/* INCOMING CALL UI */}
      {uiState === 'incoming' && (
        <View style={styles.fullscreenCall}>
          <View style={styles.avatarLarge}>
            <Image source={require('./assets/avatar.png')} style={{ width: 110, height: 110, borderRadius: 55 }} />
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
              <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>⚠️ Signal Lost - Reconnect</Text>
            </TouchableOpacity>
          )}

          {/* Active Call Language selection bar */}
          {/* Active Call Language selection bar */}
          {(userRole === 'patient' || userRole === 'counselor') && (
            <View style={[styles.langRow, { marginBottom: 15, width: '100%' }]}>
              {[
                { code: 'en', name: 'English' },
                { code: 'pa', name: 'ਪੰਜਾਬੀ' },
                { code: 'hi', name: 'हिन्दी' }
              ].map(lang => (
                <TouchableOpacity 
                  key={lang.code} 
                  onPress={async () => {
                    setSelectedLanguage(lang.code);
                    if (userRole === 'patient' && patientId) {
                      // Also persist to server DB so counselor gets updated
                      const langMap = { en: 'en-US', pa: 'pa-IN', hi: 'hi-IN' };
                      try {
                        await fetch(`${SERVER_URL}/api/auth/patient-login`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'X-Requested-With': 'XMLHttpRequest',
                            'ngrok-skip-browser-warning': '1'
                          },
                          body: JSON.stringify({ patientId: patientId, preferredLanguage: langMap[lang.code] })
                        });
                        console.log('[MobileApp] Updated preferred language mid-call:', lang.code);
                      } catch (err) {
                        console.warn('[MobileApp] Failed to update language on server:', err.message);
                      }
                    }
                  }}
                  style={[styles.langBtn, selectedLanguage === lang.code && styles.langBtnActive]}
                >
                  <Text style={styles.langBtnText}>{lang.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Live Transcript View */}
          {userRole === 'counselor' && (
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
          )}

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
                      c.sender === userRole ? styles.chatBubbleRight : styles.chatBubbleLeft
                    ]}
                  >
                    <Text style={{ color: '#1e293b', fontSize: 14 }}>{c.text}</Text>
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
                <Text style={{ color: '#ffffff', fontSize: 18 }}>✈️</Text>
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
              <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: 'bold', marginTop: 10 }}>Scheduled Check-in</Text>
              <Text style={{ color: '#14b8a6', fontSize: 24, fontWeight: '800', marginTop: 4 }}>9:00 AM Daily</Text>
            </View>

            <TouchableOpacity style={styles.btnPrimary} onPress={scheduleDailyMotivationalQuotes}>
              <Text style={styles.btnText}>Enable Daily Reminders</Text>
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

      {/* RESOURCES MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={activeModal === 'resources'}
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Educational Resources</Text>
            <Text style={styles.modalSubtitle}>Helpful articles and audio guides</Text>
            
            <ScrollView style={{ width: '100%', marginVertical: 15, maxHeight: 300 }}>
              <TouchableOpacity 
                style={{ padding: 15, backgroundColor: '#f8fafc', borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' }}
                onPress={() => alert('Opening "Understanding Triggers" resource...')}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#0f172a' }}>Understanding Triggers</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>A 5-minute read on how to identify and manage sudden urges.</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={{ padding: 15, backgroundColor: '#f8fafc', borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' }}
                onPress={() => alert('Playing "Guided Meditation" audio...')}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#0f172a' }}>Guided Meditation (Audio)</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>10 minutes of guided mindfulness for cravings.</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={{ padding: 15, backgroundColor: '#f8fafc', borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0' }}
                onPress={() => alert('Opening "Nutrition in Recovery" resource...')}
              >
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#0f172a' }}>Nutrition in Recovery</Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>How a healthy diet supports your physical and mental healing.</Text>
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity 
              style={styles.modalCloseBtn} 
              onPress={() => setActiveModal(null)}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* NOTIFICATIONS MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={activeModal === 'notifications'}
        onRequestClose={() => setActiveModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Notifications</Text>
            <View style={{ width: '100%', marginVertical: 30, alignItems: 'center' }}>
              <Text style={{ fontSize: 40, marginBottom: 10 }}>📭</Text>
              <Text style={{ textAlign: 'center', color: '#64748b' }}>You're all caught up!</Text>
              <Text style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 4 }}>No new notifications at the moment.</Text>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setActiveModal(null)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PROFILE MODAL */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={activeModal === 'profile'}
        onRequestClose={() => { setActiveModal(null); setIsEditingProfile(false); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>My Profile</Text>
            <View style={{ width: '100%', marginVertical: 20, padding: 20, backgroundColor: '#f1f5f9', borderRadius: 16 }}>
              {isEditingProfile ? (
                <View>
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>Patient ID</Text>
                  <Text style={{ fontSize: 16, color: '#94a3b8', marginBottom: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{patientId}</Text>
                  
                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>Full Name</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: '#ffffff', color: '#1e293b', borderColor: '#cbd5e1', marginBottom: 20 }]} 
                    value={patientName}
                    onChangeText={setPatientName}
                    placeholder="Enter your name"
                    placeholderTextColor="#94a3b8"
                  />

                  <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>Language Preference</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                    <TouchableOpacity 
                      style={[styles.langBtn, selectedLanguage === 'en' ? styles.langBtnActive : { backgroundColor: '#ffffff', borderColor: '#cbd5e1' }]} 
                      onPress={() => setSelectedLanguage('en')}
                    >
                      <Text style={[styles.langBtnText, selectedLanguage === 'en' ? { color: '#ffffff' } : { color: '#1e293b' }]}>English</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.langBtn, selectedLanguage === 'pa-IN' ? styles.langBtnActive : { backgroundColor: '#ffffff', borderColor: '#cbd5e1' }]} 
                      onPress={() => setSelectedLanguage('pa-IN')}
                    >
                      <Text style={[styles.langBtnText, selectedLanguage === 'pa-IN' ? { color: '#ffffff' } : { color: '#1e293b' }]}>Punjabi</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity 
                    style={[styles.btnPrimary, { backgroundColor: '#10b981', marginBottom: 10 }]} 
                    onPress={handleSaveProfile}
                  >
                    <Text style={styles.btnText}>Save Changes</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                    <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#cbd5e1', justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                      <Text style={{ fontSize: 30 }}>👤</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1e293b' }}>{patientName || 'Patient'}</Text>
                      <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>ID: {patientId}</Text>
                      <Text style={{ color: '#475569', marginTop: 4 }}>Language: {selectedLanguage === 'en' ? 'English' : 'Punjabi'}</Text>
                    </View>
                  </View>
                  
                  {patientData && (
                    <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 15, marginBottom: 20, borderWidth: 1, borderColor: '#e2e8f0' }}>
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#64748b', marginBottom: 12, textTransform: 'uppercase' }}>Medical Details</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ color: '#64748b' }}>District:</Text>
                        <Text style={{ color: '#1e293b', fontWeight: '500' }}>{patientData.district || 'N/A'}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ color: '#64748b' }}>Severity:</Text>
                        <Text style={{ color: patientData.severity === 'Severe' ? '#ef4444' : patientData.severity === 'Moderate' ? '#f59e0b' : '#1e293b', fontWeight: 'bold' }}>{patientData.severity || 'N/A'}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ color: '#64748b' }}>Addiction:</Text>
                        <Text style={{ color: '#1e293b', fontWeight: '500', maxWidth: '60%', textAlign: 'right' }}>{patientData.addictionCategory || 'N/A'}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: '#64748b' }}>Last Session:</Text>
                        <Text style={{ color: '#1e293b', fontWeight: '500' }}>{patientData.lastSessionDate || 'None'}</Text>
                      </View>
                    </View>
                  )}
                  
                  <TouchableOpacity 
                    style={[styles.btnPrimary, { backgroundColor: '#e2e8f0', marginTop: 0, marginBottom: 10 }]} 
                    onPress={() => setIsEditingProfile(true)}
                  >
                    <Text style={[styles.btnText, { color: '#1e293b' }]}>Edit Profile</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.btnPrimary, { backgroundColor: '#ef4444' }]} 
                    onPress={() => { setActiveModal(null); setIsEditingProfile(false); setUiState('login'); }}
                  >
                    <Text style={styles.btnText}>Log Out</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => { setActiveModal(null); setIsEditingProfile(false); }}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PATIENT DETAILS MODAL (Counselor View) */}
      <Modal
        visible={viewedPatient !== null}
        animationType="slide"
        onRequestClose={() => setViewedPatient(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '85%' }]}>
            {viewedPatient && (
              <ScrollView style={{ width: '100%' }}>
                <Text style={styles.modalTitle}>{viewedPatient.name || viewedPatient.id}</Text>
                <Text style={styles.modalSubtitle}>Patient ID: {viewedPatient.id}</Text>
                
                <View style={{ marginTop: 15, marginBottom: 10, padding: 15, backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' }}>
                  <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 5, color: '#334155' }}>Clinical Profile</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600' }}>District:</Text> {viewedPatient.district || 'N/A'}</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600' }}>Language:</Text> {viewedPatient.preferredLanguage === 'pa-IN' ? 'Punjabi' : viewedPatient.preferredLanguage === 'hi-IN' ? 'Hindi' : 'English'}</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600' }}>Category:</Text> {viewedPatient.addictionCategory || viewedPatient.category || 'General'}</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600' }}>Severity:</Text> {viewedPatient.severity || 'Normal'}</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600' }}>Risk Status:</Text> {viewedPatient.status || 'Active'}</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600' }}>Urgency Score:</Text> {viewedPatient.urgencyScore || 0}/10</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600' }}>Craving Intensity:</Text> {viewedPatient.cravingsIntensity || 0}/10</Text>
                </View>

                <View style={{ marginBottom: 20, padding: 15, backgroundColor: '#f0fdf4', borderRadius: 8, borderWidth: 1, borderColor: '#bbf7d0' }}>
                  <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 5, color: '#166534' }}>Engagement</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600', color: '#166534' }}>Last Session:</Text> {viewedPatient.lastSessionDate || viewedPatient.last || 'None'}</Text>
                  <Text style={{ marginBottom: 4 }}><Text style={{ fontWeight: '600', color: '#166534' }}>Admission Date:</Text> {viewedPatient.admissionDate || 'N/A'}</Text>
                </View>
                
                <TouchableOpacity 
                  style={[styles.btnPrimary, { marginBottom: 10 }]} 
                  onPress={() => { 
                    setTargetPatientId(viewedPatient.id); 
                    setViewedPatient(null); 
                    setActiveTab('home'); 
                  }}
                >
                  <Text style={styles.btnPrimaryText}>Select & Prepare Call</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.modalCloseBtn} 
                  onPress={() => setViewedPatient(null)}
                >
                  <Text style={styles.modalCloseBtnText}>Close Details</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 480 : '100%',
    marginHorizontal: Platform.OS === 'web' ? 'auto' : 0,
    boxShadow: Platform.OS === 'web' ? '0px 0px 20px rgba(0,0,0,0.1)' : undefined,
  },
  scrollContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loginCard: {
    backgroundColor: '#ffffff',
    padding: 30,
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    color: '#1e293b',
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
    backgroundColor: '#f1f5f9',
    color: '#1e293b',
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    backgroundColor: '#e2e8f0',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    flex: 1,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  },
  langBtnActive: {
    backgroundColor: '#0d9488',
    borderColor: '#14b8a6',
  },
  langBtnText: {
    color: '#1e293b',
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
    color: '#1e293b',
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
    color: '#1e293b',
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
    color: '#1e293b',
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    borderColor: '#475569',
  },
  counselorName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e293b',
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    color: '#1e293b',
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
    borderBottomColor: '#e2e8f0',
  },
  moodLogText: {
    color: '#1e293b',
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
    backgroundColor: '#f8fafc',
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
    borderColor: '#e2e8f0',
    marginBottom: 30,
  },
  incomingTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1e293b',
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
    color: '#1e293b',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // ACTIVE CALL SCREEN
  fullscreenActiveCall: {
    flex: 1,
    backgroundColor: '#f8fafc',
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
    color: '#1e293b',
    marginBottom: 6,
  },
  activeCallTimer: {
    fontSize: 36,
    fontWeight: '800',
    color: '#1e293b',
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
    color: '#475569',
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
    backgroundColor: '#ffffff',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    borderBottomColor: '#e2e8f0',
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
    backgroundColor: '#e2e8f0',
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
    color: '#1e293b',
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
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 24,
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 24,
    textAlign: 'center',
  },
  modalCloseBtn: {
    backgroundColor: '#e2e8f0',
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
    color: '#1e293b',
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
    backgroundColor: '#e2e8f0',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#475569',
  },
  moodItemActive: {
    borderColor: '#14b8a6',
    backgroundColor: 'rgba(20, 184, 166, 0.1)',
  },
  moodText: {
    color: '#475569',
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
    backgroundColor: '#e2e8f0',
    alignSelf: 'flex-start',
    borderTopLeftRadius: 4,
  },
  roleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    color: '#1e293b',
  },
  govBanner: {
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    borderRadius: 18,
    width: '100%',
    marginBottom: 20,
    gap: 12,
  },
  govImage: {
    width: 130,
    height: 130,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#0d9488',
  },
  govTextContainer: {
    alignItems: 'center',
  },
  govName: {
    color: '#1e293b',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  govTitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  govInitiative: {
    color: '#0d9488',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  dashboardGovBanner: {
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    borderRadius: 20,
    width: '100%',
    marginBottom: 20,
    gap: 14,
  },
  dashboardGovImage: {
    width: 140,
    height: 140,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#0d9488',
  },
  dashboardGovText: {
    color: '#1e293b',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  dashboardGovSubtext: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  dashboardGovInitiative: {
    color: '#0d9488',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  dashboardScrollContent: { padding: 16, paddingTop: 20, paddingBottom: 20 },
  headerContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  headerSubtitle: { color: '#64748b', fontSize: 14, marginBottom: 4 },
  headerTitle: { color: '#1e293b', fontSize: 20, fontWeight: 'bold' },
  onDutyBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  onDutyText: { color: '#166534', fontWeight: '600', fontSize: 14 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  metricCard: { backgroundColor: '#ffffff', borderRadius: 12, padding: 15, flex: 1, marginHorizontal: 4, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  metricLabel: { color: '#64748b', fontSize: 12, marginBottom: 8 },
  metricValue: { color: '#1e293b', fontSize: 24, fontWeight: 'bold' },
  cardLight: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  cardLightTitle: { color: '#1e293b', fontSize: 16, fontWeight: '600', marginBottom: 15 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 12, marginBottom: 15 },
  inputIcon: { fontSize: 20, marginRight: 10 },
  inputLight: { flex: 1, height: 50, color: '#1e293b', fontSize: 16 },
  callPatientBtn: { backgroundColor: '#dcfce7', padding: 15, borderRadius: 12, alignItems: 'center' },
  callPatientBtnText: { color: '#166534', fontSize: 16, fontWeight: 'bold' },
  queueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, marginTop: 10 },
  queueTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b' },
  filterBtn: { borderWidth: 1, borderColor: '#475569', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  filterBtnText: { color: '#475569', fontSize: 13, fontWeight: '500' },
  patientQueueCard: { backgroundColor: '#ffffff', borderRadius: 12, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  patientQueueCardSelected: { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' },
  pqName: { fontSize: 16, fontWeight: 'bold', color: '#1e293b', marginBottom: 4 },
  pqDetails: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  pqBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pqBadgeNormal: { backgroundColor: '#fef3c7' },
  pqBadgeUrgent: { backgroundColor: '#fee2e2' },
  pqBadgeText: { fontSize: 11, fontWeight: '600', color: '#b45309' },
  pqBadgeTextUrgent: { color: '#b91c1c' },
  pqSelectBtn: { borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  pqSelectBtnActive: { flexDirection: 'row', alignItems: 'center' },
  pqSelectBtnText: { color: '#1e293b', fontSize: 13, fontWeight: '600' },
  pqSelectBtnTextActive: { color: '#2563eb', fontSize: 13, fontWeight: 'bold' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center' },
  connectedBanner: { backgroundColor: '#dcfce7', borderRadius: 12, padding: 15, marginBottom: 15 },
  connectedBannerTitle: { color: '#166534', fontWeight: 'bold', fontSize: 14, marginBottom: 4 },
  connectedBannerSub: { color: '#166534', fontSize: 12 },
  emergencyBtn: { backgroundColor: '#fdf2f8', borderWidth: 1, borderColor: '#fbcfe8', borderRadius: 12, padding: 15, alignItems: 'center', marginBottom: 20 },
  emergencyBtnText: { color: '#9d174d', fontWeight: '600', fontSize: 16 },
  calendarIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#dbeafe', justifyContent: 'center', alignItems: 'center' },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e2e8f0', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 15 },
  navItem: { alignItems: 'center', justifyContent: 'center', width: 60 },
  navIcon: { fontSize: 24, color: '#64748b', marginBottom: 4 },
  navText: { fontSize: 10, color: '#64748b', fontWeight: '500' },
  navItemCenter: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center', marginTop: -30, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  navIconCenter: { justifyContent: 'center', alignItems: 'center' },

});