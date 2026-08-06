/**
 * L'app d'Android (docs/03 · docs/13 M13).
 *
 * El mòdul `core` és **Kotlin pur, sense Android**, i això és a posta: hi viuen el
 * parser d'afegida ràpida i l'índex fraccional, que han de donar exactament el mateix
 * que els de TypeScript (`parser-parity`, D3). Sense dependre de l'SDK d'Android, les
 * seves proves corren a qualsevol màquina i a CI sense emulador ni llicències.
 */

rootProject.name = "fem-ho"

include(":core")

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        google()
    }
}
