package com.podnoms.chime.push

import java.net.URI
import java.net.URISyntaxException

data class MobileLink(val url: String, val title: String) {
    companion object {
        fun fromData(data: Map<String, String>, currentDeviceId: String?): MobileLink? {
            if (currentDeviceId == null || data["deviceId"] != currentDeviceId || data["type"] != "web-link") return null
            val url = data["url"]?.takeIf { it.length <= 2048 } ?: return null
            val uri = try {
                URI(url)
            } catch (_: URISyntaxException) {
                return null
            }
            if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank() || uri.userInfo != null) return null
            val title = data["title"]?.take(200)?.takeIf { it.isNotBlank() } ?: "Link from your desktop"
            return MobileLink(url, title)
        }
    }
}
