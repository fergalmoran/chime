package com.podnoms.chime.notifications

import com.podnoms.chime.data.NotificationCategory

/** Pure decision logic for which notifications to sync and how to categorise them. */
object NotificationClassifier {
    private val knownApps = mapOf(
        "com.whatsapp" to NotificationCategory.Message,
        "com.whatsapp.w4b" to NotificationCategory.Message,
        "org.telegram.messenger" to NotificationCategory.Message,
        "org.thoughtcrime.securesms" to NotificationCategory.Message,
        "com.facebook.orca" to NotificationCategory.Message,
        "com.discord" to NotificationCategory.Message,
        "com.Slack" to NotificationCategory.Message,
        "com.microsoft.teams" to NotificationCategory.Message,
        "com.google.android.apps.messaging" to NotificationCategory.Sms,
        "com.samsung.android.messaging" to NotificationCategory.Sms,
        "com.google.android.gm" to NotificationCategory.Email,
        "com.microsoft.office.outlook" to NotificationCategory.Email,
        "ch.protonmail.android" to NotificationCategory.Email,
        "com.fsck.k9" to NotificationCategory.Email,
        "com.google.android.dialer" to NotificationCategory.Call,
        "com.samsung.android.dialer" to NotificationCategory.Call,
    )

    // Values of android.app.Notification.CATEGORY_*, inlined so this stays a plain JVM unit.
    private val androidCategories = mapOf(
        "msg" to NotificationCategory.Message,
        "email" to NotificationCategory.Email,
        "call" to NotificationCategory.Call,
        "missed_call" to NotificationCategory.Call,
    )

    fun classify(packageName: String, androidCategory: String?, defaultSmsPackage: String?): NotificationCategory =
        when {
            packageName == defaultSmsPackage -> NotificationCategory.Sms
            else -> knownApps[packageName] ?: androidCategories[androidCategory] ?: NotificationCategory.Other
        }

    fun shouldForward(
        packageName: String,
        ownPackage: String,
        isOngoing: Boolean,
        isGroupSummary: Boolean,
        title: CharSequence?,
        text: CharSequence?,
    ): Boolean = packageName != ownPackage &&
        packageName != "android" &&
        !isOngoing &&
        !isGroupSummary &&
        (!title.isNullOrBlank() || !text.isNullOrBlank())
}
