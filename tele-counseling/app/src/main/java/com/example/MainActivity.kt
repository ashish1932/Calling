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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
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
    val patientId by viewModel.patientId.collectAsState()
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

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        permissionGranted = isGranted
        if (isGranted) {
            viewModel.addLog("Permission: Audio record permission granted!")
            viewModel.answerCall()
        } else {
            viewModel.addLog("Permission Error: Audio record permission denied.")
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
                                patientId = patientId,
                                onServerUrlChange = { viewModel.updateServerUrl(it) },
                                onpatientIdChange = { viewModel.updatePatientId(it) },
                                onConnectClick = { viewModel.connect() }
                            )
                        }

                        CallState.CONNECTING -> {
                            ConnectingView(onCancel = { viewModel.disconnect() })
                        }

                        CallState.WAITING -> {
                            PatientDashboardView(
                                patientId = patientId, // using patientId state var for patient ID
                                onLogout = { viewModel.disconnect() }
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
    patientId: String,
    onServerUrlChange: (String) -> Unit,
    onpatientIdChange: (String) -> Unit,
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
            Icon(Icons.Default.Person, contentDescription = null, tint = Color(0xFF2DD4BF), modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(16.dp))
            Text("Patient Sign In", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(
                value = patientId,
                onValueChange = onpatientIdChange,
                placeholder = { Text("Enter Patient ID", color = Color(0xFF475569)) },
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

@Composable
fun PatientDashboardView(patientId: String, onLogout: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("Welcome Back", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("Patient: $patientId", color = Color(0xFF94A3B8), fontSize = 12.sp)
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
            Text("Connected. Waiting for counselor call...", color = Color(0xFFCBD5E1), fontSize = 14.sp)
        }

        Spacer(Modifier.height(24.dp))

        // ASSIGNED COUNSELOR Card
        Text("YOUR ASSIGNED COUNSELOR", color = Color(0xFF64748B), fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        Spacer(Modifier.height(8.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .background(Color(0xFF0F172A), CircleShape)
                        .border(1.dp, Color(0xFF334155), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Person, contentDescription = null, tint = Color.White)
                }
                Spacer(Modifier.width(16.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("Dr. Amanpreet", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text("Tele-Counsellor (Amritsar)", color = Color(0xFF94A3B8), fontSize = 12.sp)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(6.dp).background(Color(0xFF22C55E), CircleShape))
                    Spacer(Modifier.width(6.dp))
                    Text("Connected", color = Color(0xFF22C55E), fontSize = 12.sp)
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        // SELF-CARE TIP
        Text("SELF-CARE TIP", color = Color(0xFF64748B), fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        Spacer(Modifier.height(8.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF312E81).copy(alpha = 0.4f)),
            shape = RoundedCornerShape(16.dp)
        ) {
            Text(
                "One day at a time. You are stronger than you think.",
                color = Color(0xFFC7D2FE),
                fontSize = 15.sp,
                fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                modifier = Modifier.padding(20.dp)
            )
        }

        Spacer(Modifier.height(24.dp))

        Text("Self-Care Tools", color = Color(0xFFCBD5E1), fontSize = 16.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))

        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            val tools = listOf(
                Triple("Breathing", "Calm your mind", Color(0xFF0891B2)),
                Triple("Mood Log", "Record feelings", Color(0xFFD97706)),
                Triple("Secure Chat", "Message counselor", Color(0xFF4F46E5)),
                Triple("Reminders", "Set check-ins", Color(0xFFE11D48))
            )
            items(tools.size) { index ->
                val (title, subtitle, color) = tools[index]
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            modifier = Modifier.size(40.dp).background(color.copy(alpha = 0.2f), RoundedCornerShape(10.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Favorite, contentDescription = null, tint = color)
                        }
                        Spacer(Modifier.height(12.dp))
                        Text(title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Text(subtitle, color = Color(0xFF94A3B8), fontSize = 11.sp)
                    }
                }
            }
        }
    }
}
