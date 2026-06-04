package com.example

import android.content.Context
import android.media.AudioManager
import android.util.Log
import io.livekit.android.LiveKit
import io.livekit.android.room.Room
import io.livekit.android.room.track.LocalAudioTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class WebRTCManager(
    private val context: Context,
    private val listener: Listener
) {
    interface Listener {
        fun onWebRTCLog(message: String)
        fun onLocalIceCandidate(candidateSdp: String, sdpMid: String, sdpMLineIndex: Int)
        fun onTrackAdded()
        fun onError(message: String)
    }

    private var room: Room? = null
    private var localAudioTrack: LocalAudioTrack? = null
    private var audioManager: AudioManager? = null
    private var previousAudioMode: Int = AudioManager.MODE_NORMAL
    private var previousSpeakerphoneOn: Boolean = false

    init {
        listener.onWebRTCLog("LiveKit: Manager initialized.")
    }

    fun prepareCall(offerSdp: String, onAnswerCreated: (String) -> Unit) {
        listener.onWebRTCLog("LiveKit: Preparing call for room: $offerSdp")
        
        try {
            audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioManager?.let { am ->
                previousAudioMode = am.mode
                previousSpeakerphoneOn = am.isSpeakerphoneOn
                am.mode = AudioManager.MODE_IN_COMMUNICATION
                am.isSpeakerphoneOn = true
                listener.onWebRTCLog("LiveKit: AudioManager configured for speakerphone.")
            }
            
            room = LiveKit.create(context)
            // Note: Actual connection requires a token fetched from the backend.
            // room?.connect("wss://ai-assistant-ommd272n.livekit.cloud", "<TOKEN>")
            
            listener.onWebRTCLog("LiveKit: Ready. Token implementation required in Android.")
            
            // Return a dummy answer to satisfy the SignalingClient's expectation
            onAnswerCreated("livekit-connected")
            
        } catch (e: Exception) {
            listener.onError("LiveKit setup failed: ${e.localizedMessage}")
        }
    }

    fun addRemoteIceCandidate(sdp: String, sdpMid: String, sdpMLineIndex: Int) {
        // No-op for LiveKit (SFU handles routing)
    }

    fun close() {
        try {
            room?.disconnect()
            room = null
            
            localAudioTrack?.dispose()
            localAudioTrack = null
            
            audioManager?.let { am ->
                am.mode = previousAudioMode
                am.isSpeakerphoneOn = previousSpeakerphoneOn
                listener.onWebRTCLog("LiveKit: AudioManager state restored.")
            }
            audioManager = null

            listener.onWebRTCLog("LiveKit: Call ended.")
        } catch (e: Exception) {
            Log.e("WebRTCManager", "Error closing LiveKit connection", e)
        }
    }
}
