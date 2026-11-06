package com.podnoms.chime.auth

import android.content.Context
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import com.podnoms.chime.BuildConfig
import java.util.UUID

data class GoogleCredential(val idToken: String, val email: String)

class GoogleSignInException(message: String) : Exception(message)

/** Google sign-in via Credential Manager. Tokens are issued for the *web* client ID, which the API accepts. */
object GoogleSignIn {
    val isConfigured: Boolean get() = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    /**
     * Shows Google's account picker. [activityContext] must be an Activity so the system UI can be shown.
     * Returns null if the user cancels.
     */
    suspend fun requestCredential(activityContext: Context): GoogleCredential? {
        val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setNonce(UUID.randomUUID().toString())
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

        val credential = try {
            CredentialManager.create(activityContext).getCredential(activityContext, request).credential
        } catch (e: GetCredentialCancellationException) {
            // A misconfigured OAuth client (wrong package/SHA-1) also surfaces here, e.g. "[16] Account reauth failed".
            Log.w(TAG, "Google sign-in cancelled: ${e.type}: ${e.errorMessage}", e)
            return null
        } catch (e: NoCredentialException) {
            Log.w(TAG, "No Google credential: ${e.errorMessage}", e)
            throw GoogleSignInException("No Google account is available on this device")
        } catch (e: GetCredentialException) {
            Log.w(TAG, "Google sign-in failed: ${e.type}: ${e.errorMessage}", e)
            throw GoogleSignInException(e.errorMessage?.toString() ?: "Google sign-in failed")
        }

        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw GoogleSignInException("Unexpected credential type")
        }
        return try {
            val google = GoogleIdTokenCredential.createFrom(credential.data)
            GoogleCredential(idToken = google.idToken, email = google.email ?: "")
        } catch (_: GoogleIdTokenParsingException) {
            throw GoogleSignInException("Google returned an invalid credential")
        }
    }

    private const val TAG = "ChimeGoogleSignIn"

    /** Clears Google's remembered account selection so the picker shows again after sign-out. */
    suspend fun clearState(context: Context) {
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
    }
}
