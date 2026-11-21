# Widget Android «Fem-ho · Tauler»

Widget independent amb Inbox, Per fer i Fent visibles de costat. S’afegeix des del
selector de widgets del llançador, sense configuració prèvia. Conviu amb «Tasques»
(una columna configurable) i «Avui».

- Mida inicial de 4 × 4 cel·les; es pot redimensionar fins a 300 × 180 dp.
- Cada columna es desplaça independentment i mostra el recompte complet. Carrega un
  màxim de 25 targetes; «Veure totes», al final, obre aquella columna dins l’app.
- Tocar una targeta avança Inbox → Per fer → Fent → Fet. La tasca feta desapareix.
  La icona d’obrir, a la capçalera de Fent, porta al tauler de l’app.
- «Refresca» demana una sincronització. «Tasques» i «Avui»
  també porten aquest botó.
- Respecta els àmbits actius, l’idioma i el tema/accent de l’app. Els projectes no
  són un filtre propi del widget. Les propostes del calendari respecten la selecció
  de projectes de l’app. Les targetes mostren el color de l’àmbit i tenen
  títol de dues línies, descripció accessible de l’acció i una zona tàctil de 64 dp
  d’alçada que creix amb la mida de la font. L’accés al tauler té 40 dp.

Cada columna integra en una sola fila el punt d’estat, el nom i el recompte. Si la
mida de la lletra i l’ample del widget deixen poc lloc per als noms, les icones
passen a una fila pròpia. Els fons de superfície i targeta
usen drawables amb variants `values` i `values-night`; no es tenyeixen amb un
`ColorProvider`, perquè alguns llançadors componen aquell tint com a negre en mode
clar.

Amb les propostes del calendari activades a Ajustos → General, «Tauler» i «Tasques»
mostren les cites d’avui a «Per fer». Durant la cita, una proposta pendent es veu
a «Fent» amb el ribet discontinu. Tocar-la obre les opcions d’inici a l’app. Si
acaba l’estona prevista sense confirmació, la proposta torna a «Per fer».

## Dades i sincronització

`LocalReads.taskBoard()` obté columnes, recomptes i colors mitjançant una sola
transacció Room. Això evita veure una tasca a dues columnes quan es mou entre
lectures. La mateixa lectura incorpora les propostes de la memòria cau i la cua
d’accions pendents. Els canvis d’hora es poden aplicar sense connexió. Si Android
ha aturat el procés, el sistema pot ajornar l’actualització del giny. El botó de
refresc torna a llegir les dades locals i demana una sincronització quan hi ha
connexió. No hi ha migració de base de dades ni API nova.

L’acció d’avançar és la mateixa del widget «Tasques»: contrasta compte, àmbit i estat,
i passa per `Repository.moveTask()`. La cua conserva cada moviment i l’hora del
gest; WorkManager fa la sincronització i els reintents. Entrar a Fent obre un tram,
sortir-ne el tanca i tornar-hi n’obre un altre. Els tres widgets es refresquen
amb els mateixos esdeveniments, inclòs el tancament de sessió. Una invalidació
observable força una nova lectura mentre la composició és viva: Glance no reinicia
`provideGlance` amb cada `updateAll`. Això també corregeix els dos widgets anteriors.
La reconfiguració de «Tasques» emet la mateixa invalidació. La durada de les
composicions i la necessitat d’observar els canvis estan documentades a
[GlanceAppWidget](https://developer.android.com/reference/kotlin/androidx/glance/appwidget/GlanceAppWidget).

Les regles R8 existents preserven el nou provider, receiver i callback compartit.
El descriptor aporta una previsualització XML per al selector d’Android 12 o superior.
La mostra usa l’accent per defecte perquè el selector no coneix el perfil; els colors
es generen des de Plou. El widget real resol l’accent de la persona.

La mida exacta i la previsualització XML segueixen la documentació de
[Glance](https://developer.android.com/develop/ui/compose/glance/create-app-widget).

## Validació

Les comprovacions i els límits de la implementació es registren a
[ESTAT.md](ESTAT.md). La compilació no substitueix una prova al llançador.

Amb l’APK amb R8 al llançador d’Android 14 s’han col·locat els tres ginys. S’hi
ha comprovat que el refresc recupera tasques i cites noves, que el canvi de
columna de la proposta funciona sense connexió i que acceptar-la amb l’hora
prevista desa l’inici del tram amb aquella hora.
