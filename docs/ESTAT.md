# Estat del producte

Què hi ha, què s'ha verificat i **què encara no hi és**. Es manté al dia amb el codi:
una llista d'estat que exagera és pitjor que no tenir-ne cap.

Data de l'última verificació completa: **2026-08-06**.

---

## Com es verifica

```bash
npm run build            # contracts → server → web, en ordre de dependència
npm run typecheck        # 0 errors
npm run lint             # 0 errors
npm test                 # unitàries, SQLite
npm run test:postgres    # unitàries, Postgres (cal FEMHO_TEST_POSTGRES_URL)
npm run check            # les 9 comprovacions permanents
npm run e2e              # navegador, contra un servidor real
npm run test:android     # Kotlin pur, sense emulador
npm run android:build    # APK de depuració
npm run test:fresh-install   # docker compose des d'un volum buit
npm run test:proxy-matrix    # CalDAV i SSE darrere de nginx i Caddy
```

| Comprovació | Resultat |
| --- | --- |
| Construcció des de zero | contracts → server → web |
| Tipus · estil | 0 · 0 |
| Proves unitàries · SQLite | 617 |
| Proves unitàries · Postgres | 638 |
| Comprovacions permanents | 9 de 9 |
| Proves de navegador | 66, de les quals 21 contra el servidor real |
| Proves de Kotlin | 30 |
| APK de depuració | es construeix |
| Primer arrencament amb Compose | 13 comprovacions |
| Matriu de proxies | 24 comprovacions, nginx i Caddy |
| Referències CalDAV | 6, contra Radicale i Xandikos |
| Restauració de còpia | 501 files, `integrity_check = ok` |

---

## Servidor

Complet respecte de `docs/05` §4: **106 rutes**. Autenticació amb refresc rotatiu,
capa de política única, `activity_log` dins de la mateixa transacció que el canvi,
sincronització amb cursor, CalDAV en port propi, MCP amb 16 tools, compartits,
notificacions i administració.

Els dos motors es proven: la suite `dual-engine` recorre els camins d'escriptura a
SQLite **i** a Postgres, i `concurrency` hi busca curses.

---

## Web

Les dotze seccions de `docs/02`:

| Secció | Estat |
| --- | --- |
| §1 Estructura general | fet |
| §2 Login | fet |
| §3 Barra superior | fet, les vuit peces |
| §4 Kanban | fet, amb arrossegament de ratolí i de teclat |
| §5 Calendari | fet: mes, setmana, dia i rail configurable |
| §6 Vista de llista senzilla | fet |
| §7 Modal d'edició completa | **parcial** — veure sota |
| §8 Tauler general | fet |
| §9 Ajustos | fet, les vuit pestanyes |
| §10 Responsive | fet |
| §11 Dreceres de teclat | fet menys `Cmd/Ctrl+K` |
| §12 Estats buits, càrrega i error | fet |

### Què falta al modal (§7)

- **Repetició** — el constructor d'`RRULE` i el commutador "comptar des que es
  completa". El servidor ja ho suporta (`recurrence_mode`), la interfície no.
- **Adjunts** — amb el commutador de context per a la IA. Tampoc hi ha l'endpoint.
- **Deadline** — el camp existeix a la base i a l'API; el modal només ensenya el
  venciment.
- **Canviar d'àmbit o de projecte** — s'ensenyen, no s'editen.

### Què falta a les dreceres (§11)

- **`Cmd/Ctrl+K`**, la paleta d'ordres. La resta hi són.

---

## Android

Els vuit mòduls de `docs/03` §11 existeixen i l'APK es construeix.

| Peça | Estat |
| --- | --- |
| Login amb camp de servidor, validat amb `GET /info` | fet |
| `https://` primer, `http://` amb avís i restringit a xarxa privada | fet |
| Tokens de Plou exportats a Compose | fet, generats i comprovats |
| Català des del mateix catàleg que la web | fet, generat i comprovat |
| Paritat de l'índex fraccional i del parser | fet, mateixos fixtures |
| Regles de la cua de sortida | fet, en Kotlin pur i provades |
| Tauler en pager horitzontal al 80% | fet |
| Calendari mensual i diari | fet |
| Ajustos amb tema i accent | fet |
| Base local amb Room i cua de sortida | fet |
| Detall de tasca, com a full des de baix | fet |
| Afegida ràpida amb xips reversibles | fet, amb el parser compartit |
| UnifiedPush, amb consulta periòdica com a alternativa | fet, **sense provar amb un distribuïdor real** |
| Vista setmanal | fet |

El detall té menys camps que el modal de la web, i és deliberat (`docs/03` §6): al mòbil
s'edita el que es toca sovint —títol, estat, mode d'IA i les llistes— i la resta es fa
des de la web. Un formulari de disset camps en una pantalla de 5,5 polzades no s'omple;
s'abandona.

---

## El que necessita un dispositiu o una persona

No es pot verificar en aquesta màquina i **no s'ha verificat**:

- `androidTest: airplane-mode-reconciliation` — cal un emulador o un telèfon.
- **UnifiedPush amb un distribuïdor real** (ntfy, Sunup). El codi hi és i compila, però
  no s'ha vist arribar cap notificació: cal un telèfon amb un distribuïdor instal·lat.
  La consulta periòdica, que és el que tindrà la majoria de gent, sí que és independent
  del distribuïdor.
- La comparació de captures entre la web mòbil i l'app — el mateix.
- Les proves amb clients CalDAV reals: DAVx⁵, Apple Recordatoris, Thunderbird,
  Evolution, Nextcloud Tasks. Veure [`CALDAV-CLIENTS.md`](CALDAV-CLIENTS.md).
- La preservació de les propietats `X-FEMHO-*` en servidors de tercers. `docs/07` §7
  ja diu que és una suposició.

## Decisions obertes

- **El deute de contrast heretat de Plou.** Blanc sobre el gradient de marca dona
  1,88–2,61:1 en tres dels quatre accents, i `docs/04` §8 en demana 4,5:1. `docs/04` §1
  diu que Plou no es reescriu, o sigui que està registrat a `contrast-baseline.json`
  per bloquejar violacions noves sense tocar les heretades. **És una decisió teva.**
- **La contrasenya dels enllaços compartits** té un mínim de 6 caràcters i no de 10 com
  els comptes, justificat pel bloqueig als 5 intents. Una línia a `services/shares.ts`
  si no hi estàs d'acord.
