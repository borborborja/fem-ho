# Desplegament

Fem-ho és un sol contenidor amb un sol volum. Per a una casa, aquest és tot el
desplegament.

---

## Posar-lo en marxa

```sh
curl -O https://raw.githubusercontent.com/borborborja/fem-ho/main/compose.yaml
# Canvia FEMHO_BASE_URL pel teu domini
docker compose up -d
```

### Si munta un directori del disc en comptes d'un volum

El contenidor **no corre com a root** (docs/12 §1): l'usuari de dins és `node`, uid 1000.
Amb un volum de Docker això no es nota —Docker li dona la propietat—, però amb un
`bind mount` d'un directori del disc, el directori és de qui l'ha creat i el contenidor
no hi pot escriure. L'error és `SQLITE_CANTOPEN` i no diu res de permisos:

```bash
sudo chown -R 1000:1000 /el/teu/directori
```

Obre `https://el-teu-domini/setup`, crea el primer administrador, i ja està. Aquella
ruta **es tanca per sempre** un cop hi ha administrador: si perds l'accés, s'ha d'entrar
a la base de dades. Una porta que es pugui reobrir des d'internet no és una porta.

En crear l'administrador es creen els seus tres àmbits inicials —Personal, Feina i
Família— amb els colors de la tríada. **No són especials**: es poden reanomenar i
esborrar.

---

## Configuració

Tot amb el prefix `FEMHO_`. Els secrets accepten el sufix `_FILE` per llegir-los d'un
fitxer, que és el que permet fer servir secrets de Docker.

| Variable | Per defecte | Què fa |
| --- | --- | --- |
| `FEMHO_BASE_URL` | — | **Obligatòria en producció.** Sense això, CalDAV i els enllaços compartits generen URL incorrectes, i és la causa número u de problemes |
| `FEMHO_INSTANCE_NAME` | `Fem-ho` | El nom que veu qui s'hi connecta, i el que publica el manifest de federació a `/.well-known/femho` |
| `FEMHO_DATABASE_URL` | `sqlite:///data/femho.db` | SQLite o `postgres://…` |
| `FEMHO_DATA_DIR` | `/data` | On viuen la base, el secret, els adjunts i les còpies prèvies a cada migració |
| `FEMHO_PORT` | `8080` | L'aplicació |
| `FEMHO_DAV_PORT` | `8081` | El CalDAV. **Mateix procés, port propi** (D1) |
| `FEMHO_SECRET` | es genera | El pebre de tots els tokens. Si no es dona, se'n genera un el primer cop a `/data` |
| `FEMHO_ALLOW_REGISTRATION` | `false` | Qualsevol es pot fer un compte. **El primer serà administrador** |
| `FEMHO_REGISTRATION` | `disabled` | La forma llarga: `disabled`, `invite` o `open` |
| `FEMHO_SCOPE_MODE` | `both` | Si aquí es treballa per àmbits, per projectes, o ho tria cadascú: `both`, `multi` o `single`. Veure l'avís de sota |
| `FEMHO_LOGO_URL` | — | El logo de la instància. Amb això posat, **mana** i no es pot pujar-ne cap des d'Ajustos |
| `FEMHO_GRAVATAR` | `false` | Les fotos de perfil surten de Gravatar. Veure l'avís de sota |
| `FEMHO_UPDATE_CHECK` | `true` | Preguntar a GitHub si hi ha una versió més nova. Veure l'avís de sota |
| `FEMHO_MAX_UPLOAD_MB` | `25` | Mida màxima d'un adjunt |
| `FEMHO_MAIL_ALLOW_HOSTS` | — | Els servidors IMAP permesos, separats per comes (`imap.gmail.com,imap.fastmail.com`). Buida vol dir qualsevol de públic; les adreces internes es rebutgen sempre, amb llista o sense |
| `FEMHO_MAIL_POLL_SECONDS` | `300` | Cada quant es llegeix un compte de correu. Cinc minuts i no trenta segons: un `LOGIN` cada mig minut contra un proveïdor gros és com es bloqueja un compte |
| `FEMHO_MAIL_MAX_MESSAGE_MB` | `25` | Un correu més gros que això no es baixa. Es desa igualment que hi era, perquè es pugui veure |
| `FEMHO_MAIL_RETENTION_DAYS` | `0` | Dies que es guarda el cos d'un correu ingerit. `0` és per sempre. **Mai purga cap tasca**: la tasca és teva i la provinença hi sobreviu |
| `FEMHO_AI_PROVIDER` | `none` | El terreny d'IA. **Res truca a res encara** (P10) |
| `FEMHO_AI_BASE_URL` | — | L'URL del proveïdor. Amb un model local, això i prou |
| `FEMHO_AI_API_KEY` | — | **No surt mai per l'API, ni emmascarada** |
| `FEMHO_AI_MODEL` | — | **Sense defecte a posta**: un model per defecte és una versió que canvia sota teu i una factura que no has triat |
| `FEMHO_AI_MAX_INPUT_TOKENS` | `8000` | Sostre del text que s'enviaria a un model |
| `FEMHO_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent` |
| `FEMHO_SOURCE_URL` | aquest repositori | **Canvia-la si publiques una versió modificada.** L'AGPL §13 diu que qui hi accedeix per xarxa té dret al codi que li estàs servint, i amb aquesta apuntant a l'original els teus usuaris no hi arribarien |

**Aquesta taula és la llista sencera.** No hi ha cap altra variable: la comprovació
permanent `env-documented` compara el que llegeix el codi amb el que diu aquest fitxer i
falla en les dues direccions. Si en veus una en un tutorial i no és aquí, no existeix.

### Posar-hi la teva marca

`FEMHO_INSTANCE_NAME` és el nom que es veu a la barra, al login i a la pàgina d'un enllaç
compartit. El logo té **dues portes**:

- **`FEMHO_LOGO_URL`**, i llavors mana: Ajustos ho diu i no deixa pujar-ne cap. És el que
  vol qui desplega amb un `compose.yaml` immutable.
- **Ajustos ▸ Admin**, si aquella variable és buida. Es desa a `<FEMHO_DATA_DIR>/brand/`,
  o sigui que va amb la còpia de seguretat com la resta de dades.

SVG, PNG o WebP, i com a molt 512 KB. **Un SVG és XML i pot portar scripts**: se serveix amb
`Content-Security-Policy: sandbox` i amb el tipus que decideix el servidor, mai el que digui
qui el puja.

### Multiàmbit, monoàmbit, o que cadascú triï

Fem-ho posa els **àmbits** —Personal, Feina, Família— a la barra superior, i és el que el
distingeix. Per a qui fa servir l'eina per a **una sola cosa** això és una barra amb un sol
xip que no fa res, i el que li caldria a dalt són els **projectes**.

`FEMHO_SCOPE_MODE` diu qui decideix:

| Valor | Què passa |
| --- | --- |
| `both` (per defecte) | Cadascú tria, amb un wizard el primer cop i a Ajustos sempre |
| `multi` | Aquí es treballa per àmbits, i el commutador d'Ajustos surt bloquejat |
| `single` | Aquí es treballa per projectes dins d'un àmbit, i el commutador surt bloquejat |

**Acotar no esborra res.** Els àmbits que ja hi hagi segueixen existint i es trien amb el
selector de la barra; el que desapareix és poder-ne mirar dos alhora. I la preferència de
cadascú es conserva: el dia que es torni a `both`, tothom recupera la seva.

Un valor que no sigui un dels tres **fa que el servidor no arrenqui**, com amb
`FEMHO_REGISTRATION`: amb el defecte silenciós, l'opció semblaria que no existeix.

### Les dues maneres de dir qui es pot registrar

`FEMHO_ALLOW_REGISTRATION` és el booleà i `FEMHO_REGISTRATION` la forma llarga de tres
estats. `true` vol dir `open` i `false` vol dir `disabled`; la llarga només cal per al
mode `invite`.

**Si en poses les dues dient coses diferents, el servidor no arrenca.** Dues variables que
es contradiuen deixarien la instància oberta o tancada per accident, i triar-ne una per
defecte seria decidir-ho per tu.

Amb el registre obert i la base buida, **registrar-se és el primer arrencament**: qui hi
arribi primer serà administrador i es trobarà els tres àmbits inicials, igual que si
hagués passat per `/setup`.

### Gravatar, i què costa

`FEMHO_GRAVATAR=true` fa que les fotos de perfil surtin de Gravatar. Val la pena tenir-ho
i **no és gratis**: Fem-ho és autoallotjat, i encendre-ho vol dir que el teu servidor
comença a preguntar a un tercer —Automattic— per la cara de cadascú.

El que se li envia és el hash SHA-256 del correu. Es llegeix sovint que "només s'envia un
hash", i **no és cap protecció**: per a una adreça que algú ja sospita, comprovar-la és
calcular-ne el hash i comparar.

Si l'encens, hi ha tres coses fetes perquè costi el mínim:

- **Les peticions les fa el servidor**, no el navegador de cadascú: Gravatar veu una
  màquina i no la IP de tota la casa a cada càrrega de pàgina.
- **La foto es guarda al volum** amb un dia de vida, o sigui que segueix sortint sense
  connexió.
- **Cada persona ho pot treure** des d'Ajustos ▸ Perfil. El correu és seu.


### La comprovació de versió

`FEMHO_UPDATE_CHECK=false` l'apaga. Ve **encesa**, i val la pena dir per què no segueix el
criteri de Gravatar, que sí que ve apagada.

El que s'envia no és el mateix. A Gravatar hi va **el hash del correu de cadascú**, i per
a una adreça que algú ja sospita comprovar-la és calcular-ne el hash i comparar: encendre
allò és dir a un tercer quines adreces hi ha en aquesta casa. Aquí és una petició anònima
al llistat públic de versions, un cop cada sis hores, sense cap dada de ningú. El que s'hi
guanya és assabentar-se d'una actualització de seguretat, i **qui no sap que existeix un
avís no el va a buscar**.

La fa **el servidor i no el navegador**, pel mateix motiu que Gravatar: si la fes cada
pestanya, GitHub veuria la IP de cada persona de la casa cada vegada que algú obre
Ajustos.

I **s'apaga sola** si `FEMHO_SOURCE_URL` no apunta a un repositori de GitHub. Aquella
variable existeix perquè l'AGPL §13 dona dret al codi *de la versió que t'estan servint*, i
qui en publiqui una de modificada hi ha de posar la seva; avisar-lo de les versions d'un
altre projecte seria dir-li que actualitzi a una cosa que no és la seva.

### Els secrets, i el sufix `_FILE`

Qualsevol variable accepta el sufix `_FILE` per llegir-ne el valor d'un fitxer, que és el
que permet fer servir els secrets de Docker sense posar-los a l'entorn:

```yaml
environment:
  FEMHO_SECRET_FILE: /run/secrets/femho_secret
secrets:
  - femho_secret
```

**`FEMHO_SECRET` es genera un sol cop a `/data` i no es regenera mai.** Perdre'l vol dir
credencials de calendaris externs il·legibles, tokens de federació morts i totes les
subscripcions de push inservibles. Entra a la còpia de seguretat: veure
[`BACKUP.md`](BACKUP.md).

---

`FEMHO_REGISTRATION` és `disabled` per defecte a posta: les altes les fa
l'administrador, que és el correcte per a una instància familiar exposada a internet.

---

## El proxy invers

**Aquí és on falla la gent**, i el motiu és sempre el mateix: CalDAV fa servir verbs HTTP
que molts proxies bloquegen per defecte.

Hi ha exemples provats a `deploy/`:

| Fitxer | Notes |
| --- | --- |
| `deploy/Caddyfile` | El més senzill: no bloqueja els verbs i no fa memòria intermèdia de sèrie |
| `deploy/traefik.yaml` | Etiquetes per al `compose.yaml` |
| `deploy/nginx.conf` | **El que més cura necessita**: els verbs DAV van explícits |

Sigui quin sigui, calen aquestes sis coses:

1. **Els verbs** `PROPFIND`, `PROPPATCH`, `REPORT`, `MKCALENDAR`, `MKCOL`, `COPY` i
   `MOVE`. nginx respon `405` si no s'hi diu res, i el client no explica per què.
2. **Cap memòria intermèdia** a `/api/v1/stream` ni a `/mcp`. Amb buffering, els
   esdeveniments arriben a bocins o no arriben.
3. **`X-Forwarded-Proto`, `-Host` i `-For`.** Passa'ls igualment: avui el servidor no
   se'ls creu —`trustProxy` és fals i res no necessita la IP del client, perquè el
   bloqueig per intents es compta **per correu i no per IP** a posta— però el dia que
   calgui, ja hi seran. Si has vist `FEMHO_TRUSTED_PROXIES` en algun lloc: no existeix.
4. **Pujades grans**, segons `FEMHO_MAX_UPLOAD_MB`.
5. **`/.well-known/caldav` redirigit** cap a `/dav/`. Sense això els clients no troben
   res encara que la resta estigui perfecta.
6. **Temps d'espera llargs** a l'SSE: desenes de minuts, no segons.

---

## Actualitzar

```sh
docker compose pull && docker compose up -d
```

Les migracions s'executen a l'arrencar, **abans** d'escoltar peticions, i amb una còpia
de seguretat automàtica a `/data/backups/`. Si una falla, el procés no arrenca: val més
no arrencar que arrencar amb l'esquema a mitges.

Les etiquetes són `latest`, la versió sencera (`1.4.2`) i la major (`1`). Qui vulgui
actualitzacions automàtiques fixa la major; qui vulgui control, la sencera.

---

## Còpies de seguretat

A [`BACKUP.md`](BACKUP.md), amb el procediment de restauració **executat de veritat** i
els números que va donar. Val la pena llegir-lo abans de necessitar-lo.

---

## Diagnòstic

| Símptoma | Mira primer |
| --- | --- |
| El calendari no apareix a DAVx⁵ | Els verbs al proxy, i `/.well-known/caldav` |
| Els canvis no arriben en directe | `proxy_buffering off` a `/api/v1/stream` |
| Els enllaços compartits porten a l'amfitrió intern | `FEMHO_BASE_URL` |
| Els enllaços antics demanen contrasenya de sobte | El `secret.key` no és el d'abans |
| Han deixat d'arribar notificacions | Les claus VAPID s'han regenerat |
| El servidor MCP no ensenya cap botó de connectar | Un `200` on hi hauria d'haver un `401` |

---

## Publicació

L'APK va a les publicacions de GitHub, signat i compatible amb F-Droid. Play Store és
opcional: una app que demana la URL d'un servidor propi no encaixa bé amb la seva
revisió.

L'app comprova la versió de la instància en connectar-s'hi i avisa si el servidor és més
nou, amb enllaç a la descàrrega. **No s'actualitza sola.**
