import wave
import struct
import math

# Audio parameters
sample_rate = 44100
duration = 1.5 # seconds per ring
frequency1 = 440.0 # A4
frequency2 = 480.0 # B4 slightly detuned
amplitude = 16000 # volume (max 32767)

with wave.open('assets/ringtone.wav', 'w') as wav_file:
    wav_file.setnchannels(1)
    wav_file.setsampwidth(2)
    wav_file.setframerate(sample_rate)
    
    for i in range(int(sample_rate * duration)):
        # Generate classic European-style ring tone (two frequencies mixed)
        # Ring for 0.4s, pause for 0.2s, ring for 0.4s, pause for 0.5s
        t = i / sample_rate
        if (t < 0.4) or (0.6 < t < 1.0):
            value = int(amplitude * (math.sin(2 * math.pi * frequency1 * t) + math.sin(2 * math.pi * frequency2 * t)) / 2)
        else:
            value = 0
            
        data = struct.pack('<h', value)
        wav_file.writeframesraw(data)
