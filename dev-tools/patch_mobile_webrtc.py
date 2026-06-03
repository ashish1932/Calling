import re

with open('patient-mobile-app/src/services/webrtc.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add qualityInterval and _qualityCallbacks to constructor
content = content.replace(
    "this._relayCallbacks = {};",
    "this._relayCallbacks = {};\n    this.qualityInterval = null;\n    this._callbacks = {};"
)

# Replace 'callbacks' with 'this._callbacks' saving in connect
content = content.replace(
    "this._relayCallbacks = callbacks;",
    "this._relayCallbacks = callbacks;\n    this._callbacks = callbacks;"
)

# Add socket.on('transcript-update')
if 'transcript-update' not in content:
    content = content.replace(
        "this.socket.on('audio-chunk', (data) => {",
        """this.socket.on('transcript-update', (data) => {
      if (this._callbacks.onTranscriptUpdate) this._callbacks.onTranscriptUpdate(data);
    });

    this.socket.on('audio-chunk', (data) => {"""
    )

# Add quality monitor starting inside onconnectionstatechange
content = content.replace(
    "if (state === 'connected') {\n          if (callbacks.onCallConnected) callbacks.onCallConnected();\n        } else if (state === 'failed' || state === 'disconnected') {",
    """if (state === 'connected') {
          this.startQualityMonitor(callbacks);
          if (callbacks.onCallConnected) callbacks.onCallConnected();
        } else if (state === 'failed' || state === 'disconnected') {"""
)

# Clear quality monitor in cleanupCall
content = content.replace(
    "this.isRelayMode = false;",
    "this.isRelayMode = false;\n    if (this.qualityInterval) { clearInterval(this.qualityInterval); this.qualityInterval = null; }"
)

# Add startQualityMonitor function
if 'startQualityMonitor' not in content:
    content = content.replace(
        "// Send a binary audio chunk (called from App.js if using expo-av recording)",
        """startQualityMonitor(callbacks) {
    if (this.qualityInterval) clearInterval(this.qualityInterval);
    this.qualityInterval = setInterval(async () => {
      if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') return;
      try {
        const stats = await this.peerConnection.getStats();
        let packetsLost = 0;
        let rtt = 0;
        
        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            packetsLost = report.packetsLost || 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime || 0;
          }
        });
        
        let status = '🟢🟢🟢';
        if (rtt > 0.5 || packetsLost > 10) status = '🔴🔴⚪';
        else if (rtt > 0.2 || packetsLost > 5) status = '🟡🟡⚪';
        
        if (callbacks.onCallQualityUpdate) callbacks.onCallQualityUpdate(status);
      } catch (e) {
      }
    }, 2000);
  }

  // Send a binary audio chunk (called from App.js if using expo-av recording)"""
    )

with open('patient-mobile-app/src/services/webrtc.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("webrtc.js patched successfully")
