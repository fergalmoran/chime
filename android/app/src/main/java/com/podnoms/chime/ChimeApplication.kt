package com.podnoms.chime

import android.app.Application
import android.content.Context
import com.podnoms.chime.data.SessionStore
import com.podnoms.chime.data.ChimeApi

/** Manual dependency container; small enough that a DI framework isn't warranted yet. */
class AppContainer(context: Context) {
    val sessionStore = SessionStore(context)
    val api = ChimeApi(sessionStore)
}

class ChimeApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
