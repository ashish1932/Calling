package com.example

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException

class SignalingClient(
    private val backendUrl: String,
    private val counselorId: String,
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
        
        clientListener.onConnectionStatusChanged("Signaling: Connecting to $formattedUrl...")
        
        try {
            val options = IO.Options().apply {
                forceNew = true
                reconnection = true
            }

            socket = IO.socket(formattedUrl, options)

            socket?.on(Socket.EVENT_CONNECT) {
                clientListener.onConnectionStatusChanged("Signaling: Connected. Registering...")
                registerCounselor()
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                clientListener.onConnectionStatusChanged("Signaling: Disconnected.")
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val errorMsg = if (args.isNotEmpty()) args[0].toString() else "Unknown error"
                clientListener.onConnectionStatusChanged("Signaling: Connection error: $errorMsg")
                clientListener.onError(errorMsg)
            }

            // Handoff request from Web Dashboard
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

    private fun registerCounselor() {
        try {
            val regData = JSONObject().apply {
                put("role", "counselor")
                put("id", counselorId)
            }
            socket?.emit("register", regData)
            clientListener.onConnectionStatusChanged("Signaling: Registered as counselor ID '$counselorId'.")
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
