plugins {
    kotlin("jvm") version "2.2.0"
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // Només per llegir els fixtures compartits a les proves: el codi de producció no
    // depèn de cap llibreria de JSON.
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed")
    }
}
