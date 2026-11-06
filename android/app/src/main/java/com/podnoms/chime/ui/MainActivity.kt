package com.podnoms.chime.ui

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.podnoms.chime.R
import com.podnoms.chime.auth.GoogleSignIn
import com.podnoms.chime.data.Session
import com.podnoms.chime.push.ReceiveLinksCard
import com.podnoms.chime.ui.theme.ChimeTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ChimeTheme {
                ChimeApp(viewModel)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChimeApp(viewModel: MainViewModel) {
    val sessionState by viewModel.sessionState.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.messageShown()
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.app_name)) }) },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding(),
        ) {
            when (val state = sessionState) {
                SessionState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                SessionState.SignedOut -> LoginScreen(viewModel)
                is SessionState.SignedIn -> HomeScreen(
                    session = state.session,
                    onSendTest = viewModel::sendTestNotification,
                    onLogout = viewModel::logout,
                )
            }
        }
    }
}

@Composable
private fun LoginScreen(viewModel: MainViewModel) {
    val form by viewModel.loginForm.collectAsStateWithLifecycle()
    val context = LocalContext.current
    // Scoped to the composition (not the ViewModel) because the picker needs the Activity context.
    val scope = rememberCoroutineScope()

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Sign in with your Google account to start syncing notifications to your desktop.", style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(
            value = form.apiUrl,
            onValueChange = { v -> viewModel.updateLoginForm { it.copy(apiUrl = v) } },
            label = { Text("Server URL") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        if (GoogleSignIn.isConfigured) {
            Button(
                onClick = {
                    viewModel.onGoogleSignInStarted()
                    scope.launch {
                        val result = try {
                            Result.success(GoogleSignIn.requestCredential(context))
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Result.failure(e)
                        }
                        viewModel.onGoogleCredential(result)
                    }
                },
                enabled = !form.busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (form.busy) "Signing in…" else "Sign in with Google") }
        } else {
            Text(
                "Google sign-in isn't configured. Set chime.googleWebClientId in gradle.properties.",
                color = MaterialTheme.colorScheme.error,
            )
        }
        form.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun HomeScreen(session: Session, onSendTest: () -> Unit, onLogout: () -> Unit) {
    val context = LocalContext.current
    var listenerEnabled by remember { mutableStateOf(false) }

    // Re-check whenever we return from system settings.
    LifecycleResumeEffect(Unit) {
        listenerEnabled = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        onPauseOrDispose { }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            colors = CardDefaults.cardColors(
                containerColor = if (listenerEnabled) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.errorContainer
                },
            ),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (listenerEnabled) Icons.Filled.CheckCircle else Icons.Filled.Warning,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(
                        if (listenerEnabled) "Syncing notifications" else "Notification access needed",
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
                Text(
                    if (listenerEnabled) {
                        "New messages on this phone will appear on your desktop."
                    } else {
                        "Allow Chime to read notifications so it can forward them to your desktop."
                    },
                )
                if (!listenerEnabled) {
                    Button(onClick = {
                        context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                    }) { Text("Grant access") }
                }
            }
        }

        Text("Signed in as ${session.email}", style = MaterialTheme.typography.bodyMedium)
        Text(session.apiUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ReceiveLinksCard()

        OutlinedButton(onClick = onSendTest, modifier = Modifier.fillMaxWidth()) { Text("Send test notification") }
        TextButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
    }
}
