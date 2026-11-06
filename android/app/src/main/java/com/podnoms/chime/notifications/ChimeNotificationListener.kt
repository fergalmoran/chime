package com.podnoms.chime.notifications

import android.app.Notification
import android.content.pm.ApplicationInfo
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.os.BundleCompat
import com.podnoms.chime.ChimeApplication
import com.podnoms.chime.data.ApiException
import com.podnoms.chime.data.CreateNotificationRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.time.Instant

/**
 * Receives every notification posted on the device (once the user grants notification access)
 * and forwards relevant ones to the Chime API.
 */
class ChimeNotificationListener : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val container by lazy { (application as ChimeApplication).container }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val notification = sbn.notification ?: return
        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)
        val text = latestMessage(notification) ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)

        val forward = NotificationClassifier.shouldForward(
            packageName = sbn.packageName,
            ownPackage = packageName,
            isOngoing = sbn.isOngoing,
            isGroupSummary = notification.flags and Notification.FLAG_GROUP_SUMMARY != 0,
            title = title,
            text = text,
        )
        if (!forward) return

        val request = CreateNotificationRequest(
            deviceId = null, // filled in from the session at upload time
            appId = sbn.packageName,
            appName = appLabel(sbn),
            category = NotificationClassifier.classify(
                sbn.packageName,
                notification.category,
                Telephony.Sms.getDefaultSmsPackage(this),
            ),
            title = title?.toString()?.take(500),
            body = text?.toString()?.take(4000),
            externalKey = sha256("${sbn.key}|${sbn.postTime}"),
            postedAt = Instant.ofEpochMilli(sbn.postTime).toString(),
        )

        scope.launch { upload(request) }
    }

    /** Tries to deliver immediately; falls back to WorkManager so nothing is lost while offline. */
    private suspend fun upload(request: CreateNotificationRequest) {
        val session = container.sessionStore.current() ?: return
        val withDevice = request.copy(deviceId = session.deviceId)
        try {
            container.api.pushNotification(withDevice)
        } catch (e: ApiException) {
            if (!e.isRetryable) {
                Log.w(TAG, "Upload rejected (${e.status}), dropping")
                return
            }
            UploadNotificationWorker.enqueue(this, withDevice)
        } catch (e: Exception) {
            Log.w(TAG, "Upload failed, queueing retry", e)
            UploadNotificationWorker.enqueue(this, withDevice)
        }
    }

    /** For chat apps the most useful text is the newest message in a MessagingStyle notification. */
    private fun latestMessage(notification: Notification): CharSequence? {
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification) ?: return null
        val message = style.messages.lastOrNull() ?: return null
        val sender = message.person?.name
        return if (style.isGroupConversation && sender != null) "$sender: ${message.text}" else message.text
    }

    private fun appLabel(sbn: StatusBarNotification): String? {
        // The posting app's info travels with the notification, avoiding the need for package-visibility permissions.
        val info = BundleCompat.getParcelable(sbn.notification.extras, EXTRA_APP_INFO, ApplicationInfo::class.java)
        return info?.let { packageManager.getApplicationLabel(it).toString() }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "ChimeListener"

        // Notification.EXTRA_BUILDER_APPLICATION_INFO is hidden from the public SDK.
        const val EXTRA_APP_INFO = "android.appInfo"

        fun sha256(value: String): String =
            MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
