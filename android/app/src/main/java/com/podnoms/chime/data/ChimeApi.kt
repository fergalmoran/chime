package com.podnoms.chime.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

class ApiException(val status: HttpStatusCode, message: String? = null) : Exception(
    message ?: if (status == HttpStatusCode.Unauthorized) "Please sign in again" else "Request failed ($status)",
) {
    /** Server errors, timeouts and rate limiting are worth retrying; other client errors are not. */
    val isRetryable: Boolean
        get() = status.value >= 500 || status == HttpStatusCode.RequestTimeout || status == HttpStatusCode.TooManyRequests
}

/** Thin client over the Chime API that transparently refreshes expired access tokens. */
class ChimeApi(private val sessions: SessionStore) {
    private val client = HttpClient(OkHttp) {
        expectSuccess = false
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true; explicitNulls = false })
        }
        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            requestTimeoutMillis = 20_000
        }
    }
    private val refreshLock = Mutex()

    /** Exchanges a Google ID token (from Credential Manager) for API tokens; the only way to sign in. */
    suspend fun loginWithGoogle(apiUrl: String, idToken: String, email: String, deviceName: String): Session {
        val baseUrl = apiUrl.trim().trimEnd('/')
        val response = client.post("$baseUrl/auth/google") {
            contentType(ContentType.Application.Json)
            setBody(GoogleLoginRequest(idToken))
        }
        if (!response.status.isSuccess()) {
            val detail = runCatching { response.body<ProblemDetails>().detail }.getOrNull()
            throw ApiException(response.status, detail ?: "Google sign-in failed (${response.status.value})")
        }
        return completeSignIn(response, baseUrl, email, deviceName)
    }

    private suspend fun completeSignIn(response: HttpResponse, baseUrl: String, email: String, deviceName: String): Session {
        val session = response.body<TokenResponse>().toSession(baseUrl, email, deviceId = null)
        sessions.save(session)

        val deviceResponse = try {
            authorized { postJson(it, "/api/devices", RegisterDeviceRequest(deviceName, DevicePlatform.Android)) }
        } catch (e: Exception) {
            sessions.clear()
            throw e
        }
        if (!deviceResponse.status.isSuccess()) {
            sessions.clear()
            throw ApiException(deviceResponse.status)
        }
        val device = deviceResponse.body<DeviceDto>()
        return session.copy(deviceId = device.id).also { sessions.save(it) }
    }

    /** Uploads a notification. Returns normally for any 2xx (including duplicates and server-side filtering). */
    suspend fun pushNotification(request: CreateNotificationRequest) {
        val response = authorized { postJson(it, "/api/notifications", request) }
        if (!response.status.isSuccess()) throw ApiException(response.status)
    }

    suspend fun registerPushToken(deviceId: String, token: String?) {
        val response = authorized { session ->
            client.put("${session.apiUrl}/api/devices/$deviceId/push-token") {
                bearerAuth(session.accessToken)
                contentType(ContentType.Application.Json)
                setBody(PushTokenRequest(token))
            }
        }
        if (!response.status.isSuccess()) throw ApiException(response.status)
    }

    private suspend inline fun <reified T> postJson(session: Session, path: String, payload: T): HttpResponse =
        client.post("${session.apiUrl}$path") {
            bearerAuth(session.accessToken)
            contentType(ContentType.Application.Json)
            setBody(payload)
        }

    /** Runs [call] with a fresh access token, refreshing and retrying once on 401. */
    private suspend fun authorized(call: suspend (Session) -> HttpResponse): HttpResponse {
        var session = sessions.current() ?: throw ApiException(HttpStatusCode.Unauthorized)
        if (session.expiresAtMillis - System.currentTimeMillis() < 30_000) session = refresh(session)

        val response = call(session)
        if (response.status != HttpStatusCode.Unauthorized) return response
        return call(refresh(session))
    }

    private suspend fun refresh(stale: Session): Session = refreshLock.withLock {
        // Another caller may already have refreshed while we waited for the lock.
        val latest = sessions.current() ?: throw ApiException(HttpStatusCode.Unauthorized)
        if (latest.accessToken != stale.accessToken) return latest

        val response = client.post("${latest.apiUrl}/auth/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(latest.refreshToken))
        }
        if (!response.status.isSuccess()) {
            sessions.clear()
            throw ApiException(HttpStatusCode.Unauthorized)
        }
        response.body<TokenResponse>().toSession(latest.apiUrl, latest.email, latest.deviceId).also { sessions.save(it) }
    }

    private fun TokenResponse.toSession(apiUrl: String, email: String, deviceId: String?) = Session(
        apiUrl = apiUrl,
        email = email,
        accessToken = accessToken,
        refreshToken = refreshToken,
        expiresAtMillis = System.currentTimeMillis() + expiresIn * 1000,
        deviceId = deviceId,
    )
}
