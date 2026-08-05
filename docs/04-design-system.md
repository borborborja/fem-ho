# 04 · Design system

Fem-ho es construeix sobre **Plou**, el design system que ve a `Plou Design System.zip`.

Hi ha una cosa que has de saber abans de tocar-lo: **Plou és el design system d'una app del temps.** Es va fer per a un radar de precipitació. Els seus fonaments (color, tipografia, forma, moviment, temes) són excel·lents i s'aprofiten sencers. El seu joc d'icones i un terç dels seus components no serveixen de res aquí.

Aquest document diu exactament què s'agafa, què s'adapta i què es llença.

---

## 1 · Instal·lació

Plou es **vendoritza** a `packages/design-system/plou/`, tal com ve. No es reescriu.

Una sola importació:

```css
@import "plou/styles.css";
```

Que al seu torn importa els tokens **en aquest ordre**:

```
fonts · colors · theme · typography · shape · spacing · elevation · motion · accents · utilities
```

**`accents.css` va l'últim, i això no és negociable.** Els selectors `[data-accent]` i `:root` tenen la mateixa especificitat, o sigui que decideix l'ordre del codi. Si `accents.css` va abans, `elevation.css` torna a guanyar totes les ombres i les variants d'accent deixen de funcionar sense cap error.

L'arrel de cada pantalla porta els dos atributs:

```html
<div data-theme="light" data-accent="default">
```

`data-theme` val `light` o `dark`. `data-accent` val `default`, `soft`, `mono-warm` o `mono-cool`. Es llegeixen de les preferències de l'usuari; `system` resol amb `prefers-color-scheme`.

---

## 2 · Tokens: tot s'aprofita

Els 275 tokens es fan servir sencers. Cap valor de color, radi, espaiat, ombra o durada s'escriu literal enlloc.

| Fitxer | Què hi ha | Ús a Fem-ho |
| --- | --- | --- |
| `fonts.css` | Roboto 400/500/700/900 | Tal qual. **Cal autoallotjar-la**: el fitxer la carrega d'un CDN i una app autoallotjada no pot dependre'n. Substitueix l'`@import` per `@font-face` amb els `.woff2` al repositori. |
| `colors.css` | Tríada de marca, gradients, vidre, `--danger-*`, `--on-brand` | Tal qual. La tríada guanya un ús nou (secció 4). |
| `theme.css` | Superfícies de clar i fosc | Tal qual, **més un token nou** (secció 3). |
| `accents.css` | Els 4 accents | Tal qual, i s'exposen tots quatre a Ajustos. |
| `typography.css` | Escala i pesos | Tal qual. Els noms dels tokens grans (`--text-hero`, `--text-display`) parlen de temperatures; els valors serveixen igual. |
| `shape.css` | Radis, gruix d'icona | Tal qual. |
| `spacing.css` | Escala i paddings | Tal qual. `--sidebar-width` no es fa servir: Fem-ho no té barra lateral. |
| `elevation.css` | Ombres i desenfocaments | Tal qual. |
| `motion.css` | Durades i corbes, amb `prefers-reduced-motion` | Tal qual. |
| `utilities.css` | Classes `.plou-*` | Disponibles, però es prefereixen els components. |

### El token que falta

El prototip pinta el fons de les columnes del kanban amb `rgba(20,22,30,0.02)` literal, que en tema fosc és invisible. **És un bug i s'ha de corregir.** Cal afegir a `theme.css`, dins de cada bloc de tema:

```css
[data-theme="light"] { --column-bg: rgba(20,22,30,0.02); }
[data-theme="dark"]  { --column-bg: rgba(255,255,255,0.03); }
```

És l'única modificació autoritzada als fitxers de Plou. Qualsevol altra extensió va a `packages/design-system/femho/`.

---

## 3 · Components: què s'aprofita

### S'agafen tal qual (12)

`Button` · `IconButton` · `Card` · `Tag` · `Wordmark` · `SegmentedControl` · `ChoiceChips` · `SettingsGroup` (+`SettingsRow`) · `Switch` · `TextField` · `Dialog` · `NavItem`

Són React pla amb estils en línia sobre variables CSS. Es poden fer servir directament en una app real. Els contractes són als `.d.ts` de cada component; respecta'ls.

Detalls que compten:

- `Button` — `variant="primary"` porta el gradient de marca. **Un sol primari per vista.** El text hi va amb `var(--on-brand)`, mai `#fff` literal, o els accents pastel es trenquen.
- `Card` — `density` `comfy` al desktop (22px) i `mobile` (18px). El `tone="washCool"` es reserva a **una** targeta per vista.
- `SegmentedControl` — 2 a 4 opcions. Per sobre, `ChoiceChips`.
- `Wordmark` — el logotip de Fem-ho **és la paraula**, en Roboto 900 amb el gradient retallat al text. No hi ha símbol i no se n'ha de dibuixar cap.

### Disponible, però sense ús a la v1 (1)

`Slider` — cap pantalla de Fem-ho el necessita. Es queda vendoritzat i funcional, per si algun ajust futur en demana un. **No l'aprofitis per a res que no sigui un valor continu**; per a tries discretes hi ha `SegmentedControl` i `ChoiceChips`.

### S'adapta (2)

- **`Icon`** — l'embolcall serveix, el contingut no (secció 5).
- **`TabBar`** — la web no en fa servir. A Android es reaprofita la geometria (píndola flotant, 22px als costats, 18px del fons, desenfocament) si es decideix posar navegació inferior.

### Es descarten (9)

`TempReadout` · `StatTile` · `PrecipChart` · `ChartLegend` · `HourlyList` · `LocationCard` · `RadarViewport` · `MapControls` (+`ZoomControl`) · `AlertScreen`

Són components de meteorologia. Cap té equivalent a Fem-ho. **No els reaprofitis "perquè s'assemblen"**: `LocationCard` no és una targeta de tasca, i acabar-la doblegant costa més que escriure-la de nou.

`GlassBar` es descarta a la pràctica: el vidre a Plou existeix per flotar sobre el mapa del radar, i Fem-ho no té cap mapa. L'única superfície amb desenfocament és la barra superior, que ja fa servir `--sidebar-bg` i `--blur-sidebar`.

---

## 4 · Els colors d'àmbit: la regla que trenquem

El readme de Plou és taxatiu en dos punts:

> La tríada de marca — mai com a farciment pla.
> Un gradient per vista, com a màxim.

**Fem-ho trenca el primer deliberadament.** Els àmbits necessiten color categòric, i la tríada ja és el llenguatge del producte. Els chips d'àmbit pinten blau, taronja i rosa com a fons plans.

Aquesta és la regla estesa, i és la que mana a Fem-ho:

**1. La tríada té dos usos, i només dos.**
 - Identitat d'àmbit: chips, punts del calendari, epígrafs de grup, vora esquerra de les targetes de resum.
 - El gradient de marca, on Plou ja el posava.

**2. El gradient continua sent un per vista.** El color pla d'àmbit **no compta** com a gradient. Una vista pot tenir tres chips de colors i un sol element amb gradient.

**3. Un àmbit no pinta mai una superfície gran.** Ni fons de columna, ni fons de targeta, ni capçaleres. Només indicadors petits: chips, punts de 5–8px, vores de 3px.

**4. La targeta de tasca no es tenyeix d'àmbit.** Quan cal identificar-lo, es fa amb una pastilla o un punt. Si les targetes es tenyeixen, un tauler amb tres àmbits sembla un arbre de Nadal i el gradient de marca deixa de destacar.

**5. Els àmbits creats per l'usuari no fan servir la tríada.** Reben color d'una paleta ampliada de 8 tons, escollits per contrast suficient amb `--ink` en els dos temes i distingibles amb les formes més comunes de daltonisme. La tríada queda per als tres àmbits inicials.

**6. Els accents pastel manen sobre el color d'àmbit.** Amb `soft`, `--on-brand` passa a fosc; els chips actius han de fer servir `var(--on-brand)` per al text, mai blanc literal.

---

## 5 · Icones

Plou porta 10 glifs dibuixats a mà: radar, forecast, bell, settings, crosshair, search, sun, layers, play, pause. **De tots, en serveixen tres**: `bell`, `settings` i `search`.

Fem-ho necessita un joc nou. Les regles de dibuix es mantenen exactament:

- Graella de 24×24, `fill="none"`, `stroke="currentColor"`.
- Gruix `1.8`, i `1.6` a partir de 30px.
- Extrems i unions arrodonits.
- Definits **en línia** en un sol fitxer, com fa Plou. Cap font d'icones, cap sprite, cap paquet npm, cap CDN.
- Només `play` i `pause` van plens. La resta són només traç.
- **Cap emoji, cap caràcter Unicode com a icona.** `·`, `—`, `+` i `−` són tipografia, no iconografia.

El joc de Fem-ho:

| Nom | On es fa servir |
| --- | --- |
| `inbox` | Columna Inbox |
| `list` | Per fer, llistes senzilles |
| `play-circle` | Fent |
| `check-circle` | Fet |
| `calendar` | Switch de calendari |
| `calendar-days` | Vista mensual |
| `columns` | Switch de tasques |
| `pin` | Llistes pinejades |
| `plus` | Crear |
| `chevron-down` `chevron-left` `chevron-right` | Desplegables i navegació |
| `user` `users` | Persona, àmbit col·lectiu |
| `folder` | Projecte |
| `tag` | Etiqueta |
| `clock` | Hora |
| `flag` | Deadline |
| `repeat` | Recurrència |
| `paperclip` | Adjunt |
| `message-square` | Comentari |
| `history` | Historial |
| `share` | Compartir |
| `link` | Enllaç compartit |
| `sparkles` | Mode IA |
| `shield-check` | Permisos, tokens |
| `server` | Servidor, CalDAV |
| `plug` | MCP i API |
| `search` `bell` `settings` | Reaprofitats de Plou |
| `trash` | Esborrar |
| `x` | Tancar |
| `grip-vertical` | Nansa d'arrossegar |

Els glifs es prenen de **Lucide** i s'ajusten al gruix 1.8 abans d'afegir-los al fitxer. És el que ja recomana el readme de Plou per a glifs que el seu joc no cobreix.

---

## 6 · Components nous de Fem-ho

Viuen a `packages/design-system/femho/`, es construeixen **només** amb tokens de Plou, i mai importen res de `weather/`.

| Component | Què és |
| --- | --- |
| `TaskCard` | La targeta del kanban: cercle d'estat, títol, metadades, distintiu d'IA, accions ràpides. |
| `KanbanColumn` | Contenidor de columna amb capçalera, recompte, scroll i afegida al peu. Variant `inbox` amb aspecte de targeta sòlida. |
| `InboxRail` | L'Inbox. **Una sola implementació** per al kanban i per al calendari (P4). |
| `QuickAddInput` | Camp d'afegida amb parseig, xips reversibles i autocompletat accessible de `@` i `#`. |
| `MentionPopover` | El desplegable d'autocompletat. Desplegable al desktop, full al mòbil. |
| `CalendarGrid` | Mes, setmana i dia, amb punts d'àmbit i selecció. |
| `ScopeChip` | Chip d'àmbit amb els estats actiu i inactiu de la secció 4. |
| `ChecklistRow` | Ítem de llista senzilla: casella rodona i text. |
| `AiModeBadge` | Els tres modes d'IA, llegible dins d'una targeta densa. |
| `ActivityTimeline` | Historial de canvis amb actors humans, d'IA i externs. |
| `ShareDialog` | Creació i gestió d'un enllaç compartit. |
| `EmptyState` | Estat buit amb frase sencera. |
| `SyncPill` | Indicador de canvis pendents i de sense connexió. |

Cadascun ha de portar el seu `.d.ts`, com fan els de Plou.

---

## 7 · Port a Compose

Els tokens s'exporten **des del CSS cap a Kotlin**, en una direcció (D7). El CSS és la font de veritat: ja codifica cascada i especificitat que un generador de variables planes destruiria.

Els que tenen equivalent a Material 3 hi van:

- Colors de superfície → esquema de colors, amb dos esquemes complets (clar i fosc) per cada accent.
- Escala tipogràfica → estils de text, amb Roboto als quatre pesos.
- Radis → formes.

Els que **no** tenen equivalent van a un objecte de tokens propi, exposat per `CompositionLocal`: gradients, colors d'àmbit, `--ink-soft` i `--ink-faint`, l'escala d'espaiat completa, les durades i corbes, i els desenfocaments.

Els gradients es fan amb `Brush.linearGradient` amb les mateixes parades i el mateix angle. **El text amb gradient es fa amb `Brush` sobre `TextStyle`**, no amb una imatge.

`prefers-reduced-motion` es llegeix de la configuració d'animacions del sistema i posa totes les durades a zero.

---

## 8 · Accessibilitat

El readme de Plou reconeix que el focus **no està definit**: *"el codi font no en defineix cap, afegeix-ne un si ho publiques de veritat"*. Fem-ho l'ha de definir.

- **Focus visible**: anell de 2px amb `var(--plou-blue)` i 2px de separació, a tot element interactiu. En elements amb gradient, l'anell va per fora.
- **Contrast**: text normal 4.5:1, text gran 3:1, en els dos temes i els quatre accents. L'accent `soft` és el que menys marge té: `--on-brand` hi passa a fosc precisament per això.
- **Objectius tàctils**: 44px mínim al mòbil.
- **El kanban és navegable amb teclat**, incloent-hi moure targetes (veure [`02-ui-web.md`](02-ui-web.md) §4).
- **El color no és mai l'únic senyal**: l'àmbit sempre porta text a més de color; el mode IA porta icona a més de color.
- **`prefers-reduced-motion`**: ja gestionat pels tokens; no l'anul·lis amb animacions fetes a mà.

---

## 9 · Contingut

Plou defineix una veu, i Fem-ho l'hereta canviant l'idioma de castellà a català.

Plana i concreta. Sense "nosaltres", sense personalitat, sense felicitacions. Sentence case a tot arreu; MAJÚSCULES només als epígrafs. El punt volat `·` com a separador. Estats buits en frase sencera. Botons que afegeixen amb `+` literal. **Cap emoji.**

Les convencions de data, hora i format català són a [`00-visio-i-glossari.md`](00-visio-i-glossari.md).
