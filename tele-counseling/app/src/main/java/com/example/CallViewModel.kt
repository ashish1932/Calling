package com.example

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

enum class CallState {
    IDLE,          // Initial configuration screen
    CONNECTING,    // Attempting network/socket registration
    WAITING,       // Registered & awaiting incoming sessions
    INCOMING,      // Offer received, presenting Answer/Reject options
    ACTIVE,        // WebRTC stream flowing
    ERROR          // Interrupted / error screen
}

class CallViewModel(application: Application) : AndroidViewModel(application) {

    private val prefs: SharedPreferences = application.getSharedPreferences("AppPreferences", Context.MODE_PRIVATE)

    private val _serverUrl = MutableStateFlow(
        prefs.getString("serverUrl", "https://economist-slideshow-flannels.ngrok-free.dev") ?: "https://economist-slideshow-flannels.ngrok-free.dev"
    )
    val serverUrl: StateFlow<String> = _serverUrl.asStateFlow()

    private val _patientId = MutableStateFlow(
        prefs.getString("patientId", "") ?: ""
    )
    val patientId: StateFlow<String> = _patientId.asStateFlow()

    private val _callState = MutableStateFlow(CallState.IDLE)
    val callState: StateFlow<CallState> = _callState.asStateFlow()

    private val _callerName = MutableStateFlow("")
    val callerName: StateFlow<String> = _callerName.asStateFlow()

    private val _logs = MutableStateFlow<List<String>>(emptyList())
    val logs: StateFlow<List<String>> = _logs.asStateFlow()

    private val _durationSeconds = MutableStateFlow(0)
    val durationSeconds: StateFlow<Int> = _durationSeconds.asStateFlow()

    private var signalingClient: SignalingClient? = null
    private var webRTCManager: WebRTCManager? = null

    private val httpClient = OkHttpClient()

    // Temp variables for the incoming call
    private var savedCallerId: String? = null
    private var savedOfferSdp: String? = null

    // Call duration timer job
    private var timerJob: Job? = null

    init {
        addLog("Application ready. Configure backend server url to start client.")
        if (prefs.getBoolean("isLoggedIn", false)) {
            addLog("Auto-login triggered. Resuming session...")
            connect()
        }
    }

    fun updateServerUrl(url: String) {
        _serverUrl.value = url
    }

    fun updatePatientId(id: String) {
        _patientId.value = id
    }

    fun clearLogs() {
        _logs.value = emptyList()
    }

    fun addLog(msg: String) {
        val timeStamp = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault()).format(Date())
        viewModelScope.launch {
            _logs.value = _logs.value + "[$timeStamp] $msg"
        }
    }

    fun connect() {
        if (_serverUrl.value.isBlank() || _patientId.value.isBlank()) {
            addLog("Error: Server URL and Patient ID cannot be empty.")
            return
        }

        val patientIdTrimmed = _patientId.value.trim()
        _patientId.value = patientIdTrimmed

        _callState.value = CallState.CONNECTING
        addLog("Validating login for Patient $patientIdTrimmed...")

        val loginData = JSONObject().apply {
            put("id", patientIdTrimmed)
            put("role", "patient")
        }
        val requestBody = loginData.toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${_serverUrl.value}/api/login")
            .header("X-Requested-With", "XMLHttpRequest")
            .post(requestBody)
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                viewModelScope.launch {
                    addLog("Login failed: Network error - ${e.localizedMessage}")
                    _callState.value = CallState.ERROR
                }
            }

            override fun onResponse(call: Call, response: Response) {
                viewModelScope.launch {
                    if (response.isSuccessful) {
                        val respStr = response.body?.string() ?: ""
                        try {
                            val json = JSONObject(respStr)
                            val name = json.optString("name", _patientId.value)
                            addLog("Login successful! Welcome, $name.")
                            
                            // Save preferences
                            prefs.edit()
                                .putString("serverUrl", _serverUrl.value)
                                .putString("patientId", _patientId.value)
                                .putBoolean("isLoggedIn", true)
                                .apply()

                            connectSignaling()
                        } catch (e: Exception) {
                            addLog("Error parsing login response.")
                            _callState.value = CallState.ERROR
                        }
                    } else {
                        addLog("Login failed: Invalid credentials or not a patient.")
                        _callState.value = CallState.ERROR
                    }
                }
            }
        })
    }

    private fun connectSignaling() {
        addLog("Connecting to signaling server at ${_serverUrl.value}...")
        signalingClient = SignalingClient(
            backendUrl = _serverUrl.value,
            patientId = _patientId.value,
            clientListener = object : SignalingClient.Listener {
                override fun onConnectionStatusChanged(status: String) {
                    addLog(status)
                    if (status.contains("Registered")) {
                        _callState.value = CallState.WAITING
                    } else if (status.contains("Disconnected")) {
                        if (_callState.value != CallState.IDLE) {
                            _callState.value = CallState.IDLE
                        }
                    }
                }

                override fun onOfferReceived(from: String, offerSdp: String, callerName: String) {
                    addLog("Signaling: Incoming offer received from counselor '$callerName' (socket ID: $from).")
                    savedCallerId = from
                    savedOfferSdp = offerSdp
                    _callerName.value = callerName
                    _callState.value = CallState.INCOMING
                }

                override fun onIceCandidateReceived(candidateSdp: String, sdpMid: String, sdpMLineIndex: Int) {
                    addLog("Signaling: Inbound ICE candidate received.")
                    webRTCManager?.addRemoteIceCandidate(candidateSdp, sdpMid, sdpMLineIndex)
                }

                override fun onHangupReceived() {
                    addLog("Signaling: Counselor hung up the call.")
                    hangupLocally()
                }

                override fun onError(message: String) {
                    addLog("Signaling Error: $message")
                }
            }
        )
        signalingClient?.connect()
    }

    fun answerCall() {
        if (_callState.value != CallState.INCOMING) return

        val callerId = savedCallerId ?: ""
        if (savedOfferSdp == null || callerId.isBlank()) {
            addLog("Error: Cannot answer call. Missing offer or caller ID.")
            return
        }

        addLog("Answering Call... Initializing WebRTC client.")
        
        // Setup WebRTCManager
        webRTCManager = WebRTCManager(
            context = getApplication(),
            serverUrl = _serverUrl.value,
            listener = object : WebRTCManager.Listener {
                override fun onWebRTCLog(message: String) {
                    addLog(message)
                }

                override fun onLocalIceCandidate(candidateSdp: String, sdpMid: String, sdpMLineIndex: Int) {
                    signalingClient?.emitIceCandidate(callerId, candidateSdp, sdpMid, sdpMLineIndex)
                }

                override fun onTrackAdded() {
                    addLog("WebRTC: Remote audio track added to connection & currently outputting.")
                }

                override fun onError(message: String) {
                    addLog("WebRTC Error: $message")
                }
            }
        )

        // WebRTC preparation & answer emission
        webRTCManager?.prepareCall(savedOfferSdp!!) { answerSdp ->
            signalingClient?.emitAnswer(callerId, answerSdp)
            _callState.value = CallState.ACTIVE
            startTimer()
        }
    }

    fun startCall(targetId: String) {
        val roomName = "room-${java.util.UUID.randomUUID().toString().substring(0, 8)}"
        val myName = _patientId.value.ifBlank { "Patient" }
        addLog("LiveKit: Initiating call to $targetId in room $roomName")

        _callState.value = CallState.CONNECTING
        savedCallerId = targetId
        savedOfferSdp = roomName

        signalingClient?.emitCallUser(targetId, roomName, myName)

        // Setup WebRTCManager
        webRTCManager = WebRTCManager(
            context = getApplication(),
            serverUrl = _serverUrl.value,
            listener = object : WebRTCManager.Listener {
                override fun onWebRTCLog(message: String) { addLog(message) }
                override fun onLocalIceCandidate(candidateSdp: String, sdpMid: String, sdpMLineIndex: Int) {}
                override fun onTrackAdded() { addLog("WebRTC: Remote audio track added to connection.") }
                override fun onError(message: String) { addLog("WebRTC Error: $message") }
            }
        )

        webRTCManager?.prepareCall(roomName) {
            _callState.value = CallState.ACTIVE
            startTimer()
        }
    }

    fun rejectCall() {
        val callerId = savedCallerId
        if (callerId != null) {
            signalingClient?.emitReject(callerId)
            addLog("Call rejected. Emitted reject back to counselor.")
        }
        resetCallState()
    }

    fun endCall() {
        val callerId = savedCallerId
        if (callerId != null) {
            signalingClient?.emitHangup(callerId)
            addLog("Call ended locally by patient. Emitted hangup.")
        }
        hangupLocally()
    }

    private fun hangupLocally() {
        webRTCManager?.close()
        webRTCManager = null
        stopTimer()
        resetCallState()
    }

    private fun resetCallState() {
        savedCallerId = null
        savedOfferSdp = null
        _callerName.value = ""
        _callState.value = CallState.WAITING
    }

    fun disconnect() {
        // Clear persistent login flag so user must sign in manually next time
        prefs.edit()
            .putBoolean("isLoggedIn", false)
            .remove("patientId")
            .apply()

        _patientId.value = ""

        timerJob?.cancel()
        timerJob = null
        
        webRTCManager?.close()
        webRTCManager = null
        
        signalingClient?.disconnect()
        signalingClient = null
        
        savedCallerId = null
        savedOfferSdp = null
        _callerName.value = ""
        
        _callState.value = CallState.IDLE
        addLog("Disconnected client services and reset to idle configuration.")
    }

    private fun startTimer() {
        _durationSeconds.value = 0
        timerJob?.cancel()
        timerJob = viewModelScope.launch {
            while (true) {
                delay(1000)
                _durationSeconds.value += 1
            }
        }
    }

    private fun stopTimer() {
        timerJob?.cancel()
        timerJob = null
    }

    override fun onCleared() {
        super.onCleared()
        disconnect()
    }
}
