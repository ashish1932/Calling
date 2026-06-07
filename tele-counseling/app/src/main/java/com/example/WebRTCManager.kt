package com.example

import android.content.Context
import android.media.AudioManager
import android.util.Log
import io.livekit.android.LiveKit
import io.livekit.android.room.Room

import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class WebRTCManager(
    private val context: Context,
    private val serverUrl: String,
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
    private val client = OkHttpClient()

    init {
        listener.onWebRTCLog("LiveKit: Manager initialized.")
    }

    fun prepareCall(offerSdp: String, isCounselor: Boolean, onAnswerCreated: (String) -> Unit) {
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
            
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    listener.onWebRTCLog("LiveKit: Fetching token for room $offerSdp...")
                    val json = JSONObject().apply {
                        put("roomName", offerSdp)
                        put("participantName", if (isCounselor) "Counselor-Mobile" else "Patient-Mobile")
                        put("isCounselor", isCounselor)
                    }
                    val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
                    val request = Request.Builder()
                        .url("$serverUrl/api/livekit/token")
                        .addHeader("X-Requested-With", "XMLHttpRequest")
                        .post(body)
                        .build()
                    
                    val response = client.newCall(request).execute()
                    if (!response.isSuccessful) {
                        val err = response.body?.string() ?: "Unknown error"
                        withContext(Dispatchers.Main) { listener.onError("Failed to fetch token: $err") }
                        return@launch
                    }
                    
                    val resJson = JSONObject(response.body?.string() ?: "{}")
                    val token = resJson.optString("token")
                    val livekitUrl = resJson.optString("url", "wss://ai-assistant-ommd272n.livekit.cloud")
                    if (token.isBlank()) {
                        withContext(Dispatchers.Main) { listener.onError("Token is empty") }
                        return@launch
                    }
                    
                    withContext(Dispatchers.Main) {
                        listener.onWebRTCLog("LiveKit: Token received, connecting to LiveKit cloud...")
                        room = LiveKit.create(context)
                        CoroutineScope(Dispatchers.Main).launch {
                            room?.events?.events?.collect { event ->
                                if (event is io.livekit.android.events.RoomEvent.TrackSubscribed) {
                                    listener.onWebRTCLog("LiveKit: Remote track subscribed!")
                                    listener.onTrackAdded()
                                }
                            }
                        }
                        
                        CoroutineScope(Dispatchers.IO).launch {
                            try {
                                room?.connect(livekitUrl, token)
                                withContext(Dispatchers.Main) {
                                    listener.onWebRTCLog("LiveKit: Connected to room!")
                                    
                                    // Create and publish local mic track
                                    localAudioTrack = room?.localParticipant?.createAudioTrack(
                                        io.livekit.android.room.track.options.AudioTrackOptions.createAudioTrackOptions("mic")
                                    )
                                    localAudioTrack?.let {
                                        localAudioTrack?.start()
                                        CoroutineScope(Dispatchers.IO).launch {
                                            try {
                                                room?.localParticipant?.publishAudioTrack(it)
                                                withContext(Dispatchers.Main) {
                                                    listener.onWebRTCLog("LiveKit: Published local microphone.")
                                                }
                                            } catch (e: Exception) {
                                                withContext(Dispatchers.Main) { listener.onError("Failed to publish mic: ${e.message}") }
                                            }
                                        }
                                    }
                                }
                            } catch (e: Exception) {
                                withContext(Dispatchers.Main) { listener.onError("LiveKit connection failed: ${e.message}") }
                            }
                        }
                        
                        // Return dummy answer to SignalingClient
                        onAnswerCreated("livekit-connected")
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) { listener.onError("Network error fetching token: ${e.message}") }
                }
            }
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
