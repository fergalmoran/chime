package com.podnoms.chime.push

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.podnoms.chime.ChimeApplication
import com.podnoms.chime.data.ApiException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class RegisterPushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!isConfigured(applicationContext)) return failure("Firebase isn't configured. Add app/google-services.json and rebuild.")
        val container = (applicationContext as ChimeApplication).container
        val deviceId = container.sessionStore.current()?.deviceId
            ?: return failure("Sign in before enabling mobile links.")
        return try {
            val enabled = NotificationManagerCompat.from(applicationContext).areNotificationsEnabled()
            val token = if (enabled) inputData.getString(KEY_TOKEN) else null
            if (enabled && token == null) {
                withContext(Dispatchers.IO) {
                    Tasks.await(FirebaseMessaging.getInstance().register(), 20, TimeUnit.SECONDS)
                }
                // onRegistered schedules the API upload with the installation ID.
                return Result.success(workDataOf("ready" to false))
            }
            container.api.registerPushToken(deviceId, token)
            if (enabled) Result.success(workDataOf("ready" to true)) else failure("Allow notifications in Android settings to receive links.")
        } catch (e: ApiException) {
            Log.w(TAG, "Push registration rejected (${e.status})")
            if (e.isRetryable && runAttemptCount < 5) Result.retry() else failure("Push registration failed (${e.status.value}). Reopen the app to retry.")
        } catch (e: IOException) {
            retry(e)
        } catch (e: ExecutionException) {
            retry(e)
        } catch (e: TimeoutException) {
            retry(e)
        }
    }

    private fun failure(message: String): Result {
        Log.w(TAG, message)
        return Result.failure(workDataOf("error" to message))
    }

    private fun retry(error: Exception): Result {
        Log.w(TAG, "Push registration failed", error)
        return if (runAttemptCount < 5) Result.retry() else failure("Push registration failed. Check connectivity and reopen the app to retry.")
    }

    companion object {
        const val WORK_NAME = "register-mobile-push"
        private const val KEY_TOKEN = "token"
        private const val TAG = "ChimePushRegistration"

        fun isConfigured(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

        fun enqueue(context: Context, token: String? = null) {
            val work = OneTimeWorkRequestBuilder<RegisterPushWorker>()
                .setInputData(workDataOf(KEY_TOKEN to token))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, work)
        }
    }
}
