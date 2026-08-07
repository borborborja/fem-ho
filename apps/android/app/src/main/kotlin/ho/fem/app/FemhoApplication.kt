package ho.fem.app

import android.app.Application
import ho.fem.data.Container

/**
 * El contenidor viu a l'aplicació i no a l'activitat: una rotació de pantalla no ha de
 * tancar la base de dades ni obrir una connexió nova.
 *
 * **Es demana a `Container.get()` en comptes de construir-lo.** Els widgets de la
 * pantalla d'inici s'executen en aquest mateix procés però sense poder veure aquesta
 * classe, i han de trobar el mateix contenidor: dos voldrien dir dues connexions de Room
 * sobre el mateix fitxer.
 */
class FemhoApplication : Application() {
    lateinit var container: Container
        private set

    override fun onCreate() {
        super.onCreate()
        container = Container.get(this)

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
