package com.example

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException

class SignalingClient(
    private val backendUrl: String,
    private val userId: String,
    private val userRole: String,
    private val clientListener: Listener
) {
    interface Listener {
        fun onConnectionStatusChanged(status: String)
        fun onOfferReceived(from: String, offerSdp: String, callerName: String)
        fun onIceCandidateReceived(candidateSdp: String, sdpMid: String, sdpMLineIndex: Int)
        fun onHangupReceived()
        fun onError(message: String)
        fun onIncomingCall(patientId: String, patientName: String, roomName: String)
        fun onTranscription(text: String, speaker: String)
    }

    private var socket: Socket? = null

    fun connect() {
        var formattedUrl = backendUrl.trim()

        clientListener.onConnectionStatusChanged("Signaling: Connecting to $formattedUrl...")

        try {
            val options = IO.Options().apply {
                forceNew = true
                reconnection = true
            }

            socket = IO.socket(formattedUrl, options)

            socket?.on(Socket.EVENT_CONNECT) {
                clientListener.onConnectionStatusChanged("Signaling: Connected. Registering...")
                registerUser()
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                clientListener.onConnectionStatusChanged("Signaling: Disconnected.")
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val errorMsg = if (args.isNotEmpty()) args[0].toString() else "Unknown error"
                clientListener.onConnectionStatusChanged("Signaling: Connection error: $errorMsg")
                clientListener.onError(errorMsg)
            }

            socket?.on("call-made") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val from = data.getString("socket")
                        val offerObj = data.getJSONObject("offer")
                        val offerSdp = offerObj.optString("roomName", offerObj.optString("sdp", ""))

                        val callerInfo = data.optJSONObject("callerInfo")
                        val callerName = callerInfo?.optString("name") ?: "Counselor"

                        clientListener.onOfferReceived(from, offerSdp, callerName)
                    }
                } catch (e: Exception) {
                    clientListener.onError("Offer parsing error: ${e.localizedMessage}")
                }
            }

            socket?.on("handoff-call") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val from = data.getString("socket")
                        val roomName = data.getString("roomName")
                        val callerName = data.optString("patientName", "Patient")
                        clientListener.onOfferReceived(from, roomName, callerName)
                    }
                } catch (e: Exception) {
                    clientListener.onError("Handoff parsing error: ${e.localizedMessage}")
                }
            }

            socket?.on("incoming-call") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val patientId = data.getString("patientId")
                        val patientName = data.optString("patientName", "Unknown Patient")
                        val roomName = data.getString("roomName")
                        clientListener.onIncomingCall(patientId, patientName, roomName)
                    }
                } catch (e: Exception) {
                    clientListener.onError("Incoming call parsing error: ${e.localizedMessage}")
                }
            }

            socket?.on("transcription") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val roomName = data.optString("roomName", "")
                        val text = data.optString("text", "")
                        val speaker = data.optString("speaker", "patient")
                        if (text.isNotBlank()) {
                            clientListener.onTranscription(text, if (speaker == "counselor") "Counselor" else "Patient")
                        }
                    }
                } catch (e: Exception) {
                    Log.e("SignalingClient", "Transcription parsing error", e)
                }
            }

            socket?.on("ice-candidate-received") { args ->
                try {
                    if (args.isNotEmpty()) {
                        val data = args[0] as JSONObject
                        val candidateObj = data.optJSONObject("candidate")
                        if (candidateObj != null) {
                            val candidateSdp = candidateObj.getString("candidate")
                            val sdpMid = candidateObj.getString("sdpMid")
                            val sdpMLineIndex = candidateObj.getInt("sdpMLineIndex")
                            clientListener.onIceCandidateReceived(candidateSdp, sdpMid, sdpMLineIndex)
                        }
                    }
                } catch (e: Exception) {
                    Log.e("SignalingClient", "Inbound ICE candidate parsing error", e)
                }
            }

            socket?.on("call-ended") {
                clientListener.onHangupReceived()
            }
            socket?.on("call-rejected") {
                clientListener.onHangupReceived()
            }

            socket?.connect()

        } catch (e: URISyntaxException) {
            clientListener.onError("Invalid URL syntax: ${e.localizedMessage}")
        }
    }

    private fun registerUser() {
        try {
            val regData = JSONObject().apply {
                put("role", userRole)
                put("id", userId)
            }
            socket?.emit("register", regData)
            clientListener.onConnectionStatusChanged("Signaling: Registered as $userRole with ID '$userId'.")
        } catch (e: Exception) {
            clientListener.onError("Registration failed: ${e.localizedMessage}")
        }
    }

    fun emitCallUser(to: String, roomName: String, callerName: String) {
        try {
            val offerObj = JSONObject().apply {
                put("type", "offer")
                put("sdp", roomName)
                put("roomName", roomName)
            }
            val callerInfoObj = JSONObject().apply {
                put("name", callerName)
            }
            val data = JSONObject().apply {
                put("to", to)
                put("offer", offerObj)
                put("callerInfo", callerInfoObj)
            }
            socket?.emit("call-user", data)
            Log.d("SignalingClient", "Emitted call-user to target: $to with room: $roomName")
        } catch (e: Exception) {
            clientListener.onError("Emitting call failed: ${e.localizedMessage}")
        }
    }

    fun emitAnswer(to: String, answerSdp: String) {
        try {
            val answerObj = JSONObject().apply {
                put("type", "answer")
                put("sdp", answerSdp)
            }
            val data = JSONObject().apply {
                put("to", to)
                put("answer", answerObj)
            }
            socket?.emit("make-answer", data)
            Log.d("SignalingClient", "Emitted SDP Answer to counselor: $to")
        } catch (e: Exception) {
            clientListener.onError("Emitting answer failed: ${e.localizedMessage}")
        }
    }

    fun emitIncomingCall(to: String, roomName: String, patientName: String) {
        try {
            val data = JSONObject().apply {
                put("to", to)
                put("from", userId)
                put("roomName", roomName)
                put("patientName", patientName)
            }
            socket?.emit("incoming-call", data)
            Log.d("SignalingClient", "Emitted incoming-call for patient to counselor: $to")
        } catch (e: Exception) {
            Log.e("SignalingClient", "Emitting incoming-call error", e)
        }
    }

    fun emitIceCandidate(to: String, candidateSdp: String, sdpMid: String, sdpMLineIndex: Int) {
        try {
            val candidateObj = JSONObject().apply {
                put("candidate", candidateSdp)
                put("sdpMid", sdpMid)
                put("sdpMLineIndex", sdpMLineIndex)
            }
            val data = JSONObject().apply {
                put("to", to)
                put("candidate", candidateObj)
            }
            socket?.emit("ice-candidate", data)
            Log.d("SignalingClient", "Emitted ICE Candidate to counselor: $to")
        } catch (e: Exception) {
            Log.e("SignalingClient", "Emitting ICE candidate error", e)
        }
    }

    fun emitHangup(to: String) {
        try {
            val data = JSONObject().apply {
                put("to", to)
            }
            socket?.emit("end-call", data)
            Log.d("SignalingClient", "Emitted end-call to counselor: $to")
        } catch (e: Exception) {
            Log.e("SignalingClient", "Emitting end-call error", e)
        }
    }

    fun emitReject(to: String) {
        try {
            val data = JSONObject().apply {
                put("to", to)
            }
            socket?.emit("reject-call", data)
            Log.d("SignalingClient", "Emitted reject-call to counselor: $to")
        } catch (e: Exception) {
            Log.e("SignalingClient", "Emitting reject-call error", e)
        }
    }

    fun disconnect() {
        socket?.disconnect()
        socket = null
        clientListener.onConnectionStatusChanged("Signaling: Disconnected client.")
    }
}