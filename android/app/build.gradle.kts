plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Push is optional during local setup; Google sign-in does not require Firebase.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.podnoms.chime"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.podnoms.chime"
        minSdk = 26
        targetSdk = 37
        // Release builds pass these (-Pchime.versionCode=…, -Pchime.versionName=…); see scripts/build-android.sh.
        versionCode = providers.gradleProperty("chime.versionCode").map(String::toInt).getOrElse(1)
        versionName = providers.gradleProperty("chime.versionName").getOrElse("0.1.0")

        // Google OAuth *Web application* client ID (the API validates ID tokens against it).
        // Set chime.googleWebClientId in android/gradle.properties (or ~/.gradle/gradle.properties, or -P); empty hides Google sign-in.
        val googleWebClientId = providers.gradleProperty("chime.googleWebClientId").getOrElse("")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
    }

    // Upload key for Play (Play App Signing re-signs with the app signing key). Read from the environment so
    // nothing secret lives in the repo; when unset, release builds are left unsigned.
    val keystorePath = providers.environmentVariable("CHIME_KEYSTORE_PATH").orNull
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = providers.environmentVariable("CHIME_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("CHIME_KEY_ALIAS").getOrElse("upload")
                keyPassword = providers.environmentVariable("CHIME_KEY_PASSWORD")
                    .orElse(providers.environmentVariable("CHIME_KEYSTORE_PASSWORD")).get()
            }
        }
    }

    buildTypes {
        debug {
            // Development API (emulators and physical devices alike).
            buildConfigField("String", "DEFAULT_API_URL", "\"https://chime.dev.fergl.ie:5002\"")
        }
        release {
            val apiUrl = providers.gradleProperty("chime.releaseApiUrl").getOrElse("https://chime.ferg.al")
            buildConfigField("String", "DEFAULT_API_URL", "\"$apiUrl\"")
            signingConfigs.findByName("release")?.let { signingConfig = it }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.analytics)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.googleid)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.ktor.client.mock)
}
