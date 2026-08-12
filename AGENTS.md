# AGENTS.md — treballar a Fem-ho

> Guia operativa per a agents d'IA (Claude Code, OpenCode, Codex).
>
> **`instruccions.md` és el document mestre i mana per damunt d'aquest.** Aquí no hi ha
> especificació de producte: hi ha com es treballa en aquest repositori sense trencar-lo,
> i el que s'ha après trencant-lo.

---

## 1 · Llegeix això abans d'escriure cap línia

| Ordre | Document                        | Per què                                                           |
| ----- | ------------------------------- | ----------------------------------------------------------------- |
| 1     | `instruccions.md`               | Les **onze regles no negociables**. Valen més que cap preferència |
| 2     | `docs/ESTAT.md`                 | Què està fet, què està provat i **què no**. L'estat honest        |
| 3     | `docs/00-visio-i-glossari.md`   | El vocabulari. Un concepte, un nom                                |
| 4     | `docs/14-decisions.md`          | Debats ja tancats. No els reobris                                 |
| 5     | La resta de `docs/`, quan toqui | Model, API, sync, CalDAV, MCP, IA, notificacions, desplegament    |

`research/` és context, **no norma**. Les versions de dependència que diu són sospitoses
(regla 2). `instruccions.txt` és el brief original: història, no especificació, i no es
modifica mai (regla 1).

---

## 2 · On som

**Les catorze fites estan fetes.** Això no és un projecte per bastir: és un projecte en
manteniment i evolució. Si un document et diu "crea l'scaffold", el document va enrere.

- Servidor, web (PWA), Android, CalDAV, MCP, compartits, notificacions i empaquetat: fets.
- **Trilingüe** (català, anglès, castellà) des dels catàlegs de `packages/contracts/i18n/`.
- **AGPL-3.0-or-later**, repositori públic a `github.com/borborborja/fem-ho`.
- Imatge multi-arquitectura pública a `ghcr.io/borborborja/fem-ho:latest`.
- Widgets de pantalla d'inici d'Android: **en curs** (`docs/03` §9).

### On la documentació ha quedat enrere

Es diu aquí en comptes de deixar que t'hi trobis:

- `instruccions.md` §Idioma i regla 3 diuen «la interfície és **català**». Ja no: són tres
  idiomes, negociats del navegador o del dispositiu i sobreescrits pel perfil. El que
  segueix valent —i és el que la regla protegeix— és que **cap literal va al codi**.
- `AGENTS.md` deia vuit comprovacions permanents. Ara en són **tretze**.
- `docs/03` §11 llista vuit mòduls d'Android. N'hi ha nou: hi ha `:core-widget`.

---

## 3 · La doctrina de verificació

**Aquesta secció és la més important del document.** Cada defecte gros que s'ha trobat en
aquest projecte s'havia amagat darrere d'una comprovació que semblava que el cobria.

> **«Compila» no vol dir «arrenca». «Les proves passen» no vol dir «funciona».
> «Verd a CI» no vol dir «algú ho ha mirat».**

Casos reals, tots del mateix repositori:

| Es creia que…                                              | La realitat era                                                                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L'app d'Android funcionava; compilava i es publicava l'APK | **No arrencava des de M13.** El `namespace` era `ho.fem` i les classes viuen a `ho.fem.app`: cada component del manifest apuntava a una classe inexistent                                     |
| El tema fosc funcionava; `tokens-parity` deia verd         | **Pintava les superfícies clares.** El generador buscava `[data-theme='dark']` amb cometes simples i el CSS les escriu dobles. La comprovació comparava el generat contra el mateix generador |
| El mòdul `:core-data` era al repositori                    | **Mai s'hi ha pujat.** `.gitignore` deia `data/` sense ancorar i s'empassava `ho/fem/data/`                                                                                                   |
| L'APK de publicació es podia construir                     | **Mai s'havia intentat.** El fitxer de regles de R8 es referenciava i no existia                                                                                                              |
| CI passava                                                 | **No s'havia executat mai.** Quan ho va fer: format, ordre de feines i el mòdul que faltava                                                                                                   |

### Què val com a verificació

1. **Arrenca-ho.** L'emulador `femho_test` (API 34) està creat. Si no hi és:
   ```bash
   $ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n femho_test \
     -k "system-images;android-34;google_apis;x86_64" -d pixel_6
   $ANDROID_HOME/emulator/emulator -avd femho_test -no-window -no-audio -gpu swiftshader_indirect &
   ```
   `/dev/kvm` és accessible en aquesta màquina. Arrenca en ~95 s.
2. **Mira-ho.** `adb shell screencap` i llegeix la captura. Els defectes de contrast, de
   desbordament i de "s'ha quedat buit" **no** els veu cap prova.
3. **Amb dades reals.** El servidor de desenvolupament respon a `http://localhost:8080`
   i l'emulador hi arriba per `http://10.0.2.2:8080`.
4. **Consulta la base del dispositiu** quan una pantalla i una altra es contradiguin:
   ```bash
   adb shell "run-as ho.fem sqlite3 /data/data/ho.fem/databases/femho.db 'select …'"
   ```
5. **Prova el que es publica, no només el que es desenvolupa.** L'APK de `release` passa
   per R8 i no es comporta com el de `debug`. Es pot instal·lar sobre l'emulador signant-lo
   amb la clau de depuració:
   ```bash
   apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android \
     --key-pass pass:android --ks-key-alias androiddebugkey --out signat.apk sense-signar.apk
   ```
6. **Reprodueix l'estat original** abans de dir que una comprovació nova serveix. Una que
   diu "net" perquè mira on no toca és pitjor que no tenir-la.

---

## 4 · Les disset comprovacions permanents

`npm run check`. Cadascuna impedeix **una manera concreta de trencar el producte sense que
res falli**, i totes tenen `--self-test`.

|                           | Què impedeix                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `openapi-diff`            | Tocar un handler sense actualitzar el contracte                           |
| `vocab-lint`              | Que el vocabulari del prototip s'infiltri al codi (`column: 'fet'`)       |
| `no-hardcoded-colors`     | Un color literal, també als `.xml` de `apps/android`                      |
| `i18n-lint`               | Text escrit al codi en comptes del catàleg                                |
| `i18n-parity`             | Una clau o un marcador `{x}` que falti en un idioma                       |
| `i18n-keys-exist`         | Una errata a `t('...')`, que compila i s'ensenya crua                     |
| `android-strings-exist`   | Un `R.string` sense cadena: no és un text que falta, és un APK que no és  |
| `no-pinned-from-research` | Una versió sense procedència registrada                                   |
| `no-ignored-sources`      | Codi que `.gitignore` s'empassa i que qui cloni no tindrà                 |
| `contrast-check`          | Contrast per sota de l'AA als vuit temes                                  |
| `audit-coverage`          | Un camí d'escriptura sense rastre a l'historial (regla 4)                 |
| `parser-parity`           | Que el parser de la web i el d'Android divergeixin                        |
| `tokens-parity`           | Que els colors de Compose s'endarrereixin respecte del CSS                |
| `css-classes`             | Una classe que no existeix — sense estil i sense error                    |
| `env-documented`          | Una opció documentada que el codi no llegeix, o a l'inrevés               |
| `scope-predicate`         | Una segona còpia de «qui pertany a un àmbit», que divergiria              |
| `mail-invariants`         | Apagar la verificació TLS, marcar el correu d'algú, o desduplicar per UID |

**Si arregles un defecte que cap comprovació hauria vist, afegeix-ne una.** És el criteri
que ha fet créixer la llista de vuit a disset.

---

## 5 · Fitxers generats: una direcció i prou (D7)

Editar-los és inútil, es reescriuen. Tots porten la capçalera `GENERAT · no l'editis a mà`.

| Generat                                                            | Font                             | Ordre                        |
| ------------------------------------------------------------------ | -------------------------------- | ---------------------------- |
| `core-designsystem/.../Tokens.kt`                                  | CSS de Plou                      | `npm run android:tokens`     |
| `core-widget/src/main/res/values{,-night}/femho_widget_colors.xml` | CSS de Plou                      | el mateix                    |
| `app/src/main/res/values{,-en,-es}/strings.xml`                    | `packages/contracts/i18n/*.json` | `npm run i18n:android`       |
| `packages/contracts/src/generated/api.ts`                          | `openapi.yaml`                   | `npm run contracts:generate` |

Si toques un color o un text, **regenera i compromet el resultat**. `tokens-parity` i
`i18n-lint` t'aturaran si no ho fas.

---

## 6 · El que comparteixen la web i Android va a `packages/contracts`

L'índex fraccional, el parser d'afegida ràpida, els catàlegs i el primer dia de la
setmana. Cada peça té **fixtures compartides** i una prova als dos costats.

El motiu no és estètic: si cadascú ho calculés pel seu compte, divergirien un dia i **cap
de les dues donaria cap error**. El calendari sortiria desplaçat un dia i prou.

Excepció legítima, escrita al codi: `Dates.dayName` només existeix en Kotlin, perquè la
web no té widgets. Duplicar-la per simetria seria mantenir codi que ningú crida.

---

## 7 · Mapa del repositori

```
apps/server      Fastify (/api/v1) · node:http (CalDAV, port propi) · MCP · SSE · jobs
apps/web         React + Vite, PWA amb cua de sortida
apps/android     nou mòduls (§8)
packages/contracts       openapi.yaml, catàlegs, parser, índex fraccional, dates
packages/design-system   Plou vendoritzat + els components de Fem-ho
tools/checks     les disset comprovacions
tools/gen        generació de tokens a Compose i a recursos
tools/i18n       generació dels strings.xml
docs/            quinze documents normatius + ESTAT.md
```

### 8 · Els mòduls d'Android

```
:core-model         Kotlin PUR, sense Android. Parser, índex fraccional, dates.
                    Les seves proves corren a CI sense emulador ni llicències.
:core-network       OkHttp + TokenStore. No coneix la base de dades.
:core-data          Room, DataStore, cua de sortida. No coneix les pantalles.
:core-designsystem  tokens de Plou exportats a Compose
:core-widget        el design system de la pantalla d'inici. L'ÚNIC amb Glance.
:feature-tasks|calendar|settings   pantalles. No es coneixen entre elles.
:app                navegació, injecció, i ELS WIDGETS
```

**Cap mòdul de funcionalitat té text propi.** Les cadenes viuen a `:app` i baixen com a
paràmetres. Per això els widgets viuen a `:app` i no a `:core-widget`: necessiten
`R.string`.

---

## 9 · Ordres

```bash
npm ci
npm run build            # ABANS que typecheck: la web importa el dist de contracts
npm run typecheck
npm run lint && npm run format:check
npm test                 # unitàries; amb FEMHO_TEST_POSTGRES_URL, també Postgres
npm run test:postgres
npm run check            # les tretze
npx playwright test      # navegador, contra un servidor real
npm run test:android     # Kotlin pur, sense emulador
npm run android:build    # APK de depuració
cd apps/android && ./gradlew assembleRelease   # el que passa per R8
```

`ANDROID_HOME` s'assumeix a `~/Android/Sdk`. Toolchain: `mise` per a Node/Java, `uv` per a
Python.

---

## 10 · Paranys coneguts

Cadascun ha costat una sessió de trobar-lo. No els tornis a pagar.

### Repositori i CI

- **`.gitignore` sense ancorar.** `data/`, `build/`, `dist/` sense barra al davant
  coincideixen a **qualsevol profunditat**. Ancora a l'arrel el que sigui de l'arrel.
- **L'ordre a `ci.yaml`**: construir abans de comprovar tipus. `apps/web` importa
  `@fem-ho/contracts`, que es resol a un `dist` que el repositori no porta.
- **La imatge Docker es publica només des de `main`.** A les propostes es construeix i es
  comprova que arrenca, però no es puja. Els paquets de GHCR neixen privats.
- **El pas que comprova que la imatge arrenca només corre a les propostes**, o sigui que
  **la imatge publicada no s'ha arrencat mai**, i l'`arm64` tampoc: es construeix per
  emulació en un runner x86.

### Android

- **`namespace` ≠ paquet.** Els noms relatius del manifest (`.MainActivity`) es resolen
  contra el `namespace`, no contra el paquet del codi.
- **R no és transitiva** des d'AGP 8: els recursos d'una biblioteca es demanen a la seva
  `R`, no a la de l'app.
- **`EncryptedSharedPreferences` pot llançar abans del primer desbloqueig.** Embolica'n la
  lectura amb `runCatching` a tot el que corri en segon pla.
- **`Repository.refresh()` reemplaça la instantània sencera** filtrada pels àmbits actius.
  Res pot oferir un àmbit que no hi sigui: se li buidarà sol al següent refresc.
- **`provideGlance` corre al fil principal.** Room i DataStore, dins de `Dispatchers.IO`.

### Glance i widgets

- **No facis servir `GlanceTheme`.** El seu esquema són vint-i-set ranures de Material 3 i
  el seu valor per defecte és el color del fons de pantalla. Fem-ho té el seu sistema, i
  `contrast-check` garanteix els vuit temes de Plou, no una foto qualsevol.
- **`ColorProvider(day, night)`** deixa les dues variants dins del `RemoteViews`: el
  llançador canvia de tema **sense despertar el procés**. Resoldre-ho a `provideGlance`
  deixaria els colors vells fins al refresc següent.
- **Per sota d'API 31 no hi ha `cornerRadius`.** Les formes són `<shape>` drawables, i un
  drawable vol un `@color/…`: per això es generen els recursos de color.
- **Un widget no pot rebre text.** No hi ha camp d'entrada dins d'un `RemoteViews`.
  Qualsevol "afegida ràpida" és un llançador, no un formulari.
- **R8 retira el que només es referencia pel nom.** Els `GlanceAppWidget` i els
  `ActionCallback` volen `keep`. Sense això el widget es pinta i **tocar-lo no fa res, i
  només a `release`**.
- **El límit del Binder** (~1 MB) el comparteix tot el que el llançador rep. Cap `Bitmap`,
  sostres explícits d'ítems, i el que sigui de llargada variable a `LazyColumn`.

---

## 11 · Git, CI i coses que surten a fora

- **Mai `git push` a `main` ni res destructiu sense que t'ho demanin explícitament.**
  Treballa en branques i obre propostes.
- Fusionar a `main` **publica una imatge pública**. És una decisió de la persona, no teva.
- Commits: `tipus: descripció` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`), en
  català com la resta del projecte. El cos explica **per què**, i si arregla un defecte
  previ, digues des de quan hi era i per què no ho veia ningú.
- No llegeixis ni imprimeixis `.env` ni claus.

---

## 12 · Estil

- **Comentaris en català, i expliquen el _per què_, no el _què_.** El codi ja diu què fa.
  El comentari diu quina alternativa es va descartar i quin defecte evita. Mira
  `Repository.flush()` o `Database.replaceTasks()` com a referència de to i densitat.
- Imita el que hi ha al voltant: naming, densitat de comentaris, idioma.
- Canvis petits i revisables. Si una feina mecànica (formatar, renombrar) es barreja amb
  una de conceptual, van en commits separats.
- Codi, identificadors, camps, enums, taules i endpoints: **anglès** (regla 3).

---

## 13 · Què està provat i què no

`docs/ESTAT.md` mana. En resum, el que **no** es pot verificar en aquesta màquina:

- UnifiedPush amb un distribuïdor real.
- Clients CalDAV de veritat (DAVx⁵, Thunderbird, Evolution).
- L'`arm64` de la imatge Docker.
- Docker en local: aquest usuari no té permís al socket.

Si acabes una feina que toca res d'això, **digues què no has pogut comprovar** en comptes
de deixar-ho implícit. És el que separa "fet" de "compila".
