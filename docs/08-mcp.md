# 08 · Servidor MCP

El Model Context Protocol és, com diu el brief, *"la manera d'interactuar amb les tasques i el calendari més enllà del caldav"*.

Fem-ho exposa un servidor MCP remot que Claude, ChatGPT i altres clients poden connectar. **No té cap motor d'IA**: exposa dades i operacions, i registra qui fa què.

---

## 1 · Les dues eres del protocol

L'especificació va canviar de forma substancial. Val la pena saber-ho abans de dissenyar res:

- Fins a la revisió de finals de 2025, el protocol és **amb sessió**: hi ha un `initialize`, un identificador de sessió a les capçaleres, i un flux d'esdeveniments obert.
- La revisió de mitjan 2026 **elimina tot això**: sense `initialize`, sense sessions, sense punt final de lectura separat. Cada petició és autodescriptiva i porta la seva metainformació.

**Per a una app autoallotjada, la segona és molt millor**: un sol `POST /mcp` sense cap estat de sessió al servidor, que encaixa gairebé un a un amb la capa de servei que ja existeix per a l'API REST.

**Però els clients reals encara van amb la primera.** La documentació de connectors de Claude encara descriu la semàntica antiga.

**La decisió: fer servir un SDK oficial que serveixi les dues eres des del mateix servidor**, en comptes d'implementar el format de cable a mà. Comprova quin ho fa i en quina versió **quan facis l'scaffold** — el research en dona números que ell mateix marca com a dubtosos.

---

## 2 · Autenticació

L'especificació demana OAuth 2.1 amb el servidor com a *resource server*, metadades de recurs protegit, registre dinàmic de client i indicadors de recurs.

Per a una instal·lació casolana això és desproporcionat. **Claude accepta capçaleres estàtiques** — una clau d'API que l'usuari enganxa — i això és el que Fem-ho fa servir per defecte.

El token és un `femho_pat_…` normal, amb les mateixes capacitats i el mateix abast d'àmbits que qualsevol altre ([`05-api-rest.md`](05-api-rest.md) §2).

### El detall d'HTTP que decideix si funciona

Quan falta el token o no val, s'ha de respondre **`401` amb la capçalera `WWW-Authenticate`**.

Si en comptes d'això respons `200` amb un resultat d'error dient "cal iniciar sessió", el client li dona aquest text al model com si fos el resultat de l'eina, i **l'usuari no veu mai cap botó de connectar**. És l'error que fa que un servidor MCP sembli trencat sense donar cap pista.

### Prohibit reenviar el token

El token que arriba a Fem-ho és **per a Fem-ho**. S'ha de validar que ho sigui, i **no s'ha de reenviar mai** a un CalDAV extern ni a cap altre servei. Reenviar-lo és el problema del diputat confús, i l'especificació ho prohibeix explícitament.

---

## 3 · Les tools

**Sense prefix, verb primer** (D6). Els clients ja fan namespace pel seu compte — a Claude una tool acaba sent `mcp__femho__list_tasks` — i posar-hi un `femho_` a sobre malgasta tokens a cada nom, a cada crida i a cada finestra de context.

S'ordenen **alfabèticament** a la llista: els clients cacheguen, i un ordre estable millora els encerts de la memòria cau de prompts.

Són **17**. La disciplina de nombre importa: una definició de tool ocupa entre 100 i 500 tokens, i amb catàlegs de 40 tools una part gran de la finestra de context se'n va en metadades abans de començar. Hi ha servidors MCP de Vikunja que n'exposen més de 30, i és un error que no s'ha de copiar.

### Lectura

| Tool | Què fa |
| --- | --- |
| `whoami` | Qui és el token, què pot fer, **quins àmbits veu**. La primera que hauria de cridar un agent. |
| `get_briefing` | Resum orientat a agent: àmbits amb les seves instruccions, projectes, què hi ha pendent, què està delegat. Estalvia sis crides. |
| `list_scopes` | Àmbits accessibles, amb descripció i instruccions. |
| `list_projects` | Projectes, filtrables per àmbit. |
| `list_tasks` | Tasques amb filtres i paginació. |
| `get_task` | Una tasca sencera: subtasques, llistes, comentaris, adjunts, historial. |
| `search_tasks` | Cerca de text. |
| `list_events` | Esdeveniments en una finestra. **Requereix `from` i `to`.** |

### Escriptura

| Tool | Què fa |
| --- | --- |
| `create_task` | Crea. Respecta `can_create_tasks` de l'agent. |
| `update_task` | Modifica camps. |
| `move_task` | Canvia `status` i `position`. |
| `complete_task` | Completa, amb cascada i recurrència. |
| `add_comment` | Comenta. **És la via principal perquè un agent reporti.** |
| `ask_user` | Pregunta **i s'atura**: el comentari surt igual, i la tasca passa a demanar atenció. La marca la baixa una resposta d'una persona, o completar la tasca. Mai un «vist». |
| `update_checklist_item` | Marca un ítem. |

### Flux de treball d'agent

| Tool | Què fa |
| --- | --- |
| `next_task` | Retorna la següent tasca delegada disponible **i la reserva**. |
| `release_task` | Allibera la reserva, amb un motiu. |

`next_task` i `release_task` són el que evita que dos agents facin la mateixa feina. Estan detallades a [`09-mode-ia.md`](09-mode-ia.md).

### Anotacions

Cada tool declara les seves pistes de comportament, i cal encertar-les perquè són el que permet que un client aprovi sol les de lectura i sempre demani confirmació per a les destructives:

| Tool | Només lectura | Destructiva | Idempotent |
| --- | --- | --- | --- |
| `whoami`, `get_*`, `list_*`, `search_*` | sí | no | sí |
| `create_task`, `add_comment`, `ask_user` | no | no | no |
| `update_*`, `move_task`, `complete_task` | no | no | sí |
| `release_task` | no | no | sí |
| `next_task` | no | no | **no** |

**Fem-ho no exposa cap tool d'esborrar.** Un agent no esborra res: com a molt marca i comenta. Si un dia cal, serà destructiva i amb confirmació.

### Errors

Tres nivells, i confondre'ls fa que els agents entrin en bucle:

- **Fallada de negoci o validació** → resultat de la tool marcat com a error, amb text llegible. El model se'n pot recuperar sol.
- **Tool desconeguda o petició mal formada** → error de protocol.
- **Autenticació o permisos** → **`401` o `403` d'HTTP**, mai cap dels dos anteriors.

Els missatges han de ser accionables: *"Aquest token només té accés a l'àmbit Feina. La tasca 0192f3a1 és a Personal."* Un 403 mut fa que l'agent reintenti fins a esgotar el límit de ritme.

### Engegar-lo, de debò

La credencial d'un agent es crea a **Ajustos ▸ Usuari IA**, dins de l'agent, i **no** a MCP i API: allà hi surt en només lectura, marcada com d'IA i amb un botó que hi porta. Els àmbits no es trien al token —els hereta de l'agent—, que és el que evita l'estat impossible d'un token per a un àmbit que l'agent no porta.

Els exemples de `.mcp.json` per a Claude Code, Codex i Hermes/openclaw són a [`agent/connectar.md`](agent/connectar.md), i el full de comportament —quin bucle segueix, quan preguntar en comptes d'endevinar— a [`agent/SKILL.md`](agent/SKILL.md).

---

## 4 · Recursos

Els clients actuals gairebé no fan servir recursos: prioritza les tools. Els que hi ha:

| Recurs | Què és |
| --- | --- |
| `femho://scopes/{id}/instructions` | Instruccions de l'àmbit |
| `femho://projects/{id}/instructions` | Instruccions del projecte |
| `femho://tasks/{id}/attachments/{id}` | Un fitxer de context |
| `femho://guide` | Com parlar amb Fem-ho: vocabulari, columnes, què vol dir cada mode d'IA |

Els adjunts es retornen com a **enllaç a recurs** des de `get_task`, no com a contingut incrustat. Una tasca amb tres PDF de context no ha de fer explotar la finestra de context de qui només volia veure el títol.

---

## 5 · Ajustos

Pestanya **MCP i API** ([`02-ui-web.md`](02-ui-web.md) §9):

- Commutador d'activació. **Per defecte desactivat.**
- Permisos, com a grups de capacitats: només lectura, lectura i escriptura, o personalitzat.
- Àmbits accessibles, amb multiselecció.
- La URL del punt final i el token, amb botó de copiar i codi QR.
- Instruccions de connexió per a Claude i ChatGPT.
- Una menció que existeix un pont de stdio a HTTP per a clients que només parlen stdio, amb l'advertiment que és una solució provisional i que no s'hi ha de dissenyar l'arquitectura al voltant.

---

## 6 · Registre

**Cada crida a una tool escriu a `activity_log`** amb `source='mcp'`, l'agent com a actor, la tool i els arguments.

Això és el que fa que la pestanya de compartits i l'historial de tasques serveixin de res: l'usuari ha de poder veure exactament què ha fet una IA i quan.

Les crides de només lectura també s'hi registren, però amb retenció més curta, perquè si no ofeguen la taula.

---

## 7 · Seguretat

**El text de les tasques és entrada no fiable** (regla 10 d'`instruccions.md`). Qualsevol pot escriure instruccions dins d'un títol amb la intenció que un model se les cregui.

Fem-ho no pot evitar-ho, però sí:

- **Marcar la provinença.** El contingut que ve d'un enllaç compartit o d'un calendari extern va etiquetat com a tal quan es retorna per MCP.
- **Mantenir els tokens estrets.** Un token per àmbit limita el radi.
- **No exposar cap tool d'esborrar.**
- **Ensenyar-ho tot.** L'usuari veu a Ajustos exactament què pot tocar cada token, i a l'historial què ha tocat.

---

## 8 · Proves

- **Amb l'inspector oficial d'MCP**: llistar tools, cridar-les, comprovar esquemes. És la comprovació de la fita.
- **Un token amb un sol àmbit**: comprovar que `list_tasks` no en retorna d'altres i que `get_task` d'una tasca de fora dona `403` amb missatge útil.
- **Sense token**: comprovar que la resposta és `401` **amb `WWW-Authenticate`**, no `200` amb un error a dins.
- **Reserva concurrent**: dos agents criden `next_task` alhora i reben tasques diferents.
- **Ordre estable**: la llista de tools surt sempre igual.
