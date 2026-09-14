# Connectar Gmail i Google Workspace

Fem-ho permet connectar el correu amb Google a la web i a Android. Es manté IMAP
amb contrasenya per als altres proveïdors i per als comptes que ho permetin.
OAuth canvia les credencials; la lectura continua passant pel mateix client IMAP,
les mateixes regles i la mateixa protecció TLS i contra adreces internes.

## Configuració de la instància

1. A Google Cloud, configura Google Auth Platform: marca, audiència i consentiment.
   Per a una instància d'una organització Workspace, tria audiència interna si
   tots els comptes pertanyen a l'organització. Per a Gmail personal o usuaris
   externs, cal audiència externa i complir els requisits de verificació de Google.
2. Crea un client OAuth de tipus **aplicació web**, també per als usuaris Android:
   el servidor fa l'intercanvi de credencials.
3. Registra exactament aquest URI de redirecció, substituint el domini:
   `https://tasques.example.org/api/v1/mail/oauth/google/callback`.
4. Configura al servidor `FEMHO_BASE_URL=https://tasques.example.org`,
   `FEMHO_GOOGLE_CLIENT_ID` i `FEMHO_GOOGLE_CLIENT_SECRET`. Els dos fitxers Compose
   ja passen aquestes variables al contenidor. Recrea el contenidor després de
   canviar-les. No posis el secret a la web, a l'APK ni al repositori.
5. A Workspace, comprova que la política de l'organització permeti aquest client
   OAuth i l'accés IMAP. OAuth no esquiva una prohibició administrativa d'IMAP.
6. A **Ajustos → Correu**, tria un compte Gmail existent per convertir-lo, o un
   compte nou, i prem **Connecta amb Google**. Accepta els permisos i confirma
   l'adreça que Fem-ho mostra abans de desar la connexió.

El desplegament públic requereix HTTPS. Per desenvolupar es permet
`http://localhost`. El proxy ha de servir la ruta de retorn al mateix servidor;
evita registrar els paràmetres de consulta d'aquesta ruta als access logs del
proxy. El servidor Fem-ho no registra els codis del retorn.

Google exigeix `https://mail.google.com/` per a IMAP, a més d'`openid email` per
verificar el compte seleccionat. Aquest permís és ampli encara que Fem-ho només
utilitzi operacions de lectura: no marca correus com a llegits, no els mou ni els
esborra. Google adverteix que els clients públics han de justificar l'ús del
permís complet; la verificació no queda resolta només publicant aquesta versió.
Vegeu [IMAP amb XOAUTH2](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol).

En una aplicació externa en estat **Testing**, els refresh tokens amb permisos
de correu caduquen habitualment als **7 dies**. Per a ús continu, configura
l'audiència i l'estat de publicació adequats; també poden caducar o ser revocats
per l'usuari o per polítiques de l'organització.
[Caducitat dels tokens](https://developers.google.com/identity/protocols/oauth2#expiration).

## Ús i recuperació

Android obre el navegador del sistema. Després d'acceptar a Google, torna a
Fem-ho, **Ajustos → Correu**, i confirma l'adreça. L'app conserva només
l'identificador de l'intent, separat per instància i usuari, i el recupera si
el procés s'ha tancat. No requereix que el navegador tingui la sessió Android.

La conversió d'un compte existent exigeix la mateixa adreça; si ja era OAuth,
també el mateix identificador de Google. Conserva l'identificador del compte,
les carpetes, les regles, els cursors i els correus importats. Per canviar
d'adreça cal crear un altre compte.

**Torna a connectar** repara permisos revocats o caducats. **Desconnecta** esborra
les credencials del servidor i atura la lectura, conservant les regles i dades.
Per retirar també el consentiment a Google, elimina l'accés des de la seguretat
del compte Google. Aquesta acció és independent del login de Fem-ho.

Els tokens es xifren amb el secret persistent de la instància i es renoven al
servidor. Conserva aquest secret amb la còpia de seguretat: canviar-lo impedeix
desxifrar les credencials existents. Els intents duren 10 minuts i el
planificador elimina els secrets temporals caducats. No s'inclouen credencials
Google als contractes de resposta, les exportacions d'usuari ni l'historial.

## Comprovació del desplegament

Després de configurar Google, connecta un compte de proves, confirma l'adreça,
prem la prova IMAP i associa una carpeta a un àmbit. Envia-hi un correu nou i
comprova que apareix una sola vegada. Reinicia el servidor i repeteix-ho després
de caducar el token d'accés; finalment revoca el consentiment a Google i comprova
que Fem-ho demana reconnectar. Les proves automatitzades simulen Google; no
substitueixen aquesta comprovació amb el consentiment i les polítiques reals.

Referència del flux de servidor: [OAuth per a aplicacions web](https://developers.google.com/identity/protocols/oauth2/web-server).

El login OAuth de l'aplicació és una peça separada, estudiada a
[proposta d'OIDC per instància](login-oidc-proposta.md).
