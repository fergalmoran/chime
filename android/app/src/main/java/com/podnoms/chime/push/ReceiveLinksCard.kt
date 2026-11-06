package com.podnoms.chime.push

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.work.WorkInfo
import androidx.work.WorkManager

@Composable
fun ReceiveLinksCard() {
    val context = LocalContext.current
    val configured = RegisterPushWorker.isConfigured(context)
    var allowed by remember { mutableStateOf(NotificationManagerCompat.from(context).areNotificationsEnabled()) }
    var permissionRequested by remember { mutableStateOf(false) }
    val work = remember(context) { WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(RegisterPushWorker.WORK_NAME) }
    val registrations by work.collectAsStateWithLifecycle(initialValue = emptyList())
    val registration = registrations.firstOrNull()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        allowed = granted
        permissionRequested = true
        if (granted) RegisterPushWorker.enqueue(context)
    }

    LifecycleResumeEffect(configured) {
        allowed = NotificationManagerCompat.from(context).areNotificationsEnabled()
        if (configured) RegisterPushWorker.enqueue(context)
        onPauseOrDispose { }
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Receive links from desktop")
            Text(
                when {
                    !configured -> "Add app/google-services.json from Firebase and rebuild to enable mobile push."
                    !allowed -> "Allow Chime to show notifications, then use Send to mobile in the browser extension."
                    registration?.state == WorkInfo.State.SUCCEEDED && registration.outputData.getBoolean("ready", false) ->
                        "This phone is ready. Use Send to mobile in the browser extension."
                    registration?.state == WorkInfo.State.FAILED -> registration.outputData.getString("error") ?: "Push registration failed."
                    else -> "Registering this phone for push notifications. Waiting for network or retrying..."
                },
            )
            if (configured) {
                Button(onClick = {
                    when {
                        allowed -> RegisterPushWorker.enqueue(context)
                        Build.VERSION.SDK_INT >= 33 && !permissionRequested -> launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        else -> context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
                        )
                    }
                }) { Text(if (allowed) "Refresh registration" else "Enable mobile notifications") }
            }
        }
    }
}
