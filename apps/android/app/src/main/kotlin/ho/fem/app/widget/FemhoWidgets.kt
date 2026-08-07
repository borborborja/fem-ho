package ho.fem.app.widget

import android.content.Context
import androidx.glance.appwidget.updateAll

/**
 * Repintar el que hi hagi col·locat a la pantalla d'inici.
 *
 * **No hi ha cap cicle propi.** Els descriptors diuen `updatePeriodMillis="0"` i el
 * refresc penja del `SyncWorker` que ja corre cada quinze minuts amb restricció de xarxa
 * — que és exactament el moment en què les dades poden haver canviat. Programar-ne un de
 * paral·lel voldria dir despertar la ràdio dues vegades per la mateixa informació.
 *
 * Es crida també just després d'escriure des d'un widget: allà ja som al procés i la
 * feina és local, i ningú ha d'esperar quinze minuts per veure el que acaba de fer.
 *
 * `updateAll` **no falla si no hi ha cap instància col·locada**: no cal preguntar-ho.
 */
object FemhoWidgets {
    suspend fun updateAll(context: Context) {
        BoardWidget().updateAll(context)
    }
}
