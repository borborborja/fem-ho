/**
 * L'app d'Android. docs/03 §11.
 *
 * L'estructura de mòduls és la que fixa el document, i no és decorativa:
 *
 *   - `:core-model` és **Kotlin pur, sense Android**. Hi viuen el parser d'afegida
 *     ràpida, l'índex fraccional i els models de domini, que han de donar exactament el
 *     mateix que els de TypeScript (`parser-parity`, D3). Sense l'SDK d'Android, les
 *     seves proves corren a qualsevol màquina i a CI sense emulador ni llicències.
 *   - `:core-network` no coneix la base de dades i `:core-data` no coneix la xarxa des
 *     de les pantalles: **els repositoris exposen fluxos des de la base local i cap
 *     pantalla crida la xarxa directament** (docs/03 §11).
 *   - Les tres `:feature-*` no es coneixen entre elles. El que comparteixen va a `core`.
 */

rootProject.name = "fem-ho"

include(":core-model")
include(":core-designsystem")
include(":core-network")
include(":core-data")
include(":feature-tasks")
include(":feature-calendar")
include(":feature-settings")
include(":app")

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
