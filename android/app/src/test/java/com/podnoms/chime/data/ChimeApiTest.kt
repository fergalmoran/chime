package com.podnoms.chime.data

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections

class ChimeApiTest {
    private class FakeSessions(var session: Session? = null) : SessionRepository {
        override suspend fun current() = session
        override suspend fun save(session: Session) { this.session = session }
        override suspend fun clear() { session = null }
    }

    private data class Call(val method: HttpMethod, val path: String, val auth: String?, val body: JsonObject?)

    private val calls: MutableList<Call> = Collections.synchronizedList(mutableListOf())

    /** Routes keyed by "METHOD /path"; each handler gets how many times that route has been called. */
    private fun api(
        sessions: FakeSessions,
        routes: Map<String, suspend MockRequestHandleScope.(Int) -> HttpResponseData>,
    ): ChimeApi {
        val engine = MockEngine { request ->
            val call = request.toCall()
            calls += call
            val key = "${call.method.value} ${call.path}"
            val count = calls.count { "${it.method.value} ${it.path}" == key }
            routes[key]?.invoke(this, count) ?: respond("", HttpStatusCode.NotFound)
        }
        return ChimeApi(sessions, engine)
    }

    private fun HttpRequestData.toCall(): Call {
        val text = (body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString()
        return Call(
            method,
            url.encodedPath,
            headers[HttpHeaders.Authorization],
            text?.takeIf { it.isNotBlank() }?.let { Json.parseToJsonElement(it).jsonObject },
        )
    }

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(body, status, headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()))

    private fun MockRequestHandleScope.tokens(access: String) =
        json("""{"accessToken":"$access","refreshToken":"$access-refresh","expiresIn":3600}""")

    private fun MockRequestHandleScope.status(status: HttpStatusCode) = respond("", status)

    private fun session(expiresInMillis: Long = 3_600_000) = Session(
        apiUrl = "https://chime.test",
        email = "me@example.com",
        accessToken = "access-1",
        refreshToken = "refresh-1",
        expiresAtMillis = System.currentTimeMillis() + expiresInMillis,
        deviceId = "phone-1",
    )

    private val notification = CreateNotificationRequest(
        deviceId = "phone-1", appId = "com.whatsapp", appName = "WhatsApp", category = NotificationCategory.Message,
        title = "Alice", body = "Hi", externalKey = "k", postedAt = "2026-11-01T12:00:00Z",
    )

    @Test
    fun `google sign-in stores the session and registers this phone`() = runBlocking {
        val sessions = FakeSessions()
        val api = api(sessions, mapOf(
            "POST /api/auth/google" to { tokens("access-1") },
            "POST /api/devices" to { json("""{"id":"phone-9","name":"Pixel"}""", HttpStatusCode.Created) },
        ))

        val result = api.loginWithGoogle(" https://chime.test/ ", "google-token", "me@example.com", "Pixel")

        assertEquals("https://chime.test", result.apiUrl)
        assertEquals("phone-9", result.deviceId)
        assertEquals(result, sessions.session)
        assertEquals("google-token", calls[0].body!!["idToken"]!!.jsonPrimitive.content)
        val register = calls[1]
        assertEquals("Bearer access-1", register.auth)
        assertEquals("Pixel", register.body!!["name"]!!.jsonPrimitive.content)
        assertEquals("Android", register.body["platform"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a rejected google sign-in explains why and stores nothing`() = runBlocking {
        val sessions = FakeSessions()
        val api = api(sessions, mapOf(
            "POST /api/auth/google" to { json("""{"detail":"Google sign-in is not configured."}""", HttpStatusCode.BadRequest) },
        ))

        val error = assertThrows(ApiException::class.java) {
            runBlocking { api.loginWithGoogle("https://chime.test", "t", "e", "Pixel") }
        }

        assertEquals("Google sign-in is not configured.", error.message)
        assertNull(sessions.session)
    }

    @Test
    fun `if the phone can't be registered the half-finished sign-in is rolled back`() = runBlocking {
        val sessions = FakeSessions()
        val api = api(sessions, mapOf(
            "POST /api/auth/google" to { tokens("access-1") },
            "POST /api/devices" to { status(HttpStatusCode.InternalServerError) },
        ))

        assertThrows(ApiException::class.java) {
            runBlocking { api.loginWithGoogle("https://chime.test", "t", "e", "Pixel") }
        }
        assertNull(sessions.session)
    }

    @Test
    fun `uploads are authorised and any 2xx counts as delivered`() = runBlocking {
        for (code in listOf(HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.NoContent)) {
            val api = api(FakeSessions(session()), mapOf("POST /api/notifications" to { status(code) }))
            api.pushNotification(notification)
        }
        assertTrue(calls.all { it.auth == "Bearer access-1" })
        assertEquals("com.whatsapp", calls[0].body!!["appId"]!!.jsonPrimitive.content)
    }

    @Test
    fun `server errors are retryable but rejected payloads are not`() {
        assertTrue(ApiException(HttpStatusCode.InternalServerError).isRetryable)
        assertTrue(ApiException(HttpStatusCode.ServiceUnavailable).isRetryable)
        assertTrue(ApiException(HttpStatusCode.TooManyRequests).isRetryable)
        assertTrue(ApiException(HttpStatusCode.RequestTimeout).isRetryable)
        assertFalse(ApiException(HttpStatusCode.BadRequest).isRetryable)
        assertFalse(ApiException(HttpStatusCode.Unauthorized).isRetryable)
        assertFalse(ApiException(HttpStatusCode.NotFound).isRetryable)
    }

    @Test
    fun `failed uploads throw with the status so the listener can decide to retry`() = runBlocking {
        val api = api(FakeSessions(session()), mapOf("POST /api/notifications" to { status(HttpStatusCode.BadGateway) }))

        val error = assertThrows(ApiException::class.java) { runBlocking { api.pushNotification(notification) } }

        assertEquals(HttpStatusCode.BadGateway, error.status)
    }

    @Test
    fun `signed-out uploads fail without touching the network`() = runBlocking {
        val api = api(FakeSessions(), emptyMap())

        val error = assertThrows(ApiException::class.java) { runBlocking { api.pushNotification(notification) } }

        assertEquals(HttpStatusCode.Unauthorized, error.status)
        assertTrue(calls.isEmpty())
    }

    @Test
    fun `an expiring token is refreshed first and the device id is kept`() = runBlocking {
        val sessions = FakeSessions(session(expiresInMillis = 5_000))
        val api = api(sessions, mapOf(
            "POST /api/auth/refresh" to { tokens("access-2") },
            "POST /api/notifications" to { status(HttpStatusCode.Created) },
        ))

        api.pushNotification(notification)

        assertEquals(listOf("/api/auth/refresh", "/api/notifications"), calls.map { it.path })
        assertEquals("refresh-1", calls[0].body!!["refreshToken"]!!.jsonPrimitive.content)
        assertEquals("Bearer access-2", calls[1].auth)
        assertEquals("access-2", sessions.session!!.accessToken)
        assertEquals("phone-1", sessions.session!!.deviceId)
    }

    @Test
    fun `a 401 is retried once with a refreshed token`() = runBlocking {
        val sessions = FakeSessions(session())
        val api = api(sessions, mapOf(
            "POST /api/auth/refresh" to { tokens("access-2") },
            "POST /api/notifications" to { n -> status(if (n == 1) HttpStatusCode.Unauthorized else HttpStatusCode.Created) },
        ))

        api.pushNotification(notification)

        assertEquals(listOf("/api/notifications", "/api/auth/refresh", "/api/notifications"), calls.map { it.path })
        assertEquals("Bearer access-2", calls[2].auth)
    }

    @Test
    fun `a rejected refresh signs the phone out`() = runBlocking {
        val sessions = FakeSessions(session())
        val api = api(sessions, mapOf(
            "POST /api/auth/refresh" to { status(HttpStatusCode.Unauthorized) },
            "POST /api/notifications" to { status(HttpStatusCode.Unauthorized) },
        ))

        val error = assertThrows(ApiException::class.java) { runBlocking { api.pushNotification(notification) } }

        assertEquals(HttpStatusCode.Unauthorized, error.status)
        assertNull(sessions.session)
    }

    @Test
    fun `concurrent uploads with an expiring token refresh only once`() = runBlocking {
        val sessions = FakeSessions(session(expiresInMillis = 1_000))
        val api = api(sessions, mapOf(
            "POST /api/auth/refresh" to { tokens("access-2") },
            "POST /api/notifications" to { status(HttpStatusCode.Created) },
        ))

        (1..5).map { async { api.pushNotification(notification) } }.awaitAll()

        assertEquals(1, calls.count { it.path == "/api/auth/refresh" })
        assertTrue(calls.filter { it.path == "/api/notifications" }.all { it.auth == "Bearer access-2" })
    }

    @Test
    fun `push tokens are registered and can be cleared`() = runBlocking {
        val api = api(FakeSessions(session()), mapOf("PUT /api/devices/phone-1/push-token" to { status(HttpStatusCode.NoContent) }))

        api.registerPushToken("phone-1", "fcm-token")
        api.registerPushToken("phone-1", null)

        assertEquals("fcm-token", calls[0].body!!["token"]!!.jsonPrimitive.content)
        // explicitNulls = false omits the field, which the API reads as null (unregister).
        assertNull(calls[1].body!!["token"])
    }
}
