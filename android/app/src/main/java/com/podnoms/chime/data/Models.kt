package com.podnoms.chime.data

import kotlinx.serialization.Serializable

@Serializable
data class GoogleLoginRequest(val idToken: String)

@Serializable
data class ProblemDetails(val title: String? = null, val detail: String? = null)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class TokenResponse(val accessToken: String, val refreshToken: String, val expiresIn: Long)

@Serializable
enum class DevicePlatform { Android, Browser, Web }

@Serializable
data class RegisterDeviceRequest(val name: String, val platform: DevicePlatform)

@Serializable
data class PushTokenRequest(val token: String?)

@Serializable
data class DeviceDto(val id: String, val name: String)

@Serializable
enum class NotificationCategory { Other, Message, Sms, Email, Call }

@Serializable
data class CreateNotificationRequest(
    val deviceId: String?,
    val appId: String,
    val appName: String?,
    val category: NotificationCategory,
    val title: String?,
    val body: String?,
    val externalKey: String?,
    /** ISO-8601 timestamp. */
    val postedAt: String?,
)

data class Session(
    val apiUrl: String,
    val email: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMillis: Long,
    val deviceId: String?,
)
