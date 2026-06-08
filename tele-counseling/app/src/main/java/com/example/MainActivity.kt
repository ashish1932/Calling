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
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {
    private val viewModel: CallViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MyApplicationTheme(dynamicColor = false) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF0F172A)
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
    val userId by viewModel.userId.collectAsState()
    val userRole by viewModel.userRole.collectAsState()
    val callerName by viewModel.callerName.collectAsState()
    val durationSeconds by viewModel.durationSeconds.collectAsState()
    val transcript by viewModel.transcript.collectAsState()

    val context = LocalContext.current

    var permissionGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    var pendingAction by remember { mutableStateOf<(() -> Unit)?>(null) }

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        permissionGranted = isGranted
        if (isGranted) {
            viewModel.addLog("Permission: Audio record permission granted!")
            pendingAction?.invoke()
            if (pendingAction == null && callState == CallState.INCOMING) {
                viewModel.answerCall()
            }
        } else {
            viewModel.addLog("Permission Error: Audio record permission denied.")
        }
        pendingAction = null
    }

    val runWithPermission: (() -> Unit) -> Unit = { action ->
        if (permissionGranted) {
            action()
        } else {
            pendingAction = action
            recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    val darkGradient = Brush.verticalGradient(
        colors = listOf(Color(0xFF0F172A), Color(0xFF020617))
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
                                userId = userId,
                                userRole = userRole,
                                onServerUrlChange = { viewModel.updateServerUrl(it) },
                                onUserIdChange = { viewModel.updateUserId(it) },
                                onUserRoleChange = { viewModel.updateUserRole(it) },
                                onConnectClick = { viewModel.connect() }
                            )
                        }

                        CallState.CONNECTING -> {
                            ConnectingView(onCancel = { viewModel.disconnect() })
                        }

                        CallState.WAITING -> {
                            if (userRole == "counselor") {
                                CounselorDashboardView(
                                    counselorId = userId,
                                    viewModel = viewModel,
                                    onCallRequested = { patientId ->
                                        runWithPermission {
                                            viewModel.startCall(patientId)
                                        }
                                    },
                                    onLogout = { viewModel.disconnect() }
                                )
                            } else {
                                PatientDashboardView(
                                    patientId = userId,
                                    onLogout = { viewModel.disconnect() }
                                )
                            }
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
                                 transcript = transcript
                             )
                         }

                        CallState.ERROR -> {
                            ErrorStateView(onReset = { viewModel.disconnect() })
                        }
                    }
                }

                if (callState != CallState.ACTIVE && callState != CallState.INCOMING) {
                    val logs by viewModel.logs.collectAsState()
                    Spacer(Modifier.height(16.dp))
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(150.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text("Connection Logs", color = Color(0xFF94A3B8), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(8.dp))
                            LazyColumn(reverseLayout = true) {
                                items(logs.reversed()) { log ->
                                    Text(log, color = Color(0xFFCBD5E1), fontSize = 11.sp, lineHeight = 16.sp)
                                    Spacer(Modifier.height(4.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ConfigurationView(
    serverUrl: String,
    userId: String,
    userRole: String,
    onServerUrlChange: (String) -> Unit,
    onUserIdChange: (String) -> Unit,
    onUserRoleChange: (String) -> Unit,
    onConnectClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
        shape = RoundedCornerShape(24.dp)
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Text("CounselFlow", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("Connect to the tele-calling backend", color = Color(0xFF94A3B8), fontSize = 14.sp)
            Spacer(Modifier.height(24.dp))
            
            Text("Select Your Role", color = Color(0xFFCBD5E1), fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                RoleSelectionButton(
                    text = "I am a Patient",
                    selected = userRole == "patient",
                    onClick = { onUserRoleChange("patient") },
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                RoleSelectionButton(
                    text = "I am a Counselor",
                    selected = userRole == "counselor",
                    onClick = { onUserRoleChange("counselor") },
                    modifier = Modifier.weight(1f)
                )
            }

            Spacer(Modifier.height(24.dp))

            OutlinedTextField(
                value = serverUrl,
                onValueChange = onServerUrlChange,
                label = { Text("Server URL", color = Color(0xFF94A3B8)) },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color(0xFF3B82F6),
                    unfocusedBorderColor = Color(0xFF334155),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White
                )
            )
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = userId,
                onValueChange = onUserIdChange,
                label = { Text(if (userRole == "counselor") "Counselor ID" else "Patient ID", color = Color(0xFF94A3B8)) },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color(0xFF3B82F6),
                    unfocusedBorderColor = Color(0xFF334155),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White
                )
            )
            Spacer(Modifier.height(32.dp))
            Button(
                onClick = onConnectClick,
                enabled = userRole.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3B82F6)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Text("Login to System", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun RoleSelectionButton(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Button(
        onClick = onClick,
        modifier = modifier.height(48.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (selected) Color(0xFF3B82F6) else Color(0xFF0F172A)
        ),
        border = if (!selected) BorderStroke(1.dp, Color(0xFF334155)) else null,
        shape = RoundedCornerShape(12.dp)
    ) {
        Text(text, fontSize = 12.sp, color = if (selected) Color.White else Color(0xFF94A3B8))
    }
}

@Composable
fun PatientDashboardView(patientId: String, onLogout: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier.size(120.dp).background(Color(0xFF1E293B), CircleShape).border(4.dp, Color(0xFF334155), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(60.dp), tint = Color(0xFF64748B))
        }
        Spacer(Modifier.height(24.dp))
        Text("Waiting for call...", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("Your ID: $patientId", color = Color(0xFF94A3B8), fontSize = 16.sp)
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onLogout,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Text("Logout")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CounselorDashboardView(
    counselorId: String,
    viewModel: CallViewModel,
    onCallRequested: (String) -> Unit,
    onLogout: () -> Unit
) {
    var inputPatientId by remember { mutableStateOf("") }
    val patients by viewModel.patients.collectAsState(initial = emptyList<PatientData>() )

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("Welcome Back", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("Counselor: $counselorId", color = Color(0xFF94A3B8), fontSize = 12.sp)
            }
            Button(
                onClick = onLogout,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                shape = RoundedCornerShape(16.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text("Logout", fontSize = 14.sp, fontWeight = FontWeight.Bold)
            }
        }

        Spacer(Modifier.height(16.dp))

        // Connection Status Banner
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF1E293B).copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                .border(1.dp, Color(0xFF334155), RoundedCornerShape(12.dp))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Info, contentDescription = null, tint = Color(0xFFF59E0B), modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("Connected. Ready to call patient.", color = Color(0xFFCBD5E1), fontSize = 14.sp)
        }

        Spacer(Modifier.height(24.dp))

        // Start Consultation Call Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("START CONSULTATION CALL", color = Color(0xFF64748B), fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Spacer(Modifier.height(12.dp))
                Text("Enter Patient ID to Call", color = Color(0xFF94A3B8), fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
                
                OutlinedTextField(
                    value = inputPatientId,
                    onValueChange = { inputPatientId = it },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color(0xFF2DD4BF),
                        unfocusedBorderColor = Color(0xFF334155),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color(0xFF0F172A),
                        unfocusedContainerColor = Color(0xFF0F172A)
                    ),
                    shape = RoundedCornerShape(12.dp)
                )

                Spacer(Modifier.height(16.dp))

                Button(
                    onClick = { if (inputPatientId.isNotBlank()) onCallRequested(inputPatientId) },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Phone, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Call Patient", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        Text("Assigned Patients List", color = Color(0xFFCBD5E1), fontSize = 16.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(patients) { patient ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF1E293B).copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(patient.name, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        val typeStr = patient.status ?: "Unknown"
                        Text("ID: ${patient.id} - Amritsar - $typeStr", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    }
                    TextButton(
                        onClick = { inputPatientId = patient.id },
                    ) {
                        Text("Select", color = Color(0xFF94A3B8))
                    }
                }
            }
        }
    }
}

@Composable
fun ConnectingView(onCancel: () -> Unit) {
    val infiniteTransition = rememberInfiniteTransition()
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(1000), repeatMode = RepeatMode.Reverse)
    )

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier.size(80.dp).background(Color(0xFF3B82F6).copy(alpha = alpha), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(32.dp))
        Text("Connecting to network...", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(32.dp))
        TextButton(onClick = onCancel) {
            Text("Cancel", color = Color(0xFF94A3B8))
        }
    }
}

@Composable
fun ErrorStateView(onReset: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFEF4444), modifier = Modifier.size(64.dp))
        Spacer(Modifier.height(16.dp))
        Text("Connection Error", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("Could not connect to the backend server.", color = Color(0xFF94A3B8))
        Spacer(Modifier.height(16.dp))
        Button(onClick = onReset, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444))) {
            Text("Go Back")
        }
    }
}

@Composable
fun IncomingCallView(callerName: String, onAnswer: () -> Unit, onReject: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
        shape = RoundedCornerShape(24.dp)
    ) {
        Column(modifier = Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Incoming Call", color = Color(0xFF2DD4BF), fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            Text(callerName, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(32.dp))
            Row(horizontalArrangement = Arrangement.SpaceEvenly, modifier = Modifier.fillMaxWidth()) {
                Button(onClick = onReject, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444))) {
                    Text("Decline")
                }
                Button(onClick = onAnswer, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E))) {
                    Text("Answer")
                }
            }
        }
    }
}

@Composable
fun ActiveCallView(callerName: String, durationSeconds: Int, onEndCall: () -> Unit, transcript: List<com.example.TranscriptLine> = emptyList()) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
            shape = RoundedCornerShape(24.dp)
        ) {
            Column(modifier = Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("In Call With", color = Color(0xFF2DD4BF), fontSize = 14.sp)
                Text(callerName, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                val mins = durationSeconds / 60
                val secs = durationSeconds % 60
                Text(String.format("%02d:%02d", mins, secs), color = Color.White, fontSize = 20.sp)
                Spacer(Modifier.height(32.dp))
                Button(
                    onClick = onEndCall,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFEF4444)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Text("End Call", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        if (transcript.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text("Live Transcript", color = Color(0xFFCBD5E1), fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                reverseLayout = true
            ) {
                items(transcript.reversed()) { line ->
                    val isCounselor = line.speaker == "Counselor"
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        horizontalArrangement = if (isCounselor) Arrangement.End else Arrangement.Start
                    ) {
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = if (isCounselor) Color(0xFF3B82F6) else Color(0xFF334155)
                            ),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(
                                    "${line.speaker}: ${line.text}",
                                    color = Color.White,
                                    fontSize = 12.sp
                                )
                                Text(
                                    line.timestamp,
                                    color = Color(0xFF94A3B8),
                                    fontSize = 10.sp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
