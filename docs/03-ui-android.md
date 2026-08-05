# 03 · UI Android

App **nativa**: Kotlin + Jetpack Compose. Offline-first, sempre aparellada a un servidor.

Aquest document diu **què és diferent** de la web. Tot el que no hi surti es comporta igual que a [`02-ui-web.md`](02-ui-web.md), i el contracte de dades és el mateix.

La referència visual és `Fem-ho Mobile.dc.html`, dissenyat sobre un llenç de 412×844.

---

## 1 · La paritat és el requisit

El brief (línia 4): *"la UI web ha de ser responsive i la versió web mòbil ha de ser gairebé igual o igual a la mobile app"*.

Això vol dir que **la web en mòbil i l'app Android han de ser indistingibles**, i que la disciplina va en les dues direccions: si canvies el kanban a Compose, canvia igual la web mòbil.

Tres mecanismes ho sostenen:

1. **Tokens compartits.** Els tokens de Plou s'exporten a un objecte de Compose des del CSS (D7). Cap valor de color, radi o espaiat s'escriu a mà en Kotlin.
2. **Textos compartits.** Les cadenes catalanes surten del mateix catàleg, exportat a `strings.xml`. Cap literal al codi.
3. **Fixtures compartits.** El parser d'afegida ràpida té els mateixos casos de prova en TypeScript i en Kotlin, verificats a CI. Sense això, les dues implementacions divergeixen i ningú se n'adona fins que un usuari escriu `#Feina/Client Salt` amb un espai.

---

## 2 · Login — amb servidor

**Aquesta és la diferència més important amb la web**, i el prototip mòbil no la té. Brief línia 4: *"la app mòbil a la pantalla de login ha de deixar escriure el servidor"*.

Tres camps: **Servidor**, **Correu**, **Contrasenya**.

El camp de servidor:

- Accepta `femho.example.com`, `https://femho.example.com` i `https://example.com/femho`.
- Sense esquema, **es prova primer `https://`**. Si falla i l'amfitrió és d'una xarxa privada, s'ofereix `http://` amb un avís clar, mai en silenci.
- Es valida contra un endpoint públic d'informació abans de demanar credencials, i es mostra el nom i la versió de la instància. Així l'usuari sap que ha encertat abans d'escriure la contrasenya.
- La URL validada es recorda i es proposa el següent cop.

**TLS.** Molta gent l'autoallotja amb una CA pròpia o un certificat autofirmat. S'accepta afegir un certificat de confiança **explícitament**, amb una pantalla que ensenyi l'empremta i obligui a confirmar-la. Mai un `TrustManager` permissiu compilat a l'app.

**Emmagatzematge.** URL, token d'accés i token de refresc van a l'emmagatzematge encriptat, amb la clau al Keystore. Verifica l'estat actual de les API de seguretat d'AndroidX en fer l'scaffold: la recomanada ha anat canviant.

---

## 3 · Estructura

Una sola `Activity` amb Compose i navegació per grafs.

La capçalera és una columna, no una fila, perquè hi cap menys:

1. Wordmark "Fem-ho" a 20px (clicable → dashboard global) i, a la dreta, l'avatar.
2. `SegmentedControl` Tasques/Calendari a amplada completa, mida `mobile`.
3. Chips d'àmbit, que emboliquen.
4. Fila amb el desplegable de projecte flexible, el botó `+` de 36px, i el de llistes pinejades quan n'hi ha.

Padding lateral de 16px.

---

## 4 · Kanban

**Columnes desplaçables horitzontalment** amb un pager, cadascuna al 80% de l'amplada perquè s'endevini la següent. Desplaçament amb ajust.

Cada columna té la seva llista mandrosa amb l'estat de scroll preservat.

Indicador de posició sota la capçalera: quatre punts, l'actiu amb `--gradient-brand-2stop`.

**L'Inbox continua sent visualment diferent** (targeta sòlida contra contenidor buit), igual que a la web.

### Moure targetes

El drag & drop lliure en un pager horitzontal és hostil en tàctil: el gest de moure competeix amb el de canviar de columna. A Android:

- **Botons ràpids** a la targeta ("→ Per fer", "→ Fent"), com ja fa el prototip.
- **Pulsació llarga** obre un full amb "Mou a…" i les quatre columnes.
- **Arrossegar per reordenar dins d'una columna**, un cop iniciat amb pulsació llarga, amb resposta hàptica.
- **Lliscar** una targeta cap a la dreta la completa; cap a l'esquerra obre accions.

### Afegida ràpida

Camp al peu de la columna. L'autocompletat de `@` i `#` surt en un full ancorat sobre el teclat, no en un desplegable flotant: en mòbil un popup sota el cursor queda tapat pel teclat.

El xip reversible es manté.

---

## 5 · Calendari

Scroll vertical, sense rail lateral (no hi cap).

`SegmentedControl` amb Mensual/Setmanal/Diari, mida `mobile`, i els cercles de persones a la dreta.

**Mensual**: graella compacta, separació 3px, radi 12px, números a 11,5px, punts de 4px.

**Setmanal**: al mòbil és una **llista vertical de dies**, no 7 columnes. Cada fila: bloc de 36px amb dia i número a l'esquerra, i les pastilles a la dreta. Així ho fa el prototip i és el correcte.

**Diari**: llista d'esdeveniments i tasques.

Sota el calendari, en scroll: la secció del dia seleccionat i la de "Sense dia", cadascuna amb el seu camp d'afegida. **És el mateix component que l'Inbox** (P4).

---

## 6 · Ajustos

Capçalera pròpia: `‹` i "Ajustos". **Res de switch ni de chips d'àmbit** (brief línia 41).

Les pestanyes són una fila de píndoles desplaçable horitzontalment. Contingut en scroll vertical amb `SettingsGroup` de densitat `mobile`.

Les mateixes pestanyes que a la web. La de **MCP i API** ha de poder ensenyar el token amb un botó de copiar i un codi QR, que en mòbil és molt més pràctic.

---

## 7 · Offline

Aquesta és la raó de ser de l'app nativa.

**La base de dades local és la font de veritat de la UI.** La interfície llegeix sempre de local i mai espera la xarxa. Tot el que es pot fer connectat es pot fer desconnectat: crear, editar, moure, completar, afegir ítems.

Cada mutació entra a una **cua de sortida** i s'aplica a local immediatament. Els identificadors i les posicions es generen al client (D3, D4), així que res depèn d'una resposta del servidor.

La sincronització la fa el gestor de treball en segon pla, amb restricció de xarxa i espera exponencial. Es dispara quan es recupera la connexió, quan l'app passa a primer pla, periòdicament, i quan arriba una notificació.

El contracte està a [`06-sync.md`](06-sync.md) i és el mateix que fa servir la web.

**A la UI**: pastilla discreta "N canvis pendents" quan la cua no és buida. Les entitats amb canvis pendents duen un punt petit. Si una mutació falla de manera permanent, es mostra un avís que permet reintentar o descartar — mai es descarta en silenci.

---

## 8 · Notificacions

Sense dependre de Google: **UnifiedPush** com a via principal, amb el servidor de distribució que l'usuari triï, i consulta periòdica com a alternativa si no n'hi ha cap.

Això és més senzill del que sembla: UnifiedPush fa servir les mateixes RFC que el Web Push del navegador, o sigui que **una sola taula de subscripcions i una sola crida d'enviament serveixen per a la PWA i per a Android**. El detall és a [`11-notificacions.md`](11-notificacions.md).

Cal demanar el permís de notificacions a Android 13+, i demanar-lo **quan l'usuari desa el seu primer recordatori**, no en obrir l'app.

---

## 9 · Extres de plataforma

- **Widget** amb les tasques d'avui i un accés a afegida ràpida.
- **Accessos directes** a l'app: "Nova tasca", "Avui".
- **Full de compartir**: rebre text des d'una altra app el converteix en tasca a l'Inbox.
- **Accions a la notificació**: "Fet" i "Ajorna", que escriuen a la cua de sortida sense obrir l'app.

---

## 10 · Convivència amb DAVx⁵

Si l'usuari ja sincronitza els CalDAV de Fem-ho al telèfon amb DAVx⁵ **i** té l'app instal·lada, veurà les mateixes tasques dues vegades: una al calendari del sistema i una a Fem-ho.

**La postura és no amagar-ho.** A Ajustos → Calendaris, si es detecta que el compte també està a DAVx⁵, es mostra una nota que explica que l'app ja sincronitza sola i que la connexió CalDAV és per a altres clients. No s'intenta desactivar res: és el telèfon de l'usuari.

---

## 11 · Estructura de mòduls

```
:app              navegació, pantalles, injecció
:core-designsystem tokens exportats de Plou + components de Fem-ho
:core-data        base de dades local, repositoris, cua de sortida, motor de sync
:core-network     client generat d'OpenAPI, autenticació, refresc
:core-model       models de domini compartits
:feature-tasks    kanban i modal de tasca
:feature-calendar calendari i Inbox
:feature-settings ajustos
```

Els repositoris exposen fluxos des de la base de dades local. Cap pantalla crida la xarxa directament.

---

## 12 · Distribució

APK signat a les publicacions de GitHub, i compatible amb F-Droid. Play Store és opcional: una app que demana la URL d'un servidor propi no encaixa bé amb la seva revisió.

L'app comprova la versió de la instància en connectar-se i avisa si el servidor és més nou que ella, amb enllaç a la descàrrega. **No s'actualitza sola.**
