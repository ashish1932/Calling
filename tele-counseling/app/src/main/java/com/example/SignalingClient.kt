package com.example

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException

class SignalingClient(
    private val backendUrl: String,
    private val patientId: String,
    private val clientListener: Listener
) {
    interface Listener {
        fun onConnectionStatusChanged(status: String)
        fun onOfferReceived(from: String, offerSdp: String, callerName: String)
        fun onIceCandidateReceived(candidateSdp: String, sdpMid: String, sdpMLineIndex: Int)
        fun onHangupReceived()
        fun onError(message: String)
    }

    private var socket: Socket? = null

    fun connect() {
        var formattedUrl = backendUrl.trim()
        
        // Ensure ws/signaling is treated as the correct namespace/path
        if (!formattedUrl.contains("/ws/signaling")) {
            formattedUrl = if (formattedUrl.endsWith("/")) {
                "${formattedUrl}ws/signaling"
            } else {
                "${formattedUrl}/ws/signaling"
            }
        }

        clientListener.onConnectionStatusChanged("Signaling: Connecting to $formattedUrl...")
        
        try {
            // Set up IO Options if needed, we'll keep it standard
            val options = IO.Options().apply {
                forceNew = true
                reconnection = true
            }

            socket = IO.socket(formattedUrl, options)

            socket?.on(Socket.EVENT_CONNECT) {
                clientListener.onConnectionStatusChanged("Signaling: Connected. Registering...")
                registerPatient()
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
                        val offerSdp = offerObj.getString("sdp")
                        
                        val callerInfo = data.optJSONObject("callerInfo")
                        val callerName = callerInfo?.optString("name") ?: "Counselor"

                        clientListener.onOfferReceived(from, offerSdp, callerName)
                    }
                } catch (e: Exception) {
                    clientListener.onError("Offer parsing error: ${e.localizedMessage}")
                }
            }

            socket?.on("ice-candidate") { args ->
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

    private fun registerPatient() {
        try {
            val regData = JSONObject().apply {
                put("role", "patient")
                put("id", patientId)
            }
            socket?.emit("register", regData)
            clientListener.onConnectionStatusChanged("Signaling: Registered as patient with ID '$patientId'. Waiting for call...")
        } catch (e: Exception) {
            clientListener.onError("Registration failed: ${e.localizedMessage}")
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
