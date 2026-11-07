# Ktor references optional JVM classes that don't exist on Android.
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**

# Credential Manager loads its Play Services provider reflectively.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
