package com.example

import android.content.Context
import android.util.Log
import org.webrtc.*

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

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var localAudioTrack: AudioTrack? = null
    private var localAudioSource: AudioSource? = null

    init {
        try {
            // 1. Initialize PeerConnectionFactory globals
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context)
                    .setEnableInternalTracer(true)
                    .createInitializationOptions()
            )
            listener.onWebRTCLog("WebRTC: Initialized library globals.")

            // 2. Create PeerConnectionFactory
            val options = PeerConnectionFactory.Options()
            peerConnectionFactory = PeerConnectionFactory.builder()
                .setOptions(options)
                .createPeerConnectionFactory()
            listener.onWebRTCLog("WebRTC: PeerConnectionFactory created successfully.")
        } catch (e: Exception) {
            listener.onError("WebRTC Init error: ${e.localizedMessage}")
        }
    }

    fun prepareCall(offerSdp: String, onAnswerCreated: (String) -> Unit) {
        val factory = peerConnectionFactory
        if (factory == null) {
            listener.onError("WebRTC Manager not initialized.")
            return
        }

        try {
            // Configure ICE Servers
            val iceServers = listOf(
                PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
                PeerConnection.IceServer.builder("turn:openrelay.metered.ca:443?transport=tcp")
                    .setUsername("openrelayproject")
                    .setPassword("openrelayproject")
                    .createIceServer()
            )

            val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            }

            // Create PeerConnection with Observer
            peerConnection = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState?) {
                    listener.onWebRTCLog("WebRTC: Signaling state changed: $state")
                }

                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                    listener.onWebRTCLog("WebRTC: ICE Connection state changed: $state")
                }

                override fun onIceConnectionReceivingChange(receiving: Boolean) {
                    listener.onWebRTCLog("WebRTC: ICE Receiving changed: $receiving")
                }

                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                    listener.onWebRTCLog("WebRTC: ICE Gathering state: $state")
                }

                override fun onIceCandidate(candidate: IceCandidate?) {
                    if (candidate != null) {
                        listener.onWebRTCLog("WebRTC: New local ICE Candidate generated.")
                        listener.onLocalIceCandidate(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)
                    }
                }

                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {
                    listener.onWebRTCLog("WebRTC: Local ICE Candidates removed.")
                }

                override fun onAddStream(stream: MediaStream?) {
                    listener.onWebRTCLog("WebRTC: [Deprecated] Stream added.")
                }

                override fun onRemoveStream(stream: MediaStream?) {
                    listener.onWebRTCLog("WebRTC: [Deprecated] Stream removed.")
                }

                override fun onDataChannel(dataChannel: DataChannel?) {}

                override fun onRenegotiationNeeded() {
                    listener.onWebRTCLog("WebRTC: Renegotiation needed.")
                }

                override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {
                    listener.onWebRTCLog("WebRTC: Remote audio track received!")
                    listener.onTrackAdded()
                }
            })

            listener.onWebRTCLog("WebRTC: RTCPeerConnection created.")

            // Set up local audio track and add it as a modern track API
            localAudioSource = factory.createAudioSource(MediaConstraints())
            localAudioTrack = factory.createAudioTrack("ARDAMSa0", localAudioSource)
            localAudioTrack?.setEnabled(true)
            
            peerConnection?.addTrack(localAudioTrack, listOf("ARDAMS"))
            listener.onWebRTCLog("WebRTC: Added local audio track via addTrack.")

            // Put offer SDP
            val remoteDescription = SessionDescription(SessionDescription.Type.OFFER, offerSdp)
            peerConnection?.setRemoteDescription(object : SdpObserver {
                override fun onCreateSuccess(desc: SessionDescription?) {}
                override fun onSetSuccess() {
                    listener.onWebRTCLog("WebRTC: Remote SDP Offer set successfully. Creating Answer...")
                    
                    // Create Answer
                    peerConnection?.createAnswer(object : SdpObserver {
                        override fun onCreateSuccess(answerDesc: SessionDescription?) {
                            if (answerDesc != null) {
                                listener.onWebRTCLog("WebRTC: Local Answer description created.")
                                
                                // Set local description
                                peerConnection?.setLocalDescription(object : SdpObserver {
                                    override fun onCreateSuccess(desc: SessionDescription?) {}
                                    override fun onSetSuccess() {
                                        listener.onWebRTCLog("WebRTC: Local Answer set successfully.")
                                        onAnswerCreated(answerDesc.description)
                                    }

                                    override fun onCreateFailure(error: String?) {
                                        listener.onError("Set Local Description Failure: $error")
                                    }

                                    override fun onSetFailure(error: String?) {
                                        listener.onError("Set Local Description Failure: $error")
                                    }
                                }, answerDesc)
                            } else {
                                listener.onError("Answer description was null")
                            }
                        }

                        override fun onSetSuccess() {}
                        override fun onCreateFailure(error: String?) {
                            listener.onError("Create Answer Failure: $error")
                        }

                        override fun onSetFailure(error: String?) {
                            listener.onError("Create Answer Failure: $error")
                        }
                    }, MediaConstraints())
                }

                override fun onCreateFailure(error: String?) {
                    listener.onError("Set Remote Description Failure: $error")
                }

                override fun onSetFailure(error: String?) {
                    listener.onError("Set Remote Description Failure: $error")
                }
            }, remoteDescription)

        } catch (e: Exception) {
            listener.onError("WebRTC call preparation failed: ${e.localizedMessage}")
        }
    }

    fun addRemoteIceCandidate(sdp: String, sdpMid: String, sdpMLineIndex: Int) {
        try {
            val candidate = IceCandidate(sdpMid, sdpMLineIndex, sdp)
            peerConnection?.addIceCandidate(candidate)
            listener.onWebRTCLog("WebRTC: Inbound ICE Candidate added successfully.")
        } catch (e: Exception) {
            Log.e("WebRTCManager", "Failure adding remote ice candidate", e)
        }
    }

    fun close() {
        try {
            peerConnection?.close()
            peerConnection = null
            
            localAudioTrack?.setEnabled(false)
            localAudioTrack?.dispose()
            localAudioTrack = null
            
            localAudioSource?.dispose()
            localAudioSource = null
            
            listener.onWebRTCLog("WebRTC: Call ended. Connection and local stream closed.")
        } catch (e: Exception) {
            Log.e("WebRTCManager", "Error closing WebRTC connection", e)
        }
    }
}
