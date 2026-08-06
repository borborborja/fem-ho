/**
 * Kotlin pur, sense Android.
 *
 * És el que fa que `parser-parity` sigui una comprovació de veritat: aquestes proves
 * corren a CI sense SDK ni emulador, i llegeixen **els mateixos fixtures** que les de
 * TypeScript.
 */
plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    testLogging { events("passed", "failed") }
}
