# Regles de R8 per a la compilació de publicació.
#
# `build.gradle.kts` referencia aquest fitxer des de M13 i **no existia**: la primera
# `assembleRelease` que s'hagués intentat hauria fallat, i la feina `release` del workflow
# d'Android només corre a les etiquetes `v*`, o sigui que ningú ho havia intentat mai.
#
# El que hi ha aquí és el mínim per compilar i el mínim per no trencar-se en execució.
# Res d'`-keep class **` generals: retirar codi mort és justament el que fa que l'APK
# baixi de mida, i desactivar-ho perquè "va més segur" és renunciar-hi sense mesurar.

# ---------------------------------------------------------------- Tink / errorprone
#
# `androidx.security:security-crypto` arrossega Tink, que porta anotacions d'Error Prone
# als seus tipus. Són anotacions **de temps de compilació** i no són a l'APK, o sigui
# que la referència que hi queda no s'ha de resoldre mai. Sense això, R8 s'atura.
#
# UnifiedPush ja exclou Tink al `build.gradle.kts` per una col·lisió amb security-crypto;
# aquí no s'exclou res, només es diu a R8 que no adverteixi del que no cal.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi

# ------------------------------------------------------------------------- Glance
#
# Els widgets de la pantalla d'inici s'instancien **pel nom de la classe**, des del
# sistema d'AppWidget i des dels `RemoteViews`. R8 no veu cap crida i els retiraria.
#
# El resultat seria un defecte que només es dona a `release`: el widget es col·loca, es
# pinta —el receptor se salva pel manifest— i **tocar-lo no fa res**, perquè la classe
# de l'acció ja no hi és. És el pitjor tipus de fallada: silenciosa i només al que es
# publica.
-keep class * extends androidx.glance.appwidget.GlanceAppWidgetReceiver { <init>(); }
-keep class * extends androidx.glance.appwidget.GlanceAppWidget { <init>(); }
-keep class * extends androidx.glance.appwidget.action.ActionCallback { <init>(); }
-keep class * implements androidx.glance.state.GlanceStateDefinition { *; }

# ---------------------------------------------------------------------------- Room
#
# Room genera implementacions que es carreguen per reflexió pel nom.
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# ------------------------------------------------------------- kotlinx.serialization
#
# Els serialitzadors es resolen per un camp estàtic generat al company object.
-keepclassmembers class ho.fem.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class ho.fem.** {
    kotlinx.serialization.KSerializer serializer(...);
}
