# 14 · Decisions

Registre de les decisions ja preses. **No les reobris** sense un motiu nou i escrit.

Tres seccions: les contradiccions entre dossiers de `research/`, els dubtes que el brief deixava oberts, i la traçabilitat frase a frase del brief.

---

## Part 1 — Contradiccions entre dossiers

Els 15 dossiers es van escriure en paral·lel i es contradiuen en 12 punts. Un crític que els va llegir sencers els va identificar. Aquestes són les resolucions. **Manen sobre qualsevol dossier.**

### D1 · Llenguatge del backend

**El conflicte.** El dossier 08 argumenta llargament que Go és l'únic backend sensat, i el motiu decisiu és que *"no existeix cap llibreria de servidor CalDAV per a Node; calcula 2-4 vegades l'esforç"*. El dossier 03 diu el mateix. El dossier 12, en canvi, dona per fet un `apps/server` de TypeScript.

**La resolució: TypeScript.** La premissa del 08 era **falsa**, i el dossier 13 la desmunta amb fonts:

- Node accepta tots els verbs CalDAV sense cap configuració. `PROPFIND`, `PROPPATCH`, `REPORT`, `MKCALENDAR`, `MKCOL`, `COPY`, `MOVE`, `ACL` i `LOCK`/`UNLOCK` són a la taula de mètodes de llhttp. No hi ha allow-list ni flag. El risc era zero.
- `caldav-adapter` (MIT) és un servidor CalDAV escrit en Node que ja implementa `calendar-query`, `calendar-multiget`, `sync-collection` (RFC 6578), `expand-property`, `MKCALENDAR`, `PROPPATCH` i ctag. Es fa servir com a **referència de lectura**, no com a dependència: arrossega Koa, moment i lodash, i el contracte del seu magatzem no està documentat.

**Conseqüència sobre el dossier 08.** Queda re-etiquetat com a *"esquema, semàntica i raonament de modelatge"*. Tots els seus pins de llibreries Go, el seu Dockerfile, la seva tria de `sqlc`/`goose` i tots els seus fragments de codi **estan anul·lats**.

**Arquitectura de la superfície DAV.** Va sobre `node:http` pelat, en un port propi dins del mateix procés:

- **Fastify** fa 404 silenciós als verbs DAV fins que els registres a mà, i llavors respon 415 a l'XML fins que hi afegeixes un parser de tipus de contingut.
- **Express 5** rebutja les rutes amb comodí de la forma antiga i fa doble descodificació dels `href`, que trenca els UID amb caràcters escapats.
- **Hono** fa passar tot pel `Request` de WHATWG, amb el cost afegit que això implica.

**XML.** Es parseja amb una llibreria namespace-aware i es despatxa **sempre** per `(namespaceURI, localName)`, mai pel prefix: els clients fan servir prefixos diferents i redefineixen `xmlns` a mig document. `fast-xml-parser` i `xml2js` **queden prohibits al camí DAV**: no són namespace-aware.

**Un parany específic de Node.** Si registres un listener de `'checkContinue'` sense cridar `res.writeContinue()`, tots els `PUT` d'Apple es pengen.

### D2 · La columna del kanban

**El conflicte.** Quatre dossiers, tres noms i dos vocabularis: `column` amb valors catalans `['inbox','per_fer','fent','fet']`, `status` amb valors anglesos `['inbox','todo','doing','done']`, i un tercer que l'indexa com a `status` sense dir-ne els valors.

**La resolució: `status`, valors `inbox` · `todo` · `doing` · `done`.**

`column` xoca amb el vocabulari SQL de tot ORM i de tota conversa sobre bases de dades. I els identificadors catalans obliguen a mantenir accents i majúscules coherents a la base de dades, l'API, el CalDAV i el MCP alhora — el mateix dossier que els proposava argumenta, tres paràgrafs més avall, que els identificadors han de ser ASCII estable.

El català viu **només** als fitxers de traducció.

### D3 · L'ordre dins d'una columna

**El conflicte.** Un dossier diu `position TEXT`, índex fraccional calculat al **client**. Un altre diu `board_rank TEXT COLLATE BINARY`, índex fraccional base62 generat al **servidor** a partir dels IDs veïns. Un tercer (Vikunja) fa servir un `DOUBLE` amb inserció al punt mitjà i recàlcul al servidor.

**La resolució: `position TEXT`, índex fraccional, calculat al client, `COLLATE BINARY`.**

El càlcul al client **no és opcional**: un moviment offline a Android ha de produir la clau definitiva sense anar al servidor, o la targeta salta de lloc quan torna la connexió. El servidor accepta `position` directament o `{before_id, after_id}` i el calcula ell, per a clients simples.

`COLLATE BINARY` és obligatori. Amb una collation lingüística l'ordre de les claus és incorrecte i les targetes es desordenen sense cap error visible.

S'hi afegeix **jitter** al final de la clau: dos clients que insereixin simultàniament al mateix buit generarien la mateixa clau, i sense jitter l'empat es resol de manera arbitrària i diferent a cada client.

El `DOUBLE` de Vikunja queda descartat: amb dos clients offline no convergeix.

### D4 · Els identificadors

**El conflicte.** Un dossier proposa cadenes opaques amb prefix (`tsk_`, `prj_`, `scp_`…) sobre un cos ULID o UUIDv7. Dos més demanen UUIDv7 nu generat pel client.

**La resolució: UUIDv7 nu, generat pel client, sense prefix.**

El prefix és incompatible amb la generació al client si no repliques la regla de prefixat a web i a Android, i els dos dossiers que el proposaven **ni tan sols coincideixen en quins prefixos**, cosa que ja demostra el problema. Si vols llegibilitat als logs, posa el tipus a la URL i als camps del log, no dins de l'identificador.

UUIDv7 i no UUIDv4 perquè porta el temps al davant: els índexs no es fragmenten i l'ordre d'inserció és útil.

### D5 · La identitat de la IA

**El conflicte.** Un dossier vol una fila a `users` amb `kind='ai'`, sembrada per migració, que sigui assignable i comentarista. Un altre vol una taula `ai_agents` separada amb `on_behalf_of_user_id`, més `ai_sessions` i `ai_activities`, i insisteix que **delegar no és assignar**.

**La resolució: totes dues coses, cadascuna per al seu propòsit.**

- `ai_agents` és la identitat de delegació. Té `on_behalf_of_user_id`: **la responsabilitat es queda sempre amb una persona**. La tasca porta `delegate_agent_id`, que és un camp diferent d'`assignee_id`.
- I una fila a `users` de tipus `ai` que és **l'actor del registre d'activitat i l'autor dels comentaris**, perquè la línia de temps i el camí de l'avatar no hagin de tractar un actor polimòrfic.

`ai_agents.actor_user_id` apunta a aquesta fila.

Delegar ≠ assignar és la lliçó cara de Linear, i és el que manté la rendició de comptes en mans humanes. Una tasca delegada segueix tenint una persona responsable.

### D6 · Els noms de les tools MCP

**El conflicte.** Tres catàlegs incompatibles: un sense prefix i verb primer (`list_tasks`, `create_task`), un amb prefix `femho_*`, i un tercer diferent.

**La resolució: sense prefix, verb primer, amb el catàleg del dossier 10.**

Sense prefix perquè els clients **ja** fan namespace pel seu compte, com `mcp__<servidor>__<tool>`. Prefixar-ho altra vegada malgasta tokens a cada nom de tool, a cada crida, a cada finestra de context.

Però el **conjunt** de tools que val és el del dossier 10, que és el ben dissenyat: té briefing, leasing de tasques, sessions i claus d'idempotència, que als altres els falten. Se li treu el prefix i ja està.

Les tools s'ordenen alfabèticament a `tools/list`: els clients cacheguen, i un ordre estable millora els encerts de la memòria cau de prompts.

### D7 · El pipeline de tokens de disseny

**El conflicte.** Plou ve amb CSS escrit a mà. Un dossier proposa convertir-lo a JSON DTCG i generar-lo amb Style Dictionary, amb el CSS com a artefacte generat i no versionat.

**La resolució: híbrida, i escrita com a decisió abans de tocar cap codi.**

El **CSS de Plou és la font de veritat per al web**, tal com ve. Ja codifica comportament de cascada i especificitat que un generador de variables planes no sap expressar: si ho aplanes tot a `:root`, destrueixes el mecanisme d'accents, que depèn que `accents.css` s'importi **l'últim** i que la regla composta `[data-theme][data-accent]` guanyi.

Style Dictionary s'utilitza **només** per exportar cap a Compose, en una direcció.

### D8 · Els esdeveniments de calendari

**El conflicte.** Cap dossier els modela: no hi ha taula, ni recurs REST, ni tool MCP. Però un ja emet `entity: 'task' | 'checklist' | 'event' | …` pel canal SSE i munta un calendari complet.

**La resolució: entitat de primer nivell, decidida abans de l'esquema.**

Un esdeveniment **no pot ser una tasca amb hores**:

- `STATUS` de VEVENT és `TENTATIVE` / `CONFIRMED` / `CANCELLED`; el de VTODO és `NEEDS-ACTION` / `IN-PROCESS` / `COMPLETED` / `CANCELLED`. Enums diferents.
- Els enums de `PARTSTAT` també difereixen.
- `TRANSP` (si l'esdeveniment ocupa temps) no té cap equivalent a VTODO.
- Un calendari extern subscrit **només** pot produir VEVENTs.

**Una fila per component, no per recurs.** El mestre té `recurrence_id IS NULL`; cada instància modificada és una fila germana amb el seu `RECURRENCE-ID`. És el model de Google (`recurringEventId` + `originalStartTime`), d'Android (`ORIGINAL_ID` + `ORIGINAL_INSTANCE_TIME`) i de Morgen.

**Els esdeveniments no surten mai al kanban.** Apareixen al calendari i, el dia que toca, a l'Inbox — com diu el brief.

### D9 · Les col·leccions CalDAV

**La resolució: dues col·leccions per contenidor, sempre.**

RFC 4791 §5.2 prohibeix recursos amb components mixtos. Cada àmbit i cada projecte que es publiqui necessita una col·lecció `-events` (VEVENT) i una `-todos` (VTODO).

No és pedanteria: DAVx⁵ classifica una col·lecció **només** per `supported-calendar-component-set`, Apple ho imposa a nivell de sistema operatiu amb `EKCalendar.allowedEntityTypes`, i el CalDAV de Google directament no suporta VTODO.

### D10 · Els enllaços compartits

**El conflicte.** Tres esquemes: taula `share` o `shares`, i enums de permisos `('read','check')` o `('view','check','comment','edit')`, amb el token guardat en clar en un cas.

**La resolució: la mecànica de seguretat del dossier 09, el vocabulari del 08 retallat.**

Del 09: columna HMAC amb pebre per buscar el token (mai el token en clar), `secret_version` per poder rotar, `locked_until` per bloquejar força bruta, i **cap columna d'IP enlloc** — és una decisió de privadesa explícita.

El permís és **un sol enum**: `view` · `check` · `comment`. Sense `edit`: un convidat anònim no edita tasques. I sense la barreja de booleans i enum que tenien els dossiers, que és exactament com s'acaba amb tots dos.

### D11 · La base de dades

**La resolució: SQLite per defecte, PostgreSQL suportat, CI prova les dues.**

SQLite és la tria correcta per a una llar que s'autoallotja: un fitxer, cap contenidor extra, còpia de seguretat trivial. Postgres per a qui ja en té un.

Provar les dues a CI **no és cosmètic**: decideix FTS5 contra tsvector per a la cerca en català, i si es poden fer servir tipus enum natius (a SQLite, no).

### D12 · Dates en llenguatge natural

**El conflicte.** Un dossier diu que el parser català de dates és *"el lloc més clar on Fem-ho pot guanyar a Vikunja"* (el de Vikunja és regex fet a mà i només en anglès). Un altre ho posa com a **anti-objectiu** explícit de la v1.

**La resolució: v1 només sigils. El parser de dates va a la v1.1, darrere d'un endpoint propi.**

La v1 reconeix `@persona` i `#Àmbit/Projecte`. Les dates surten del selector.

Però **no s'escriu com a anti-objectiu**, perquè la superfície MCP ja promet que el servidor sap interpretar una cadena de data, i un anti-objectiu escrit en un document que la mateixa IA llegeix a la mateixa sessió genera exactament la confusió que volíem evitar. S'escriu com "v1.1, darrere de `POST /api/v1/parse`".

Quan s'implementi, dues coses no negociables:

- El **xip reversible**: el text reconegut s'ha de poder tornar a convertir en text pla amb un clic. És el que fa que Todoist pugui permetre's un parser agressiu, i el que Akiflow va acabar copiant.
- Els **fixtures compartits** entre TypeScript i Kotlin, verificats a CI, o les dues implementacions divergeixen.

---

## Part 2 — El que el brief deixava obert

El brief pensa en veu alta i deixa quatre coses sense decidir. Tres es resolen amb precedent investigat; la quarta és una tria de disseny.

### P1 · Llistes senzilles: subprojecte o subtasca?

**El dubte del brief**, literal: *"Estic pensant que lo de les subtasques de dins d'un projecte xoca amb que la llista sigui com un subprojecte."*

**La resolució: cap de les dues. Dues taules i un flag de presentació.**

- `checklist` pertany **sempre** a una tasca, i opcionalment s'ancora a una subtasca concreta.
- `checklist_item` només té text i fet/no fet.
- Una tasca porta `view_mode`: quan val `simple`, la UI la pinta com una llista de comprovació en comptes de com una targeta de kanban. **És presentació, no estructura.**

Els ítems **no** tenen data, ni assignat, ni niuament. Aquesta contenció és deliberada i és de Things 3: és exactament el que fa que la seva llista d'avui es mantingui neta. La riquesa va al **contenidor** (la llista es pot pinejar i compartir), no als ítems.

**La cascada amunt sí que hi és**, com demana el brief: marcar tots els ítems marca la subtasca o la tasca d'origen. Un dossier ho prohibia explícitament; mana el brief.

Quan una llista pinejada es completa del tot, es pregunta si es vol despinejar. L'usuari la pot despinejar quan vulgui.

### P2 · La columna "Fet" es neteja cada dia

**La resolució: és una consulta, no un estat. Cap job nocturn.**

La columna es calcula amb `status = 'done'` i `completed_at` dins d'un rang, **en el fus horari de qui mira**. Això vol dir:

- Cap tasca programada a mitjanit que pugui fallar.
- Correcte amb els canvis d'hora, que és on fallen les implementacions ingènues.
- Correcte quan dues persones de la casa són a fusos diferents.

`user_settings.done_cleared_at` es guarda **per usuari**: netejar és un gest personal, no destrueix res i no afecta ningú més.

**La presentació és més suau que un tall sec**: per defecte es veu el d'avui, i a sota "Ahir" i "Aquesta setmana" plegats amb el recompte. No s'amaga res, es plega. La cadència documentada del Personal Kanban és setmanal, no diària, i cap app de referència neteja el Fet silenciosament.

Es mantenen les dues coses que demana el brief: el botó de netejar a demanda, i el mini-calendari a la capçalera per navegar a qualsevol dia passat. Més el botó de "veure tot el fet d'avui", que ignora el `done_cleared_at`.

### P3 · Membres externs d'un àmbit col·lectiu

**El dubte del brief**: àmbits col·lectius *"amb usuaris de l'eina o externs (via caldav) o fins i tot col·lectius de les dues tipologies"*.

**La resolució: dos mecanismes segons què vulgui l'usuari.**

- **Només lectura** → subscripció a un `.ics` o a una col·lecció CalDAV externa. La persona no existeix com a usuari; el seu calendari es reflecteix dins de l'àmbit i es marca de només lectura.
- **Lectura i escriptura** → una fila d'usuari real l'única credencial de la qual és una **app password de CalDAV**. No té accés web ni a l'app; només connecta el seu client de calendari. Apareix com a membre, se li poden assignar tasques i queda al registre d'activitat com qualsevol altre.

### P4 · L'Inbox té dues identitats

**La resolució: és literalment la mateixa instància de component.**

No és una decisió d'arquitectura, és de UI, i la resposta correcta és la trivial: la columna Inbox del kanban i el rail de l'Inbox al costat del calendari són **el mateix component amb la mateixa font de dades**. Si divergeixen, es notarà.

És el consens del sector: de vuit apps que fusionen tasques i calendari, cinc posen el dipòsit de tasques sense hora en un rail a l'esquerra del calendari. El que és nou a Fem-ho és fer-lo alhora la primera columna del kanban.

### P5 · Compartir un àmbit sencer

**La resolució: hi ha dues vies de compartir, i comparteixen coses diferents.**

`docs/10` §1 diu que "no es comparteixen projectes ni àmbits sencers", i és cert **de la
via que aquell document descriu**: un enllaç públic, que un convidat anònim obre amb un
token a la URL. Allò segueix sent per a una cosa concreta i acotada —una tasca amb les
seves llistes— i obrir-hi un àmbit sencer seria regalar-lo a qui tingui l'enllaç.

La via nova és una altra: **persones amb compte i identitat**. Qui entra a un àmbit
compartit hi entra com a membre —`scope_members`, amb rol—, no com a visitant. La
diferència que ho justifica no és de mida, és de qui hi ha a l'altra banda: un membre és
expulsable, queda a l'historial amb nom, i el que hi escriu és seu.

| Via | Què es comparteix | Amb qui | Es pot retirar |
| --- | --- | --- | --- |
| Enllaç públic (`shares`) | Una tasca amb les seves llistes, o una llista | Qualsevol amb l'enllaç | Revocant l'enllaç |
| Membres (`scope_members`) | El kanban de l'àmbit, i els calendaris que es triïn un per un | Persones amb compte, d'aquesta instància o d'una altra | Expulsant, i el client ho esborra |

Tres coses que se'n deriven i que no són òbvies:

- **Els calendaris es trien un per un.** L'àmbit *és* el kanban, o sigui que compartir
  l'àmbit el comparteix sencer; però una font externa pot portar credencials que el
  propietari no vol cedir, i les credencials no viatgen mai —estan lligades al secret
  d'aquesta instància.
- **Descompartir ha d'esborrar de debò.** Deixar de sortir al sync no és el mateix que
  arribar com a esborrat: sense `scope_access_revocations` i `dropped_scopes`, qui surt
  d'un àmbit es queda les tasques al mòbil per sempre.
- **Una altra instància no és una mena nova de principal**, és un client d'API amb un
  usuari ombra i un token limitat a l'àmbit. Obrir un segon camí d'autorització per al que
  ve de fora seria trair la regla 8 al pitjor lloc possible.

### P6 · Què vol dir esborrar

**La resolució: esborrar és sempre suau, arrossega el que penja, i el que ve de fora no
es pot esborrar aquí.**

La pregunta que ho va obrir era concreta: *si esborres una tasca feta des d'un
esdeveniment, què passa?* La resposta honesta és que **aquell cas no existeix**: no hi ha
cap camí que faci una tasca a partir d'un esdeveniment, i la regla 7 diu que no són el
mateix. El que sí que existeix i necessita regla és això:

| Què esborres | Què se n'endú | Què NO se n'endú |
| --- | --- | --- |
| Una tasca | Les seves subtasques, llistes i ítems | Res del calendari |
| Una tasca amb data | El mateix. Desapareix del calendari perquè **hi sortia com a tasca**, no perquè hi hagués una còpia | — |
| Un esdeveniment local | L'ocurrència, la sèrie sencera o d'aquí endavant, segons el que es triï | Cap tasca |
| Un esdeveniment d'una font subscrita | **Res: es nega amb un 403.** La font és de qui la publica | — |

Tres coses que se'n deriven:

- **Una tasca amb data no té cap bessona al calendari.** Es dibuixa allà perquè té data,
  i prou. Per això esborrar-la no obre cap pregunta: no hi ha res a triar.
- **Les dues portes han d'esborrar igual.** Esborrar una tasca des d'un client CalDAV feia
  un `UPDATE tasks SET deleted_at` a pèl i deixava les subtasques i les llistes vives i
  sense pare; ara delega al mateix servei que el botó de l'app. Dues portes a la mateixa
  acció que fan coses diferents acaben sent algú que no entén per què li reapareixen coses.
- **No hi ha desfer, i per això es pregunta.** A la base tot és esborrat suau i la
  tombstone viatja, però `undo` només val per a un canvi autònom de la IA amb valors
  anteriors: cap persona pot recuperar una tasca des de la interfície. Mentre sigui així,
  el diàleg diu **què més se n'anirà** en comptes de preguntar "segur?".

I si algun dia es vol *fer una tasca a partir d'un esdeveniment*, la regla ja està
decidida aquí: **la tasca neix independent**. Esborrar-la no toca l'esdeveniment, i
esborrar l'esdeveniment no toca la tasca. L'alternativa —un enllaç viu— vol dir que
esborrar un esdeveniment d'un calendari compartit esborri en silenci la tasca que algú
altre s'havia apuntat.

### P7 · On viu el filtre de projectes

**La resolució: a cada xip d'àmbit, i amb selecció múltiple.**

Hi havia una píndola a la dreta de tots els xips que triava **un** projecte. Tres coses no
hi anaven, i cap és de detall:

- **Filtrava lluny del que filtra.** Els àmbits s'encenen als xips i els projectes es
  triaven en un altre control, tres píxels més enllà però conceptualment a part. Amb dos
  àmbits actius, aquell desplegable barrejava els projectes dels dos sense dir de qui era
  cadascun.
- **Un de sol.** "Veure Obra i Jardí però no la resta" no es podia demanar.
- **Sortia sempre.** Amb una instància sense cap projecte —que és com comença tothom— hi
  havia un desplegable permanent que només oferia "Tots els projectes".

Ara el botonet va enganxat al xip, **només si aquell àmbit té projectes**, i el menú és de
caselles: se'n marquen les que es vulguin i no es tanca a cada clic.

**Els dos prototips segueixen ensenyant el control vell, i és a posta.**

`Fem-ho Web.dc.html` i `Fem-ho Mobile.dc.html` porten tots dos el desplegable global amb
`projectFilter: 'all' | <projecte>` — un de sol, per a tots els àmbits. **No s'han
actualitzat**: són el disseny d'origen i es conserven com és, com `instruccions.txt`.

Es diu aquí perquè qui compari disseny i codi més endavant trobarà la diferència i pensarà
que és un descuit. No ho és: la va demanar l'autor amb aquestes paraules —*"el selector de
projectes que surt a la pàgina principal a la dreta d'àmbits me'l petaria"*— i els tres
motius de sota són el que la sosté.

**Un àmbit sense res triat vol dir "tots els seus".** La tria es desa com una llista plana
d'identificadors a la URL (`?projects=a,b`), i la llista buida ja diu "tot": desar un
"tots" explícit per àmbit seria un segon estat que vol dir el mateix. La conseqüència, que
val la pena tenir escrita: **una tasca sense projecte d'un àmbit amb tria no es veu.** Si
has demanat "d'aquest àmbit, Obra", una tasca sense projecte no és Obra.

### P8 · El botó de llistes pinejades, quan no n'hi ha cap

**La resolució: hi és igualment, i el desplegable diu on es pinegen.**

`docs/02` §3 deia "si no n'hi ha cap, el botó no es mostra", i el prototip fa el contrari:
el botó hi és sempre i el menú ensenya *"Cap llista pinejada. Pineja una llista senzilla
des d'una tasca."*

Guanya el prototip, i no perquè sigui el prototip. Amagar-lo té un problema que no es veu
mirant una instància ja feta servir: **pinejar no es descobreix enlloc**. L'acció viu dins
d'una tasca, en una llista, darrere d'un botó petit; i el lloc que n'ensenyaria l'existència
—la capçalera— només apareixia quan ja n'havies pinejat una. És un control que et premia
per saber-ne l'existència i no te'n diu res si no en saps.

La contrapartida és honesta i petita: una icona més a una capçalera que a mòbil ja va
justa. Es paga perquè el buit **no és un carreró sense sortida**: diu la frase que
converteix el descobriment en una acció.

Val per a les dues superfícies. El recompte, en canvi, només surt quan n'hi ha: un `0` al
costat de la xinxeta seria repetir amb un número el que el text ja diu.

---

### P9 · Les fonts a la bústia, i la regla 7

**La resolució: la regla 7 s'acota al model i no al lloc on es dibuixa.**

La bústia diària havia de ser **el que arriba de fora més les tasques** —calendaris
subscrits, `.ics` publicats i canals RSS—, que és el que distingeix Fem-ho d'una llista de
coses per fer. Però la bústia és **la primera columna del kanban**, i `instruccions.md` §7
deia «els esdeveniments no surten mai al kanban». A més, P4 diu que la columna i el rail
del calendari són el mateix component amb la mateixa font de dades.

Les tres coses no hi caben alhora. Es va mirar què cedia:

| Opció | Cost |
| --- | --- |
| Cedeix P4: les fonts només al rail del calendari | La columna i el rail deixen de ser el mateix, que és exactament la divergència que P4 volia evitar |
| Cedeix la visió: la bústia només amb tasques | Es perd «les fonts conformen el dia», que és la gràcia del producte |
| **Cedeix la regla 7, acotada** | Cap: el que protegia es manté sencer |

Perquè el que la regla 7 protegeix **no és on es dibuixa un esdeveniment**: és que no es
modeli com una tasca. Els seus `STATUS` són els de VEVENT, té `TRANSP` i assistents amb
`PARTSTAT`, i un calendari subscrit només en pot produir d'aquests. Res d'això canvia
perquè surti a la bústia.

La frase nova és:

> Un esdeveniment **no té mai estat de kanban ni s'arrossega entre columnes**. A la bústia
> hi pot sortir com a font, mai com a targeta de tasca.

**El que la fa millor que l'anterior és que es pot comprovar.** «No surten al kanban» és
una frase sobre píxels i s'ha de discutir mirant una pantalla. La nova és una llista de
fets: un esdeveniment no té `status`, no té `position`, no és un `Task` en cap tipus, no
s'arrossega, no té casella de fet, i cap identificador seu pot arribar a
`POST /tasks/{id}/move`. Les tres columnes de treball vénen de `/board`, i allà no hi entra
cap esdeveniment mai. Hi ha una prova de navegador que ho asserta: si algú dibuixa les
cites amb `BoardCard` per estalviar-se un component, cau.

Dues coses que se'n deriven i que val la pena deixar dites:

- **`InboxEvent` és un tipus propi i un array propi**, no un `Task` amb camps buits ni una
  llista barrejada. Si compartissin llista, un dia algú passaria un esdeveniment per on
  passa una tasca i la distinció s'evaporaria sense que res fallés.
- **La diferència visual va a la superfície i la forma, no al contrast.** La temptació era
  difuminar-les; `docs/04` §8 reserva `--ink-faint` per a text decoratiu i prohibeix
  fer-lo servir per a res que calgui llegir, i una cita de la bústia s'ha de llegir. A més,
  cap de les comprovacions permanents ho hauria vist: `contrast-check` només mira la seva
  llista de parells.

És l'única vegada que s'ha tocat `instruccions.md`, que és el document de precedència
màxima, i es va fer amb aprovació explícita abans d'escriure cap línia de codi.

---

### P10 · Que el servidor truqui a un model inverteix `docs/09`

**La resolució: es construeix el terreny, no el motor — i quan hi hagi motor, el que faci
surt per on ja surt la IA.**

`docs/09-mode-ia.md` diu una cosa que fins ara ha estat literalment certa: **Fem-ho no té
motor d'IA propi**. La intel·ligència és sempre externa —un agent, amb un token, que entra
per MCP o per l'API— i per això avui **no hi ha ni una variable de proveïdor** a
`config.ts`. Que el servidor agafi un correu i el porti ell a un model és el contrari
d'això, i no és un detall d'implementació: canvia qui fa la crida, qui paga la factura i
qui pot veure el text.

Es registra aquí perquè **la fase de correu construeix el terreny i no el motor**, i la
diferència entre les dues coses és exactament el que aquesta decisió fixa:

| Es fa ara | No es fa ara |
| --- | --- |
| Les variables validades (`FEMHO_AI_*`), documentades als tres llocs | Cap crida a cap model |
| `GET /api/v1/ai/status`, que diu si hi ha credencials | Cap connector, ni buit ni amb un `TODO` |
| El `.eml` cru, el fil ordenat i la decisió registrada | Cap columna que només serveixi per a demà |

Les tres coses de l'esquerra **tenen un ús avui sense cap model pel mig**, i és el criteri
que separa el terreny de l'especulació.

Dues restriccions que el disseny d'ara ha de deixar possibles, i que si no s'escriuen ara
no es podran afegir després sense refer-ho:

- **Tot el que faci un model ha de sortir per on ja surt la IA**: `activity_log` amb
  `actor_type = 'ai_agent'`, lligat a un agent que actua **en nom d'una persona**, i
  **desfeible** — `services/activity.ts` només ofereix «Desfés» amb aquell actor i amb els
  verbs que porten valors previs. Escriure com a `system` seria més fàcil i trencaria la
  promesa central del mòdul: que el que fa una IA es veu i es pot desfer.
- **La provinença és dada i no conveni.** `tasks.source_kind = 'mail'` vol dir que una eina
  futura pot etiquetar el text com a **extern** consultant-ho, i no endevinant-ho pel
  format. És la base de qualsevol defensa contra la injecció de prompts que es vulgui fer
  després.

I la barrera que ja existeix i no depèn de cap model: **el correu no tria res del seu
encaminament**. Ho tria la carpeta, i la carpeta la va mapar una persona. Un remitent pot
escriure el que vulgui al text; no pot decidir a quin àmbit va.

La frase honesta, que va a la pantalla: **«configurada» vol dir que hi ha credencials, no
que res les faci servir encara.**

---

### P11 · Un correu és el seu `Message-ID`, i un fil no és un assumpte

**La resolució: la identitat és `(account_id, message_key)`, mai l'UID d'IMAP; i els fils
s'agrupen per referències, mai per assumpte.**

Són dues decisions i van juntes perquè les dues responen a la mateixa pregunta —«quan són
el mateix?»— i les dues, mal resoltes, fallen **en silenci i mesos després**.

**Per què l'UID no serveix.** Un UID és estable dins d'una carpeta i mentre `UIDVALIDITY`
no canviï, i les dues condicions es trenquen soles:

- Quan el servidor reindexa, el protocol diu literalment «oblida tots els UID que t'he
  donat». Amb l'UID com a clau, això vol dir reingerir la bústia sencera i **duplicar cada
  tasca creada des del primer dia**.
- Moure un correu de carpeta és `COPY` + `EXPUNGE`, o sigui UID nou. Arrossegar entre
  etiquetes és un gest quotidià a Gmail: si cada arrossegada creés una segona tasca, la
  funció seria inservible la primera setmana.

Per això `message_key` surt del `Message-ID` normalitzat, amb prefix (`mid:`) i amb un
digest determinista (`sha:`) per als correus que no en porten — determinista **perquè el
cas on cal és exactament el de tornar a veure el mateix correu**. L'UID es desa igualment,
però com a **on l'hem vist per última vegada**: serveix per demanar només els nous.

Això té una conseqüència que va escrita a la comprovació permanent `mail-invariants`: **cap
índex únic sobre `mail_messages` que inclogui `uid`**. És l'anàleg directe de la lliçó de la
011, i existeix perquè «optimitzar» la desduplicació cap a l'UID sembla una millora.

**Per què l'assumpte no agrupa.** Agrupar per assumpte normalitzat —treure els `Re:` i
comparar— fusionaria correus de **remitents diferents** que comparteixen assumpte
(«Factura», «Reunió»). I en aquest disseny una fusió errònia no és un desordre: vol dir que
**el correu d'un desconegut apareix com a comentari a una tasca teva**. No és una comoditat,
és una propietat de seguretat.

La fallada correcta és la contrària: **un fil duplicat es veu i es descarta amb un clic; una
fusió no es veu i filtra.** Per això `thread_key` surt de `References` / `In-Reply-To` i
`mail_threads.subject` es desa **només per a la llista**.

Dos detalls que se'n deriven:

- **L'arrel de la conversa i no el pare immediat**, perquè una branca que arriba abans que
  el seu pare acabi convergint igualment.
- **L'ordre del fil és per `internal_date`** —la posa el servidor que el va rebre— i no per
  `Date:`, que la posa el remitent i pot mentir.

---

### P12 · Una sola regla de visibilitat, i res arriba sol al kanban

**La resolució: tot el que ve d'una font va a la bústia, i l'única pregunta és si es veu.**

El correu va néixer amb un camp `action` a la regla, amb dos valors: «cau a la bústia» o
«es converteix en tasca sola». La segona opció posava coses **al kanban d'algú** perquè una
carpeta de correu ho havia dit, i el model del producte és el contrari:

> A l'inbox hi ha correus, cites, titulars i tasques. **Les tasques les has escrit tu**; la
> resta són **elements que pots convertir**. El calendari és l'organitzador de la setmana:
> hi surt tot el que ha arribat, i és des d'allà que decideixes què puja a la llista.

`action` no era una opció que sobrés: era una que no hauria d'existir. La plantilla del
títol no es perd —s'aplica quan converteixes—, i l'únic automatisme que queda és que una
resposta a un fil que **ja** té tasca hi deixi un comentari, que hi és per no partir la
feina en dues.

**El que ho fa comprovable és que ara les quatre menes fan servir la mateixa cascada.** Els
cinc nivells d'`isInInbox` ja existien per als esdeveniments; el correu hi entra sense
inventar-ne cap:

| Nivell | Cita | Correu |
| --- | --- | --- |
| 0 · ja n'hi ha tasca | `tasks.event_uid` | `tasks.mail_message_key` |
| 1 · aquest ítem | marca de l'ocurrència | `mail_messages.inbox_visible` |
| 2 · la sèrie | marca de la sèrie | *(el fil: buit a posta)* |
| 3 · la font | `calendars.inbox_visible` | `mail_rules.inbox_visible` |
| 4 · el defecte | `defaultInInbox` | `defaultInInbox` |

Tres coses que se'n deriven i que no són òbvies:

- **El defecte d'una carpeta de correu és «no visible»**, com l'RSS i pel mateix motiu:
  mapar-la és dir «vull veure això en algun lloc», no «posa-m'ho tot a la llista de coses
  per fer». Una bústia amb volum enterraria la pantalla principal el primer matí, i la
  reacció raonable de qualsevol és deixar de mirar-la.
- **El que s'amaga no desapareix.** Abans, «descartar» un correu el treia per sempre i cap
  ruta ho desfeia; ara es queda al calendari, difuminat, i torna d'un clic. La diferència
  no és de comoditat: **una acció que no es pot desfer no es pren amb tranquil·litat**, i
  una bústia on esborrar fa por no es buida mai.
- **`/inbox?include_hidden` és una consulta amb dues lents**, i és el que salva P4. La
  columna del kanban i el rail del calendari segueixen sent el mateix component amb la
  mateixa font de dades: el tauler ensenya el que has decidit que és feina, i el calendari
  ho ensenya tot. Amb dues consultes, un dia el que es difumina al calendari i el que falta
  a la bústia deixarien de ser la mateixa cosa.

**El nivell 2 del correu es queda buit a posta.** Seria «tot aquest fil, no», i el forat hi
és perquè el dia que es demani entri sense tocar res més.

---

### P13 · La vista de mes ensenya el que hi ha, i deixa de ser quadrada

**La resolució: `aspect-ratio: 1` fora, i els punts substituïts pel títol del que hi ha.**

`docs/02` §5 demanava «cel·les quadrades» amb «fins a 3 punts de 5px». Les dues coses es van
escriure mirant el prototip, i totes dues fallen a la pantalla de debò:

| | Amb cel·la quadrada | Mesurat |
| --- | --- | --- |
| Alçada d'una cel·la a 1440px | lligada a l'amplada | **137px** |
| Amb el rail a sota (amplada sencera) | igual | **182px** |
| Alçada del mes | 6 files | **926px** |
| A un portàtil de 700px | | **les dues últimes setmanes sota la línia de flotació** |

I amb el rail a sota, la bústia quedava a mil quatre-cents píxels de la vista: el calendari
**tapava** literalment el que hi havia a sota.

**El punt és l'altra meitat del problema.** Diu que el dia té alguna cosa i no diu quina, que
és exactament la pregunta que una vista de mes existeix per respondre. Amb punts, saber què
tens la setmana que ve vol dir clicar set dies seguits — i llavors la vista de mes no serveix
de res que la de setmana no faci millor.

Ara: alçada mínima de 78px, el número a dalt a l'esquerra, i fins a tres ítems amb hora i
títol; la resta, un `+N`. El mes sencer cap en una pantalla de portàtil.

Tres coses que se'n deriven:

- **El dia seleccionat perd el gradient de marca.** Amb text a dins, omplir la cel·la
  obligaria cada títol a ser llegible sobre un degradat de tres parades i vuit accents, i
  `docs/04` §8 diu que el que cal llegir no s'hi juga. Passa a fons fantasma amb anell.
- **Els selectors de dia d'un desplegable es queden com eren.** El de la columna Fet i el de
  la bústia són popovers on només hi ha un número, i allà la compacitat és el que es vol. Ho
  decideix la presència d'`itemsByDate`: sense ítems, la cel·la segueix sent quadrada.
- **L'ordre dins del dia és per instant i no per títol.** La primera versió ordenava el text
  ja compost i posava «15:00 Dentista» abans de «9:00 Reunió»: en text, `1` va abans que `9`.

---

### P14 · Arribar a Fet és completar-la, i el segell el posa `move`

**La resolució: `POST /tasks/{id}/move` manté `completed_at`, i entrar a Fet fa tot el que
vol dir «feta».**

La columna Fet es calcula amb `status = 'done'` **i `completed_at` dins del dia de qui mira**
(P2, `docs/14` línia 187). El segell només el posava `completeTask`, i `POST /complete` **no
el crida cap client**: ni la web, ni Android, ni el CalDAV. Els dos gestos que la interfície
ofereix per acabar una tasca —arrossegar-la a Fet i el commutador de la targeta— passen
tots dos per `move`.

O sigui que `completed_at` era `NULL` sempre, la columna Fet no podia ensenyar **res mai**, i
la targeta que hi deixaves anar desapareixia de les quatre columnes: ja no era a Fent i
encara no era enlloc. `DoneColumn.ts` era correcte i tenia les seves proves; el que li
arribava era una llista buida. El defecte era la costura, com al calendari.

Tres coses que se'n deriven:

- **Entrar a Fet fa el mateix que el commutador**, i no una part: les subtasques cauen i, si
  la tasca es repeteix, neix la següent. Que dependrés del gest seria el pitjor dels dos
  móns —i `recurrence_mode = 'completion'` compta des de `completed_at`, que sense segell no
  existeix.
- **Sortir de Fet esborra el segell.** Una tasca que torna a Per fer no s'ha fet.
- **El registre en diu «completed» i hi guarda el segell**, perquè desfer un moviment a Fet
  no deixi la tasca fora de Fet i completada alhora (`docs/01` §7).

La prova va per `move` a posta, i n'hi ha una al navegador que arriba fins a veure la targeta
dins la columna: el que no es prova pel camí que la gent fa servir és el que es trenca.

---

## Part 3 — Fets sospitosos de `research/`

El crític va marcar 7 afirmacions com a probablement inventades, obsoletes o internament incoherents. **Cap `docs/` en depèn.**

| Què | Per què no t'hi refiïs |
| --- | --- |
| Un conjunt de versions "de lockfile": `typescript 6.0.3`, `vite 8.2.0`, `eslint 10.8.0`, `react 19.2.8`, `lucide-react 1.28.0` | Salts de major molt per davant del que es pot documentar. `lucide-react` ha estat a 0.x tota la seva vida: un 1.28.0 implicaria una renumeració que ningú ha vist. |
| Els plugins de FullCalendar a 7.0.2 en bloc, amb un polyfill de Temporal com a peer obligatori | El dossier admet que només va verificar dos paquets contra el registre. La resta i el requisit del polyfill són extrapolació. |
| L'SDK d'MCP amb paquets `@modelcontextprotocol/{core,server,client,node,express,hono,fastify}` tots a 2.0.0 | El dossier mateix diu que la pàgina de release li va donar un any impossible. |
| `tsdav` a 2.3.1 publicat el 2026-07-10 | Un altre dossier de la mateixa sessió el marca `UNVERIFIED`. Dues verificacions incompatibles del mateix fet: senyal que les etiquetes "verificat" no són comparables entre fitxers. |
| Els pins de Go (`modernc.org/sqlite`, `go-webdav`, `rrule-go`) amb versions d'SQLite aparellades | Irrellevant: l'stack és TypeScript. I l'aparellament de versions és el tipus de detall que envelleix malament. |
| El format de token amb CRC32 justificat citant GitHub | La citació fa servir "digits" per a caràcters base62, cosa que suggereix una paràfrasi que s'ha endurit fins a semblar una cita literal. |
| OkHttp 5.4.0 i Retrofit 3.0.0 a la mateixa taula "compatible" | Incoherent: l'entrada de Retrofit fixa la seva dependència transitiva a OkHttp 4.12 mentre la taula presenta la 5.4.0 com a actual. |

**La regla que en surt:** cap document d'aquesta carpeta fixa cap versió. Es resolen en crear l'scaffold, es comproven contra el registre real, i es congelen al lockfile.

---

## Part 4 — Traçabilitat del brief

Cada requisit d'`instruccions.txt` i on viu. Els números de línia són del brief original.

| Línia | Requisit | On |
| --- | --- | --- |
| 2 | Gestor personal i familiar, multi-usuari; web i app; app autònoma però aparellada a un servidor | `00`, `03`, `06` |
| 4 | Dues UI que se sentin la mateixa cosa; web responsive; web mòbil ≈ app mòbil; camp de servidor al login de l'app | `02`, `03` |
| 6 | Web autoallotjada amb Docker | `12` |
| 7 | App mòbil nativa d'Android | `03` |
| 11 | Login amb correu i contrasenya; dashboard que ho ensenya tot d'una mirada; afegir tasques i marcar-les fetes ràpid; calendari al dashboard | `02`, `05` |
| 13 | Tres àmbits; espai general per àmbit; projectes dins d'un àmbit | `01` |
| 15 | Menú superior: switch calendari/tasques, chips multiselector d'àmbit, desplegable de projecte, botó `+`, botó de perfil | `02`, `03` |
| 17 | Calendari mensual/setmanal/diari; esdeveniments d'altres usuaris amb permís; afegir tasques i esdeveniments; tasques normalment sense hora; els esdeveniments surten a l'Inbox el dia que toca; columna d'Inbox al costat, posicionable; secció de tasques sense dia | `01`, `02`, `07` |
| 19 | Amb més d'un àmbit seleccionat cal triar àmbit; una tasca pot no tenir projecte però mai no tenir àmbit | `01`, `02` |
| 21 | Kanban de 4 columnes; `+` per afegir ràpid sense modal; assignació a persona; a Personal tot és de qui ha entrat; `@` autocompleta persona; `#Àmbit` i `#Àmbit/Projecte` encaminen | `01`, `02` |
| 23 | Inbox dinàmic, punt d'unió entre els dos móns; tasques del dia; sense data; endarrerides configurable; canviar de dia; filtrar per projecte | `01`, `02`, P4 |
| 25 | "Per fer" rígid, s'arrossega dia a dia; epígrafs d'àmbit plegables amb més d'un àmbit | `01`, `02` |
| 27-33 | Ajustos: General, Calendaris, MCP, Usuari IA, Perfil, Admin | `02`, `07`, `08`, `09` |
| 37 | Selector de tema sistema/clar/fosc i d'accent | `02`, `04` |
| 38 | Dashboard global clicant el títol "Fem-ho" | `02` |
| 39 | L'Inbox s'ha de veure diferent de les tres llistes kanban | `02`, `04` |
| 40 | Botons ràpids a la targeta; drag & drop al web | `02`, `04` |
| 41 | Dins d'Ajustos no hi ha d'haver switch ni àmbits, només "Tornar" | `02`, `03` |
| 42 | A Perfil edites el teu, no el dels altres | `05` |
| 43 | Admin: afegir, editar i eliminar usuaris; netejar instància | `05`, `10` |
| 44 | Crear àmbits: individuals o col·lectius; membres interns, externs via CalDAV, o mixtos | `01`, `07`, P3 |
| 45 | Llistes de tasques senzilles: creació, selecció, vista simple, ancoratge a subtasca, pinejat, cascada de completat, despinejat | `01`, `02`, P1 |
| 47-48 | Mode IA: individual / amb ajuda / delegada; sense fricció en crear; Fem-ho no té motor d'IA; indicadors visuals; canvis autònoms visibles; historial | `09` |
| 50 | API i MCP d'usuari i d'IA amb límits separats; no duplicar lògica; tokens per àmbit; passar fitxers de context i instruccions | `05`, `08`, `09` |
| 52 | Instruccions genèriques i descripcions per àmbit i per projecte | `09` |
| 54 | Historial de canvis a totes les tasques | `01`, `05` |
| 56 | Edició completa en modal: títol, àmbit, projecte, persones, mode IA, deadline, instruccions, fitxers | `02`, `03` |
| 58 | "Fet" es neteja cada dia o a demanda; mini-calendari per navegar; veure tot el fet d'avui | `01`, `02`, P2 |
| 60 | Compartir amb enllaç; durada, contrasenya, nom obligatori; Ajustos-Compartits; els externs surten a l'historial amb nom o amb identificador | `10` |

**Divergències deliberades respecte al brief**, totes justificades més amunt: la columna "Fet" no s'esborra (P2), les llistes senzilles no són subprojectes (P1), i el parser de dates en llenguatge natural es difereix a la v1.1 (D12).

### Divergències respecte al prototip

El prototip és una maqueta i en tres punts es queda curt respecte al que demana el brief. **Mana el brief.**

| El prototip fa | Fem-ho fa | Per què |
| --- | --- | --- |
| Admin acaba amb "Zona de perill → Eliminar compte" | Admin gestiona usuaris (afegir, convidar, editar, eliminar) i té "Netejar instància" | El brief (línia 43) demana gestió d'usuaris i neteja d'instància, no que l'administrador esborri el seu propi compte |
| Manté el switch de vista i els chips d'àmbit dins d'Ajustos | Dins d'Ajustos només hi ha "‹ Tornar al tauler" | Queixa explícita del brief (línia 41) |
| Pinta el fons de columna amb un literal `rgba(20,22,30,0.02)` | Fa servir el token `--column-bg`, definit als dos temes | És un bug: en tema fosc el fons és invisible |

I quatre pantalles que el prototip no té i el brief demana: el dashboard global (línia 38), el rail de llistes pinejades (línia 45), la creació d'àmbits (línia 44) i la pestanya de Compartits (línia 60). Més el camp de servidor al login d'Android (línia 4).
