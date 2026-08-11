plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    /**
     * El `namespace` és el paquet del codi; l'`applicationId`, la identitat de l'app.
     *
     * **No són el mateix i aquí no ho eren.** El codi viu a `ho.fem.app` i el namespace
     * deia `ho.fem`, o sigui que els noms relatius del manifest —`.MainActivity`,
     * `.FemhoApplication`, `.PushReceiver`— es resolien contra `ho.fem` i apuntaven a
     * classes que no existeixen. L'app no arrencava: `ClassNotFoundException` abans de
     * pintar res. Compilava, l'APK es construïa i les proves de Kotlin passaven, perquè
     * cap de les tres coses arrenca mai l'aplicació.
     *
     * L'`applicationId` es queda com estava: és el que identifica l'app al telèfon i
     * canviar-lo faria que fos una app diferent de la que algú tingués instal·lada.
     */
    namespace = "ho.fem.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ho.fem"
        minSdk = 26
        targetSdk = 36
        versionCode = 7
        versionName = "0.7.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true }

    /**
     * La clau de signatura ve de l'entorn, mai del repositori.
     *
     * Sense les variables, `signingConfig` es queda nul i `assembleRelease` dona un APK
     * **sense signar**, que Android no instal·la. És el comportament que es vol: val més
     * que falli a la instal·lació que no pas publicar-ne un que sembla bo i que després
     * ningú pot actualitzar, perquè una actualització d'Android exigeix la mateixa clau
     * que la instal·lació original.
     */
    val keystore = System.getenv("FEMHO_KEYSTORE")
    signingConfigs {
        if (!keystore.isNullOrBlank()) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("FEMHO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("FEMHO_KEY_ALIAS")
                keyPassword = System.getenv("FEMHO_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!keystore.isNullOrBlank()) signingConfig = signingConfigs.getByName("release")
        }
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core-model"))
    implementation(project(":core-network"))
    implementation(project(":core-data"))
    implementation(project(":core-designsystem"))
    implementation(project(":core-widget"))
    implementation(project(":feature-tasks"))
    implementation(project(":feature-calendar"))
    implementation(project(":feature-settings"))

    val composeBom = platform("androidx.compose:compose-bom:2026.03.01")
    implementation(composeBom)
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.navigation:navigation-compose:2.9.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    // UnifiedPush: notificacions sense Google (docs/11 §1). Si no hi ha cap
    // distribuïdor instal·lat, es cau a la consulta periòdica, que és el mateix
    // WorkManager.
    implementation("org.unifiedpush.android:connector:3.3.3") {
        /**
         * El connector porta Tink de JVM i `security-crypto` en porta la variant
         * d'Android. Són **les mateixes classes** amb dos artefactes, i el dexer no ho
         * accepta: "Duplicate class com.google.crypto.tink.Aead". Es queda la d'Android,
         * que és la que sap parlar amb el magatzem de claus del dispositiu.
         */
        exclude(group = "com.google.crypto.tink", module = "tink")
    }
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
