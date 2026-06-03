import re

with open('js/patient.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add active-counselor-name update
if 'active-counselor-name' not in content:
    content = content.replace(
        "if (callerEl && data.callerInfo && data.callerInfo.name) {\n      callerEl.innerText = `${data.callerInfo.name} is calling...`;\n    }",
        "if (callerEl && data.callerInfo && data.callerInfo.name) {\n      callerEl.innerText = `${data.callerInfo.name} is calling...`;\n      const activeCounselorEl = document.getElementById('active-counselor-name');\n      if (activeCounselorEl) activeCounselorEl.innerText = `${data.callerInfo.name}`; \n    }"
    )

# Add socket.on('transcript-update') and socket.on('disconnect') handler improvements
if 'transcript-update' not in content:
    content = content.replace(
        "socket.on('disconnect', () => {\n    statusText.innerText = 'Disconnected from server. Reconnecting...';\n  });",
        """socket.on('disconnect', () => {
    statusText.innerText = 'Disconnected from server. Network drop detected.';
    const btnReconnect = document.getElementById('btn-reconnect');
    if (btnReconnect) btnReconnect.style.display = 'block';
  });

  socket.on('transcript-update', (data) => {
    const box = document.getElementById('call-transcript-box');
    if (!box) return;
    const placeholder = document.getElementById('transcript-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    
    const div = document.createElement('div');
    div.style.marginBottom = '4px';
    div.innerHTML = `<strong>${data.sender === 'counselor' ? 'Counselor' : 'You'}:</strong> ${data.text}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  });
"""
    )

# Add ICE connection state handler improvements
if 'btn-reconnect' not in content:
    content = content.replace(
        "peerConnection.oniceconnectionstatechange = () => {\n      console.log('[Patient] ICE state:', peerConnection.iceConnectionState);\n    };",
        """peerConnection.oniceconnectionstatechange = () => {
      console.log('[Patient] ICE state:', peerConnection.iceConnectionState);
      if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
          const btnReconnect = document.getElementById('btn-reconnect');
          if (btnReconnect) btnReconnect.style.display = 'block';
          statusText.innerText = 'Connection lost. Please reconnect.';
          statusText.style.color = 'var(--accent-red)';
      }
    };"""
    )

# Add volume meters and quality monitor initialization in btn-accept
if 'initVolumeMeters' not in content:
    content = content.replace(
        "// 3. Add local tracks\n    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));",
        """// 3. Add local tracks
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    initVolumeMeters();
    startQualityMonitor();"""
    )

# Add the new functions at the end of the file
if 'function initVolumeMeters' not in content:
    new_funcs = """
let audioCtx = null;
let qualityInterval = null;

function initVolumeMeters() {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  const createMeter = (stream, meterId) => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const meterEl = document.getElementById(meterId);
    
    const update = () => {
      if (!meterEl) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const height = Math.min(100, Math.max(0, (avg / 128) * 100));
      meterEl.style.height = `${height}%`;
      requestAnimationFrame(update);
    };
    update();
  };
  
  createMeter(localStream, 'meter-local');
  if (remoteAudio && remoteAudio.srcObject) {
    createMeter(remoteAudio.srcObject, 'meter-remote');
  }
}

function startQualityMonitor() {
  const barsEl = document.getElementById('call-quality-bars');
  if (!barsEl) return;
  
  qualityInterval = setInterval(async () => {
    if (!peerConnection) return;
    try {
      const stats = await peerConnection.getStats();
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
      
      if (rtt > 0.5 || packetsLost > 10) {
         barsEl.innerText = '🔴🔴⚪';
      } else if (rtt > 0.2 || packetsLost > 5) {
         barsEl.innerText = '🟡🟡⚪';
      } else {
         barsEl.innerText = '🟢🟢🟢';
      }
    } catch(e) {}
  }, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
    const btnReconnect = document.getElementById('btn-reconnect');
    if (btnReconnect) {
        btnReconnect.addEventListener('click', () => {
            window.location.reload();
        });
    }
});
"""
    content += new_funcs

with open('js/patient.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("js/patient.js patched successfully.")
