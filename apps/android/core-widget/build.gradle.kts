plugins {
    id("com.android.library")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "ho.fem.widget"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-data"))
    // `api` i no `implementation`: els widgets viuen a `:app` i necessiten els tipus de
    // colors de Plou (`FemhoColors`) per parlar amb la paleta d'aquí.
    api(project(":core-designsystem"))

    // Glance no s'afegeix a `:core-designsystem`: l'arrossegaria a les tres `:feature-*`,
    // que no en fan res. Viu aquí, i s'exposa perquè `:app` hi declara els widgets.
    api("androidx.glance:glance:1.1.1")
    api("androidx.glance:glance-appwidget:1.1.1")

    // El compilador de Compose el necessita encara que aquí no es pinti res de Compose
    // "de pantalla": Glance fa servir el mateix runtime de composició.
    val composeBom = platform("androidx.compose:compose-bom:2026.03.01")
    implementation(composeBom)
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-unit")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    testImplementation("junit:junit:4.13.2")
}
