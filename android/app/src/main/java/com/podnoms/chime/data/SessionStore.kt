package com.podnoms.chime.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(name = "session")

/** Where [ChimeApi] keeps the signed-in session (an interface so the API client can be unit-tested). */
interface SessionRepository {
    suspend fun current(): Session?
    suspend fun save(session: Session)
    suspend fun clear()
}

/** Persists the signed-in session in app-private storage. */
class SessionStore(context: Context) : SessionRepository {
    private val dataStore = context.sessionDataStore

    val session: Flow<Session?> = dataStore.data.map { it.toSession() }

    override suspend fun current(): Session? = session.first()

    override suspend fun save(session: Session) {
        dataStore.edit { prefs ->
            prefs[API_URL] = session.apiUrl
            prefs[EMAIL] = session.email
            prefs[ACCESS_TOKEN] = session.accessToken
            prefs[REFRESH_TOKEN] = session.refreshToken
            prefs[EXPIRES_AT] = session.expiresAtMillis
            session.deviceId?.let { prefs[DEVICE_ID] = it } ?: prefs.remove(DEVICE_ID)
        }
    }

    override suspend fun clear() {
        dataStore.edit { it.clear() }
    }

    private fun Preferences.toSession(): Session? {
        return Session(
            apiUrl = this[API_URL] ?: return null,
            email = this[EMAIL] ?: return null,
            accessToken = this[ACCESS_TOKEN] ?: return null,
            refreshToken = this[REFRESH_TOKEN] ?: return null,
            expiresAtMillis = this[EXPIRES_AT] ?: 0L,
            deviceId = this[DEVICE_ID],
        )
    }

    private companion object {
        val API_URL = stringPreferencesKey("api_url")
        val EMAIL = stringPreferencesKey("email")
        val ACCESS_TOKEN = stringPreferencesKey("access_token")
        val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        val EXPIRES_AT = longPreferencesKey("expires_at")
        val DEVICE_ID = stringPreferencesKey("device_id")
    }
}
