# 02 · UI web

El prototip `Fem-ho Web.dc.html` ja resol bona part d'això. **Quan aquest document i el prototip coincideixin, mana el prototip**: mesures, jerarquia, textos catalans. Quan aquest document afegeixi una pantalla que el prototip no té, és perquè el brief la demana i el prototip es va quedar curt.

Per extreure el prototip: `unzip -o "Fem-ho app webmobile.zip"`.

---

## 1 · Estructura general

Arrel amb `data-theme` i `data-accent`, `min-height:100vh`, fons `var(--page-bg)`, tipografia `var(--font-sans)`.

Tres pantalles de primer nivell: **login**, **app** i **compartit públic**. Dins d'app: **tauler**, **dashboard global** i **ajustos**.

Amplada màxima del contingut `1360px` (`--content-max`), centrada, amb 28px de padding lateral.

---

## 2 · Login

Targeta centrada de `380px` màxim, `var(--card-bg)`, vora hairline, `var(--card-shadow)`, radi `var(--radius-card)`, padding `40px 36px`.

De dalt a baix: el wordmark "Fem-ho" a 30px pes 900 amb `var(--gradient-brand-text)` retallat al text; el subtítol "El gestor de tasques per a tu i la família" a 13,5px en `var(--ink-soft)`; els camps "Correu" i "Contrasenya" (`TextField` amb `tone="surface"`); el botó "Entrar" a amplada completa; i l'enllaç "Has oblidat la contrasenya?".

**A la web no hi ha camp de servidor.** El servidor és el que serveix la pàgina. Això és una diferència deliberada amb Android.

**Errors**: missatge sota els camps, `var(--danger-text)` a 12px. Mai es diu si el correu existeix o no — sempre "Correu o contrasenya incorrectes".

---

## 3 · La barra superior

Enganxada a dalt, `z-index:30`, fons `var(--sidebar-bg)`, `backdrop-filter: blur(14px)`, vora inferior hairline. Dins, una fila amb 22px de separació que embolica.

D'esquerra a dreta:

**1. Wordmark "Fem-ho"** — 24px, pes 900, gradient retallat al text. **És un botó**: clicar-lo obre el dashboard global. El prototip no ho té i el brief ho demana (línia 38). Ha de tenir `cursor:pointer` i `aria-label`.

**2. Switch Tasques / Calendari** — `SegmentedControl` mida `md`, ~200px.

**3. Chips d'àmbit** — un per àmbit, multiselecció. Actiu: fons del color de l'àmbit, text blanc, pes 700. Inactiu: `var(--ghost-bg)`, `var(--ink-soft)`, pes 500. Píndola de 100px, padding `9px 16px`.

**No es poden desactivar tots.** Si l'usuari desmarca l'últim, es rebutja el canvi (el prototip ja ho fa: comprova que quedi almenys un actiu). Canviar la selecció d'àmbits **buida els projectes triats**, perquè un projecte d'un àmbit desactivat filtraria el tauler sense que es vegi per què.

**4. Filtre de projectes — a cada xip d'àmbit.** Els àmbits que tenen projectes porten un botonet enganxat al xip, amb un `▾` i el recompte dels triats si n'hi ha cap. Obre un menú amb "Tots els projectes" i després els projectes **d'aquell àmbit**, cadascun amb marca de selecció; se'n poden marcar diversos i el menú **no es tanca** en marcar-ne un. Màxim 260px d'alçada, amb scroll.

**Aquí hi havia una píndola de 170px a la dreta de tots els xips**, que triava un sol projecte i sortia encara que no n'hi hagués cap enlloc. Es va treure per tres coses: filtrava lluny d'allò que filtra, obligava a triar-ne un de sol, i un desplegable buit és una promesa que no es compleix. Veure `docs/14` P7.

**Un àmbit sense projectes no porta botonet.** I un àmbit del qual no s'ha triat res vol dir *tots els seus*: no hi ha manera de dir "cap projecte", que no voldria dir res.

**5. Botó `+`** — cercle de 38px. Obre un menú amb dues opcions: **"+ Nou projecte"** i **"+ Nova llista de tasques"**. Totes dues porten a Ajustos, que és on es crea l'estructura: els projectes viuen amb els àmbits, agrupats per àmbit.

> El brief demana reanomenar "llista de tasques" a **"llista de tasques senzilles"** (línia 45). Al menú, per espai, "+ Nova llista"; al diàleg, el títol complet.

**6. Botó de llistes pinejades** — *no és al prototip; el brief el demana (línia 45).* A la dreta del switch. Cercle de 38px amb icona de xinxeta i una pastilla amb el recompte si n'hi ha. Obre un desplegable amb les llistes pinejades de l'usuari. Si no n'hi ha cap, el botó no es mostra.

**7. Espaiador flexible.**

**8. Botó de perfil** — cercle de 38px amb les inicials, `var(--tag-bg)`. Menú amb nom i correu, "Ajustos" i "Tancar sessió" (aquest en `var(--danger-text)`).

Només un menú obert alhora: obrir-ne un tanca els altres. Es tanquen amb `Escape` i amb clic fora.

---

## 4 · Vista de tasques — el kanban

Graella de 4 columnes iguals, 16px de separació, `align-items:start`.

### La columna

Radi 20px, vora hairline, padding 14px, alçada mínima 520px.

> **Bug del prototip a corregir.** El fons de la columna és `rgba(20,22,30,0.02)` literal, que en tema fosc queda invisible. S'ha de tokenitzar: cal un token nou `--column-bg` definit als dos temes.

Capçalera: nom a 14,5px pes 800, i el recompte en una pastilla `var(--tag-bg)` a 11,5px.

Cos: llista amb scroll vertical sense barra visible (classe `femho-scroll`), 9px entre targetes.

Peu: el camp d'afegida ràpida.

### L'Inbox ha de semblar una altra cosa

El brief ho demana explícitament (línia 39): *"Visualment ha de ser diferent l'inbox que les tres llistes kanban"*.

La solució: **l'Inbox és una targeta sòlida, les altres tres són contenidors buits.** L'Inbox porta `var(--card-bg)`, vora completa i `var(--card-shadow)`; les altres tres només tenen el fons tènue i la vora hairline. A més, l'Inbox se separa de les altres tres amb 24px en comptes de 16px, i les tres restants queden visualment agrupades.

L'Inbox també té controls propis a la capçalera que les altres no tenen: navegador de dia (`‹ 5 d'agost ›`) i un commutador per ensenyar les endarrerides.

### La targeta de tasca

`var(--card-bg)`, vora hairline, radi 16px, `var(--card-shadow)`, padding 12px. Flex amb 9px de separació.

**Barra de moure**, 28px d'ample i tota l'alçada, a la **dreta**. A les dues primeres columnes és una fletxa `›` sobre `var(--ghost-bg)` que mou la targeta una columna endavant; a les dues últimes és la casella d'estat: cercle buit sobre `var(--ghost-bg)`, o `var(--gradient-brand-2stop)` amb una marca blanca quan està feta.

> Fins a l'agost del 2026 això eren tres controls: un cercle d'estat de 22px a dalt a l'esquerra i dos botons "→ Per fer" i "→ Fent" sota el títol, només a l'Inbox. El disseny validat els ha ajuntat en un de sol, **perquè els tres feien el mateix gest**: fer avançar la targeta. Amb dues destinacions a cada targeta, l'usuari havia de triar trenta vegades seguides una cosa que gairebé sempre és la següent.

**Cos**: títol a 13,5px pes 600, interlineat 1.3. Sota, una fila de metadades que embolica: pastilla de projecte (10,5px, `var(--tag-bg)`), inicial de la persona assignada (cercle de 18px), hora si en té, i **el distintiu de mode IA** si no és `manual` (veure [`09-mode-ia.md`](09-mode-ia.md)).

**Accions de la cantonada**: a dalt a la dreta del cos, botons de 20px que **apareixen en passar-hi per sobre** —i amb el focus del teclat, que si no serien inabastables sense ratolí. El llapis obre l'edició completa; el de llista amb un més obre el camp d'afegir.

**Afegir des de la targeta**: un sol camp. `#Llista element` posa l'ítem a aquella llista; sense sigil, és una subtasca. Mateix sigil que l'afegida ràpida.

**Indicador de llista**: si la tasca té llistes senzilles, una pastilla amb `3/7`. A sota, el commutador `▸ Llistes (2)` —que compta **blocs**, no ítems— desplega les subtasques (nues) i les llistes (en caixa, amb el seu nom i una xinxeta).

**Clic** obre el modal d'edició completa. **Clic al cercle** només commuta l'estat i no obre res.

### Agrupació per àmbit

Quan hi ha més d'un àmbit actiu **i** no hi ha cap projecte triat, cada columna agrupa per àmbit amb un epígraf plegable: punt de 7px del color de l'àmbit, nom en majúscules a 11,5px pes 700 amb `letter-spacing:0.04em`, i un `▾`/`▸`.

L'estat de plegat és per columna i àmbit, i persisteix a les preferències de l'usuari.

### Afegida ràpida

Camp de text al peu de cada columna: `+ Afegir a {columna}… #Àmbit @Persona`.

`Enter` crea la tasca **sense obrir cap modal**. El camp es buida i manté el focus, per poder-ne encadenar.

Parseig (v1, només sigils — D12):

- `#Àmbit` encamina a l'àmbit. `#Àmbit/Projecte` encamina també al projecte.
- `@Persona` assigna.
- La resta és el títol, amb els espais sobrants col·lapsats.

**Autocompletat**: en escriure `#` o `@` apareix un desplegable ancorat al cursor. Fletxes per navegar, `Enter` o `Tab` per triar, `Escape` per tancar. És un `combobox` accessible amb `aria-activedescendant`.

**Xip reversible**: quan una part es reconeix, es pinta com a pastilla dins del camp. Clicar-la la torna a text pla. Sense això, un parser agressiu és una trampa — és el mecanisme amb què Todoist se'l pot permetre.

**Si hi ha més d'un àmbit actiu i no s'ha escrit `#`**, no es crea res: es mostra "Indica l'àmbit amb #Personal, #Feina o #Família" en `var(--danger-text)` a 11px. Amb un sol àmbit actiu, s'agafa aquell.

A un àmbit `individual`, la tasca s'assigna sola al propietari.

### Drag & drop

El brief ho demana per a la web (línia 40).

- Arrossegar entre columnes canvia `status`. Dins d'una columna canvia `position`.
- La posició es calcula **al client** amb índex fraccional a partir dels veïns (D3).
- Actualització optimista, amb reversió si el servidor rebutja.
- Indicador d'inserció: una línia de 2px amb `var(--gradient-brand-2stop)`.
- Mentre s'arrossega, la targeta original queda a `opacity:0.4`.

**Amb teclat també.** `Espai` agafa, fletxes mouen, `Espai` deixa anar, `Escape` cancel·la. S'anuncia per regió `aria-live`. Un tauler que només funciona amb ratolí no és accessible.

Amb `prefers-reduced-motion`, sense animació de transició; el canvi és instantani.

### La columna "Fet"

Capçalera pròpia (P2):

- Botó de **calendari** que obre un mini-calendari per navegar a qualsevol dia passat.
- Botó de **netejar** que posa `user_settings.done_cleared_at` a ara. No esborra res.
- Quan hi ha `done_cleared_at` d'avui, apareix **"Veure tot el fet d'avui"**, que l'ignora.

Per defecte es veu el d'avui desplegat i, a sota, "Ahir · 4" i "Aquesta setmana · 11" plegats. **No s'amaga res: es plega.**

---

## 5 · Vista de calendari

Graella de dues columnes: calendari flexible i rail de 340px. **La posició del rail és configurable** a Ajustos → General: esquerra, dreta o a sota (brief línia 17). Per defecte, dreta.

### Capçalera

`SegmentedControl` amb Mensual / Setmanal / Diari (~260px). A la dreta, cercles de 30px amb les inicials de cada persona, per ensenyar o amagar els seus esdeveniments. Actiu amb `var(--ghost-bg)`, inactiu transparent i `var(--ink-faint)`.

### Mensual

Targeta amb padding 22px. Capçalera amb `‹`, el mes i l'any, i `›`. Fila de dies `dl dt dc dj dv ds dg` a 11,5px `var(--ink-faint)`.

Graella de 7 columnes, 6px de separació, cel·les quadrades de radi 14px. Cada cel·la: el número i, sota, fins a 3 punts de 5px amb els colors dels àmbits que hi tenen alguna cosa.

Dia seleccionat: fons `var(--gradient-brand-2stop)`, text blanc, pes 800. Avui: `var(--ghost-bg)`. Dies d'altres mesos: `opacity:0`.

### Setmanal

7 columnes, alçada mínima 160px. Cada dia: dia de la setmana en majúscules a 10,5px, número a 15px pes 700, i fins a 3 pastilles amb els títols. "Sense res" si és buit.

### Diari

Targeta única amb la llista del dia. Cada element: punt del color de l'àmbit, títol a 14px pes 600, hora a la dreta si en té.

**Els esdeveniments amb hora es col·loquen en una graella horària**; les tasques sense hora van a una franja de "tot el dia" a dalt.

### El rail

Dues seccions, cadascuna en una targeta:

**Dia seleccionat** — epígraf en majúscules amb la data. Llista d'esdeveniments i tasques. Camp d'afegida ràpida `+ Afegir el {dia}… #Àmbit @Persona`.

**Sense dia** — epígraf "SENSE DIA". Tasques amb `due_date IS NULL`. Camp propi.

**Aquest rail és el mateix component que la columna Inbox del kanban** (P4). Mateixa font de dades, mateixes accions, mateix aspecte de targeta. Si divergeixen, es nota.

### Arrossegar al calendari

Arrossegar una tasca de "Sense dia" a un dia li posa `due_date`. Arrossegar-la a una hora de la vista diària li posa també `due_time`.

---

## 6 · Vista de llista senzilla

Una llista pinejada s'obre **des del menú de la xinxeta** de la barra superior, i llavors el kanban desapareix i es mostra la llista simple (brief línia 45). Al menú, cada llista porta el nom i **com va** —"3 de 7 fets"—: amb quatre pinejades, els noms sols obliguen a entrar a cadascuna per saber quina té feina pendent.

Columna única de màxim 720px, centrada. Títol de la llista, i sota la tasca d'origen com a molla de pa clicable.

Cada ítem: casella rodona de 22px i el text. Sense pastilles, sense assignats, sense dates — els ítems no en tenen (P1).

Commutador a la capçalera: **completats en línia** (ratllats al seu lloc) o **en una secció "Completats"** al final, plegada amb el recompte.

Camp d'afegida al peu: `+ Afegir ítem…`. `Enter` afegeix i manté el focus.

Quan es completa l'últim ítem, apareix una confirmació discreta: "Llista completada. Vols despinejar-la?" amb "Despinejar" i "Mantenir". La cascada amunt ja s'ha aplicat.

---

## 7 · Modal d'edició completa

Brief línia 56. `Dialog` de 560px al desktop.

- **Títol** — camp gran, 19px pes 700, editable en línia.
- **Descripció** — àrea de text amb Markdown bàsic.
- **Àmbit i projecte** — dos desplegables encadenats. Canviar d'àmbit reinicia el projecte.
- **Persones** — multiselecció amb cerca.
- **Estat** — `SegmentedControl` amb les quatre columnes.
- **Data i hora** — selector de data, i un commutador "Té hora" que revela el d'hora.
- **Deadline** — separat de la data de venciment.
- **Repetició** — desactivada, o RRULE amb un constructor simple, més el commutador **"Comptar des que es completa"** (`recurrence_mode`).
- **Mode IA** — tres opcions, i si és `assisted` o `delegated`, un camp d'instruccions i el selector d'agent.
- **Etiquetes**.
- **Subtasques** — llista reordenable amb casella i text.
- **Llistes senzilles** — cadascuna plegable, amb els seus ítems, i botó de pinejar.
- **Adjunts** — amb un commutador per marcar-los com a context per a la IA.
- **Comentaris**.
- **Historial** — línia de temps de `activity_log` (veure [`09-mode-ia.md`](09-mode-ia.md)).
- **Compartir** — obre el diàleg de [`10-compartits-i-seguretat.md`](10-compartits-i-seguretat.md).

Peu: "Cancel·lar" fantasma i "Desar" primari. `Escape` tanca amb confirmació si hi ha canvis. `Cmd/Ctrl+Enter` desa.

---

## 8 · Dashboard global

S'hi arriba clicant el wordmark. **No és al prototip.** Brief línia 38: *"una vista global de totes les tasques i esdeveniments, així com un camp per afegir tasques"*.

Ignora la selecció d'àmbits i de projecte: ho ensenya tot.

De dalt a baix:

1. **Camp d'afegida ràpida** ample, amb el mateix parseig. Aquí `#Àmbit` és obligatori sempre.
2. **Fila de resum**: una targeta per àmbit amb el recompte de pendents i de vençudes, amb la vora del color de l'àmbit. Clicar-la va al tauler amb només aquell àmbit.
3. **"Avui"** — tasques amb venciment avui i esdeveniments d'avui, de tots els àmbits, amb pastilla d'àmbit a cada línia.
4. **"Endarrerides"** — vençudes i no fetes. Es pot amagar a Ajustos.
5. **Calendari en miniatura** — mes en curs amb punts. Es pot amagar a Ajustos (el prototip ja té el commutador).
6. **"Fent ara"** — el que hi ha a `doing` de tots els àmbits.

---

## 9 · Ajustos

Graella de 220px + contingut, màxim 1100px.

> **Dins d'Ajustos no hi ha ni switch de vista ni chips d'àmbit.** El brief hi insisteix (línia 41): *"no es intuitiu que desde ajustos tinguis els switch de calendari... els àmbits. s'hauria de substituir tot per el tornar"*. El prototip encara els deixa. La barra superior en Ajustos porta **només** el wordmark i el botó "‹ Tornar al tauler".

Pestanyes: General · Àmbits · Calendaris · MCP i API · Usuari IA · Compartits · Perfil · Admin.

**General** — tema (sistema/clar/fosc) i accent (default/soft/mono-warm/mono-cool) com a `ChoiceChips`; elements del dashboard; posició del rail d'Inbox; si l'Inbox ensenya endarrerides; activar l'usuari IA.

**Àmbits** — *no és al prototip; brief línia 44.* Llista d'àmbits amb color i tipus. Crear-ne: nom, color, individual o col·lectiu. Si és col·lectiu, gestió de membres, que poden ser usuaris de l'eina, externs per CalDAV, o tots dos.

**Calendaris** — per àmbit, el CalDAV d'origen, i botó per afegir-ne un per projecte. I la secció "Els teus CalDAV Fem-ho" amb les URL bidireccionals i botó de copiar. Cada àmbit en publica **dues** (D9): esdeveniments i tasques. Han d'estar etiquetades perquè s'entengui.

**MCP i API** — activar MCP, permisos, àmbits accessibles, i les instruccions de connexió per a Claude i ChatGPT. Gestió de tokens: crear-ne amb nom, capacitats, àmbits i caducitat; **es mostra un sol cop**; llista amb prefix, últim ús i botó de revocar.

**Usuari IA** — només si està activat. Agents, instruccions genèriques, i el commutador de "pot crear tasques" (brief línia 48).

**Compartits** — *no és al prototip; brief línia 60.* Enllaços creats, a què apunten, permís, caducitat, accessos i últim accés. Editar configuració i revocar.

**Perfil** — el teu perfil i prou. El brief és explícit (línia 42): aquí no s'editen els altres.

**Admin** — només administradors. Llista de membres de la llar amb el seu rol, i **"+ Convidar membre"**, que crea l'usuari i genera un enllaç d'invitació d'un sol ús perquè la persona s'hi posi la contrasenya. Amb `FEMHO_REGISTRATION=invite` aquest és l'únic camí d'alta ([`12-desplegament.md`](12-desplegament.md) §3). També: editar i eliminar usuaris, i "Netejar instància" amb confirmació escrivint el nom de la instància.

---

## 10 · Responsive

Un sol codi per a desktop i mòbil. Per sota de 860px, la web ha de ser **gairebé idèntica a l'app Android** (brief línia 4):

- La barra superior es reorganitza en dues files: wordmark i perfil a dalt; switch, chips i projecte a sota.
- El kanban passa a **columnes desplaçables horitzontalment**, cadascuna al 80% de l'amplada, amb desplaçament amb ajust.
- El calendari perd el rail lateral: passa a sota, en scroll vertical.
- Els modals passen a fulls des de baix.
- Àrees tàctils de 44px mínim.

Es fan servir **container queries** on el component ho permeti, i breakpoints només per al canvi de disposició global.

Cal respectar `env(safe-area-inset-*)`.

---

## 11 · Dreceres de teclat

| Tecla | Acció |
| --- | --- |
| `c` | Focus a l'afegida ràpida de l'Inbox |
| `t` / `k` | Tasques / Calendari |
| `1`–`9` | Commuta l'àmbit N |
| `g` llavors `d` | Dashboard global |
| `g` llavors `s` | Ajustos |
| `/` | Cerca |
| `Cmd/Ctrl+K` | Paleta d'ordres |
| `Escape` | Tanca menú, modal o cancel·la arrossegament |
| `?` | Ajuda de dreceres |

No s'activen mentre el focus és en un camp de text.

---

## 12 · Estats buits, càrrega i error

**Buits**: frase sencera, mai un guió. "Cap tasca a Per fer." "Res per aquest dia." "Encara no has creat cap enllaç compartit."

**Càrrega**: res d'esquelets brillants — el design system prohibeix el shimmer. Es fa servir el contingut de la memòria cau amb `opacity:0.6` mentre es revalida.

**Error**: banda discreta a dalt amb `var(--danger-bg)` i botó de reintentar. Els errors de xarxa amb mutacions pendents no bloquegen: la cua es reintenta sola.

**Offline**: pastilla persistent "Sense connexió · N canvis pendents". En recuperar-la, "Sincronitzat" 2 segons i desapareix.
