# Fem-ho

Un gestor de tasques i calendari **per a una casa**, pensat per autoallotjar-se. Web, app
d'Android i un servidor que parla CalDAV i MCP.

En català, anglès i castellà.

---

## Què és

Un tauler kanban de quatre columnes, un calendari, llistes senzilles i una bústia
compartida, amb tres idees que el distingeixen d'un gestor de tasques qualsevol:

- **Àmbits**, no projectes solts. Personal, feina i família conviuen al mateix tauler i
  es filtren amb un clic. Una tasca sempre pertany a un àmbit; pot no tenir projecte.
- **CalDAV de veritat**, en les dues direccions. El calendari del telèfon i el de
  l'ordinador veuen el mateix, i un `.ics` o un RSS externs es poden posar com a font.
- **La IA com un membre més**, no com una capa a sobre. Una tasca es pot delegar, l'agent
  la reserva mentre hi treballa, i tot el que fa queda a l'historial amb "Desfés" al
  costat.

## Com s'engega

```bash
docker compose up -d
```

I a `http://localhost:8080` hi ha `/setup`, que crea el primer administrador i tanca la
porta per sempre. Amb Postgres en comptes de SQLite, `compose.postgres.yaml`.

La imatge és multi-arquitectura (`amd64` i `arm64`), o sigui que va igual en un servidor
que en una Raspberry Pi:

```
ghcr.io/borborborja/fem-ho:latest
```

Els detalls d'operació —proxy invers, còpies de seguretat, restauració— són a
[`docs/DEPLOY.md`](docs/DEPLOY.md) i [`docs/BACKUP.md`](docs/BACKUP.md).

## Com es desenvolupa

```bash
npm ci
npm run build
npm test                 # unitàries, SQLite
npm run test:postgres    # les mateixes, contra Postgres
npm run check            # les dotze comprovacions permanents
npx playwright test      # navegador, contra un servidor real
npm run test:android     # Kotlin pur, sense emulador
```

### Les dotze comprovacions permanents

No són linters de format: cadascuna impedeix **una manera concreta de trencar el producte
sense que res falli**. Totes tenen autoprova, perquè una comprovació que diu "verd" sense
comprovar res és pitjor que no tenir-la.

| | Què impedeix |
| --- | --- |
| `openapi-diff` | Tocar un handler sense actualitzar el contracte |
| `vocab-lint` | Que el vocabulari del prototip s'infiltri al codi (`column: 'fet'`) |
| `no-hardcoded-colors` | Un color escrit a mà que no segueixi el tema ni l'accent |
| `i18n-lint` | Text escrit al codi en comptes del catàleg |
| `i18n-parity` | Una clau o un marcador `{x}` que falti en un idioma |
| `i18n-keys-exist` | Una errata a `t('...')`, que compila i s'ensenya crua a la cara |
| `no-pinned-from-research` | Una versió de dependència sense procedència registrada |
| `contrast-check` | Contrast per sota de l'AA als vuit temes |
| `audit-coverage` | Un camí d'escriptura que no deixi rastre a l'historial |
| `parser-parity` | Que el parser de la web i el d'Android divergeixin |
| `tokens-parity` | Que els colors de Compose s'endarrereixin respecte del CSS |
| `css-classes` | Una classe que no existeix — es veu sense estil i res falla |

## Com està fet

Monorepo amb npm workspaces:

```
apps/server      Fastify (/api/v1) · node:http (CalDAV) · MCP · SSE · feines programades
apps/web         React + Vite, PWA amb cua de sortida
apps/android     Kotlin + Compose, Room i UnifiedPush
packages/contracts       openapi.yaml, catàlegs d'idioma, parser i índex fraccional
packages/design-system   Plou vendoritzat + els components de Fem-ho
tools/checks     les dotze comprovacions
docs/            quinze documents normatius
```

**El que han de compartir la web i Android viu a `packages/contracts`**, i es compara amb
fixtures: l'índex fraccional, el parser d'afegida ràpida, els catàlegs i el primer dia de
la setmana. Si cadascú ho calculés pel seu compte divergirien un dia, i cap de les dues
donaria cap error.

L'estat honest del producte —què està provat, què necessita un dispositiu i què encara no
hi és— és a [`docs/ESTAT.md`](docs/ESTAT.md).

## Llicència

Encara no n'hi ha cap. Sense llicència, tots els drets queden reservats: es pot llegir,
però no reutilitzar. Si això no és el que vols, cal afegir-hi un `LICENSE`.

El design system **Plou**, a `packages/design-system/plou/`, ve d'un projecte a part i
porta les seves pròpies condicions.
