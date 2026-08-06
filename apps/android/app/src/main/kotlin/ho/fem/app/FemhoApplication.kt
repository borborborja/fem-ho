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

        /**
         * La consulta periòdica es programa **sempre**.
         *
         * Amb distribuïdor és redundant i barata —quinze minuts, i només amb xarxa—; i
         * sense, és l'únic camí perquè arribin els recordatoris. Programar-la només quan
         * no hi ha distribuïdor voldria dir saber-ho en arrencar, i això no se sap fins
         * que el registre respon.
         */
        Notifications.ensureChannel(this)
        Notifications.schedulePolling(this)
    }
}
