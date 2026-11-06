package com.podnoms.chime.notifications

import com.podnoms.chime.data.NotificationCategory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationClassifierTest {
    @Test
    fun `default sms app is classified as sms even if unknown`() {
        assertEquals(
            NotificationCategory.Sms,
            NotificationClassifier.classify("com.example.sms", androidCategory = "msg", defaultSmsPackage = "com.example.sms"),
        )
    }

    @Test
    fun `known apps take precedence over the android category`() {
        assertEquals(
            NotificationCategory.Email,
            NotificationClassifier.classify("com.google.android.gm", androidCategory = "msg", defaultSmsPackage = null),
        )
    }

    @Test
    fun `unknown apps fall back to android category then other`() {
        assertEquals(NotificationCategory.Call, NotificationClassifier.classify("x.y", "missed_call", null))
        assertEquals(NotificationCategory.Other, NotificationClassifier.classify("x.y", "promo", null))
        assertEquals(NotificationCategory.Other, NotificationClassifier.classify("x.y", null, null))
    }

    @Test
    fun `ongoing, summary, empty and own notifications are not forwarded`() {
        val own = "com.podnoms.chime"
        assertTrue(NotificationClassifier.shouldForward("com.whatsapp", own, false, false, "Alice", "Hi"))
        assertFalse(NotificationClassifier.shouldForward(own, own, false, false, "t", "b"))
        assertFalse(NotificationClassifier.shouldForward("com.spotify", own, isOngoing = true, isGroupSummary = false, "Song", null))
        assertFalse(NotificationClassifier.shouldForward("com.whatsapp", own, false, isGroupSummary = true, "2 messages", null))
        assertFalse(NotificationClassifier.shouldForward("com.whatsapp", own, false, false, " ", null))
    }
}
