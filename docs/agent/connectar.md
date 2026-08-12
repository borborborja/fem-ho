# Connectar-hi un agent

Quatre coses i ja treballa: **un agent**, **els seus àmbits**, **una credencial** i **una
línia de configuració**. El transport és MCP i ja hi és; això és com s'hi entra.

## 1 · L'agent i d'on agafa feina

A **Ajustos ▸ Usuari IA**:

1. Escriu-hi un nom i crea'l. Un agent neix aturat i sense cap àmbit: encara no és de ningú.
2. Marca'l com a actiu, i marca **els àmbits que porta**. Un àmbit és **d'un sol agent**: els
   que ja té un altre surten desactivats amb el seu nom, perquè sàpigues a qui has d'anar.
3. «Tots els àmbits» val quan només hi ha d'haver un agent. Mentre un altre en tingui algun,
   no es pot.

El que veurà: **el kanban de la IA i prou** —les tasques `assisted` i `delegated` dels seus
àmbits—. La bústia no la veu mai, i res hi arriba sol (P12).

## 2 · La credencial

Al mateix agent, **+ Nova credencial**. El testimoni sencer surt **una sola vegada** —del
hash no se'n pot treure— i va amb el botó de copiar.

Els àmbits **no** es trien a la credencial: els hereta de l'agent. És el que evita tenir un
token per a Feina d'un agent que no la porta.

A **Ajustos ▸ MCP i API** hi surt en només lectura, marcada com d'IA i amb un botó que porta
a l'agent: és on la gent busca els tokens, i un token que existeix i no surt on el busques és
pitjor que no tenir-lo.

## 3 · La línia de configuració

L'URL és `https://LA-TEVA-INSTANCIA/mcp` (a Ajustos ▸ MCP i API la tens amb un botó de
copiar). La credencial viatja a `Authorization: Bearer …`.

### Claude Code i Claude Desktop

`.mcp.json` al projecte, o `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fem-ho": {
      "type": "http",
      "url": "https://la-teva-instancia/mcp",
      "headers": { "Authorization": "Bearer femho_pat_LA_TEVA_CREDENCIAL" }
    }
  }
}
```

Amb Claude Code també va d'una línia:

```bash
claude mcp add --transport http fem-ho https://la-teva-instancia/mcp \
  --header "Authorization: Bearer femho_pat_LA_TEVA_CREDENCIAL"
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.fem-ho]
url = "https://la-teva-instancia/mcp"

[mcp_servers.fem-ho.http_headers]
Authorization = "Bearer femho_pat_LA_TEVA_CREDENCIAL"
```

### Hermes, openclaw i qualsevol client d'MCP

Qualsevol client que parli **MCP sobre HTTP en mode sense estat** hi va: no cal cap sessió al
servidor, cada petició porta el seu token i es resol sola. Si el client només sap parlar per
`stdio`, posa-hi un pont d'`stdio` a HTTP; el servidor no hi canvia res.

## 4 · Comprovar que hi és

La primera crida ha de ser `whoami`. Ha de dir:

- `kind: "agent"` i l'`agent_id` del que has creat —si diu `user`, el token és d'una persona i
  no d'un agent, i `next_task` no li tornarà mai res;
- `scope_ids` amb els àmbits que li has marcat. Si surt buit, l'agent no en porta cap i no
  veurà cap tasca: torna al pas 1.

I després `get_briefing`, que és la segona: àmbits amb les seves instruccions, projectes, què
hi ha pendent i què està delegat, en una crida en comptes de sis.

## 5 · Com s'ha de comportar

El que fa que un agent sigui útil i no perillós no és el transport sinó el **bucle**: quan
agafa feina, quan la deixa anar, i **quan pregunta en comptes d'endevinar**. Això és
[`SKILL.md`](SKILL.md), i es pot donar tal qual a l'agent com a instruccions.
