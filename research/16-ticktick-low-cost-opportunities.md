# Oportunitats de TickTick aplicables a Fem-ho

## Resum executiu

TickTick competeix per amplitud: captura ràpida, filtres, calendaris, vistes múltiples,
temporitzador, hàbits, matriu d’Eisenhower, estadístiques, widgets i integracions conviuen
en una mateixa aplicació.[^1] Aquesta amplitud explica bona part del seu atractiu, però
també el seu principal risc: una ressenya destacada de Google Play diu que repetir,
recordar i reprogramar costa de trobar, i que l’aplicació no resulta intuïtiva.[^2]
La lliçó útil per a Fem-ho és copiar connexions petites entre funcions que ja existeixen,
no reproduir tot el catàleg.

La millor oportunitat és completar un cicle que Fem-ho ja té gairebé construït:

1. **Captura** des del lloc on apareix la necessitat.
2. **Tria** què mereix entrar al dia d’avui.
3. **Enfoca** una sola tasca mentre el registre de dedicació corre.
4. **Revisa** el temps real al mateix sistema d’informes.

Les quatre primeres iniciatives recomanades no necessiten una entitat nova ni una
migració de dades. En conjunt s’estimen en **10–15 dies de desenvolupament** per a una
persona familiaritzada amb el repositori, incloent web, Android, traduccions i proves.

| Ordre | Iniciativa | Cost estimat | Valor principal | Model/API nous |
| --- | --- | ---: | --- | --- |
| 1 | Captura des de compartir i des del widget Tauler | 2–3 dies | Redueix la fricció abans que una idea es perdi | No |
| 2 | Revisió «Prepara avui» basada en regles | 3–5 dies | Converteix acumulació en decisions petites | No |
| 3 | Mode «Enfoca» sobre el registre existent | 3–5 dies | Dona utilitat immediata al tracking i als informes | No |
| 4 | Filtres ràpids i ordenació recent | 2–3 dies | Permet trobar què fer sense construir un llenguatge de filtres | No |
| 5 | Captura de diverses línies | 2–4 dies | Importa un brain dump sense IA ni formularis repetits | No |
| 6 | Ajornament configurable de notificacions | 2–3 dies | Millora una interacció diària d’alt valor | Preferència petita |
| 7 | Estimació contra temps real | 7–10 dies | Tanca el cercle de planificació i reporting | Sí |

## Què explica l’èxit funcional de TickTick

La pàgina oficial actual presenta cinc capes connectades. La captura combina widget,
drecera global, processament de llenguatge natural, veu i integracions. L’organització
usa llistes, etiquetes i filtres. La planificació combina calendari, Kanban i timeline.
L’execució incorpora Pomodoro. La revisió agrega estadístiques de tasques, focus i
hàbits.[^1] El valor no és tenir cinc menús: és que una tasca passa d’una capa a la
següent sense tornar a introduir dades.

El posicionament té tracció. La fitxa de Google Play mostrava **4,6 estrelles i 157.000
ressenyes** el 14 de setembre de 2026.[^2] TickTick Premium cobra 49,99 dòlars anuals i
situa entre els arguments de pagament la durada de tasques, els filtres, el timeline,
la matriu, els widgets i les estadístiques.[^3] Això no demostra el valor individual de
cada funció, però sí que el producte considera monetitzable la combinació de planificar,
executar i revisar.

El changelog de 2026 és més útil que el catàleg històric per detectar oportunitats
barates. TickTick hi ha afegit tasques suggerides per revisar pendents i portar-les a
avui, filtres de cerca, ordenació per creació o modificació, un temporitzador de focus a
la pestanya del navegador i preferències separades per dispositiu.[^4] Són ajustos de
flux i visibilitat, no nous dominis de dades.

### Senyals de necessitat dels usuaris

Les fonts comunitàries tenen biaix d’autoselecció i no permeten estimar percentatges,
però serveixen per entendre problemes concrets:

- Un usuari veterà demana poder introduir una durada estimada i després filtrar per
  tasques que caben en els minuts disponibles; altres participants reconeixen el mateix
  cas d’ús.[^5]
- En el mateix fil es demana revisar automàticament les tasques que envelleixen a
  l’Inbox i es critica la incoherència visual entre plataformes.[^5]
- Altres usuaris valoren les petites millores de qualitat de vida i rebutgen incorporar
  IA costosa o imprevisible al nucli de la gestió personal.[^6]
- En una conversa sobre Premium, els recordatoris, l’ajornament, el calendari i els
  filtres intel·ligents apareixen entre els elements més valorats.[^7]
- La ressenya crítica de Google Play no demana més potència: demana que repetir,
  recordar i reprogramar siguin fàcils de descobrir.[^2]

La conclusió analítica és que Fem-ho obtindrà més retorn connectant i fent visibles les
capacitats actuals que afegint un sisè sistema de productivitat.

## Punt de partida de Fem-ho

Fem-ho ja cobreix bona part del valor estructural que TickTick anuncia:

| Capacitat | TickTick | Fem-ho avui | Conseqüència |
| --- | --- | --- | --- |
| Captura ràpida | NLP, veu, widgets, dreceres | Parser compartit web/Android, drecera Android i Quick Add | Falta capturar des d’altres apps i des del widget de tres columnes |
| Organització | Llistes, etiquetes, filtres | Àmbits, projectes, etiquetes, estats i cerca | Es poden crear filtres ràpids sense model nou |
| Calendari | Diverses vistes i time blocking | Mes, setmana, dia, rail i arrossegament | No cal construir una altra vista temporal |
| Execució | Pomodoro i cronòmetre | Entrar a Fent obre un tram i el comptador corre | Falta una experiència explícita de focus |
| Revisió | Estadístiques de tasques i focus | Resum, dedicació, registre i cronograma editable | El tracking pot donar valor abans de crear mètriques noves |
| Repeticions | Calendari i compleció | RRULE i repetició des de compleció | Ja resolt |
| Col·laboració | Llistes compartides i assignació | Àmbits col·lectius, membres, convidats i CalDAV | Fem-ho ja té un model més ric |
| Integració | Calendaris i serveis externs | CalDAV, REST, MCP i tokens amb abast | És un diferenciador, no un buit |

La base tècnica també afavoreix millores petites:

- [`TaskTimeBadge.tsx`](../apps/web/src/board/TaskTimeBadge.tsx) ja calcula cada segon el
  total tancat més els trams oberts.
- [`tasks.ts`](../apps/server/src/services/tasks.ts) ja retorna al dashboard les tasques
  d’avui, endarrerides i en curs en una sola petició.
- [`Routing.kt`](../apps/android/app/src/main/kotlin/ho/fem/app/Routing.kt) i
  [`TodayWidget.kt`](../apps/android/app/src/main/kotlin/ho/fem/app/widget/TodayWidget.kt)
  ja obren l’afegida ràpida des d’un widget.
- El parser de [`QuickAdd.kt`](../apps/android/core-model/src/main/kotlin/ho/fem/model/QuickAdd.kt)
  i el seu equivalent compartit ja resolen àmbit, projecte, persona i data.
- L’acció Android d’ajornar existeix, però està fixada a quinze minuts a
  [`NotificationActionReceiver.kt`](../apps/android/app/src/main/kotlin/ho/fem/app/NotificationActionReceiver.kt).

## Criteri de cost

Les estimacions assumeixen una persona que coneix el repositori i inclouen la mateixa
experiència essencial a web i Android quan correspon, catàlegs en tres idiomes, camí
offline, historial d’escriptures i proves significatives. No inclouen publicació ni una
ronda extensa d’investigació amb usuaris.

- **XS, fins a 1 dia:** canvi d’interfície que reutilitza una acció existent.
- **S, 2–3 dies:** flux curt sense migració ni contracte nou.
- **M, 4–7 dies:** diverses superfícies o una extensió petita del contracte.
- **L, més de 7 dies:** model nou, sincronització nova o comportament transversal.

Una iniciativa només entra al primer paquet si el seu MVP és S o M baixa i no duplica
una capacitat actual.

## 1. Captura des de qualsevol lloc

### Proposta

Afegir Fem-ho com a destinació d’Android per a `ACTION_SEND` i
`ACTION_PROCESS_TEXT`. En compartir text o un enllaç, l’aplicació obre l’afegida ràpida
amb el contingut emplenat i deixa que la persona confirmi l’àmbit abans de desar. Afegir
també una icona `+` al widget Tauler de tres columnes, reutilitzant la mateixa ruta que
ja usa el widget Avui.

### Evidència i encaix

TickTick posa la captura al principi de la seva proposta: widget amb creació ràpida,
drecera global, NLP, veu i integracions.[^1] La fitxa d’Android també destaca escriure o
dictar i la detecció automàtica de dates.[^2] Fem-ho ja té la part difícil —parser,
pantalla, àmbits i cua offline—; només li falta l’entrada des del sistema operatiu.

### MVP i cost

- Declarar els intents de compartir text i processar selecció.
- Passar el text inicial a l’afegida ràpida sense crear res automàticament.
- Conservar l’aplicació d’origen a la descripció només si la persona ho demana; el MVP
  no necessita una columna de procedència nova.
- Afegir el `+` al widget Tauler amb descripció accessible.
- Provar text, URL, aplicació sense sessió, mode avió i text molt llarg.

**Estimació: 2–3 dies.** No hi ha migració, endpoint ni operació de domini nova.

### Mesura

Percentatge de tasques creades des de compartir o widget, i proporció de captures que
arriben a Per fer en les 24 hores següents. En una instal·lació autoallotjada, aquestes
mètriques han de ser locals o explícitament opt-in.

## 2. Revisió «Prepara avui» basada en regles

### Proposta

Mostrar al dashboard una targeta opcional amb una seqüència curta de tasques que
necessiten decisió. Per a cada tasca: **Avui**, **Demà**, **Torna a l’Inbox**, **Fet** o
**Salta**. La primera versió usa regles transparents:

1. Tasques que continuen a Fent.
2. Tasques endarrerides.
3. Tasques d’avui.
4. Tasques de l’Inbox sense data, limitades a les més antigues que ja arriben al client.

No cal ordenar-les amb IA ni puntuar comportaments personals. La interfície ha
d’explicar per què surt cada suggeriment: «en curs», «vençuda ahir» o «sense data».

### Evidència i encaix

TickTick va afegir el gener de 2026 «Suggested Tasks» per revisar pendents i portar-los
ràpidament a avui.[^4] La seva funció històrica «Plan Your Day» presenta les tasques
d’avui i endarrerides una per una per reprogramar, completar o eliminar.[^8] Un usuari
veterà demana específicament un mecanisme perquè les captures antigues de l’Inbox no
quedin oblidades.[^5]

Fem-ho ja agrega `today`, `overdue` i `doing` al dashboard. Les accions necessàries són
PATCH de data i els moviments que ja existeixen. El MVP pot començar amb aquestes tres
llistes i afegir l’antiguitat de l’Inbox després, si Android necessita exposar
`created_at` a la seva projecció local.

### MVP i cost

- Entrada «Prepara avui» només quan hi ha decisions pendents.
- Màxim de deu targetes; mai un modal obligatori en obrir l’app.
- Accions reversibles i toast amb desfer quan sigui possible.
- Sense eliminació dins del ritual inicial.
- Mateixes regles a servidor o contracte compartit; no duplicar criteris web/Android.

**Estimació: 3–5 dies.** No necessita taules noves. Afegir tasques antigues de l’Inbox a
la resposta del dashboard pot ampliar el contracte, però no canvia l’esquema.

### Mesura

Nombre de decisions completades, endarrerides abans/després i percentatge de dies en
què el ritual es tanca. Cal evitar convertir la ratxa d’ús en pressió o gamificació.

## 3. Mode «Enfoca» sobre el tracking existent

### Proposta

Afegir una acció «Enfoca» a cada tasca. Si és a Per fer, passa a Fent i obre una vista
reduïda amb títol, subtasques, temps corrent i tres accions: **Pausa**, **Feta** i
**Obre la tasca**. Si ja és a Fent, només obre la vista. A la web, el títol de la
pestanya pot mostrar `12:34 · Nom de la tasca` mentre el tram és obert.

No cal implementar Pomodoro en el primer lliurament. El valor és fer visible el focus
que el model de Fem-ho ja registra.

### Evidència i encaix

TickTick connecta Pomodoro o cronòmetre amb una tasca i després mostra estadístiques de
focus.[^1] El seu material de time blocking recomana iniciar el temporitzador des del
bloc planificat i usar el cronòmetre per aprendre quant duren les tasques.[^9] El
changelog de 2026 va portar el temporitzador al títol de la pestanya del navegador, una
millora mínima de visibilitat.[^4]

Fem-ho té una base més directa per a aquest MVP: entrar a Fent obre un tram, sortir-ne
el tanca, `time_summary.open_started_at` identifica la sessió corrent i els informes ja
agreguen els trams. No cal un segon temporitzador ni un segon registre.

### MVP i cost

- Acció contextual a web i Android.
- Vista de focus sense navegació nova al servidor.
- «Pausa» torna a Per fer i tanca el tram; «Feta» usa la compleció existent.
- Document title a web i notificació local discreta a Android només en una iteració
  posterior, perquè una notificació persistent requereix política pròpia.
- Si hi ha diverses tasques a Fent, la vista no inventa exclusivitat: mostra quina s’ha
  triat per enfocar.

**Estimació: 3–5 dies.** És interfície sobre estat i agregats existents.

### Mesura

Percentatge de trams iniciats des d’«Enfoca», trams sense final i consultes posteriors
als informes. L’objectiu és millorar la confiança del registre, no augmentar minuts.

## 4. Filtres ràpids i ordenació recent

### Proposta

Afegir una fila plegable de filtres d’un toc al tauler:

- Avui.
- Endarrerides.
- Assignades a mi.
- Sense projecte.
- Amb preguntes de la IA.

Afegir ordenació per posició manual, creació recent i activitat recent. El MVP no desa
filtres personalitzats ni crea una gramàtica booleana.

### Evidència i encaix

TickTick tracta els filtres com una capacitat central i els inclou a la comparació de
plans.[^1][^3] El seu changelog de juliol de 2026 va afegir agrupació i ordenació per
temps de creació o modificació, i al juny havia afegit filtres de cerca.[^4] Els filtres
intel·ligents també apareixen entre els motius pels quals alguns usuaris mantenen
Premium.[^7]

Fem-ho ja retorna data, projecte, assignacions, atenció de la IA, creació, actualització
i activitat. Per al tauler carregat, la major part es pot calcular al client. Si un
filtre ha de superar el límit de dades carregades, s’ha d’afegir com a paràmetre a
`GET /tasks`; no convé fingir exactitud amb una mostra parcial.

### MVP i cost

- Filtres predefinits, combinació AND i botó clar per restablir.
- URL a la web perquè la vista es pugui compartir i recuperar.
- Estat local a Android durant la sessió.
- Comptador de resultats i estat buit que anomena el filtre actiu.

**Estimació: 2–3 dies** si s’aplica sobre les dades completes del tauler; **4–6 dies**
si cal estendre API i consultes paginades.

### Mesura

Ús per filtre, temps fins a obrir una tasca i freqüència de «restableix». Molts
restabliments immediats indicarien noms o combinacions poc clars.

## 5. Captura de diverses línies

### Proposta

Quan s’enganxa text amb salts de línia a l’afegida ràpida, oferir una previsualització:
«Crear 7 tasques». Cada línia passa pel parser actual i pot resoldre el seu àmbit,
projecte, persona i data. La persona pot corregir línies invàlides o aplicar un àmbit
comú abans de confirmar.

### Evidència i encaix

La captura per veu i NLP forma part de l’atractiu de TickTick.[^1][^2] En la comunitat,
un cas d’ús expressat és poder descarregar verbalment o per escrit totes les coses que
cal fer sense configurar-les una a una.[^6] Fem-ho pot resoldre el mateix problema sense
motor d’IA: text estructurat, previsualització i parser determinista.

### MVP i cost

- Activació només en enganxar dues línies o més.
- Identificadors generats al client i una mutació existent per línia.
- Resum final de creades, pendents offline i línies amb error.
- Cap endpoint batch inicial; la cua actual conserva reintents i idempotència.

**Estimació: 2–4 dies.** El principal cost és una recuperació clara dels errors parcials.

## 6. Ajornament configurable de notificacions

### Proposta

Permetre triar a Ajustos el comportament de l’acció «Ajorna»: 15 minuts, 1 hora o demà
a primera hora. La notificació conserva una sola acció; aplica el valor preferit sense
obrir l’app. Una iteració posterior pot obrir un selector, però no és necessària per
obtenir valor.

### Evidència i encaix

TickTick destaca múltiples recordatoris, recordatori persistent i notificacions per
correu.[^1] En el fil sobre Premium, l’ajornament i la capacitat d’actuar des de la
notificació encapçalen la llista de beneficis percebuts.[^7] Fem-ho ja completa i ajorna
des de la notificació, però el retard és sempre de quinze minuts.

**Estimació: 2–3 dies.** Requereix una preferència sincronitzada i que Android la pugui
llegir offline; no necessita canviar les tasques ni els recordatoris.

## 7. Estimació contra temps real

### Proposta

Afegir `estimated_seconds` opcional a les tasques i mostrar-lo al costat del temps real.
Els informes podrien agregar desviació per projecte o tipologia. Després es podria
afegir un filtre «em queden 15/30/60 minuts», que és el cas d’ús més distintiu detectat
entre els usuaris.[^5]

TickTick relaciona l’estimació amb el temporitzador i presenta estimat contra real com
una eina per planificar millor.[^10] Aquesta proposta encaixa especialment bé amb
Fem-ho perquè el temps real i els trams ja són fiables.

No és una victòria immediata: necessita migració SQLite/PostgreSQL, OpenAPI, sincronització,
Room, formularis web/Android, CalDAV si es vol preservar interoperabilitat i informes.
**Estimació: 7–10 dies.** Cal posar-la després de validar que «Enfoca» augmenta l’ús del
tracking; altrament s’afegeix un camp que poca gent omplirà.

## Priorització recomanada

| Iniciativa | Valor | Abast | Confiança | Cost | Decisió |
| --- | --- | --- | --- | --- | --- |
| Captura des de qualsevol lloc | Alt | Android i widget | Alta | S | Fer ara |
| Prepara avui | Molt alt | Web i Android | Alta | M baixa | Fer ara |
| Enfoca | Molt alt | Web i Android | Alta | M baixa | Fer ara |
| Filtres ràpids | Alt | Web i Android | Mitjana-alta | S/M | Fer ara després de confirmar volum |
| Diverses línies | Mitjà-alt | Web i Android | Mitjana | S | Segona tanda |
| Ajornament configurable | Mitjà | Principalment Android | Mitjana-alta | S | Segona tanda |
| Estimació contra real | Alt | Tot el producte | Mitjana | L baixa | Validar abans |

### Pla de lliurament

**Paquet 1 — Captura i tria, 5–8 dies**

1. Compartir text a Fem-ho i `+` al widget Tauler.
2. Targeta «Prepara avui» amb Fent, endarrerides i avui.
3. Instrumentació local mínima i proves de mode avió.

**Criteri de continuació:** almenys una de cada cinc sessions actives usa captura externa
o «Prepara avui» durant dues setmanes en una prova amb persones reals. Si no hi ha dades
de telemetria, cinc entrevistes de seguiment i observació directa són suficients per
decidir.

**Paquet 2 — Execució i selecció, 5–7 dies**

1. «Enfoca» i temporitzador al títol de la pestanya.
2. Filtres ràpids sobre el tauler complet.
3. Revisió visual web/Android i comprovació que els informes reben tots els trams.

**Criteri de continuació:** la majoria de trams iniciats des d’«Enfoca» es tanquen sense
edició manual i les persones poden explicar la diferència entre Fent i Enfoca.

**Paquet 3 — Profunditat opcional**

1. Captura multilínia.
2. Ajornament configurable.
3. Prototip d’estimació contra real; implementar el model només si el tracking té ús.

## Funcions de TickTick que no convé copiar ara

| Funció | Motiu per ajornar-la |
| --- | --- |
| Hàbits | Nova entitat, regles de ratxa, recordatoris, estadístiques i sincronització. Competeix amb el nucli de tasques. |
| Matriu d’Eisenhower | Fem-ho no té prioritat ni urgència formal. Afegir-les només per construir una vista crea semàntica i migracions transversals. |
| Pomodoro complet | Configuració de cicles, pauses, sons, notificació persistent i comportament en segon pla. «Enfoca» captura primer el valor amb el tracking actual. |
| Recordatori constant | Pot ser intrusiu i multiplica problemes entre dispositius. La comunitat el considera potent però fins i tot molest.[^11] |
| Plantilles completes | Demanen versionat, visibilitat per àmbit i política sobre subtasques, llistes, persones i dates. Captura multilínia i recurrència cobreixen molts casos. |
| Notes com a entitat | Eixampla cerca, permisos, CalDAV, exportació i navegació. La descripció i els adjunts actuals cobreixen el cas lleuger. |
| Recordatoris per ubicació | Permisos sensibles, geofencing, consum i comportament diferent per plataforma. TickTick mateix els anuncia només per iOS.[^1] |
| Assistent d’IA intern | Fem-ho està dissenyat perquè una IA externa operi per MCP amb permisos i traçabilitat. Un motor intern duplicaria arquitectura i contradiria el senyal d’usuaris que prefereixen millores deterministes.[^6] |
| Més temes | Fem-ho ja té vuit combinacions; el problema actual és claredat i coherència, no varietat. |

## Riscos i límits de l’evidència

La pàgina de funcions, preus, changelog i Google Play es van consultar el 14 de setembre
de 2026. Els articles que descriuen «Plan Your Day», time blocking i estimacions són de
2020; els detalls d’interacció poden haver canviat, encara que el catàleg actual continua
oferint calendaris, focus, filtres, durada i estadístiques.[^1][^3][^4]

Reddit aporta exemples concrets però no una mostra representativa. Els fils barregen
plataformes, plans i fluxos personals, i els vots visibles són baixos en diversos casos.
Per això les recomanacions no depenen d’una petició aïllada: exigeixen coincidència entre
una necessitat observada, una capacitat actual de TickTick i una reutilització clara del
codi de Fem-ho.

Les estimacions són de planificació, no compromisos. Abans d’implementar cada paquet cal
confirmar el recorregut exacte a web i Android i mantenir les invariants del repositori:
contracte abans de l’API, historial dins la transacció, cua offline i paritat de textos.

## Fonts

[^1]: TickTick. “[Features](https://ticktick.com/features).” Consulta: 14 de setembre de 2026.
[^2]: Google Play. “[TickTick: To Do List & Calendar](https://play.google.com/store/apps/details?id=com.ticktick.task&hl=en_US).” Fitxa, valoració i ressenyes; consulta: 14 de setembre de 2026.
[^3]: TickTick. “[Smarter Tools, Better Productivity](https://www.ticktick.com/upgrade).” Comparació Free/Premium i preu; consulta: 14 de setembre de 2026.
[^4]: TickTick. “[Changelog](https://ticktick.com/public/changelog/en.html).” Entrades web de gener–agost de 2026; consulta: 14 de setembre de 2026.
[^5]: Reddit, r/ticktick. “[Anyone else been using TickTick for years? What would you change?](https://www.reddit.com/r/ticktick/comments/1skv83j/anyone_else_been_using_ticktick_for_years_what/)” 14 d’abril de 2026.
[^6]: Reddit, r/ticktick. “[Please don't change (too much), TickTick](https://www.reddit.com/r/ticktick/comments/1q49j2w/please_dont_change_too_much_ticktick/).” 5 de gener de 2026.
[^7]: Reddit, r/ticktick. “[The things you would miss most about TickTick Premium if it were taken away from you](https://www.reddit.com/r/ticktick/comments/1r12qwg/the_things_you_would_miss_most_about_ticktick/).” 10 de febrer de 2026.
[^8]: TickTick Blog. “[20 Lesser-Known TickTick Features](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/).” 8 de desembre de 2020.
[^9]: TickTick Blog. “[Time Blocking: How It Helps You Take Control of Your Time](https://blog.ticktick.com/2020/07/24/time-blocking-take-control-of-your-time/).” 24 de juliol de 2020.
[^10]: TickTick Blog. “[Review of Recent Updates in TickTick](https://blog.ticktick.com/2020/09/03/recent-updates-in-ticktick/).” 3 de setembre de 2020.
[^11]: Reddit, r/ticktick. “[Long-term users, how reliable do you think this app is?](https://www.reddit.com/r/ticktick/comments/1qa9rio/longterm_users_how_reliable_do_you_think_this_app/).” 11 de gener de 2026.
