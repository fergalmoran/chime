package com.podnoms.chime.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.podnoms.chime.ChimeApplication
import com.podnoms.chime.R
import kotlinx.coroutines.runBlocking

class MobileMessagingService : FirebaseMessagingService() {
    override fun onRegistered(fid: String) {
        RegisterPushWorker.enqueue(this, fid)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val session = runBlocking { (application as ChimeApplication).container.sessionStore.current() }
        val link = MobileLink.fromData(message.data, session?.deviceId)
        if (link == null) {
            Log.i(TAG, "Ignored invalid link or push for a different signed-in device")
            return
        }
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled() ||
            Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "Cannot display mobile link: notifications are disabled")
            return
        }

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Links from desktop", NotificationManager.IMPORTANCE_HIGH))
        val openLink = PendingIntent.getActivity(
            this,
            0,
            Intent(Intent.ACTION_VIEW, Uri.parse(link.url)).addCategory(Intent.CATEGORY_BROWSABLE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_chime)
            .setColor(ContextCompat.getColor(this, R.color.chime_accent))
            .setContentTitle(link.title)
            .setContentText(link.url)
            .setStyle(NotificationCompat.BigTextStyle().bigText(link.url))
            .setContentIntent(openLink)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        manager.notify(message.messageId ?: link.url, 0, notification)
    }

    private companion object {
        const val TAG = "ChimeMobilePush"
        const val CHANNEL_ID = "desktop-links"
    }
}
