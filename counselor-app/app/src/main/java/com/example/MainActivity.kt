package com.example

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.example.ui.theme.MyApplicationTheme
import kotlin.math.sin

class MainActivity : ComponentActivity() {
    private val viewModel: CallViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MyApplicationTheme(dynamicColor = false) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF0F172A) // Deep Slate Black
                ) {
                    MainScreen(viewModel)
                }
            }
        }
    }
}

@Composable
fun MainScreen(viewModel: CallViewModel) {
    val callState by viewModel.callState.collectAsState()
    val serverUrl by viewModel.serverUrl.collectAsState()
    val counselorId by viewModel.counselorId.collectAsState()
    val callerName by viewModel.callerName.collectAsState()
    val logs by viewModel.logs.collectAsState()
    val durationSeconds by viewModel.durationSeconds.collectAsState()

    val context = LocalContext.current

    // Launcher for handling Audio Record runtime permissions securely
    var permissionGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        permissionGranted = isGranted
        if (isGranted) {
            viewModel.addLog("Permission: Audio record permission granted!")
            viewModel.answerCall()
        } else {
            viewModel.addLog("Permission Error: Audio record permission was denied. Cannot answer call.")
        }
    }

    // Modern dark immersive theme background
    val darkGradient = Brush.verticalGradient(
        colors = listOf(
            Color(0xFF0F172A), // Midnight Carbon
            Color(0xFF020617)  // Deepest Space Black
        )
    )

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        contentWindowInsets = WindowInsets.safeDrawing,
        containerColor = Color.Transparent
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(darkGradient)
                .padding(innerPadding)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Main content container
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    when (callState) {
                        CallState.IDLE -> {
                            ConfigurationView(
                                serverUrl = serverUrl,
                                counselorId = counselorId,
                                onServerUrlChange = { viewModel.updateServerUrl(it) },
                                onCounselorIdChange = { viewModel.updateCounselorId(it) },
                                onConnectClick = { viewModel.connect() }
                            )
                        }

                        CallState.CONNECTING -> {
                            ConnectingView(counselorId = counselorId, onCancel = { viewModel.disconnect() })
                        }

                        CallState.WAITING -> {
                            WaitingForCallsView(
                                counselorId = counselorId,
                                onDisconnect = { viewModel.disconnect() },
                                viewModel = viewModel
                            )
                        }

                        CallState.INCOMING -> {
                            IncomingCallView(
                                callerName = callerName,
                                onAnswer = {
                                    if (permissionGranted) {
                                        viewModel.answerCall()
                                    } else {
                                        recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                },
                                onReject = { viewModel.rejectCall() }
                            )
                        }

                        CallState.ACTIVE -> {
                            ActiveCallView(
                                callerName = callerName,
                                durationSeconds = durationSeconds,
                                onEndCall = { viewModel.endCall() },
                                onLogAction = { action -> viewModel.addLog("In-Call control toggled: $action") }
                            )
                        }

                        CallState.ERROR -> {
                            ErrorStateView(onReset = { viewModel.disconnect() })
                        }
                    }
                }

                // Scrolling Logs view at bottom - only visible on configuring & waiting screens
                // Strictly hidden during active and incoming calling states to achieve 100% normal call immersion!
                if (callState == CallState.WAITING || callState == CallState.ERROR) {
                    Spacer(modifier = Modifier.height(12.dp))
                    DiagnosticConsole(
                        logs = logs,
                        onClearLogs = { viewModel.clearLogs() }
                    )
                }
            }
        }
    }
}

/**
 * 1st Screen - Passcode-style Patient Identity Sign In Screen.
 * Contains purely Patient ID Input and a prominent Sign In Button to match user intent.
 * Embedded with an expandable Advanced settings panel for Backend URL configuration.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigurationView(
    serverUrl: String,
    counselorId: String,
    onServerUrlChange: (String) -> Unit,
    onCounselorIdChange: (String) -> Unit,
    onConnectClick: () -> Unit
) {
    var showAdvanced by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.5f)),
        shape = RoundedCornerShape(28.dp),
        border = BorderStroke(1.dp, Color(0xFF334155))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Elegant Shield Connection Icon
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .background(Color(0xFF0F766E).copy(alpha = 0.15f), CircleShape)
                    .border(1.5.dp, Color(0xFF0F766E).copy(alpha = 0.8f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Lock,
                    contentDescription = "Shield Security Logo",
                    tint = Color(0xFF2DD4BF),
                    modifier = Modifier.size(32.dp)
                )
            }

            Spacer(modifier = Modifier.height(18.dp))

            Text(
                text = "Tele-Dialer Sign In",
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Text(
                text = "Secure patient identity enrollment gateway",
                color = Color(0xFF94A3B8),
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 4.dp)
            )

            Spacer(modifier = Modifier.height(28.dp))

            // Patient ID Input - The primary configuration element
            Text(
                text = "COUNSELOR ACCOUNT ID",
                color = Color(0xFF2DD4BF),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp)
            )
            OutlinedTextField(
                value = counselorId,
                onValueChange = onCounselorIdChange,
                placeholder = { Text("Enter Counselor ID", color = Color(0xFF475569)) },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("counselor_id_input"),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color(0xFF2DD4BF),
                    unfocusedBorderColor = Color(0xFF334155),
                    focusedContainerColor = Color(0xFF0F172A).copy(alpha = 0.6f),
                    unfocusedContainerColor = Color(0xFF0F172A).copy(alpha = 0.3f),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    cursorColor = Color(0xFF2DD4BF)
                ),
                shape = RoundedCornerShape(12.dp)
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Connect & Sign In Button
            Button(
                onClick = onConnectClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .testTag("connect_button"),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF0D9488),
                    contentColor = Color.White
                ),
                shape = RoundedCornerShape(14.dp),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 4.dp)
            ) {
                Row(
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = "Sign in arrow",
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Sign In & Connect Carrier",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Expandable settings drawer - Keeps server URL manageable but beautifully hidden by default!
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                TextButton(
                    onClick = { showAdvanced = !showAdvanced }
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = if (showAdvanced) Icons.Default.KeyboardArrowUp else Icons.Default.Settings,
                            contentDescription = "Gear Toggle settings",
                            tint = Color(0xFF64748B),
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (showAdvanced) "Hide Signaling Config" else "Advanced Connection Settings",
                            color = Color(0xFF94A3B8),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }

                AnimatedVisibility(
                    visible = showAdvanced,
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 12.dp)
                    ) {
                        Text(
                            text = "SIGNALING GATEWAY ENDPOINT",
                            color = Color(0xFF64748B),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.5.sp,
                            modifier = Modifier.padding(bottom = 4.dp)
                        )
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = onServerUrlChange,
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("backend_url_input"),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Color(0xFF0D9488),
                                unfocusedBorderColor = Color(0xFF334155),
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.LightGray
                            ),
                            shape = RoundedCornerShape(10.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Loading state during device signaling socket registration.
 */
@Composable
fun ConnectingView(counselorId: String, onCancel: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator(
            color = Color(0xFF2DD4BF),
            modifier = Modifier.size(56.dp),
            strokeWidth = 3.dp
        )
        Spacer(modifier = Modifier.height(26.dp))
        Text(
            text = "Enrolling Identity...",
            color = Color.White,
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            text = "Registering device: $counselorId",
            color = Color(0xFF94A3B8),
            fontSize = 13.sp,
            modifier = Modifier.padding(top = 8.dp),
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(32.dp))
        OutlinedButton(
            onClick = onCancel,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFF87171)),
            border = BorderStroke(1.dp, Color(0xFFF87171).copy(alpha = 0.5f)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.testTag("cancel_connect_button")
        ) {
            Text("Cancel Protocol")
        }
    }
}

/**
 * 2nd Screen - Carrier open connection standby. Represents active signaling registration.
 */
@Composable
fun WaitingForCallsView(
    counselorId: String,
    onDisconnect: () -> Unit,
    viewModel: CallViewModel? = null
) {
    // Beautiful dynamic pulsing beacon antenna wave
    var pulseState by remember { mutableStateOf(0f) }
    LaunchedEffect(Unit) {
        while (true) {
            animate(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(1800, easing = LinearOutSlowInEasing),
                    repeatMode = RepeatMode.Restart
                )
            ) { value, _ ->
                pulseState = value
            }
        }
    }

    val pulseSize = 64.dp + (48.dp * pulseState)
    val pulseAlpha = 0.8f - (pulseState * 0.8f)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.4f)),
        shape = RoundedCornerShape(28.dp),
        border = BorderStroke(1.dp, Color(0xFF334155))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "TELEPHONY TUNNEL GATEWAY",
                color = Color(0xFF64748B),
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.5.sp
            )

            Spacer(modifier = Modifier.height(30.dp))

            // Pulse connection visual beacon
            Box(
                modifier = Modifier
                    .height(130.dp)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .size(pulseSize)
                        .background(Color(0xFF0D9488).copy(alpha = pulseAlpha), CircleShape)
                )
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .background(Color(0xFF0F766E), CircleShape)
                        .border(1.dp, Color(0xFF2DD4BF), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Standby dynamic beacon icon",
                        tint = Color.White,
                        modifier = Modifier.size(28.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Waiting for incoming calls...",
                color = Color(0xFF2DD4BF),
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Line is active. Counselors can begin a secure audio counseling portal directly to your line.",
                color = Color(0xFF94A3B8),
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 12.dp)
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Registered profile capsules
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0F172A).copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                    .padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text("ACTIVE ACCOUNT LINK", color = Color(0xFF64748B), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(counselorId, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(8.dp).background(Color(0xFF22C55E), CircleShape))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Signaled Online", color = Color(0xFF22C55E), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            val patients by viewModel?.patients?.collectAsState(initial = emptyList()) ?: mutableStateOf(emptyList())

            if (patients.isEmpty()) {
                Text(
                    text = "No assigned patients found.",
                    color = Color(0xFF64748B),
                    fontSize = 13.sp,
                    modifier = Modifier.padding(vertical = 16.dp)
                )
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 250.dp)
                ) {
                    items(patients) { patient ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .background(Color(0xFF0F172A).copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(patient.name, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                Text("${patient.id} • ${patient.status ?: "Unknown"} • ${patient.severity ?: "Unknown"} Severity", color = Color(0xFF94A3B8), fontSize = 11.sp)
                            }
                            Button(
                                onClick = { viewModel?.startCall(patient.id) ?: Unit },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0D9488)),
                                modifier = Modifier.height(36.dp),
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Call,
                                    contentDescription = "Call ${patient.name}",
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Call", fontSize = 12.sp, color = Color.White)
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Button(
                onClick = onDisconnect,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF334155)),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag("disconnect_button"),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Sign Out & Disconnect", fontSize = 14.sp, color = Color(0xFFE2E8F0))
            }
        }
    }
}

/**
 * 3rd Screen - Fullscreen Immersive Incoming Phone Call interface.
 * Matches standard mobile telephone carrier interfaces.
 */
@Composable
fun IncomingCallView(
    callerName: String,
    onAnswer: () -> Unit,
    onReject: () -> Unit
) {
    // Elegant pulsing avatar outline animation
    val transition = rememberInfiniteTransition(label = "Calling pulse")
    val scaleFactor by transition.animateFloat(
        initialValue = 1.0f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "Scaling factor"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Upper section containing Caller details
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(top = 48.dp)
        ) {
            Text(
                text = "INCOMING AUDIO CALL",
                color = Color(0xFF2DD4BF),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
                modifier = Modifier.padding(bottom = 24.dp)
            )

            // Huge circular avatar matching standard contacts
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.size(140.dp)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer(scaleX = scaleFactor, scaleY = scaleFactor)
                        .background(Color(0xFF0F766E).copy(alpha = 0.2f), CircleShape)
                        .border(1.5.dp, Color(0xFF0D9488).copy(alpha = 0.5f), CircleShape)
                )

                Box(
                    modifier = Modifier
                        .size(100.dp)
                        .background(Color(0xFF0F766E), CircleShape)
                        .border(2.dp, Color.White.copy(alpha = 0.8f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    val initials = if (callerName.isNotBlank()) callerName.take(1).uppercase() else "C"
                    Text(
                        text = initials,
                        color = Color.White,
                        fontSize = 38.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = callerName,
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = "Professional Counsel Line",
                color = Color(0xFF94A3B8),
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium
            )
        }

        // Bottom section with standard circular decline/answer button columns
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 56.dp, start = 24.dp, end = 24.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Decline Button Combo (Decline on the Left)
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                IconButton(
                    onClick = onReject,
                    modifier = Modifier
                        .size(76.dp)
                        .background(Color(0xFFEF4444), CircleShape)
                        .testTag("reject_button")
                ) {
                    // Handset down representation
                    Icon(
                        imageVector = Icons.Default.CallEnd,
                        contentDescription = "Decline button",
                        tint = Color.White,
                        modifier = Modifier.size(34.dp)
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = "Decline",
                    color = Color.White.copy(alpha = 0.8f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }

            // Answer Button Combo (Answer on the Right)
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                IconButton(
                    onClick = onAnswer,
                    modifier = Modifier
                        .size(76.dp)
                        .background(Color(0xFF10B981), CircleShape)
                        .testTag("answer_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.Call,
                        contentDescription = "Answer button",
                        tint = Color.White,
                        modifier = Modifier.size(34.dp)
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = "Answer",
                    color = Color.White.copy(alpha = 0.8f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

/**
 * 4th Screen - Fullscreen Immersive Active dialing screen.
 * Models normal phone call interfaces and triggers functional in-call controls.
 */
@Composable
fun ActiveCallView(
    callerName: String,
    durationSeconds: Int,
    onEndCall: () -> Unit,
    onLogAction: (String) -> Unit
) {
    val hrs = durationSeconds / 3600
    val mins = (durationSeconds % 3600) / 60
    val secs = durationSeconds % 60
    val durationText = if (hrs > 0) {
        String.format("%02d:%02d:%02d", hrs, mins, secs)
    } else {
        String.format("%02d:%02d", mins, secs)
    }

    // In-Call state holders
    var isMuted by remember { mutableStateOf(false) }
    var isSpeakerOn by remember { mutableStateOf(false) }
    var showKeypad by remember { mutableStateOf(false) }

    // Waveform phase factor
    val infiniteTransition = rememberInfiniteTransition(label = "Oscillator math")
    val phaseFactor by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 2f * Math.PI.toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(2200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "Phase factor wave"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // 1. Caller header
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(top = 28.dp)
        ) {
            // Status Tag Badge
            Box(
                modifier = Modifier
                    .background(Color(0xFF10B981).copy(alpha = 0.15f), RoundedCornerShape(50.dp))
                    .border(1.dp, Color(0xFF10B981).copy(alpha = 0.4f), RoundedCornerShape(50.dp))
                    .padding(horizontal = 14.dp, vertical = 6.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(6.dp).background(Color(0xFF22C55E), CircleShape))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "SECURE TELE-AUDIO CONNECTED",
                        color = Color(0xFF34D399),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Core Profile Contact Avatar
            Box(
                modifier = Modifier
                    .size(90.dp)
                    .background(Color(0xFF1E293B), CircleShape)
                    .border(1.dp, Color(0xFF334155), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Person,
                    contentDescription = "Avatar shape",
                    tint = Color(0xFF94A3B8),
                    modifier = Modifier.size(46.dp)
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            Text(
                text = callerName,
                color = Color.White,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(4.dp))

            // Call Duration Ticker
            Text(
                text = durationText,
                color = Color(0xFF34D399),
                fontSize = 18.sp,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 4.dp)
            )
        }

        // 2. Center Panel - Option Grid or Dialpad
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            if (showKeypad) {
                // Keypad dialer overlay
                DialpadLayout(
                    onKeyPress = { code -> onLogAction("Dialed Tone '$code'") },
                    onClose = {
                        showKeypad = false
                        onLogAction("Dismissed DTMF keypad view")
                    }
                )
            } else {
                // Harmonic Siri-like wave display when call control options are visible
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(60.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val width = size.width
                            val height = size.height
                            val centerY = height / 2

                            val harmColors = listOf(
                                Color(0xFF10B981).copy(alpha = 0.8f),
                                Color(0xFF00F2FE).copy(alpha = 0.5f),
                                Color(0xFF2DD4BF).copy(alpha = 0.3f)
                            )
                            val frequencies = listOf(1f, 1.6f, 2.2f)
                            val amplitudes = listOf(22.dp.toPx(), 14.dp.toPx(), 8.dp.toPx())

                            for (i in 0 until 3) {
                                val path = androidx.compose.ui.graphics.Path()
                                path.moveTo(0f, centerY)

                                val f = frequencies[i]
                                val a = amplitudes[i]

                                for (x in 0..width.toInt() step 5) {
                                    val relX = x / width
                                    val angle = relX * 3.5f * Math.PI.toFloat() * f + phaseFactor
                                    val envelopeFactor = sin(relX * Math.PI.toFloat())
                                    val y = centerY + sin(angle) * a * envelopeFactor
                                    path.lineTo(x.toFloat(), y)
                                }
                                drawPath(
                                    path = path,
                                    color = harmColors[i],
                                    style = Stroke(width = 1.5.dp.toPx())
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    // Classic Phone Dialer 2x3 Button Matrix
                    Column(
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        // Row 1
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(28.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Mute Key
                            InCallActionButton(
                                icon = if (isMuted) Icons.Filled.MicOff else Icons.Filled.Mic,
                                label = if (isMuted) "muted" else "mute",
                                isActive = isMuted,
                                onClick = {
                                    isMuted = !isMuted
                                    onLogAction(if (isMuted) "Microphone Muted" else "Microphone Unmuted")
                                }
                            )

                            // Keypad Key
                            InCallActionButton(
                                icon = Icons.Filled.Dialpad,
                                label = "keypad",
                                isActive = false,
                                onClick = {
                                    showKeypad = true
                                    onLogAction("Launched DTMF keypad view")
                                }
                            )

                            // Speaker Key
                            InCallActionButton(
                                icon = if (isSpeakerOn) Icons.Filled.VolumeMute else Icons.Filled.VolumeUp,
                                label = if (isSpeakerOn) "speaker: on" else "speaker",
                                isActive = isSpeakerOn,
                                onClick = {
                                    isSpeakerOn = !isSpeakerOn
                                    onLogAction(if (isSpeakerOn) "Speaker Routing Activated" else "Handset Routing Restored")
                                }
                            )
                        }

                        // Row 2
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(28.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Disabled elegant placeholders to replicate perfect iOS / Android Dialers
                            InCallActionButton(
                                icon = Icons.Filled.PersonAdd,
                                label = "add call",
                                isActive = false,
                                enabled = false,
                                onClick = {}
                            )
                            InCallActionButton(
                                icon = Icons.Filled.Videocam,
                                label = "facetime",
                                isActive = false,
                                enabled = false,
                                onClick = {}
                            )
                            InCallActionButton(
                                icon = Icons.Filled.Pause,
                                label = "hold",
                                isActive = false,
                                enabled = false,
                                onClick = {}
                            )
                        }
                    }
                }
            }
        }

        // 3. Huge Red Hang Up Circle Button
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(bottom = 24.dp)
        ) {
            IconButton(
                onClick = onEndCall,
                modifier = Modifier
                    .size(76.dp)
                    .background(Color(0xFFEF4444), CircleShape)
                    .testTag("end_call_button")
            ) {
                Icon(
                    imageVector = Icons.Default.CallEnd,
                    contentDescription = "Hang up call icon",
                    tint = Color.White,
                    modifier = Modifier.size(34.dp)
                )
            }
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = "End Call",
                color = Color.White.copy(alpha = 0.8f),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

/**
 * Custom dialer key template for typical active call touch controllers.
 */
@Composable
fun InCallActionButton(
    icon: ImageVector,
    label: String,
    isActive: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val containerColor = when {
        !enabled -> Color(0xFF334155).copy(alpha = 0.15f)
        isActive -> Color.White
        else -> Color(0xFF1E293B).copy(alpha = 0.4f)
    }
    val contentColor = when {
        !enabled -> Color(0xFF64748B).copy(alpha = 0.5f)
        isActive -> Color(0xFF0F172A)
        else -> Color.White
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .background(containerColor, CircleShape)
                .border(
                    width = 1.dp,
                    color = if (isActive) Color.White else Color(0xFF334155).copy(alpha = 0.6f),
                    shape = CircleShape
                )
                .clip(CircleShape)
                .clickable(enabled = enabled, onClick = onClick),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = contentColor,
                modifier = Modifier.size(26.dp)
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = label,
            color = if (enabled) Color.White.copy(alpha = 0.7f) else Color(0xFF64748B).copy(alpha = 0.5f),
            fontSize = 12.sp,
            fontWeight = FontWeight.Normal
        )
    }
}

/**
 * Standard phone system numeric DTMF dialpad overlay inside active counseling call.
 */
@Composable
fun DialpadLayout(
    onKeyPress: (String) -> Unit,
    onClose: () -> Unit
) {
    val keys = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf("*", "0", "#")
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.95f)),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0xFF334155))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "TOUCH TONE KEYPAD",
                    color = Color(0xFF2DD4BF),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp
                )

                IconButton(onClick = onClose) {
                    Icon(Icons.Default.Close, contentDescription = "Close keypad", tint = Color.White)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                keys.forEach { row ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        row.forEach { digit ->
                            Box(
                                modifier = Modifier
                                    .size(54.dp)
                                    .background(Color(0xFF0F172A).copy(alpha = 0.6f), CircleShape)
                                    .border(1.dp, Color(0xFF334155), CircleShape)
                                    .clip(CircleShape)
                                    .clickable { onKeyPress(digit) },
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = digit,
                                    color = Color.White,
                                    fontSize = 20.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Clean Error status display.
 */
@Composable
fun ErrorStateView(onReset: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF2D1F1F)),
        shape = RoundedCornerShape(24.dp),
        border = BorderStroke(1.dp, Color(0xFFEF4444).copy(alpha = 0.5f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Default.Warning,
                contentDescription = "Error state vector",
                tint = Color(0xFFF87171),
                modifier = Modifier.size(54.dp)
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Tele-Dialer Connection Disrupted",
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
            Text(
                text = "Singaling communication link lost. Please check endpoint addresses and online server tunnels.",
                color = Color(0xFFFCA5A5),
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp, bottom = 20.dp)
            )
            Button(
                onClick = onReset,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Retry Connection")
            }
        }
    }
}

/**
 * Dynamic developer / diagnostic console output.
 */
@Composable
fun DiagnosticConsole(
    logs: List<String>,
    onClearLogs: () -> Unit
) {
    val listState = rememberLazyListState()

    LaunchedEffect(logs.size) {
        if (logs.isNotEmpty()) {
            listState.animateScrollToItem(logs.size - 1)
        }
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 160.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF020617)),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, Color(0xFF1E293B))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.Info,
                        contentDescription = "Console Icon Info",
                        tint = Color(0xFF10B981),
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "CARRIER SIGNALING LOGS",
                        color = Color(0xFF94A3B8),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.5.sp
                    )
                }

                TextButton(
                    onClick = onClearLogs,
                    modifier = Modifier.height(24.dp)
                ) {
                    Text("Clear Logs", fontSize = 10.sp, color = Color(0xFF64748B))
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider(color = Color(0xFF1E293B))
            Spacer(modifier = Modifier.height(8.dp))

            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(logs) { log ->
                    Text(
                        text = log,
                        color = if (log.contains("Error", ignoreCase = true)) Color(0xFFF87171) else Color(0xFF34D399),
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
    }
}
