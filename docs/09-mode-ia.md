# 09 · Mode IA

Tot això només existeix si l'usuari IA està activat a Ajustos. **Per defecte està desactivat**, i amb ell desactivat cap distintiu, cap camp i cap endpoint d'IA apareix enlloc.

El brief ho diu clar: *"La nostra app no té cap motor d'IA només es el gestor de tasques que li diu a la IA, has de fer això o allò."* Fem-ho és el sistema de registre. La intel·ligència és fora.

---

## 1 · Delegar no és assignar

Aquesta és la decisió que ho ordena tot (D5).

Una tasca delegada **continua tenint una persona assignada**, que n'és responsable. Són dos camps diferents:

| Camp | Apunta a | Vol dir |
| --- | --- | --- |
| `assignee_id` | una persona | Qui respon d'aquesta tasca |
| `delegate_agent_id` | un agent | Qui l'està executant |

Si delegar substituís assignar, la feina desapareixeria del radar de tothom en el moment de delegar-la, i quan l'agent fallés no seria de ningú. És la lliçó cara que Linear ja va aprendre.

L'agent, al seu torn, sempre actua **en nom d'una persona** (`ai_agents.on_behalf_of_user_id`). No hi ha feina que no tingui un humà al darrere.

---

## 2 · Els tres modes

`tasks.ai_mode`, amb tres valors:

| Mode | Codi | Què vol dir |
| --- | --- | --- |
| **Individual** | `manual` | La faig jo. La IA no hi toca. Per defecte. |
| **Amb ajuda** | `assisted` | La IA pot llegir, comentar, proposar i preparar. **No la pot completar.** |
| **Delegada** | `delegated` | La IA la pot executar sencera, dins dels seus límits. |

### Triar-ho sense fricció

El brief demana que en crear una tasca hi hagi *"una manera sense fricció de seleccionar"* el mode.

**A l'afegida ràpida no es demana res.** Tota tasca neix `manual`. Afegir un tercer selector al camp d'afegida trencaria la premissa que escriure una tasca és escriure i prémer Enter.

El canvi de mode es fa:

- Amb el sigil `!ia` o `!ia:delegada` a l'afegida ràpida, per a qui el vulgui.
- Amb un clic al distintiu de la targeta, que cicla entre els tres modes.
- Al modal d'edició completa.
- En bloc, seleccionant diverses targetes.

---

## 3 · Com es veu

El brief ho demana explícitament: *"L'interface de tasques i de calendari ha de permetre veure visualment si es una tasca individual, que la IA pot ajudar o la fa autònomament la IA."*

`AiModeBadge`, a la fila de metadades de la targeta:

| Mode | Aspecte |
| --- | --- |
| `manual` | **No es pinta res.** És el cas normal i no ha d'ocupar espai. |
| `assisted` | Pastilla tènue amb la icona `sparkles` i el text "Amb ajuda". |
| `delegated` | Pastilla amb `--gradient-wash-tag`, icona `sparkles` plena i el text "IA". |

El color no és mai l'únic senyal: sempre porta icona i text.

**Canvi autònom no vist.** Quan un agent ha tocat una tasca i l'usuari encara no ho ha mirat, la targeta porta un **punt de 6px** a la cantonada superior dreta amb `--plou-orange`. Desapareix en obrir la tasca. És el que respon a *"També veure si hi ha hagut algun canvi autònom"*.

**Al calendari**, les tasques delegades porten el punt d'àmbit amb un anell fi al voltant.

**Una tasca reservada per un agent en aquest moment** porta la pastilla amb una pulsació lenta — que `prefers-reduced-motion` converteix en estàtica.

---

## 4 · El traspàs

Perquè una IA pugui fer una tasca de veritat li cal molt més que el títol. Això és el que retorna `get_task` i `next_task`:

```json
{
  "task": { "id": "...", "title": "...", "description": "...",
            "due_date": "...", "deadline": "...", "ai_mode": "delegated" },
  "context": {
    "scope":   { "name": "Feina", "instructions": "...", "description": "..." },
    "project": { "name": "Client Salt", "instructions": "...", "description": "..." },
    "task_instructions": "...",
    "attachments": [ { "id": "...", "filename": "...", "mime_type": "...",
                       "resource_uri": "femho://tasks/.../attachments/..." } ],
    "comments": [ ],
    "checklists": [ ],
    "subtasks": [ ]
  },
  "constraints": {
    "can_create_tasks": false,
    "scope_ids": ["..."],
    "lease_expires_at": "2026-08-05T16:30:00Z"
  }
}
```

Les instruccions d'àmbit i de projecte són les que el brief demana a la línia 52: *"En ajustos-IA hem de poder posar instruccions genèriques i descripcions per a cada àmbit i per a cada projecte."*

Els adjunts es donen com a **enllaços a recurs**, no incrustats. Una tasca amb tres PDF no ha de fer explotar la finestra de context de qui només volia el títol.

`constraints` és el que fa que l'agent sàpiga els seus límits **abans** de trobar-se un 403.

---

## 5 · Reserves

Sense reserva, dos agents amb el mateix token fan la mateixa feina dues vegades.

```
GET  /api/v1/ai/next-task          → retorna i reserva
POST /api/v1/ai/tasks/{id}/claim   → reserva una de concreta
POST /api/v1/ai/tasks/{id}/release → allibera, amb motiu
```

- La reserva dura **30 minuts** i es pot renovar.
- **És també el pany.** Mentre visqui, la persona no pot moure ni reclamar la tasca (`409`
  amb qui la té i quants minuts queden) i l'agent només pot moure i completar el que té
  reservat. Comentar sempre es pot per les dues bandes.
- **Preguntar la deixa anar**: qui espera no treballa, i mentre espera la persona ha de poder
  respondre o endur-se la tasca.
- Caducada, la tasca torna a estar disponible i s'anota a l'historial.
- `next_task` **només retorna tasques `delegated`** que no estiguin reservades ni esperant resposta, en àmbits que el token pugui veure. Si tornés les que esperen, l'agent es repartiria la tasca per la qual t'espera i preguntaria el mateix en bucle.
- Alliberar exigeix un motiu, que es publica com a comentari.

L'assignació de la reserva ha de ser atòmica: dos `next_task` simultanis han de rebre tasques diferents.

---

## 6 · Com reporta l'agent

**El comentari és la via principal.** És el que ja fa el producte per a humans, es veu a l'historial i no necessita cap concepte nou.

| Situació | Què fa l'agent |
| --- | --- |
| Comença | `move_task` a `doing` |
| Ho ha sabut per un altre canal | `resume_task` amb el que ha après: primer ho documenta, després la marca cau |
| Progrés | `add_comment` |
| Té un dubte que pot esperar | `ask_user` — la tasca queda marcada i **es veu sense obrir-la** |
| Té un dubte i vol deixar-la anar | `add_comment` **i** `release_task` |
| Acaba | `add_comment` amb el resultat, i `complete_task` |
| No pot | `add_comment` amb el motiu i `release_task` |

Un agent **mai** completa una tasca `assisted`. Si ho intenta, `403` amb el motiu explicat.

**`ask_user` és `add_comment` amb conseqüència.** La pregunta surt a la conversa i a l'historial com tota la resta; el que hi afegeix és `needs_attention` a la tasca, que és el que fa el punt amb recompte al commutador d'IA i la targeta destacada al kanban —amb icona i text, mai el color sol.

Qui la baixa: **una persona que respon**, i completar la tasca. No hi ha cap botó de «vist»: el que desencalla l'agent és la resposta, i marcar-ho com a vist deixaria la pantalla neta amb l'agent esperant per sempre. Un comentari del mateix agent no la baixa —seguiria parlant sol— i una persona no la pot aixecar: no vol dir «recorda-t'ho», vol dir «algú t'espera».

**Reclamar-la.** `POST /tasks/{id}/take-over` la porta al tauler humà a la columna que es demani, passa a `manual`, baixa la marca i deixa anar la reserva —**i no esborra res**: comentaris, adjunts i historial són de la tasca i no del mode. L'agent ho sap perquè la seva següent escriptura falla amb el motiu escrit, perquè `get_briefing` porta `taken_over`, i perquè l'historial ho diu amb verb propi.

Dins de la fitxa, quan la tasca no és `manual` —**o quan hi ha qualsevol missatge d'agent**, que és el que fa que reclamar-la no esborri la conversa— la secció de comentaris **és** la conversa amb la IA: es veu qui parla, l'avís del que espera resposta, i que el que hi adjuntis li arriba amb el traspàs. És la mateixa conversa i no una pestanya a part, perquè amb dos llocs on mirar algú respondria al que no toca.

---

## 7 · Historial

El brief: *"L'historial de canvis hi és per totes les tasques, es registra qualsevol moviment."*

`ActivityTimeline` mostra `activity_log` amb els actors barrejats:

```
Borja           ha creat la tasca                      fa 3 dies
Borja           ha delegat a la IA                     fa 3 dies
IA · Claude     ha mogut a Fent                        fa 2 h
IA · Claude     ha comentat                            fa 2 h
IA · Claude     ha canviat el deadline  15 ag → 22 ag  fa 1 h   [Desfés]
Extern · Marta  ha marcat "Cables"                     fa 30 min
```

Tres detalls que compten:

- **Els actors es distingeixen visualment**: humans amb avatar d'inicials, IA amb la icona `sparkles`, externs amb la icona `link`.
- **Els canvis de camp ensenyen el valor anterior i el nou.** Per això `activity_log.changes` guarda `{camp: {from, to}}`.
- **Els canvis autònoms de la IA porten "Desfés"**, que crea un canvi invers i el registra com a tal. No s'esborra res de l'historial.

Filtre a la capçalera: tot, només IA, només humans.

---

## 8 · Ajustos

**General** — el commutador mestre d'activar l'usuari IA. En apagar-lo, tot el que hi ha en aquest document desapareix de la interfície; les dades es conserven.

**Usuari IA** — només visible si està activat:

- Els agents, amb nom, en nom de qui actuen i si estan actius.
- **"Pot crear tasques"** per agent. És la distinció exacta del brief: *"la IA només pot processar tasques o si també en pot afegir"*.
- Instruccions genèriques de tota la instància.
- Instruccions i descripció per àmbit i per projecte (les mateixes que s'editen des de cada àmbit).
- Enllaç a la pestanya de tokens per crear-ne un d'abast limitat.

---

## 9 · Límits

- Un agent **no esborra res**. No hi ha tool d'esborrar (`08-mcp.md` §3).
- Un agent **no crea tasques** si no té `can_create_tasks`.
- Un agent **no toca àmbits fora del seu token**.
- Un agent **no completa tasques `assisted`**.
- Un agent **no modifica usuaris, tokens, compartits ni ajustos**. No hi ha cap tool que ho permeti.
- Els límits de ritme d'MCP són més estrictes que els de l'API ([`05-api-rest.md`](05-api-rest.md) §7).

---

## 10 · Injecció de prompts

El text de les tasques i els adjunts els escriuen persones, i poden contenir instruccions dirigides al model que les llegeixi. **Fem-ho no pot impedir-ho.** El que sí que pot:

- **Etiquetar la provinença.** El contingut que ve d'un enllaç compartit o d'un calendari extern es marca com a tal en retornar-lo per MCP. Un agent que rebi text d'origen extern ho sap.
- **Mantenir els tokens estrets**, perquè el radi d'un error sigui petit.
- **No exposar operacions destructives.**
- **Ensenyar-ho tot**: què pot tocar cada token a Ajustos, i què ha tocat a l'historial.

La defensa real no és tècnica: és que l'usuari pugui veure el que ha passat i desfer-ho.
