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
- **Canals:** API, MCP o tots dos, en els tokens manuals. OAuth concedeix només MCP.
- **Caducitat:** els tokens manuals proposen 90 dies, editables. El secret es mostra
  només una vegada; al servidor només se'n guarda el hash.

Els tokens personals poden veure totes les tasques dels àmbits concedits, inclòs
Inbox. Els tokens d'agent continuen actuant com un agent: només tasques assistides o
delegades i dins de la seva assignació. En crear una credencial d'agent es pot limitar
encara més l'abast i triar només lectura. Un token no pot superar el propietari ni
concedir-se permisos a si mateix. La configuració de comptes, tokens, correu, compartits
i instància exigeix sessió de l'app; no queda oberta pel fet de tenir un token.

La llista mostra l'estat, l'últim ús, la caducitat, els canals i els àmbits. Revocar és
immediat. Editar un token manual conserva el secret i aplica els nous límits a la
petició següent. Per canviar una autorització OAuth, revoca-la i torna a connectar:
cal consentiment nou. L'historial identifica el canal, el nom i l'ID de la credencial.

## ChatGPT

1. Copia la URL MCP que mostra Fem-ho, per exemple `https://tasques.example.net/mcp`.
2. Activa el mode desenvolupador de ChatGPT si el compte i l'espai de treball ho
   permeten. Afegeix el servidor a l'apartat de plugins/connectors amb autenticació OAuth.
3. Quan s'obri Fem-ho, inicia sessió i selecciona explícitament àmbits i permisos.
4. Comprova la connexió demanant la identitat (`whoami`) i una lectura (`list_tasks`).

[Instruccions oficials de ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).
Els noms i la disponibilitat dels menús depenen del compte i de la política de l'espai.

## Claude

A **Settings → Connectors → Add custom connector**, posa la URL MCP de Fem-ho i
connecta. El navegador obre el consentiment de Fem-ho, on tries àmbits i permisos.
El registre del client OAuth és automàtic; no cal crear un client de Google ni cap
proveïdor extern.

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
l'entrada de l'eina poden ampliar l'autorització. La revocació i els interruptors es
consulten a cada petició, també abans de renovar.

### Verificar sense modificar dades

Ajustos ofereix **Comprovar connexió MCP** després de crear un token: executa `whoami`
i `list_tasks`, i mostra els àmbits i permisos efectius. Per a OAuth, fes la mateixa
comprovació des del client després del consentiment. Un `401` indica credencial
invàlida o caducada; un `403`, canal apagat o permís insuficient. Si apareix una URL
incorrecta al descobriment, revisa `FEMHO_BASE_URL`.

La implementació es comprova amb el client oficial de l'SDK MCP, peticions OAuth
reals i proves de navegador. La configuració en comptes reals de ChatGPT, Claude i
Hermes queda subjecta a l'accés i les polítiques de cada client; no es dona per
verificada només perquè el protocol local passi.
