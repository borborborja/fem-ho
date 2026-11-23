# Connectar Google Calendar

## Configuració de la instància

1. Activa **Google Calendar API** i, si es farà servir el correu de Google, **Gmail API** al projecte de Google Cloud.
2. Configura la pantalla de consentiment per als comptes que faran servir la instància. Crea un client OAuth de tipus **Aplicació web**. El mateix client serveix per al web i Android.
3. Registra les adreces que mostra **Ajustos → Admin → Integració amb Google**. Amb `FEMHO_BASE_URL=https://tasques.example.org`, són `https://tasques.example.org/api/v1/mail/oauth/google/callback` i `https://tasques.example.org/api/v1/calendars/google/oauth/callback`.
4. Desa l'identificador i el secret al panell d'administració, o posa la parella `FEMHO_GOOGLE_CLIENT_ID` i `FEMHO_GOOGLE_CLIENT_SECRET` al servidor. Qualsevol d'aquestes variables bloqueja l'edició des del panell. Si falta un valor de la parella d'entorn, la integració queda inactiva fins que es completi. Mantén `FEMHO_BASE_URL` apuntant a l'adreça pública HTTPS de la instància. En desenvolupament s'accepta HTTP a `localhost`.

Conserva el secret persistent de la instància quan en facis còpies o la traslladis. Fem-ho el fa servir per xifrar les credencials desades. Canviar l'identificador del client OAuth requereix tornar a connectar els comptes. Si canvies només el secret del mateix client, Fem-ho el fa servir en la renovació següent.

Configura el proxy perquè cap ruta de retorn OAuth escrigui els paràmetres de consulta als registres. Els permisos que demana cada funció són independents del login de Fem-ho. Google pot requerir la verificació de l'aplicació i limita la durada dels permisos en mode de proves. [OAuth de Google](https://developers.google.com/identity/protocols/oauth2/web-server) · [Permisos de Calendar](https://developers.google.com/workspace/calendar/api/auth) · [Correu amb Google](mail-oauth.md)

## Comptes i àmbits

Al web i a Android, obre **Ajustos → Calendaris** i ves a **Fonts de dades** de l'àmbit propi on vols veure el calendari. Tria **Google Calendar** al selector de fonts, al costat de CalDAV, iCal i RSS. El formulari mostra els comptes que ja has connectat.

Prem **Connecta amb Google** per connectar el primer compte o **Connecta un compte nou** per afegir-ne un altre. Tria el compte al navegador i confirma l'adreça al mateix formulari en tornar a Fem-ho. A Android, torna a l'app quan acabis al navegador. També pots connectar comptes, reconnectar-los o desconnectar-los des del bloc **Google Calendar** de la pestanya **Calendaris**.

Tria un compte i un dels seus calendaris. L'àmbit des d'on has obert el formulari ja està seleccionat. Marca altres àmbits propis si també hi vols afegir el calendari i prem **Vincula el calendari**. Cada vinculació apareix a les **Fonts de dades** del seu àmbit i té els seus controls de visibilitat i de bústia. En un àmbit compartit, només tu el veus fins que el comparteixis expressament. Les cites privades de Google queden reservades a qui ha autoritzat la connexió.

Una vinculació admet edició si el compte de Google hi té accés d'escriptura i has activat l'opció en vincular-la. Qui l'ha autoritzada pot crear cites puntuals i editar o esborrar una ocurrència d'una sèrie. Fem-ho demana confirmació abans d'enviar un canvi que avisi els convidats.

## Sincronització i recuperació

El servidor descarrega les cites de l'últim any i del pròxim any. La primera passada completa es pagina i les següents recuperen els canvis amb el cursor de Google. El servidor revalida tota la finestra quan es mou un dia, canvien els permisos o expira el cursor. Si una pàgina falla, conserva el darrer conjunt complet de dades.

Una edició es desa primer al dispositiu. Després el servidor la posa a la cua per enviar-la a Google. Fem-ho consulta els canvis de Google cada quinze minuts i demana un refresc després d'enviar una edició. Si la cita canvia a Google mentre l'edició és pendent, a **Canvis a Google Calendar** es pot conservar la versió de Google descartant el canvi o confirmar que es vol reaplicar l'edició sobre la versió actual.

Desconnectar un compte atura els refrescos i conserva els calendaris vinculats. Treure una vinculació elimina la còpia d'aquell àmbit. Si retires l'accés al projecte des del compte de Google, pot caldre tornar a autoritzar també Gmail. [Revocació d’autoritzacions](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)

## Prova del desplegament

Amb un compte Google de proves, afegeix un calendari des del selector de fonts d'un àmbit i marca un segon àmbit. Comprova que el calendari apareix a les fonts de tots dos. Crea una cita de tot el dia, modifica-la a Google i comprova que apareix a tots dos àmbits. Mou una ocurrència d'una sèrie des de Fem-ho i comprova que només canvia aquella cita. Repeteix el recorregut a Android i comprova la represa després de perdre la connexió.
