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
npm run check            # les 10 comprovacions permanents
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
| Proves unitàries · SQLite | 640 |
| Proves unitàries · Postgres | 661 |
| Comprovacions permanents | 10 de 10 |
| Proves de navegador | 78, de les quals 32 contra el servidor real |
| Proves de Kotlin | 40 |
| APK de depuració | es construeix |
| Primer arrencament amb Compose | 13 comprovacions |
| Matriu de proxies | 24 comprovacions, nginx i Caddy |
| Referències CalDAV | 6, contra Radicale i Xandikos |
| Restauració de còpia | 501 files, `integrity_check = ok` |

---

## El disseny validat

El projecte s'ha ajustat al disseny validat (`design/prototip/`, comparat el 2026-08-06
amb la versió del llenç). El que en va sortir:

| Canvi | On |
| --- | --- |
| Afegida ràpida **al peu de cada columna**, amb el botó rodó d'edició completa | web i Android |
| El commutador del **tauler de la IA** a la barra, amb el gir | web i Android |
| Subtasques i llistes **a la targeta**, sota "▸ Llistes (2)", amb formulari per afegir-n'hi | web i Android |
| Botó d'edició completa al tauler general | web |
| Persones **només a la bústia d'un àmbit col·lectiu** | web |
| Les tasques d'altres, darrere el commutador de l'epígraf i atenuades | web |
| El tauler omple la pantalla i cada columna es desplaça per dins | web |

**On no s'ha seguit el disseny, i per què:**

- **El llapis d'edició a la targeta.** El disseny hi posa un botó de 20px; `docs/02` §4
  diu que **clicar la targeta obre el modal**, que ja hi és i està provat. Amb les dues
  coses, el llapis és un segon camí cap al mateix lloc.
- **La pastilla `3/7`.** El disseny la treu i deixa només el commutador de llistes;
  `docs/02` §4 la demana explícitament ("una pastilla amb `3/7`"), i és l'únic que diu
  quant en falta amb la targeta plegada. Hi són les dues: la pastilla informa, el
  commutador desplega.
- **El camp de persones en crear una tasca.** El disseny l'ensenya; aquí l'assignació és
  una crida a part sobre una tasca que ja existeix, o sigui que surt en obrir-la. Abans
  d'aquest canvi, en crear, escrivia a `/tasks/undefined/assignees`.

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
| §7 Modal d'edició completa | fet menys els adjunts |
| §8 Tauler general | fet |
| §9 Ajustos | fet, les vuit pestanyes |
| §10 Responsive | fet |
| §11 Dreceres de teclat | fet, amb la paleta d'ordres |
| §12 Estats buits, càrrega i error | fet |

### L'única cosa que falta al modal (§7)

**Els adjunts**, amb el commutador de context per a la IA. No és una omissió per manca
de temps: `docs/12` no diu on es guarden els fitxers —volum, mida màxima, servei— i
inventar-ho voldria dir triar per l'operador coses que després no es poden desfer sense
migrar dades. El camp `attachments` és a `docs/05` §4 i l'endpoint no existeix.

La repetició, la data límit i el canvi de projecte **sí que hi són**.

### Sobre el constructor de repetició

Quatre opcions —cada dia, setmana, mes i any— més el commutador de "comptar des que es
completa". No hi ha editor de regles arbitràries: `BYDAY`, `BYSETPOS` i `WKST` són molta
pantalla per a un cas que gairebé ningú té. Una regla més complicada que arribi per
CalDAV **es conserva i s'ensenya tal com és**; sobreescriure-la seria perdre el que algú
va escriure en una altra app.

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
| Subtasques i llistes a la targeta | fet, amb el formulari d'afegir |
| Tauler de la IA | fet, amb el commutador a la barra |

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
- **L'app d'Android en execució.** Compila, empaqueta i les proves de Kotlin passen, però
  aquí no hi ha ni emulador ni telèfon: el que s'ha vist funcionar de veritat és la web.
- Les proves amb clients CalDAV reals: DAVx⁵, Apple Recordatoris, Thunderbird,
  Evolution, Nextcloud Tasks. Veure [`CALDAV-CLIENTS.md`](CALDAV-CLIENTS.md).
- La preservació de les propietats `X-FEMHO-*` en servidors de tercers. `docs/07` §7
  ja diu que és una suposició.

## Decisions obertes

- **El deute de contrast heretat de Plou.** Blanc sobre el gradient de marca dona
  1,88–2,61:1 en tres dels quatre accents, i `docs/04` §8 en demana 4,5:1. `docs/04` §1
  diu que Plou no es reescriu, o sigui que està registrat a `contrast-baseline.json`
  per bloquejar violacions noves sense tocar les heretades. **És una decisió teva.**
- **El formulari de tasca nova a Android.** El disseny mòbil posa un botó rodó al costat
  de cada afegida ràpida que obre l'edició completa. A Android el detall de tasca només
  edita una que ja existeix, i el botó necessitaria un formulari de creació que ara no hi
  és; s'ha deixat fora en comptes de posar un botó que no porta enlloc.
- **La contrasenya dels enllaços compartits** té un mínim de 6 caràcters i no de 10 com
  els comptes, justificat pel bloqueig als 5 intents. Una línia a `services/shares.ts`
  si no hi estàs d'acord.
