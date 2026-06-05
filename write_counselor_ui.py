import os

kotlin_code = """package com.example

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
import androidx.compose.ui.platform.LocalContext
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
    val counselorId by viewModel.counselorId.collectAsState()
    val callerName by viewModel.callerName.collectAsState()
    val durationSeconds by viewModel.durationSeconds.collectAsState()

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
                                counselorId = counselorId,
                                onServerUrlChange = { viewModel.updateServerUrl(it) },
                                onCounselorIdChange = { viewModel.updateCounselorId(it) },
                                onConnectClick = { viewModel.connect() }
                            )
                        }

                        CallState.CONNECTING -> {
                            ConnectingView(onCancel = { viewModel.disconnect() })
                        }

                        CallState.WAITING -> {
                            CounselorDashboardView(
                                counselorId = counselorId,
                                viewModel = viewModel,
                                onCallRequested = { patientId ->
                                    runWithPermission {
                                        viewModel.startCall(patientId)
                                    }
                                },
                                onLogout = { viewModel.disconnect() }
                            )
                        }

                        CallState.INCOMING -> {
                            IncomingCallView(
                                callerName = callerName,
                                onAnswer = {
                                    runWithPermission {
                                        viewModel.answerCall()
                                    }
                                },
                                onReject = { viewModel.rejectCall() }
                            )
                        }

                        CallState.ACTIVE -> {
                            ActiveCallView(
                                callerName = callerName,
                                durationSeconds = durationSeconds,
                                onEndCall = { viewModel.endCall() }
                            )
                        }

                        CallState.ERROR -> {
                            ErrorStateView(onReset = { viewModel.disconnect() })
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigurationView(
    serverUrl: String,
    counselorId: String,
    onServerUrlChange: (String) -> Unit,
    onCounselorIdChange: (String) -> Unit,
    onConnectClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B).copy(alpha = 0.5f)),
        shape = RoundedCornerShape(28.dp),
        border = BorderStroke(1.dp, Color(0xFF334155))
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(Icons.Default.Lock, contentDescription = null, tint = Color(0xFF2DD4BF), modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(16.dp))
            Text("Counselor Sign In", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(
                value = counselorId,
                onValueChange = onCounselorIdChange,
                placeholder = { Text("Enter Counselor ID", color = Color(0xFF475569)) },
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color(0xFF2DD4BF),
                    unfocusedBorderColor = Color(0xFF334155),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White
                )
            )
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = onConnectClick,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0D9488))
            ) {
                Text("Sign In", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun ConnectingView(onCancel: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = Color(0xFF2DD4BF))
        Spacer(Modifier.height(16.dp))
        Text("Authenticating...", color = Color.White)
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = onCancel) { Text("Cancel", color = Color(0xFFEF4444)) }
    }
}

@Composable
fun ErrorStateView(onReset: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFEF4444), modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(16.dp))
        Text("Connection Error", color = Color.White, fontSize = 20.sp)
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
fun ActiveCallView(callerName: String, durationSeconds: Int, onEndCall: () -> Unit) {
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
    val patients by viewModel.patients.collectAsState(initial = emptyList())

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

        Text("District Patients List", color = Color(0xFFCBD5E1), fontSize = 16.sp, fontWeight = FontWeight.Bold)
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
                        Text("ID: ${patient.id} • ${patient.district ?: "Amritsar"} • $typeStr", color = Color(0xFF94A3B8), fontSize = 12.sp)
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
"""

with open("e:\\Punjab-voice-AI-Assistant--deploy\\Punjab-voice-AI-Assistant--deploy\\counselor-app\\app\\src\\main\\java\\com\\example\\MainActivity.kt", "w", encoding="utf-8") as f:
    f.write(kotlin_code)

print("Counselor MainActivity.kt rewritten successfully!")
