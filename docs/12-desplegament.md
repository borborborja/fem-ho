# 12 · Desplegament

Fem-ho s'autoallotja amb Docker. L'objectiu és que algú amb un servidor a casa el tingui funcionant amb un `compose.yaml` i cinc minuts.

---

## 1 · La imatge

Multi-etapa: una etapa que compila el servidor i la web, i una final mínima que només porta el runtime i els artefactes.

Requisits que no es negocien:

- **Usuari no root.** Cap procés com a root dins del contenidor.
- **PID 1 correcte.** El procés ha de rebre `SIGTERM` i tancar net; si el runtime no ho fa bé sol, cal un init mínim. Sense això, cada reinici és un tall brusc i amb SQLite això és arriscat.
- **Healthcheck** que apunti a `/healthz`.
- **Multi-arquitectura**: `amd64` i `arm64`. Molta gent ho posarà en un ARM petit.
- Sense compiladors ni eines de construcció a la imatge final.

Etiquetatge: `latest`, la versió sencera (`1.4.2`), i la major (`1`). Qui vulgui actualitzacions automàtiques fixa la major; qui vulgui control fixa la sencera.

---

## 2 · Compose

### Mínim, amb SQLite

Un sol contenidor. És el cas recomanat per a una casa.

```yaml
services:
  femho:
    image: ghcr.io/<owner>/fem-ho:1
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - femho-data:/data
    environment:
      FEMHO_BASE_URL: https://femho.example.com
      FEMHO_DATABASE_URL: sqlite:///data/femho.db
    healthcheck:
      test: ["CMD", "/app/healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

volumes:
  femho-data:
```

### Amb PostgreSQL

Igual, afegint el servei de base de dades, canviant `FEMHO_DATABASE_URL`, i amb `depends_on` que esperi el healthcheck del postgres, no només que existeixi el contenidor.

**Un sol volum, `/data`**, amb la base de dades, els adjunts i els secrets generats. Un volum és una còpia de seguretat.

---

## 3 · Configuració

Variables d'entorn amb prefix `FEMHO_`. Els secrets accepten el sufix `_FILE` per llegir-los d'un fitxer, que és el que permet fer servir secrets de Docker.

| Variable | Per defecte | Notes |
| --- | --- | --- |
| `FEMHO_BASE_URL` | — | **Obligatòria.** Sense això, CalDAV i els enllaços compartits generen URL incorrectes |
| `FEMHO_PORT` | `8080` | API i web |
| `FEMHO_DAV_PORT` | `8081` | Superfície CalDAV |
| `FEMHO_DATABASE_URL` | `sqlite:///data/femho.db` | |
| `FEMHO_DATA_DIR` | `/data` | |
| `FEMHO_TRUSTED_PROXIES` | — | Rangs dels quals s'accepten les capçaleres `X-Forwarded-*`. **Encara no** hi és: `trustProxy` és fals i res no necessita la IP del client, perquè el bloqueig per intents es compta per correu |
| `FEMHO_SECRET` | generat | El pebre de tots els tokens. Es persisteix a `/data` al primer arrencament. **Aquí hi deia `FEMHO_SECRET_KEY`, que no ha existit mai** |
| `FEMHO_SMTP_*` | — | Amfitrió, port, usuari, contrasenya, xifratge, remitent. **Encara no** hi són: no s'envia cap correu |
| `FEMHO_ALLOW_REGISTRATION` | `false` | Qualsevol es pot fer un compte. **El primer serà administrador.** |
| `FEMHO_GRAVATAR` | `false` | Les fotos de perfil surten de Gravatar. Veure l'avís de sota. |
| `FEMHO_UPDATE_CHECK` | `true` | Preguntar a GitHub si hi ha una versió més nova. Veure l'avís de sota. |
| `FEMHO_REGISTRATION` | `disabled` | La forma llarga: `disabled`, `invite`, `open` |
| `FEMHO_MAX_UPLOAD_MB` | `25` | |
| `FEMHO_MAIL_ALLOW_HOSTS` | — | Els servidors IMAP als quals aquesta instància es pot connectar, separats per comes. Buida vol dir **qualsevol de públic**: el que sempre es rebutja són les adreces internes, i això només serveix per acotar-ho més |
| `FEMHO_LOG_LEVEL` | `info` | |
| `FEMHO_INSTANCE_NAME` | `Fem-ho` | El nom que veu qui s'hi connecta i el que publica el manifest de federació |
| `FEMHO_SOURCE_URL` | aquest repositori | On és el codi d'aquesta instància (AGPL §13) |
| `FEMHO_CALDAV_ALLOWLIST` | — | Restricció opcional d'orígens externs. **Encara no** hi és com a variable; `safeFetch` accepta `allowHosts` per paràmetre |

**`FEMHO_BASE_URL` mal posada és la causa número u de problemes.** Un CalDAV darrere d'un proxy que no la sap genera `href` amb l'amfitrió intern, i cap client hi pot connectar. Al primer arrencament, el servidor l'ha de validar i escriure un avís clar al log si sembla incorrecta.

Els secrets generats (`FEMHO_SECRET`, la clau VAPID) es guarden a `/data` **el primer cop i no es regeneren mai**. La conseqüència de perdre'ls: credencials de calendaris externs il·legibles i totes les subscripcions de push mortes.

---

## 4 · Proxy invers

Aquí és on falla la gent, i el motiu és sempre el mateix: **CalDAV fa servir verbs HTTP que molts proxies i tallafocs d'aplicació bloquegen per defecte.**

Requisits per a qualsevol proxy:

1. **Permetre els verbs** `PROPFIND`, `PROPPATCH`, `REPORT`, `MKCALENDAR`, `MKCOL`, `COPY` i `MOVE`. nginx i molts WAF els rebutgen si no s'hi diu res.
2. **No fer memòria intermèdia** de `/api/v1/stream` (SSE) ni de `/mcp`. Amb *buffering*, els esdeveniments arriben a bocins o no arriben.
3. **Passar `X-Forwarded-Proto`, `-Host` i `-For`.** El servidor encara no se'ls creu —veure la taula—, però passar-los no costa res i el dia que calgui ja hi seran.
4. **Permetre pujades grans** segons `FEMHO_MAX_UPLOAD_MB`.
5. **Redirigir `/.well-known/caldav`** cap a la ruta del principal.
6. **Temps d'espera llargs** a l'SSE — desenes de minuts, no segons.

El repositori ha de portar exemples per a **Caddy**, **Traefik** i **nginx**. El de nginx ha de tenir els verbs DAV explícits i el *buffering* desactivat, amb un comentari que expliqui per què.

---

## 5 · Migracions

S'executen a l'arrencar, abans d'escoltar peticions.

- **Còpia de seguretat automàtica abans de migrar**, a `/data/backups/`, amb les últimes 5.
- Si una migració falla, **el procés no arrenca**. Res de continuar amb l'esquema a mitges.
- Cap migració destructiva sense una versió prèvia que la prepari: primer s'afegeix, es desplega, i la següent versió esborra.
- El log de migracions ha de dir de quina versió a quina va, i quant ha trigat.

---

## 6 · Còpies de seguretat

La documentació ha de dir tres coses, i la tercera és la que ningú fa:

**Què copiar.** El volum `/data` sencer. Amb Postgres, el volum més un bolcat de la base.

**Com.** Amb SQLite, l'API de còpia en línia o la instrucció de còpia de seguretat — **mai copiant el fitxer amb `cp` amb el servidor engegat**, que amb WAL dona una còpia corrupta. Es pot suggerir una eina de replicació contínua per a qui vulgui còpies contínues.

**Com restaurar, provat.** La guia ha de tenir un procediment de restauració que l'autor hagi executat de veritat, no un paràgraf teòric. Una còpia que no s'ha restaurat mai no és una còpia.

---

## 7 · Primer arrencament

Amb la base buida, el servidor crea l'esquema, genera els secrets i els persisteix, i espera.

`/setup` mostra un formulari per crear el primer administrador. Un cop creat, la ruta es tanca per sempre.

En crear l'administrador es creen els seus tres àmbits inicials (Personal, Feina, Família) amb els colors de la tríada. **No són especials**: es poden reanomenar i esborrar.

Les altes posteriors depenen del registre. Per defecte està tancat: els usuaris els crea l'administrador, que és el comportament correcte per a una instància familiar exposada a internet.

Per obrir-lo n'hi ha prou amb una línia al `.env`:

```
FEMHO_ALLOW_REGISTRATION=true
```

**Amb la base buida, registrar-se és el primer arrencament**: qui hi arribi primer serà administrador i es trobarà els tres àmbits inicials, exactament igual que si hagués passat per `/setup`. No són dos camins: el registre delega en aquell. Del segon endavant, `member` amb un àmbit propi.

Hi ha també `FEMHO_REGISTRATION`, amb tres estats, per si es vol el mode `invite`. `FEMHO_ALLOW_REGISTRATION=true` vol dir `open` i `false` vol dir `disabled`, i **si es posen les dues dient coses diferents el servidor no arrenca**: dues variables que es contradiuen deixarien la instància oberta o tancada per accident, i triar-ne una per defecte seria decidir-ho per l'operador.

Dades de demostració: opcionals, darrere d'una variable, i mai per defecte.

---

## 8 · Observabilitat

- **Registres estructurats** en JSON a stdout, amb nivell configurable. Cap secret, cap token, cap contrasenya. Les rutes `/s/*` amb el token anonimitzat.
- **`/healthz`** — el procés és viu.
- **`/readyz`** — base de dades accessible i migracions aplicades.
- **`/metrics`** — opcional, desactivat per defecte.
- **Paquet de diagnòstic** des d'Ajustos → Admin: versió, esquema, configuració **amb els secrets ocultats**, estat dels jobs, estat de la connexió SMTP, errors recents. És el que fa que un informe d'error sigui útil.

---

## 9 · Actualitzacions

Semàntica de versions, i els canvis que trenquen coses només en major.

Les notes de versió han de dir explícitament si cal alguna acció manual. Si una versió necessita intervenció, el servidor l'ha de detectar i **negar-se a arrencar amb un missatge que digui exactament què fer**, en comptes d'arrencar a mitges.

Compatible amb actualitzacions automàtiques d'imatge quan es fixa la major.

---

## 10 · Publicació

CI construeix i publica a cada etiqueta:

- La imatge multi-arquitectura al registre de contenidors.
- L'APK signat d'Android a la publicació de GitHub.
- Les notes de versió.

I a cada canvi proposat, sense publicar: construcció, proves de les dues bases de dades, verificació que el codi generat d'OpenAPI no té canvis pendents, proves de contracte, proves d'interfície i les de seguretat de [`10-compartits-i-seguretat.md`](10-compartits-i-seguretat.md) §10.

---

## 11 · Fitxers del repositori

```
Dockerfile
compose.yaml                  SQLite, el recomanat
compose.postgres.yaml         variant amb Postgres
.env.example                  totes les variables comentades
deploy/
  caddy/Caddyfile
  traefik/labels.yaml
  nginx/femho.conf            amb els verbs DAV i el buffering
docs/DEPLOY.md                guia per a qui allotja
docs/BACKUP.md                copiar i restaurar, amb el procediment provat
```

## Gravatar, i què costa

`FEMHO_GRAVATAR=true` fa que les fotos de perfil surtin de [Gravatar](https://gravatar.com). Val la pena tenir-ho i **no és gratis**, en un sentit que no és el dels diners: Fem-ho és autoallotjat, i encendre això vol dir que el servidor de casa comença a preguntar a un tercer —Automattic— per la cara de cadascú.

El que se li envia és el hash SHA-256 del correu. Es llegeix sovint que "només s'envia un hash", i **no és cap protecció**: per a una adreça que algú ja sospita, comprovar-la és calcular-ne el hash i comparar. Encendre-ho és, doncs, dir a Gravatar quines adreces hi ha en aquesta instància.

Si es decideix encendre, hi ha tres coses fetes perquè costi el mínim possible:

- **Les peticions les fa el servidor, no el navegador de cadascú.** Un `<img>` directe a gravatar.com és una línia menys de codi i fa que a cada càrrega de pàgina els arribi la IP de cada persona de la casa. Així en veuen una.
- **La foto es guarda al volum** amb un dia de vida. Per això segueix sortint sense connexió, que és el que la regla 6 demana, i per això una casa de deu persones no pica el servei deu vegades per pantalla.
- **Cada persona ho pot treure** des d'Ajustos ▸ Perfil. El correu que viatja és el seu, no el de qui administra.

Amb això apagat —el valor per defecte— els avatars són les inicials i no es pregunta res de ningú.


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
