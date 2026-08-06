/**
 * Versions resolides contra els registres reals el 2026-08-06 (regla 2): Maven Central
 * per a Kotlin i KSP, i el Maven de Google per a AGP, Compose i AndroidX. Cap surt d'un
 * dossier de `research/`.
 */
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("com.android.library") version "8.13.2" apply false
    kotlin("android") version "2.2.0" apply false
    kotlin("jvm") version "2.2.0" apply false
    kotlin("plugin.serialization") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
    id("com.google.devtools.ksp") version "2.2.0-2.0.2" apply false
}
