# Connectar Fem-ho amb MCP i API

A partir de 0.19.0, **Ajustos → MCP i API** permet activar separadament l'API externa i
MCP. Són preferències de cada persona. Apagar-les pausa les credencials corresponents,
incloses les dels seus agents IA, sense tancar les sessions de la web ni d'Android.

## Permisos de cada connexió

- **Àmbits:** selecciona Personal, Feina, Família o qualsevol combinació. «Tots els
  actuals» copia els àmbits existents; crear-ne un de nou no amplia cap credencial.
- **Només lectura:** consultar tasques, esdeveniments, projectes i àmbits autoritzats.
- **Lectura i escriptura:** també crear, editar, moure i completar tasques. No inclou
  eliminar-les. Les eliminacions REST de tasques i esdeveniments són un permís avançat.
- **Personalitzat:** tria **Consultar**, **Crear**, **Moure i completar**, **Editar** i
  **Adjuntar fitxers** per separat. Els permisos s'apliquen als àmbits seleccionats i al
  rol que hi tens. El consentiment OAuth marca per defecte les operacions de tasques
  que ha demanat el client. Les pots desmarcar. Tria els àmbits que vols compartir o
  selecciona'ls tots amb **Tots els actuals**.
- **Canals:** API, MCP o tots dos, en els tokens manuals. OAuth concedeix només MCP.
- **Caducitat:** els tokens manuals proposen 90 dies, editables. El secret es mostra
  només una vegada; al servidor només se'n guarda el hash.

Els tokens personals poden veure totes les tasques dels àmbits concedits, inclòs
Inbox. Els tokens d'agent continuen actuant com un agent: només tasques assistides o
delegades i dins de la seva assignació. En crear una credencial d'agent es pot limitar
encara més l'abast i triar només lectura. Un token no pot superar el propietari ni
concedir-se permisos a si mateix. La configuració de comptes, tokens, correu, compartits
i instància exigeix sessió de l'app; no queda oberta pel fet de tenir un token.

A **Ajustos → MCP i API**, la llista mostra els tokens manuals i les connexions OAuth
amb l'estat, l'últim ús, la caducitat, els canals i els àmbits. Pots editar o revocar un
token manual, i reduir els permisos o els àmbits d'una connexió OAuth o revocar-la.
Els canvis s'apliquen a la petició següent. Per ampliar una connexió OAuth, torna a
connectar des del client i confirma el consentiment. L'historial identifica el canal,
el nom i l'ID de la credencial.

## Connectar amb OAuth

Enganxa la URL de MCP al client i tria OAuth. El navegador obre Fem-ho. Si no hi tens
sessió, inicia-la amb el teu correu i contrasenya de Fem-ho. Comprova el compte i el
client que mostra el consentiment, tria els àmbits i revisa els permisos marcats.
Si MCP està desactivat, pots activar-lo en confirmar la connexió.

Fem-ho ofereix lectura i escriptura per defecte. Si el client en demana només una,
el consentiment mostra les operacions de tasques que hi corresponen. El client rep
una credencial pròpia per a MCP.

## Enviar una tasca des d'un LLM

1. Tria **Crear** i els àmbits on vols rebre tasques. Afegeix **Consultar** per trobar
   tasques pel títol, **Moure i completar** per canviar-ne la columna, i **Adjuntar
   fitxers** si vols incloure documents.
2. Crida `get_task_context` per obtenir els àmbits. Amb `scope_id` també torna els
   identificadors de projectes, tipologies, etiquetes i responsables. Per REST, fes
   `GET /api/v1/task-context?scope_id=…`.
3. Envia aquest tipus de càrrega amb `create_task` o `POST /api/v1/tasks`, substituint
   els identificadors pels de la teva instància. Genera `id` al client i reutilitza'l
   en els reintents.

```json
{
  "id": "01955f3c-3c04-7d4e-996b-644400000001",
  "scope_id": "ÀMBIT",
  "title": "Preparar el dossier",
  "description": "Incloure el resum i adjuntar les notes originals.",
  "project_id": "PROJECTE",
  "task_type_id": "TIPOLOGIA",
  "assignee_ids": ["PERSONA"],
  "label_ids": ["ETIQUETA"],
  "status": "todo",
  "due_date": "2027-01-15",
  "due_time": "10:30",
  "deadline": "2027-01-15T17:00:00+01:00",
  "ai_mode": "assisted",
  "ai_instructions": "Comprova que el resum inclogui els acords.",
  "subtasks": [{ "title": "Recollir les notes" }],
  "checklists": [{ "name": "Lliurament", "items": [{ "text": "Revisar el resum" }] }],
  "comments": [{ "body": "Tasca preparada a partir de les notes de la reunió." }]
}
```

Les columnes són Inbox (`inbox`), Per fer (`todo`), Fent (`doing`) i Fet (`done`). Sense
`status`, la tasca entra a Inbox. Amb `done`, `completed_at` accepta una data del perfil
o un instant amb zona horària. Si l'ometes, el servidor fa servir l'hora actual. Una
tasca recurrent importada a Fet es desa com a registre històric.

Per moure una tasca, crida `move_task` amb `task_id`, `status` i, opcionalment,
`expected_version` del rebut. Per REST, envia el cos a `POST /api/v1/tasks/{id}/move`
amb l'identificador a la ruta. La tasca queda al final de la columna si omets la posició.

Amb la tasca desada, crida `add_task_attachment` per a cada fitxer amb `task_id`, un
`id` UUID propi del fitxer, `filename` i un de `content_base64` o `url`. El contingut
Base64 a MCP té un màxim d'1 MiB. La URL ha de ser HTTPS i accessible des de Fem-ho.
Per REST, `POST /api/v1/tasks/{id}/attachments` accepta JSON amb `id`, `filename`,
`url`, o els bytes del fitxer com a `application/octet-stream` amb `id` i `filename`
a la consulta. Les pujades REST i les descàrregues per URL tenen el límit configurat
a la instància. Conserva l'identificador si has de reintentar un fitxer.

## ChatGPT

1. Copia la URL MCP que mostra Fem-ho, per exemple `https://tasques.example.net/mcp`.
2. Activa el mode desenvolupador de ChatGPT si el compte i l'espai de treball ho
   permeten. Afegeix el servidor a l'apartat de plugins/connectors amb autenticació OAuth.
3. Quan s'obri Fem-ho, segueix els passos de **Connectar amb OAuth**.
4. Comprova la connexió demanant la identitat (`whoami`) i una lectura (`list_tasks`).

[Instruccions oficials de ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).
Els noms i la disponibilitat dels menús depenen del compte i de la política de l'espai.

## Claude

A **Settings → Connectors → Add custom connector**, posa la URL MCP de Fem-ho i
connecta. El navegador obre el consentiment de Fem-ho. Fem-ho registra el client
OAuth automàticament.

[Connectors remots de Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Hermes

Afegeix al fitxer de configuració d'Hermes:

```yaml
mcp_servers:
  femho:
    url: https://tasques.example.net/mcp
    auth: oauth
    trust: untrusted
```

En connectar, completa OAuth al navegador. Alternativament, crea a Fem-ho un token
manual amb canal MCP, defineix `FEMHO_MCP_TOKEN` a l'entorn d'Hermes i utilitza:

```yaml
mcp_servers:
  femho:
    url: https://tasques.example.net/mcp
    headers:
      Authorization: "Bearer ${FEMHO_MCP_TOKEN}"
    trust: untrusted
```

[Configuració MCP oficial d'Hermes](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference/).

## Desplegament

No hi ha cap contenidor MCP separat: el mateix servidor ofereix `POST /mcp`.
`FEMHO_BASE_URL` ha de ser la URL pública canònica, amb HTTPS i sense camí addicional.
El proxy ha de reenviar `/mcp`, `/oauth/*`, `/.well-known/*`, `/connect/mcp` i `/api/v1/*`
al servidor, conservant `Authorization`, `Origin`, el cos i el tipus de contingut.
No s'han de posar darrere d'un segon login ni guardar-los en memòria cau. El proxy no
ha de registrar codis OAuth ni paràmetres de les URL d'autorització. El servidor
elimina aquestes queries dels seus logs i envia `Cache-Control: no-store` i
`Referrer-Policy: no-referrer` al flux OAuth.

Els clients de núvol han de poder arribar a la URL. `localhost` només serveix per a
proves amb clients locals; no és una URL vàlida per a ChatGPT o Claude al núvol.
Les crides amb `Origin` d'un altre domini es rebutgen; els clients de servidor sense
`Origin` poden usar MCP amb la seva credencial. No s'accepta una sessió de l'app com a
credencial MCP.

### Actualitzar una instància existent

Fes una còpia de seguretat seguint [BACKUP.md](BACKUP.md) i actualitza la imatge.
La migració `024-external-access` s'executa automàticament. Els comptes existents
conserven API i MCP actius; els nous comencen amb tots dos apagats.

Els tokens personals antics sense llista d'àmbits passen a una instantània dels
àmbits accessibles en migrar. Si no en tenien cap, queden sense accés fins que se'ls
editi. Els tokens d'agent que heretaven l'assignació la conserven. Les credencials de
federació no canvien. Els interruptors no afecten les app passwords de CalDAV.

OAuth persisteix a la mateixa base de dades. Els codis duren 2 minuts i només es poden
bescanviar una vegada amb PKCE S256. L'accés dura 15 minuts i el refresc, 30 dies des de
l'última rotació. Reutilitzar un refresc gastat revoca la sessió. El recurs MCP, client,
redirecció exacta i consentiment es comproven al servidor; ni els scopes OAuth ni
l'entrada de l'eina poden ampliar l'autorització. Els permisos, la revocació i els
interruptors es consulten a cada petició, també abans de renovar.

### Verificar sense modificar dades

Ajustos ofereix **Comprovar connexió MCP** després de crear un token: executa `whoami`
i, si es pot consultar tasques, `list_tasks`. Mostra els àmbits i permisos efectius. Per a OAuth, fes la mateixa
comprovació des del client després del consentiment. Un `401` indica credencial
invàlida o caducada; un `403`, canal apagat o permís insuficient. Si apareix una URL
incorrecta al descobriment, revisa `FEMHO_BASE_URL`.

La implementació es comprova amb el client oficial de l'SDK MCP, peticions OAuth
reals i proves de navegador. La configuració en comptes reals de ChatGPT, Claude i
Hermes queda subjecta a l'accés i les polítiques de cada client; no es dona per
verificada només perquè el protocol local passi.
