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
| `FEMHO_DATABASE_URL` | `sqlite:///data/femho.db` | SQLite o `postgres://…` |
| `FEMHO_DATA_DIR` | `/data` | On viuen la base, el secret i els adjunts |
| `FEMHO_PORT` | `8080` | L'aplicació |
| `FEMHO_DAV_PORT` | `8081` | El CalDAV. **Mateix procés, port propi** (D1) |
| `FEMHO_REGISTRATION` | `disabled` | `disabled`, `invite` o `open` |
| `FEMHO_TRUSTED_PROXIES` | — | El rang del proxy, per creure's `X-Forwarded-For` |
| `FEMHO_SECRET` | es genera | El pebre. Si no es dona, es genera un cop a `/data/secret.key` |
| `FEMHO_LOG_LEVEL` | `info` | |

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
3. **`X-Forwarded-Proto`, `-Host` i `-For`**, amb `FEMHO_TRUSTED_PROXIES` al rang del
   proxy.
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
