package ho.fem.app

import android.app.Application
import ho.fem.data.Container

/**
 * El contenidor viu a l'aplicació i no a l'activitat: una rotació de pantalla no ha de
 * tancar la base de dades ni obrir una connexió nova.
 */
class FemhoApplication : Application() {
    lateinit var container: Container
        private set

    override fun onCreate() {
        super.onCreate()
        container = Container(this)
    }
}
