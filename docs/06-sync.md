# 06 · Sincronització

El contracte de sincronització entre servidor i clients. **L'implementen dos clients** — la web (PWA) i Android — i han de fer-ho igual. Per això és un document a part i no un apartat d'Android.

Regla 6 d'`instruccions.md`: això es dissenya a la fita del model de dades, no quan es comenci l'app mòbil.

---

## 1 · El model

Font de veritat local, empenta diferida:

```
UI ──llegeix──> BD local ──(sempre, mai espera la xarxa)
UI ──escriu──> BD local + cua de sortida ──> xarxa ──> servidor
servidor ──delta──> BD local ──> UI
```

Tres propietats que fan que funcioni, i que ja són al model de dades:

- **Els identificadors els genera el client** (D4). Crear offline no necessita cap resposta.
- **Les posicions les calcula el client** (D3). Moure offline produeix la clau definitiva.
- **Res s'esborra de veritat** (§12 de `01`). Un esborrat és una tombstone que es pot sincronitzar.

---

## 2 · El cursor

El cursor és el `seq` de `change_log`: un enter monòton per instància.

S'envia com a cadena opaca. **El client no l'ha d'interpretar mai** — així es pot canviar el format sense trencar clients desplegats.

### El parany de la visibilitat fora d'ordre

Amb un comptador autoincremental, una transacció llarga que agafa el `seq` 100 pot fer-se visible **després** d'una de curta amb el `seq` 101. Un client que hagi llegit fins al 101 no veurà mai el 100.

Dues maneres de resoldre-ho; la primera és la recomanada:

1. **Assignar el `seq` al final de la transacció**, sota un bloqueig curt, de manera que l'ordre d'assignació sigui l'ordre de compromís.
2. Retornar només fins a `min(seq)` de les transaccions obertes, retenint els resultats fins que no quedi cap forat.

Amb SQLite en mode WAL i un sol escriptor, el problema pràcticament no existeix. **A PostgreSQL sí que hi és** i s'ha de tractar. Aquesta diferència és una de les raons per provar les dues a CI (D11).

---

## 3 · Baixada

```
GET /api/v1/sync?cursor=<opac>&limit=500
```

```json
{
  "changes": [
    { "entity": "task", "id": "0192f3a1-...", "op": "upsert", "seq": 48210, "data": { } },
    { "entity": "task", "id": "0192f3b7-...", "op": "delete", "seq": 48211 }
  ],
  "next_cursor": "...",
  "has_more": false,
  "server_time": "2026-08-05T14:30:00Z"
}
```

Regles:

- **Ordenat per `seq` ascendent.** Sempre.
- **Filtrat pel principal**: només arriba el dels àmbits que el token pot veure. Si un token perd accés a un àmbit, el client rep tombstones d'aquelles entitats.
- Un `upsert` porta l'entitat **sencera**, no un diff. És més trànsit i molta menys complexitat, i les entitats de Fem-ho són petites.
- Un `delete` només porta l'identificador.
- **Sense cursor** és una sincronització completa.

### Resincronització forçada

Les tombstones es conserven 90 dies. Un client que torni més tard rebria un delta incomplet sense saber-ho.

```json
{ "error": "cursor_too_old", "must_resync": true }
```

Amb un `409`. El client buida la base local i torna a començar sense cursor. És el mateix mecanisme que el `507` de CalDAV amb un sync-token caducat.

**Cal comprovar-ho abans de servir el delta**, no després.

### `server_time`

Cada resposta el porta perquè el client pugui detectar desviació de rellotge. Amb més d'uns minuts de diferència, cal avisar: un rellotge mal posat trenca els recordatoris i les comparacions de "avui".

**El servidor mai confia en una marca de temps del client** per a l'ordre. Les del client són informatives.

---

## 4 · Pujada: la cua de sortida

```sql
CREATE TABLE outbox (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,      -- create | update | delete | move
  payload     TEXT NOT NULL,      -- JSON
  base_version INTEGER,           -- versió sobre la qual s'edita
  created_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','sending','failed','conflict'))
);
CREATE INDEX idx_outbox_pending ON outbox(created_at) WHERE status = 'pending';
```

### Ordre

**Per ordre de creació, i en sèrie per entitat.** Dues edicions de la mateixa tasca s'han d'aplicar en ordre. Entitats diferents poden anar en paral·lel.

Les dependències es respecten: si es crea una tasca i tot seguit una subtasca seva, la tasca va primer. La cua es recorre en ordre topològic dins de cada lot.

### Fusió

Diverses edicions pendents de la **mateixa entitat i els mateixos camps** es fusionen en una. Marcar una tasca feta, desfer-ho i tornar-la a marcar ha de produir **una** operació, no tres.

**No es fusionen**: operacions de tipus diferent (una edició i un esborrat), ni res que ja estigui en estat `sending`.

### Enviament

```
POST /api/v1/sync/batch
{ "operations": [ { "op_id": "...", "entity": "task", "op": "update",
                    "id": "...", "base_version": 4, "data": { } } ] }
```

```json
{ "results": [
    { "op_id": "...", "status": "ok", "entity": { } },
    { "op_id": "...", "status": "conflict", "server_entity": { } },
    { "op_id": "...", "status": "rejected", "error": { } }
] }
```

Tres resultats i prou. **Cada operació es resol per separat**: una que falli no ha de tombar el lot.

`op_id` és la clau d'idempotència. Reenviar un lot després d'una caiguda no duplica res.

---

## 5 · Conflictes

`base_version` diferent de la del servidor és un conflicte. La resolució depèn del camp:

| Camp | Regla |
| --- | --- |
| `title`, `description`, `ai_instructions` | Guanya l'última escriptura, **i s'avisa l'usuari** si el text divergeix de veritat |
| `status` | Guanya l'última escriptura. Moure és intencionat i recent |
| `position` | **Mai és conflicte.** Els índexs fraccionals convergeixen |
| `completed_at` | Guanya el primer que completa |
| `due_date`, `due_time`, `deadline` | Última escriptura |
| Assignats, etiquetes | **Unió**, no substitució. Són conjunts |
| Ítems de llista | Per ítem, mai per llista sencera |
| Esborrat contra edició | **Guanya l'esborrat.** Es conserva l'edició a `activity_log` |

**`position` no és mai un conflicte**, i aquesta és tota la raó dels índexs fraccionals: dos clients que moguin targetes diferents generen claus diferents que ordenen bé les dues. Dos que moguin *la mateixa* targeta al *mateix* buit generen claus properes però diferents, gràcies al jitter, i el desempat és determinista perquè és una comparació de cadenes binàries.

### Quan es pregunta a l'usuari

Gairebé mai. Només quan **els dos costats han canviat el títol o la descripció** a coses realment diferents. En aquest cas la mutació queda en estat `conflict` i la UI ensenya les dues versions amb "Mantenir la meva" i "Mantenir la del servidor". No es fusiona text automàticament.

Tota la resta es resol sol i queda a `activity_log`.

---

## 6 · Reintents

| Resposta | Què fer |
| --- | --- |
| `2xx` | Treure de la cua |
| `409` conflicte | Aplicar la regla; si cal preguntar, estat `conflict` |
| `4xx` altres | **No reintentar.** Estat `failed`, avisar |
| `401` | Refrescar el token i reintentar un cop |
| `403` per abast | Estat `failed`, amb el motiu llegible del servidor |
| `429` | Respectar `Retry-After` |
| `5xx` o xarxa | Espera exponencial amb dispersió, fins a 6 intents |

**Una operació fallida no bloqueja la resta.** Es marca i es continua. La UI ho ensenya i deixa reintentar o descartar; mai es descarta en silenci.

---

## 7 · Quan se sincronitza

| Disparador | Web | Android |
| --- | --- | --- |
| Es recupera la connexió | sí | sí |
| L'app passa a primer pla | sí | sí |
| Mutació local | immediat si hi ha xarxa | immediat si hi ha xarxa |
| SSE rep un canvi | sí | mentre és en primer pla |
| Notificació push | — | sí |
| Periòdic | mentre la pestanya és visible | cada 15 min amb restriccions |

La consulta periòdica és una xarxa de seguretat, no el mecanisme principal. El principal és l'SSE quan hi ha una sessió oberta i el push quan no n'hi ha.

---

## 8 · Càrrega inicial

Un compte nou amb historial pot tenir moltes entitats. La primera sincronització es fa **per prioritat**:

1. Usuaris, àmbits, projectes, etiquetes.
2. Tasques no fetes i esdeveniments de la finestra d'un mes.
3. Llistes i subtasques de les tasques ja baixades.
4. La resta: tasques fetes, esdeveniments antics, comentaris, historial.

La UI és utilitzable després del pas 2. Els passos 3 i 4 van en segon pla amb una barra de progrés discreta.

---

## 9 · Què no se sincronitza

- **Les repeticions d'esdeveniments.** Se sincronitzen components i s'expandeixen localment. És la divisió de feina de DAVx⁵ amb el proveïdor de calendari d'Android, i evita multiplicar per cent les files d'una sèrie llarga.
- **Els adjunts.** Metadades sí; el contingut es baixa a demanda i es guarda en memòria cau amb límit.
- **`activity_log`.** Es consulta a demanda quan s'obre l'historial d'una tasca.
- **Dades d'altres usuaris** fora dels àmbits compartits.

---

## 10 · Proves

Aquestes són les que decideixen si el sync funciona:

1. **Mode avió**: crear, editar, moure i completar sense xarxa; recuperar-la; comprovar que el servidor acaba idèntic al client.
2. **Edició concurrent**: dos clients editen camps diferents de la mateixa tasca offline; en tornar, tots dos canvis hi són.
3. **Reordenació concurrent**: dos clients reordenen la mateixa columna offline; en tornar, els dos veuen el mateix ordre i no s'ha perdut cap targeta.
4. **Esborrat contra edició**: un esborra, l'altre edita; guanya l'esborrat i l'edició queda a l'historial.
5. **Cursor caducat**: cursor de fa més de 90 dies; el client fa resincronització completa i acaba correcte.
6. **Reenviament de lot**: enviar el mateix lot dues vegades; no es duplica res.
7. **Pèrdua d'accés**: es treu un àmbit a un token; el client rep tombstones i el buida.
8. **Canvi d'hora**: sincronitzar durant el diumenge de canvi d'hora; les consultes de "avui" continuen correctes.

Les 1, 3 i 5 s'executen a CI en els dos clients.
