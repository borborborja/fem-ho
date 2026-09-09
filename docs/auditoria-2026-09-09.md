# Auditoria de programació i funcionalitat de Fem-ho

L’auditoria ha corregit errors d’accés a dades, de sincronització, de sessió i de calendari. Els casos més greus permetien retornar contingut fora de l’abast autoritzat o descartar escriptures que el servidor no havia confirmat. Les correccions incorporen proves de regressió i s’han contrastat amb el servidor real i amb fluxos de navegador.

L’anàlisi parteix del commit local `4248659`, versió de producte 0.16.0, a `/opt/projects/fem-ho`. Els canvis són a la branca local `audit-functional-2026-09-09`. La data de verificació és el 9 de setembre de 2026. L’informe descriu el codi corregit; no acredita que aquesta versió estigui desplegada.

## Abast i criteri

S’han revisat les regles del producte, els serveis de tasques i llistes, les comprovacions d’àmbit, el registre de canvis, el client HTTP de la web, el repositori Android i el calendari. La selecció prioritza confidencialitat, conservació de dades i coherència entre dispositius. Les regles de referència exigeixen una política compartida de permisos, un registre de cada escriptura i identificadors generats pel client.[^1]

La suite inicial passava amb 1.155 proves correctes i 5 d’omeses. Per tant, les incidències següents exemplifiquen comportaments que les proves existents no garantien. Les reproduccions noves afegeixen escenaris amb identificadors repetits, revocació d’accés, respostes HTTP tardanes, confirmacions absents i canvis que afecten entitats filles.

La gravetat expressa l’impacte funcional observat, sense atribuir puntuacions CVSS ni assumir exposició pública de cap desplegament. Una auditoria d’aquest abast no demostra l’absència d’altres defectes.

## Resultats i correccions

| Cas | Gravetat | Comportament defectuós | Correcció |
| --- | --- | --- | --- |
| A01 | Alta | Reutilitzar l’id d’una tasca existent retornava aquella tasca després de validar només l’àmbit indicat al cos de la petició. | Es comprova l’accés a l’àmbit real de la tasca abans de retornar un reintent. |
| A02 | Alta | Crear una subtasca amb l’id d’una altra retornava la subtasca aliena, encara que la tasca mare demanada fos diferent. | El reintent exigeix la mateixa tasca mare i una subtasca no esborrada. |
| A03 | Alta | Una llista podia ancorar-se a una subtasca d’una altra tasca; la cascada podia escriure fora de la jerarquia autoritzada. | L’ancoratge exigeix una subtasca viva de la mateixa tasca. |
| A04 | Alta | Les pinejades es filtraven per persona, però no per l’abast del token ni per la pertinença actual a l’àmbit. | Es fa la intersecció entre els àmbits visibles i els autoritzats pel token. |
| A05 | Mitjana | Esborrar una subtasca desancorava les llistes a la base, però no enviava el canvi de les llistes al sync. | Cada desancoratge registra el valor anterior i genera el seu delta. |
| A06 | Mitjana | Completar una tasca canviava les subtasques sense generar un delta per cadascuna. | Tant el moviment a Fet com el completat explícit registren les filles modificades. |
| A07 | Alta | Completar des de l’últim ítem d’una llista deixava la sessió de dedicació oberta i no generava la recurrència següent. | La cascada utilitza el servei de completat, inclosos temps, atenció, recurrència i política de reserva. |
| A08 | Mitjana | Repetir el completat explícit podia tornar a segellar una tasca feta i generar una altra recurrència. | Completar una tasca ja feta és una operació sense canvi. |
| A09 | Mitjana | Un error temporal de refresc, inclosos 429 i 5xx, eliminava les credencials a la web i a Android. | Només el rebuig 401 del refresc invalida la sessió; els altres errors conserven les credencials. |
| A10 | Alta | Una resposta tardana del refresc web podia reemplaçar o eliminar la sessió d’un altre compte. | Una generació de sessió invalida les respostes antigues i impedeix reintentar amb un altre compte. |
| A11 | Mitjana | Una resposta d’error JSON sense `type` provocava un `TypeError` i amagava l’error HTTP original. | El client conserva el codi HTTP i utilitza un text de reserva quan manca el format de problema. |
| A12 | Alta | Android retirava operacions rebutjades, en conflicte o sense una confirmació vàlida; després podia sobreescriure les dades locals amb la lectura del servidor. | Només es retira una operació amb `ok` i l’`op_id` corresponent. La resta es conserva i interromp el buidatge i el refresc. |
| A13 | Mitjana | La serialització manual dels títols Android no escapava tots els caràcters de control. | S’utilitza el serialitzador JSON existent; la prova inclou tabulador, retorn, salt de línia, cometes i barra inversa. |
| A14 | Mitjana | Un enllaç al calendari d’un altre mes mostrava el mes actual a la graella i el dia demanat a la bústia. | La graella i la selecció parteixen de la mateixa data validada i responen als canvis de l’adreça i a tornar enrere. |

### Accés a dades i jerarquia

El problema A01 era al camí d’idempotència. La creació ordinària comprovava permisos, però el retorn anticipat d’una fila existent no comprovava els permisos d’aquella fila. La reproducció crea una tasca privada d’una segona persona i intenta recuperar-la indicant un àmbit accessible: abans rebia un 200 amb la tasca privada; ara rep un 403 sense el seu contingut.[^2]

A02 tenia la mateixa família de causa aplicada a subtasques. A03 afectava l’escriptura: una clau forana existent no garanteix que la subtasca pertanyi a la tasca de la llista. La correcció valida aquesta relació abans d’inserir, de manera que marcar posteriorment un ítem no completi una subtasca d’una altra tasca.[^3]

A04 demostra per què una preferència personal no concedeix accés permanent. Pinejar una llista no ha de permetre seguir-la llegint després de perdre la pertinença. També es verifica un token amb `checklists:read` i sense `scopes:read`: restringir correctament les pinejades no ha d’introduir una capacitat addicional per poder llegir-les.[^4]

### Sincronització i completat

El registre del canvi de l’entitat mare no substitueix el de les filles. En A05 i A06 el servidor acabava en un estat correcte, però el delta no comunicava totes les modificacions. Les noves proves obtenen un cursor, executen l’acció i inspeccionen el delta posterior. La correcció registra les files realment afectades, dins de la mateixa transacció.[^5]

A07 era una duplicació incompleta del significat de «completar». El servei de llistes escrivia directament l’estat de la tasca. Ara delega al servei de tasques amb el permís de cascada corresponent, conservant el verb `cascade_complete`. La comprovació verifica que el bloc temporal es tanqui i que existeixi exactament una recurrència, fins i tot després d’un altre completat explícit.[^6]

A12 es comprova executant el repositori Android amb la cua i el transport controlats. Una resposta HTTP correcta no implica que cada operació del lot s’hagi acceptat. Es proven respostes malformades, resultats buits, un `op_id` diferent, rebuig i conflicte. Les operacions sense confirmar romanen a la cua i les dependents no s’envien. Un pany serialitza les crides de buidatge; la cancel·lació de la corrutina es propaga.[^7]

Aquesta correcció prioritza conservar la intenció local. **No afegeix una pantalla de resolució de conflictes Android**: un conflicte o rebuig persistent continua requerint resolució, i mentre sigui pendent el refresc s’interromp. La conservació de dades i la resolució interactiva són garanties diferents.

### Sessió i navegador

A09 separa indisponibilitat del servidor i invalidació de credencials. Les proves injecten 429, 500, 502, 503 i 504 al refresc i comproven que es conservin els tokens. També es comprova que un 401 real de refresc sí que finalitzi la sessió web. A10 introdueix respostes ajornades i canvia de compte mentre el refresc és pendent.[^8]

La prova de navegador exerceix el flux d’afegida ràpida: la petició de creació rep un 401 i el refresc rep un 503. El tauler continua visible, el text torna al camp i les credencials es mantenen. En retirar la fallada simulada i reintentar, la tasca apareix. La captura revisada mostra aquest estat de recuperació.[^9]

A14 es va detectar amb una prova existent que navegava a agost mentre la màquina era al setembre. La bústia seguia la data de l’enllaç; el cursor de la graella començava amb `new Date()`. La correcció també comprova dates de calendari vàlides, i la prova nova exerceix un canvi de l’adreça sense remuntar la pantalla i el retorn amb l’historial del navegador.[^10]

## Verificació

| Comprovació | Resultat |
| --- | --- |
| Suite inicial Vitest | 1.155 correctes, 5 omeses, 78 fitxers |
| Suite final Vitest | 1.175 correctes, 5 omeses, 78 fitxers |
| Kotlin `core-model` | 102 correctes |
| Kotlin `core-data` | 10 correctes |
| Chromium, fluxos seleccionats | 22 correctes |
| Construcció web i servidor | Correcta en còpia neta; el navegador utilitza les construccions de producció |
| APK de depuració | `assembleDebug` correcte |
| Comprovacions permanents | 18 correctes en còpia neta |
| Tipus, ESLint i format | Correctes en còpia neta |

Els fluxos de navegador cobreixen creació i comprovació de llistes, cascada, recurrència, pinejat, esborrat amb cancel·lació i confirmació, columna Fet, tasques al calendari, navegació de dates, recuperació de sessió, actualització d’ajustos i compartició d’àmbits.

També s’ha corregit el format preexistent de `settings-refresh.spec.ts`. A `calendar-tasks.spec.ts`, les proves posteriors entren amb el compte ja creat en lloc de tornar-lo a registrar. Són ajustos del banc de proves; no canvien el comportament de registre del producte.

La verificació ha necessitat una còpia neta perquè l’arbre original conté fitxers generats i carpetes de compilació propietat de `root`, i `.codegraph` apunta a una ubicació inaccessible. Les incidències observades inclouen l’escriptura dels tipus generats, la carpeta temporal de Vite, els resultats de Playwright i directoris de KSP. La còpia utilitza els mateixos canvis de font i les dependències instal·lades. Els impediments de permisos de l’arbre original no es presenten com a errors del codi corregit.

Els registres de reproducció i verificació es conserven a `/tmp/femho-audit-20260909/`. Les proves de regressió queden al repositori i permeten repetir els casos sense dades personals.

## Límits i treball pendent

No s’ha pogut arrencar l’APK a l’emulador: la comprovació d’acceleració informa que l’usuari no té permís per utilitzar `/dev/kvm`, i no hi havia cap dispositiu Android connectat. La compilació i les proves de Kotlin no substitueixen una prova visual de l’app nativa. Tampoc s’han comprovat l’APK de publicació amb R8, PostgreSQL, clients CalDAV externs, UnifiedPush, IMAP real ni imatges Docker multi-arquitectura.

La cua sense connexió de la web continua sense estar integrada als fluxos ordinaris. És una limitació ja documentada del producte, no una funcionalitat implementada per aquesta auditoria. Les proves de sessió demostren conservació del text i reintent, però no garanteixen creació offline persistent a la web.[^11]

Les correccions no recuperen operacions Android que versions anteriors ja haguessin eliminat de la cua. Tampoc reconstrueixen retrospectivament les sessions de dedicació que una cascada antiga hagués deixat obertes, ni reescriuen l’historial de canvis anterior. Cal revisar aquestes dades sobre una còpia si es vol investigar afectació històrica.

No s’han publicat commits, fet push, fusionat branques ni desplegat cap servei. Cal provar l’arrencada nativa i revisar els conflictes persistents abans de considerar aquesta revisió una validació integral de publicació.

## Fonts

Les fonts són l’especificació i el codi locals de Fem-ho, consultats i verificats el 9 de setembre de 2026. No s’han utilitzat estimacions externes per substituir el comportament observat.

[^1]: Fem-ho, [instruccions.md](../instruccions.md), regles 4, 6, 8 i 9; [decisions](14-decisions.md), D4 i P1.
[^2]: Fem-ho, [servei de tasques](../apps/server/src/services/tasks.ts), `createTask`; [regressions HTTP](../apps/server/src/http/checklists.test.ts), cas d’identificador de tasca d’un altre àmbit.
[^3]: Fem-ho, [servei de subtasques](../apps/server/src/services/subtasks.ts), `createSubtask`; [servei de llistes](../apps/server/src/services/checklists.ts), `createChecklist`.
[^4]: Fem-ho, [servei de llistes](../apps/server/src/services/checklists.ts), `listPinnedChecklists`; [política de visibilitat](../apps/server/src/policy/scope-visibility.ts).
[^5]: Fem-ho, [servei de subtasques](../apps/server/src/services/subtasks.ts), `deleteSubtask`; [servei de tasques](../apps/server/src/services/tasks.ts), `completeSubtasks`; [regressions HTTP](../apps/server/src/http/checklists.test.ts).
[^6]: Fem-ho, [servei de llistes](../apps/server/src/services/checklists.ts), `applyCascade`; [servei de tasques](../apps/server/src/services/tasks.ts), `completeTask`; [decisions](14-decisions.md), P14 i P27.
[^7]: Fem-ho, [repositori Android](../apps/android/core-data/src/main/kotlin/ho/fem/data/Repository.kt); [proves de sincronització Android](../apps/android/core-data/src/test/kotlin/ho/fem/data/RepositorySyncTest.kt); [lectura de resultats del lot](../apps/android/core-data/src/test/kotlin/ho/fem/data/BatchStatusTest.kt).
[^8]: Fem-ho, [client HTTP web](../apps/web/src/app/api.ts) i [proves](../apps/web/src/app/api.test.ts); [client HTTP Android](../apps/android/core-network/src/main/kotlin/ho/fem/network/FemhoApi.kt) i [prova de sessió](../apps/android/core-data/src/test/kotlin/ho/fem/data/ApiSessionTest.kt).
[^9]: Fem-ho, [prova de recuperació de sessió al navegador](../apps/web/e2e/session-recovery.spec.ts).
[^10]: Fem-ho, [pantalla de calendari](../apps/web/src/screens/CalendarScreen.tsx) i [proves de tasques al calendari](../apps/web/e2e/calendar-tasks.spec.ts).
[^11]: Fem-ho, [estat del producte](ESTAT.md), apartat Web; [decisions](14-decisions.md), P21.
