package com.podnoms.chime.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.podnoms.chime.BuildConfig
import com.podnoms.chime.ChimeApplication
import com.podnoms.chime.auth.GoogleCredential
import com.podnoms.chime.auth.GoogleSignIn
import com.podnoms.chime.data.CreateNotificationRequest
import com.podnoms.chime.data.NotificationCategory
import com.podnoms.chime.data.Session
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data class SignedIn(val session: Session) : SessionState
}

data class LoginForm(
    val apiUrl: String = BuildConfig.DEFAULT_API_URL,
    val busy: Boolean = false,
    val error: String? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val container = (application as ChimeApplication).container

    val sessionState: StateFlow<SessionState> = container.sessionStore.session
        .map { if (it == null) SessionState.SignedOut else SessionState.SignedIn(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SessionState.Loading)

    private val _loginForm = MutableStateFlow(LoginForm())
    val loginForm: StateFlow<LoginForm> = _loginForm.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    fun updateLoginForm(transform: (LoginForm) -> LoginForm) = _loginForm.update { transform(it).copy(error = null) }

    /** Called when the Google account picker is about to be shown. */
    fun onGoogleSignInStarted() = _loginForm.update { it.copy(busy = true, error = null) }

    /** Handles the account picker outcome: a credential, null when cancelled, or a failure. */
    fun onGoogleCredential(result: Result<GoogleCredential?>) {
        val credential = result.getOrElse { e ->
            _loginForm.update { it.copy(busy = false, error = e.message ?: "Google sign-in failed") }
            return
        }
        if (credential == null) {
            _loginForm.update { it.copy(busy = false) }
            return
        }
        viewModelScope.launch {
            try {
                container.api.loginWithGoogle(_loginForm.value.apiUrl, credential.idToken, credential.email, deviceName())
                _loginForm.update { LoginForm(apiUrl = it.apiUrl) }
            } catch (e: Exception) {
                _loginForm.update { it.copy(busy = false, error = e.message ?: "Couldn't reach the server") }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            container.sessionStore.clear()
            GoogleSignIn.clearState(getApplication())
        }
    }

    fun sendTestNotification() {
        viewModelScope.launch {
            val session = container.sessionStore.current() ?: return@launch
            _message.value = try {
                container.api.pushNotification(
                    CreateNotificationRequest(
                        deviceId = session.deviceId,
                        appId = getApplication<Application>().packageName,
                        appName = "Chime",
                        category = NotificationCategory.Message,
                        title = "Test notification",
                        body = "If you can see this on your desktop, sync is working.",
                        externalKey = UUID.randomUUID().toString(),
                        postedAt = Instant.now().toString(),
                    ),
                )
                "Test notification sent"
            } catch (e: Exception) {
                "Failed: ${e.message}"
            }
        }
    }

    fun messageShown() {
        _message.value = null
    }

    private fun deviceName() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
}
