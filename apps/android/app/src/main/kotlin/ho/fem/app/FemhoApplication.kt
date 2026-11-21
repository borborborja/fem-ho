package ho.fem.app

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
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
    internal lateinit var pomodoroSignals: PomodoroSignals
        private set

    override fun onCreate() {
        super.onCreate()
        container = Container.get(this)
        pomodoroSignals = PomodoroSignals(this, container)

        /**
         * La consulta periòdica es programa **sempre**.
         *
         * Sense distribuïdor també recull els avisos d'activitat. Amb distribuïdor
         * recupera els que no han arribat i confirma els que ja s'han mostrat.
         */
        Notifications.ensureChannel(this)
        Notifications.schedulePolling(this)
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    container.account()?.let { Notifications.requestSync(this@FemhoApplication, it) }
                }
            },
        )
    }
}
