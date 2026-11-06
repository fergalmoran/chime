package com.podnoms.chime.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MobileLinkTest {
    private val payload = mapOf(
        "type" to "web-link",
        "deviceId" to "phone-id",
        "url" to "https://example.com/article?q=1#section",
        "title" to "Read this",
    )

    @Test
    fun acceptsWebLinksForTheCurrentSignedInDevice() {
        assertEquals(
            MobileLink("https://example.com/article?q=1#section", "Read this"),
            MobileLink.fromData(payload, "phone-id"),
        )
    }

    @Test
    fun ignoresPushesAfterLogoutOrAccountSwitch() {
        assertNull(MobileLink.fromData(payload, null))
        assertNull(MobileLink.fromData(payload, "another-phone"))
    }

    @Test
    fun rejectsUnsafeAndMalformedLinks() {
        listOf("javascript:alert(1)", "file:///etc/passwd", "intent://example.com", "https://user:pass@example.com", "not a URL")
            .forEach { url -> assertNull(MobileLink.fromData(payload + ("url" to url), "phone-id")) }
    }

    @Test
    fun fallsBackWhenThePageHasNoTitle() {
        assertEquals("Link from your desktop", MobileLink.fromData(payload - "title", "phone-id")?.title)
    }
}
