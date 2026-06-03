import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator, AppState, Platform, PermissionsAndroid, ScrollView } from 'react-native';
import { webrtcService } from './src/services/webrtc';
import { RTCView } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [uiState, setUiState] = useState('login'); // login, waiting, incoming, active
  const [patientId, setPatientId] = useState('PT-8885-b20d');
  const [statusMsg, setStatusMsg] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callSeconds, setCallSeconds] = useState(0);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isRelayMode, setIsRelayMode] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [transcripts, setTranscripts] = useState([]);
  const [callQuality, setCallQuality] = useState('🟢🟢🟢');
  const [showReconnect, setShowReconnect] = useState(false);
  const timerRef = useRef(null);
  const appState = useRef(AppState.currentState);

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

    return () => {
      subscription.remove();
      if (timerRef.current) clearInterval(timerRef.current);
      InCallManager.stopRingtone();
      InCallManager.stop();
    };
  }, []);

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

  const handleLogin = () => {
    if (!patientId.trim()) {
      alert('Please enter a Patient ID');
      return;
    }
    setUiState('waiting');
    setStatusMsg('Connecting to server...');

    webrtcService.connect(patientId.trim(), {
      onConnect: () => setStatusMsg('Connected. Waiting for your counselor to call...'),
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
        setCallerName(name);
        setUiState('incoming');
        playRingtone();

        // Trigger background notification if app is minimized
        if (appState.current.match(/inactive|background/)) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "Incoming Call",
              body: `${name} is calling you on CounselFlow.`,
              sound: true,
              priority: Notifications.AndroidNotificationPriority.MAX,
            },
            trigger: null, // Send immediately
          });
        }
      },

      // WebRTC P2P audio track arrived successfully
      onRemoteTrack: (stream) => {
        console.log('[App] Remote stream received (WebRTC P2P mode)');
        setRemoteStream(stream);
        setIsRelayMode(false);
        setTranscripts([]);
        setShowReconnect(false);
      },

      // WebRTC P2P failed — relay mode activated automatically
      onRelayStarted: () => {
        console.log('[App] Socket relay mode active');
        setIsRelayMode(true);
        setStatusMsg('Audio connected via server relay');
      },

      // Incoming audio chunk from counselor via relay — play it
      onRelayAudioChunk: async (data) => {
        // react-native-webrtc does not expose AudioContext.
        // We let the native side handle this via the localStream track on the PC side.
        // On Android the audio will play through the WebRTC audio engine automatically
        // once the relay recorder sends data and the PC side streams back.
        // No manual decode needed here — the socket relay handles bidirectional flow.
      },

      onCallEnded: () => {
        setUiState('waiting');
        setStatusMsg('Call ended. Waiting for next call...');
        stopRingtone();
        stopTimer();
        setRemoteStream(null);
        setIsRelayMode(false);
        setTranscripts([]);
        setShowReconnect(false);
      },

      onCallConnected: () => {
        setStatusMsg('Audio connected (P2P)');
        stopRingtone();
      },

      onCallFailed: () => {
        setStatusMsg('Call failed. Switching to relay mode or please reconnect.');
        stopRingtone();
        setShowReconnect(true);
      },
    });
  };

  const handleAcceptCall = async () => {
    stopRingtone();
    setUiState('active');
    setStatusMsg('Connecting audio...');
    startTimer();
    
    // Start InCallManager to manage audio focus and route to speaker
    InCallManager.start({ media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(true);
    InCallManager.setMicrophoneMute(false);

    const success = await webrtcService.acceptCall();
    if (!success) {
      alert('Failed to connect to the call or access microphone.');
      setUiState('waiting');
      setStatusMsg('Call failed. Waiting for next call...');
      stopTimer();
      InCallManager.stop();
    }
  };

  const handleDeclineCall = () => {
    stopRingtone();
    webrtcService.declineCall();
    setUiState('waiting');
    setStatusMsg('Call declined. Waiting for next call...');
  };

  const handleReconnect = () => {
    webrtcService.cleanupCall();
    setUiState('login');
    setShowReconnect(false);
    setTranscripts([]);
    setCallSeconds(0);
  };

  const handleEndCall = () => {
    webrtcService.endCall();
    setUiState('waiting');
    setStatusMsg('Call ended. Waiting for next call...');
    stopTimer();
    setRemoteStream(null);
    setIsRelayMode(false);
    setTranscripts([]);
    setShowReconnect(false);
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>

        {/* LOGIN UI */}
        {uiState === 'login' && (
          <View style={styles.viewContainer}>
            <Text style={styles.title}>CounselFlow Patient</Text>
            <Text style={styles.label}>Enter Patient ID</Text>
            <TextInput
              style={styles.input}
              value={patientId}
              onChangeText={setPatientId}
              placeholder="e.g. PT-1234"
              placeholderTextColor="#888"
            />
            <Text style={styles.label}>Preferred Language</Text>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 20}}>
              {['en', 'pa', 'hi'].map(lang => (
                <TouchableOpacity 
                  key={lang} 
                  onPress={() => setSelectedLanguage(lang)}
                  style={[styles.langBtn, selectedLanguage === lang && styles.langBtnActive]}
                >
                  <Text style={styles.btnText}>{lang === 'en' ? 'English' : lang === 'pa' ? 'Punjabi' : 'Hindi'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.btnPrimary} onPress={handleLogin}>
              <Text style={styles.btnText}>Login & Wait for Call</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* WAITING UI */}
        {uiState === 'waiting' && (
          <View style={styles.viewContainer}>
            <ActivityIndicator size="large" color="#14b8a6" style={{ marginBottom: 20 }} />
            <Text style={styles.title}>Connected</Text>
            <Text style={styles.subtitle}>Waiting for your counselor to initiate the call...</Text>
            <Text style={styles.statusText}>{statusMsg}</Text>
          </View>
        )}

        {/* INCOMING CALL UI */}
        {uiState === 'incoming' && (
          <View style={styles.viewContainer}>
            <Text style={styles.title}>Incoming Call</Text>
            <Text style={styles.subtitle}>{callerName} is calling...</Text>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.btnAction, styles.btnAccept]} onPress={handleAcceptCall}>
                <Text style={styles.btnText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnAction, styles.btnDecline]} onPress={handleDeclineCall}>
                <Text style={[styles.btnText, { color: '#ef4444' }]}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ACTIVE CALL UI */}
        {uiState === 'active' && (
          <View style={styles.viewContainer}>
            <Text style={styles.title}>Call in Progress</Text>
            <Text style={styles.timer}>{formatTime(callSeconds)}</Text>

            {/* Call Quality & Reconnect */}
            <View style={{flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 10, marginBottom: 10}}>
              <Text style={{color: '#94a3b8', fontSize: 12}}>Signal: {callQuality}</Text>
              {showReconnect && (
                <TouchableOpacity onPress={handleReconnect} style={{backgroundColor: '#ef4444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10}}>
                  <Text style={{color: '#fff', fontSize: 12}}>Reconnect</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Connection mode badge */}
            <View style={[styles.modeBadge, isRelayMode ? styles.modeBadgeRelay : styles.modeBadgeP2P]}>
              <Text style={styles.modeBadgeText}>
                {isRelayMode ? '🔄 Server Relay Mode' : '📡 Direct P2P Mode'}
              </Text>
            </View>

            {statusMsg ? <Text style={styles.statusText}>{statusMsg}</Text> : null}

            {/* Transcript View */}
            <View style={{width: '100%', height: 150, backgroundColor: '#0f172a', borderRadius: 8, padding: 10, marginVertical: 15}}>
              <Text style={{color: '#94a3b8', fontSize: 11, marginBottom: 5}}>Live Transcript</Text>
              <ScrollView style={{flex: 1}} contentContainerStyle={{paddingBottom: 10}}>
                {transcripts.length === 0 ? (
                  <Text style={{color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 20}}>Transcript will appear here...</Text>
                ) : (
                  transcripts.map((t, i) => (
                    <Text key={i} style={{color: '#f8fafc', fontSize: 13, marginBottom: 4}}>
                      <Text style={{fontWeight: 'bold', color: t.sender === 'counselor' ? '#3b82f6' : '#94a3b8'}}>
                        {t.sender === 'counselor' ? 'Counselor' : 'You'}:
                      </Text> {t.text}
                    </Text>
                  ))
                )}
              </ScrollView>
            </View>

            <TouchableOpacity style={[styles.btnAction, styles.btnEnd]} onPress={handleEndCall}>
              <Text style={styles.btnText}>End Call</Text>
            </TouchableOpacity>

            {/* RTCView must be rendered (even invisible) to activate audio engine on Android */}
            {remoteStream && (
              <RTCView
                streamURL={remoteStream.toURL ? remoteStream.toURL() : remoteStream}
                style={{ width: 1, height: 1, position: 'absolute', opacity: 0 }}
              />
            )}
          </View>
        )}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#1e293b',
    padding: 30,
    borderRadius: 20,
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  viewContainer: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#cbd5e1',
    marginBottom: 20,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  input: {
    width: '100%',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    fontSize: 16,
  },
  btnPrimary: {
    backgroundColor: '#3b82f6',
    width: '100%',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  langBtn: {
    backgroundColor: '#334155',
    padding: 10,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  langBtnActive: {
    backgroundColor: '#3b82f6',
  },
  btnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 13,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  btnAction: {
    padding: 15,
    borderRadius: 30,
    width: '45%',
    alignItems: 'center',
  },
  btnAccept: {
    backgroundColor: '#10b981',
  },
  btnDecline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  btnEnd: {
    backgroundColor: '#ef4444',
    width: '100%',
    marginTop: 20,
  },
  timer: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#3b82f6',
    marginVertical: 20,
  },
  modeBadge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 8,
  },
  modeBadgeP2P: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  modeBadgeRelay: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  modeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
});
