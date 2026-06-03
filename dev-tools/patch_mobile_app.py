import re

with open('patient-mobile-app/App.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add ScrollView to react-native imports
content = content.replace(
    "import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator, AppState, Platform, PermissionsAndroid } from 'react-native';",
    "import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator, AppState, Platform, PermissionsAndroid, ScrollView } from 'react-native';"
)

# Add state variables
content = content.replace(
    "const [isRelayMode, setIsRelayMode] = useState(false);",
    """const [isRelayMode, setIsRelayMode] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [transcripts, setTranscripts] = useState([]);
  const [callQuality, setCallQuality] = useState('🟢🟢🟢');
  const [showReconnect, setShowReconnect] = useState(false);"""
)

# Add connect callbacks
content = content.replace(
    "onDisconnect: () => setStatusMsg('Disconnected. Reconnecting...'),",
    """onDisconnect: () => {
        setStatusMsg('Disconnected. Network drop detected.');
        setShowReconnect(true);
      },
      onTranscriptUpdate: (data) => {
        setTranscripts(prev => [...prev, data]);
      },
      onCallQualityUpdate: (status) => {
        setCallQuality(status);
      },"""
)

# Update onCallFailed to show reconnect
content = content.replace(
    "onCallFailed: () => {\n        setStatusMsg('Switching to relay mode...');\n        stopRingtone();\n      },",
    """onCallFailed: () => {
        setStatusMsg('Call failed. Switching to relay mode or please reconnect.');
        stopRingtone();
        setShowReconnect(true);
      },"""
)

# Update onCallEnded to clear transcripts and reconnect
content = content.replace(
    "setIsRelayMode(false);\n      },",
    "setIsRelayMode(false);\n        setTranscripts([]);\n        setShowReconnect(false);\n      },"
)

# Also update handleEndCall to clear states
content = content.replace(
    "setIsRelayMode(false);\n    InCallManager.stop();",
    "setIsRelayMode(false);\n    setTranscripts([]);\n    setShowReconnect(false);\n    InCallManager.stop();"
)

# Handle reconnect button
if 'handleReconnect' not in content:
    content = content.replace(
        "const handleEndCall = () => {",
        """const handleReconnect = () => {
    webrtcService.cleanupCall();
    setUiState('login');
    setShowReconnect(false);
    setTranscripts([]);
    setCallSeconds(0);
  };

  const handleEndCall = () => {"""
    )

# Add language selector to login UI
content = content.replace(
    """<TouchableOpacity style={styles.btnPrimary} onPress={handleLogin}>
              <Text style={styles.btnText}>Login & Wait for Call</Text>
            </TouchableOpacity>""",
    """<Text style={styles.label}>Preferred Language</Text>
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
            </TouchableOpacity>"""
)

# Add quality indicator, reconnect, and transcripts to active UI
content = content.replace(
    """{/* Connection mode badge */}
            <View style={[styles.modeBadge, isRelayMode ? styles.modeBadgeRelay : styles.modeBadgeP2P]}>""",
    """{/* Call Quality & Reconnect */}
            <View style={{flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 10, marginBottom: 10}}>
              <Text style={{color: '#94a3b8', fontSize: 12}}>Signal: {callQuality}</Text>
              {showReconnect && (
                <TouchableOpacity onPress={handleReconnect} style={{backgroundColor: '#ef4444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10}}>
                  <Text style={{color: '#fff', fontSize: 12}}>Reconnect</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Connection mode badge */}
            <View style={[styles.modeBadge, isRelayMode ? styles.modeBadgeRelay : styles.modeBadgeP2P]}>"""
)

content = content.replace(
    """<TouchableOpacity style={[styles.btnAction, styles.btnEnd]} onPress={handleEndCall}>
              <Text style={styles.btnText}>End Call</Text>
            </TouchableOpacity>""",
    """{/* Transcript View */}
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
            </TouchableOpacity>"""
)

# Add CSS for language buttons
content = content.replace(
    "btnText: {",
    """langBtn: {
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
  btnText: {"""
)

with open('patient-mobile-app/App.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("App.js patched successfully")
