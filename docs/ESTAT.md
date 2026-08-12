# Estat del producte

Què hi ha, què s'ha verificat i **què encara no hi és**. Es manté al dia amb el codi:
una llista d'estat que exagera és pitjor que no tenir-ne cap.

Data de l'última verificació completa: **2026-08-12**.

---

## Com es verifica

```bash
npm run build            # contracts → server → web, en ordre de dependència
npm run typecheck        # 0 errors
npm run lint             # 0 errors
npm test                 # unitàries, SQLite
npm run test:postgres    # unitàries, Postgres (cal FEMHO_TEST_POSTGRES_URL)
npm run check            # les 17 comprovacions permanents
npm run e2e              # navegador, contra un servidor real
npm run test:android     # Kotlin pur, sense emulador
npm run android:build    # APK de depuració
npm run test:fresh-install   # docker compose des d'un volum buit
npm run test:proxy-matrix    # CalDAV i SSE darrere de nginx i Caddy
```

| Comprovació | Resultat |
| --- | --- |
| Construcció des de zero | contracts → server → web |
| Tipus · estil | 0 · 0 |
| Proves unitàries · SQLite | 661 |
| Proves unitàries · Postgres | 682 |
| Comprovacions permanents | 12 de 12 |
| Proves de navegador | 97, de les quals 45 contra el servidor real |
| Proves de Kotlin | 44 |
| APK de depuració | es construeix |
| Primer arrencament amb Compose | 13 comprovacions |
| Matriu de proxies | 24 comprovacions, nginx i Caddy |
| Referències CalDAV | 6, contra Radicale i Xandikos |
| Restauració de còpia | 501 files, `integrity_check = ok` |

---

## El disseny validat

El projecte s'ha ajustat al disseny validat (importat del llenç el 2026-08-06, i
reimportat el mateix dia perquè n'havia sortit una versió nova). El que en va sortir:

| Canvi | On |
| --- | --- |
| Afegida ràpida **al peu de cada columna**, amb el botó rodó d'edició completa | web i Android |
| El commutador del **tauler de la IA** a la barra, amb el gir | web i Android |
| Subtasques i llistes **a la targeta**, sota "▸ Llistes (2)", amb formulari per afegir-n'hi | web i Android |
| Botó d'edició completa al tauler general | web |
| Persones **només a la bústia d'un àmbit col·lectiu** | web |
| Les tasques d'altres, darrere el commutador de l'epígraf i atenuades | web |
| El tauler omple la pantalla i cada columna es desplaça per dins | web |
| Per sota de 860px, columnes desplaçables al 78% amb ajust (`docs/02` §10) | web |
| **Accions a la cantonada de la targeta**: llapis d'editar i afegir subtasca/llista | web i Android |
| A la web surten **en passar-hi per sobre** i amb el focus del teclat; al mòbil, sempre | web i Android |
| Afegir amb **un sol camp**: `#Llista element`, o sense sigil una subtasca | web i Android |
| Les subtasques van **nues**; les llistes amb nom, en caixa amb xinxeta | web i Android |
| L'entrada de 200ms en desplegar (`femho-list-in`) | web |
| **Barra de moure de 28px a la dreta**: fletxa a les dues primeres columnes, casella a les dues últimes | web i Android |
| Fora el cercle d'estat de dalt a l'esquerra i els botons "→ Per fer" / "→ Fent" | web i Android |

`docs/02` §4 descrivia la targeta antiga —cercle a l'esquerra, dos botons de destinació—
i **s'ha actualitzat**: un document que descriu una pantalla que ja no existeix és pitjor
que no tenir-ne cap.

**On no s'ha seguit el disseny, i per què:**

- **La pastilla `3/7`.** El disseny la treu i deixa només el commutador de llistes;
  `docs/02` §4 la demana explícitament ("una pastilla amb `3/7`"), i és l'únic que diu
  quant en falta amb la targeta plegada. Hi són les dues: la pastilla informa, el
  commutador desplega.
- **El camp de persones en crear una tasca.** El disseny l'ensenya; aquí l'assignació és
  una crida a part sobre una tasca que ja existeix, o sigui que surt en obrir-la. Abans
  d'aquest canvi, en crear, escrivia a `/tasks/undefined/assignees`.
- **La tercera icona de la targeta: "Pinejar la tasca".** Al disseny pineja el bloc de
  subtasques, que allà és una llista sense nom. Aquí les subtasques **no són una llista**:
  són una taula pròpia, i `pinned_by` viu a `checklists` (P1). Fer-ho voldria dir decidir
  què vol dir pinejar una cosa que no és una llista, i això és producte, no disseny. Les
  altres dues icones —llapis i afegir— sí que hi són.
- **La pantalla "Vista general" i els dos interruptors d'Ajustos.** La versió nova del
  disseny els treu. `docs/02` §8 descriu el tauler general amb nom i cognoms i el brief
  el demana a la línia 38, i els interruptors són els que la mateixa secció fa servir per
  amagar les endarrerides. Esborrar una pantalla documentada perquè una iteració del
  llenç no la porta seria perdre una funcionalitat sense que ningú ho hagi decidit.

---

## Servidor

Complet respecte de `docs/05` §4: **106 rutes**. Autenticació amb refresc rotatiu,
capa de política única, `activity_log` dins de la mateixa transacció que el canvi,
sincronització amb cursor, CalDAV en port propi, MCP amb 16 tools, compartits,
notificacions i administració.

Els dos motors es proven: la suite `dual-engine` recorre els camins d'escriptura a
SQLite **i** a Postgres, i `concurrency` hi busca curses.

---

## Web

Les dotze seccions de `docs/02`:

| Secció | Estat |
| --- | --- |
| §1 Estructura general | fet |
| §2 Login | fet |
| §3 Barra superior | fet, les vuit peces |
| §4 Kanban | fet, amb arrossegament de ratolí i de teclat; **la columna Fet no ensenyava res** fins que `move` va segellar `completed_at` (P14) |
| §5 Calendari | fet: mes, setmana, dia i rail configurable; les URL de CalDAV ja tenen el botó de copiar. **No ensenyava cap tasca** fins a P18 |
| §6 Vista de llista senzilla | fet |
| §7 Modal d'edició completa | fet menys el commutador de context per a la IA; **les etiquetes eren un epígraf buit** fins a P15, i l'estat no s'hi podia canviar |
| §8 Tauler general | fet; el mini calendari no tenia els punts que `docs/02` §8 demana (P18) |
| §9 Ajustos | fet, les vuit pestanyes |
| §10 Responsive | fet; el kanban del mòbil es va **arreglar** en ajustar-se al disseny, i a P19 la pàgina va deixar de moure's de costat i Ajustos va passar a ser usable al telèfon |
| §11 Dreceres de teclat | fet, amb la paleta d'ordres |
| §12 Estats buits, càrrega i error | fet |

### Els adjunts (§7), que abans hi faltaven

Van quedar fora molt de temps perquè `docs/12` no deia on es guarden els fitxers, i
inventar-ho voldria dir triar per l'operador coses que després no es desfan sense migrar
dades. Amb els àmbits compartits ja no eren ajornables —el receptor ha de veure els
adjunts dels esdeveniments compartits— i es va decidir així:

- **Al volum**, a `<FEMHO_DATA_DIR>/attachments/<aaaa>/<mm>/<uuid>`, sense extensió al
  disc i amb `storage_path` **relatiu**. Una còpia del volum segueix sent una còpia de
  seguretat completa, que és el que `docs/12` §3 promet.
- **`FEMHO_MAX_UPLOAD_MB`**, 25 per defecte, comprovat a la capa d'HTTP i al servei.
- **El tipus surt del contingut** i no de l'extensió, i mai és `text/html`.
- **Els `ATTACH` d'un calendari subscrit** entren: els que porten bytes en base64 es
  desen; els que són una URI **no es baixen mai**, només se'n guarda l'enllaç.

### Els projectes i les pinejades, per superfície

| | Web | Android |
| --- | --- | --- |
| Crear projectes a Ajustos, per àmbit | sí | no |
| Filtre de projectes de l'àmbit | sí, al xip | sí, en una fila plegable sota els xips |
| `#Àmbit/Projecte` a l'afegida ràpida | sí | sí (parser compartit) |
| Menú de llistes pinejades amb progrés | sí | sí |

**La forma canvia i el criteri no.** A la web el botonet va enganxat al xip; a Android els
xips emboliquen i fan scroll horitzontal, i un desplegable per sobre d'aquella fila
quedaria tallat. Per això allà és una fila plegable a sota, amb un epígraf per àmbit. El
que és igual a les dues: **un àmbit sense res triat vol dir tots els seus**, i una tasca
sense projecte d'un àmbit amb tria no es veu.

El que **no** s'ha pogut comprovar engegat: després del reinici del 10 d'agost de 2026,
l'usuari d'aquesta màquina ha perdut l'accés a `/dev/kvm` i l'emulador no arrenca. Hi ha
compilació i proves de Kotlin, però ningú ha vist aquestes dues pantalles funcionant.

### El que dels adjunts encara NO hi és

El servidor els té sencers —pujar, baixar, el tall dels calendaris compartits, el sync i
els `ATTACH` de l'iCal— i la interfície només en cobreix una part:

- **El commutador de context per a la IA.** `docs/02` §7 el demana amb aquestes paraules,
  i la columna (`attachments.is_ai_context`) i el paràmetre de l'API hi són des del primer
  dia. El que falta és la casella.
- **Els adjunts d'un esdeveniment, a la web.** El component ja accepta `parent="events"` i
  no el crida ningú: **no hi ha cap vista de detall d'un esdeveniment**. Al calendari es
  poden veure, i clicar-ne un no obre res. Fins que hi hagi aquella pantalla, la promesa
  que el receptor d'un àmbit compartit veu els adjunts dels esdeveniments **només es
  compleix per l'API**.
- **Android**: no en té res.
- **El MCP** no els dona com a enllaços a recurs, que és el que `docs/09` §5 descriu.

La repetició, la data límit i el canvi de projecte **també hi són**.

### Sobre el constructor de repetició

Quatre opcions —cada dia, setmana, mes i any— més el commutador de "comptar des que es
completa". No hi ha editor de regles arbitràries: `BYDAY`, `BYSETPOS` i `WKST` són molta
pantalla per a un cas que gairebé ningú té. Una regla més complicada que arribi per
CalDAV **es conserva i s'ensenya tal com és**; sobreescriure-la seria perdre el que algú
va escriure en una altra app.

---

## Android

Els vuit mòduls de `docs/03` §11 existeixen i l'APK es construeix.

| Peça | Estat |
| --- | --- |
| Login amb camp de servidor, validat amb `GET /info` | fet |
| `https://` primer, `http://` amb avís i restringit a xarxa privada | fet |
| Tokens de Plou exportats a Compose | fet, generats i comprovats |
| Català des del mateix catàleg que la web | fet, generat i comprovat |
| Paritat de l'índex fraccional i del parser | fet, mateixos fixtures |
| Regles de la cua de sortida | fet, en Kotlin pur i provades |
| Tauler en pager horitzontal al 80% | fet |
| Calendari mensual i diari | fet |
| Ajustos amb tema i accent | fet |
| Base local amb Room i cua de sortida | fet |
| Detall de tasca, com a full des de baix | fet |
| Afegida ràpida amb xips reversibles | fet, amb el parser compartit |
| UnifiedPush, amb consulta periòdica com a alternativa | fet, **sense provar amb un distribuïdor real** |
| Vista setmanal | fet |
| Subtasques i llistes a la targeta | fet, amb el formulari d'afegir |
| Tauler de la IA | fet, amb el commutador a la barra |

El detall té menys camps que el modal de la web, i és deliberat (`docs/03` §6): al mòbil
s'edita el que es toca sovint —títol, estat, mode d'IA i les llistes— i la resta es fa
des de la web. Un formulari de disset camps en una pantalla de 5,5 polzades no s'omple;
s'abandona.

---

## El que necessita un dispositiu o una persona

No es pot verificar en aquesta màquina i **no s'ha verificat**:

- `androidTest: airplane-mode-reconciliation` — cal un emulador o un telèfon.
- **UnifiedPush amb un distribuïdor real** (ntfy, Sunup). El codi hi és i compila, però
  no s'ha vist arribar cap notificació: cal un telèfon amb un distribuïdor instal·lat.
  La consulta periòdica, que és el que tindrà la majoria de gent, sí que és independent
  del distribuïdor.
- La comparació de captures entre la web mòbil i l'app — el mateix.
- **L'app d'Android en execució.** Compila, empaqueta i les proves de Kotlin passen, però
  aquí no hi ha ni emulador ni telèfon: el que s'ha vist funcionar de veritat és la web.

  **La bústia amb fonts d'Android entra sencera en aquest sac.** `InboxRail`, el botó de
  fer-ne una tasca i el de treure-la de la bústia compilen, passen R8 i tenen proves de
  model —la deserialització, els valors per defecte contra un servidor vell i la clau per
  identitat externa—, **però no s'han vist a la pantalla**. El que sí que es va poder
  verificar llegint el codi és el defecte que hi havia: `LaunchedEffect(selected.month,
  selected.year)` no reaccionava a canviar de dia dins del mes, o sigui que la bústia que
  es carregava era la del dia en què s'havia obert el mes. Ningú ho havia vist perquè el
  resultat no es pintava enlloc.

  El bloqueig és concret i té solució coneguda: aquesta màquina no té accés a `/dev/kvm`
  des de la reengegada del 10 d'agost del 2026. `sudo usermod -aG kvm $USER` i tornar a
  entrar el desbloqueja.
- Les proves amb clients CalDAV reals: DAVx⁵, Apple Recordatoris, Thunderbird,
  Evolution, Nextcloud Tasks. Veure [`CALDAV-CLIENTS.md`](CALDAV-CLIENTS.md).
- La preservació de les propietats `X-FEMHO-*` en servidors de tercers. `docs/07` §7
  ja diu que és una suposició.

## Fonts de dades del calendari

Un àmbit pot tenir fonts externes de tres menes, que s'afegeixen a **Ajustos ▸
Calendaris** i es veuen al calendari:

| Mena | Què és | Escriptura |
| --- | --- | --- |
| `caldav` | Una col·lecció CalDAV | Pendent, veure sota |
| `ical` | Un `.ics` publicat | Només lectura |
| `rss` | Un canal RSS o Atom | Només lectura |

De l'RSS, **cada element és un instant i no una durada**: un titular publicat a les 14:32
no dura res, i donar-li mitja hora perquè es vegi millor seria inventar-se una dada. Els
elements sense data llegible no arriben al calendari.

A la vista de calendari, cada font es pot apagar i encendre. **S'amaga, no s'esborra**: la
font és de l'àmbit i la comparteix tothom qui hi és. Es guarda el que s'amaga i no el que
es veu, perquè una font nova ha de sortir sola.

L'estat de l'últim refresc surt a Ajustos amb el motiu si va fallar: una font caiguda es
veu exactament igual que una que no té esdeveniments, i sense dir-ho ningú se n'assabenta.

### El que falta: l'escriptura cap a l'origen

`calendars.writable` existeix i el servei ja hi confia —una font marcada com a
bidireccional deixa d'estar bloquejada a la capa de repositori— **però l'empenta cap a
l'origen no està feta**: `docs/07` §9 la descriu (PUT amb `If-Match`, comparació d'etag,
etiquetatge `source='caldav'` per no rebotar), i el lloc correcte és una feina del
planificador i no una crida de xarxa dins d'una transacció.

Per això **el commutador no surt a la interfície**. Oferir-lo ara voldria dir deixar
editar una cosa que no arribaria mai a l'altre costat, i una edició que es perd en
silenci és pitjor que una que no es deixa fer.

---

## El correu com a font d'entrada

Cada persona pot donar d'alta comptes IMAP a **Ajustos ▸ Correu** i mapar carpetes cap a un
àmbit i un projecte. **Un compte és d'una persona i no de la casa**: ningú més el veu, ni
l'administrador, i demanar-lo per identificador dona el mateix que si no existís.

| Què | Estat |
| --- | --- |
| Comptes i regles, amb les carpetes triables de la llista del servidor | Fet, provat amb la pantalla oberta |
| «Prova la connexió», que no desa res | Fet |
| Lectura periòdica amb cursor i retirada exponencial | Fet, provat contra un client fals injectat |
| Bústia i calendari, amb la icona de provinença | Fet |
| Conversió a tasca, amb plantilla de títol i cos a la descripció | Fet, **sempre la demana una persona** |
| Adjunts del correu com a adjunts de la tasca | Fet |
| Resposta a un fil que ja té tasca → comentari | Fet |
| Retenció del cos dels correus ingerits | Fet, `0` (per sempre) per defecte |
| **Contra un servidor IMAP de veritat** | **NO provat encara** |

**Aquesta última línia és la que compta.** Tot el que hi ha a sobre passa contra un
`MailClient` fals i contra la base de dades real, i això prova el cicle i les decisions —no
prova que `imapflow` parli bé amb un Dovecot o amb Gmail. En aquest projecte ja sabem què
vol dir «compila».

### Què es veu i on

**Tot el que arriba d'una font va a la bústia**, i l'única pregunta és si es veu:

| | Pestanya Tasques | Pestanya Calendari |
| --- | --- | --- |
| Visible | Sí, a la columna Inbox | Sí |
| No visible | No | **Sí, difuminat**, amb el botó per pujar-lo |

Val igual per a un correu, una cita d'un CalDAV, un `.ics` i un titular d'RSS. **Res es
converteix en tasca sol**: el que arriba és un element que pots convertir, i qui ho decideix
ets tu. Els defectes per mena:

| | Entra a l'inbox de Tasques |
| --- | --- |
| Calendari d'aquesta casa | Sí |
| CalDAV i `.ics` subscrits | Sí |
| RSS | No |
| Correu | No |

I es pot dir el contrari **per font** —a Ajustos— o **per ítem** —des del calendari—, en
tots dos sentits i sempre reversible.

Al costat de cada targeta hi ha **un ull**: obert vol dir que això surt a l'inbox de
Tasques, tatxat que no. És el mateix control per a les quatre menes, i el mateix a la
bústia i al calendari.

Tres coses que val la pena saber abans de fer-lo servir:

- **La primera lectura d'una carpeta no ingereix res.** El cursor comença al final: mapar
  una etiqueta amb dotze anys de correu crearia desenes de milers de tasques i no hi ha
  desfer massiu. La importació d'històric no existeix.
- **Res marca els teus correus com a llegits.** Les carpetes s'obren amb `EXAMINE`, que en
  IMAP vol dir que el servidor **no pot** posar `\Seen`.
- **Una carpeta sense regla no es llegeix**: ni es baixa ni es desa res.

### El terreny d'IA, que no és la funció

`docs/09` diu que Fem-ho **no té motor d'IA propi**, i segueix sent literalment cert: **cap
camí de codi truca a cap model**. El que existeix és el terreny —les variables `FEMHO_AI_*`
validades entre elles, i `GET /api/v1/ai/status`—, i la frase que dona la pantalla és la
honesta: *configurada vol dir que hi ha credencials, no que res les faci servir encara*.

Amb el proveïdor posat i el model o la clau a faltar, **el servidor no arrenca**: una
instància que sembla preparada i no ho està no dona cap símptoma fins al dia que algú
espera que funcioni.

---

## Idiomes

Català, anglès i castellà. **Automàtic amb opció de canviar**: el navegador o el
dispositiu decideixen la primera vegada, i a partir d'aquí mana `users.locale` del
perfil, que es canvia a Ajustos ▸ General ▸ Idioma i val per a tots els dispositius.

Els tres catàlegs són a `packages/contracts/i18n/{ca,en,es}.json`. **`ca.json` és la font
de veritat de les claus**: cap altre fitxer en pot tenir de noves, i `i18n-parity` ho fa
complir. Una traducció que falti cau al català —que es llegeix—; una clau que falti a tot
arreu s'ensenya crua, que és un error de programa i s'ha de veure.

Afegir un quart idioma és: un fitxer a `i18n/`, una entrada a `LOCALES`
(`packages/contracts/src/i18n.ts`), una a `locales_config.xml` i una al selector
d'Ajustos. Res més: el `strings.xml` d'Android i les comprovacions surten dels fitxers
que hi ha.

**Tres comprovacions noves** en fan de xarxa:

| Comprovació | Què impedeix |
| --- | --- |
| `i18n-parity` | Una clau o un marcador `{x}` que falti en un idioma. Cap de les dues falla avui: la primera fa sortir una frase en un altre idioma, la segona fa desaparèixer un número |
| `i18n-keys-exist` | Una errata a `t('...')`, que compila i passa tots els altres linters |
| `i18n-lint` | Ampliada amb `ñ`, `¿` i `¡`: sense, el castellà escrit a mà tornaria a colar-se fora del catàleg |

### Dates i hores

Segueixen l'idioma. Els noms dels mesos i dels dies **ja no són al catàleg**: els dona
CLDR, per `Intl` a la web i `java.time` a Android, que porten la mateixa base. Eren dues
claus amb els dotze mesos separats per comes i indexats per posició — es trencaven amb
qualsevol llengua que porti una coma dins d'un nom de mes, i ningú en validava la
llargada.

| | ca | es | en |
| --- | --- | --- | --- |
| Comença la setmana | dilluns | dilluns | diumenge |
| Hora | 24 h | 24 h | 12 h |
| Un dia sencer | 6 d'agost | 6 de agosto | August 6 |

El dia sencer era la plantilla `"{day} de {month}"`, que no podia expressar ni l'elisió
catalana ni l'ordre anglès. `Intl` les resol i, de propina, hi posa l'apòstrof tipogràfic
bo.

**El primer dia de la setmana es pot canviar a mà**, a Ajustos ▸ General sota l'idioma:
no és només una convenció lingüística, i qui treballa el cap de setmana el vol d'una
manera i qui no, d'una altra, amb la mateixa llengua. La taula per idioma viu a
`packages/contracts/src/dates.ts` i **està escrita, no derivada d'`Intl.Locale#weekInfo`**:
Firefox no la porta, i el valor ha de ser idèntic a les dues apps. El port de Kotlin fixa
la mateixa taula amb els mateixos casos.

### Els errors

**Qui llegeix un error no és qui el pateix.** El reben tres públics molt diferents: una
persona davant de l'app, un agent per MCP, i un client CalDAV com DAVx⁵ o Thunderbird.
Els dos últims no tenen ni catàleg ni idioma. Per això l'error viatja en dues peces:

- `type`, `title` i `detail` **en anglès**, estables, per programar-hi.
- `params`, les **dades**. Les apps hi posen el text del seu catàleg amb `error.<slug>`.

**Si l'app no té la clau, ensenya el `detail`.** És el que permet desplegar el servidor
abans que les apps sense que ningú es quedi mirant un forat: es veu el text anglès, que
és lleig però es llegeix.

Són 53 tipus d'error, tots amb clau als tres idiomes. `notFound()` rebia la paraula ja
traduïda i barrejada —`notFound('tasca')` tretze cops i `notFound('task')` sis— i ara rep
el nom canònic en anglès.

### Les notificacions i les dades sembrades

Una notificació push **la pinta el sistema operatiu**: quan arriba al telèfon ja és text i
el client no la pot traduir després. Per això el planificador llegeix `users.locale` del
destinatari i el text surt del catàleg compartit. És l'única cosa per la qual el servidor
importa `@fem-ho/contracts`, i és justificada.

Els tres àmbits inicials es creen **en l'idioma de qui crea el compte**: trobar-se "Feina"
i "Família" en obrir una app que has demanat en anglès és la primera cosa que veus, i diu
que el producte no és teu.

### Les superfícies de màquina, a l'anglès

Els llegeixen agents d'MCP, DAVx⁵, Thunderbird i qui programi contra l'API — cap d'ells té
catàleg ni idioma:

- Les 16 tools d'MCP: títols, descripcions i tots els `.describe()`. Traduir-les per
  idioma d'usuari no tindria on mirar-se —un token no és una persona— i faria que el
  mateix servidor descrivís les seves eines diferent segons qui preguntés.
- Els ~20 missatges `text/plain` del camí DAV.
- El `PRODID` (`-//Fem-ho//CalDAV//EN`) i el sufix de la col·lecció de tasques.

Els errors d'arrencada i els que llança `assertCatalogue` es queden en català: els llegeix
qui manté la instància, no cap client.

### El que encara és en català

Res de cara a l'usuari. Queden els registres del servidor i els missatges d'arrencada, que
`i18n-lint` ja deixa fora de l'abast a posta.

### Els límits coneguts

- **Android per sota de 13** segueix l'idioma del dispositiu i ignora el del perfil:
  l'API d'idioma per app no existeix abans, i un embolcall de context per a un cas de
  vuit anys enrere seria molt codi per molt poca gent.
- **Els comptes que ja existeixen** es queden en català fins que algú els canviï a
  Ajustos. L'idioma del navegador només s'escriu **en crear el compte**, que és l'únic
  moment en què "automàtic" és inequívoc: després, `users.locale` ja porta una tria i
  endevinar-la seria sobreescriure-la.

---

## Decisions obertes

- **El deute de contrast heretat de Plou.** Blanc sobre el gradient de marca dona
  1,88–2,61:1 en tres dels quatre accents, i `docs/04` §8 en demana 4,5:1. `docs/04` §1
  diu que Plou no es reescriu, o sigui que està registrat a `contrast-baseline.json`
  per bloquejar violacions noves sense tocar les heretades. **És una decisió teva.**
- **El formulari de tasca nova a Android.** El disseny mòbil posa un botó rodó al costat
  de cada afegida ràpida que obre l'edició completa. A Android el detall de tasca només
  edita una que ja existeix, i el botó necessitaria un formulari de creació que ara no hi
  és; s'ha deixat fora en comptes de posar un botó que no porta enlloc.
- **La contrasenya dels enllaços compartits** té un mínim de 6 caràcters i no de 10 com
  els comptes, justificat pel bloqueig als 5 intents. Una línia a `services/shares.ts`
  si no hi estàs d'acord.
