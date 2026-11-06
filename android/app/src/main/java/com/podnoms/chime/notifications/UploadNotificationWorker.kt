package com.podnoms.chime.notifications

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.podnoms.chime.ChimeApplication
import com.podnoms.chime.data.ApiException
import com.podnoms.chime.data.CreateNotificationRequest
import kotlinx.serialization.json.Json
import java.util.concurrent.TimeUnit

/** Durable retry path for notifications that couldn't be uploaded immediately (e.g. while offline). */
class UploadNotificationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val payload = inputData.getString(KEY_PAYLOAD) ?: return Result.failure()
        val request = Json.decodeFromString<CreateNotificationRequest>(payload)
        val api = (applicationContext as ChimeApplication).container.api

        return try {
            api.pushNotification(request)
            Result.success()
        } catch (e: ApiException) {
            if (e.isRetryable && runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.failure()
        } catch (_: Exception) {
            if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.failure()
        }
    }

    companion object {
        private const val KEY_PAYLOAD = "payload"
        private const val MAX_ATTEMPTS = 10

        fun enqueue(context: Context, request: CreateNotificationRequest) {
            val work = OneTimeWorkRequestBuilder<UploadNotificationWorker>()
                .setInputData(workDataOf(KEY_PAYLOAD to Json.encodeToString(request)))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // The external key de-duplicates repeated enqueues of the same notification.
            WorkManager.getInstance(context)
                .enqueueUniqueWork("upload-${request.externalKey}", ExistingWorkPolicy.KEEP, work)
        }
    }
}
