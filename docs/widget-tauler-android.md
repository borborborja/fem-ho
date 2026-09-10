# Widget Android «Fem-ho · Tauler»

Widget independent amb Inbox, Per fer i Fent visibles de costat. S’afegeix des del
selector de widgets del llançador, sense configuració prèvia. Conviu amb «Tasques»
(una columna configurable) i «Avui».

- Mida inicial de 4 × 4 cel·les; es pot redimensionar fins a 300 × 180 dp.
- Cada columna es desplaça independentment i mostra el recompte complet. Carrega un
  màxim de 25 tasques; «Veure totes», al final, obre aquella columna dins l’app.
- Tocar una targeta avança Inbox → Per fer → Fent → Fet. La tasca feta desapareix.
  «Obre» porta al tauler de l’app.
- Respecta els àmbits actius, l’idioma i el tema/accent de l’app. Els projectes no
  són un filtre propi del widget. Les targetes mostren el color de l’àmbit i tenen
  títol de dues línies, descripció accessible de l’acció i una zona tàctil de 72 dp
  d’alçada que creix amb la mida de la font. Els accessos tenen almenys 48 dp.

## Dades i sincronització

`LocalReads.taskBoard()` obté columnes, recomptes i colors mitjançant una sola
transacció Room. Això evita veure una tasca a dues columnes quan es mou entre
lectures. No hi ha migració de base de dades ni API nova.

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

Queda pendent al dispositiu: afegir els tres widgets alhora, moure tasques offline,
fer doble toc, tornar a connectar i comprovar els informes; revisar columnes buides,
més de 25 tasques, títols llargs, tema clar/fosc, font ampliada, redimensionament,
desplaçament independent, accessos i tancament de sessió.
