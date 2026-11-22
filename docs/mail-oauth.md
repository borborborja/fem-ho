# Connectar Gmail i Google Workspace

Fem-ho permet connectar diversos comptes de Gmail o Google Workspace a la web i
a Android. En donar d’alta un compte amb Google, Fem-ho llegeix el correu amb
l’API de Gmail. Per a cada compte, tria una etiqueta i l’àmbit de destinació
des d’Ajustos → Correu → Regles. Per exemple, la safata d’entrada del compte de
feina pot anar a Feina i la del compte personal a Personal.

## Configuració de la instància

1. A Google Cloud, configura Google Auth Platform: marca, audiència i consentiment.
   Per a una instància d'una organització Workspace, tria audiència interna si
   tots els comptes pertanyen a l'organització. Per a Gmail personal o usuaris
   externs, cal audiència externa i complir els requisits de verificació de Google.
2. Crea un client OAuth de tipus **aplicació web**, també per als usuaris Android:
   el servidor fa l'intercanvi de credencials.
3. Registra exactament aquest URI de redirecció, substituint el domini:
   `https://tasques.example.org/api/v1/mail/oauth/google/callback`.
4. Activa l’API de Gmail al projecte de Google Cloud. Configura al servidor
   `FEMHO_BASE_URL=https://tasques.example.org`. Desa la parella OAuth a
   **Ajustos → Administració → Integració amb Google** o configura
   `FEMHO_GOOGLE_CLIENT_ID` i `FEMHO_GOOGLE_CLIENT_SECRET` a l’entorn. Els
   dos fitxers Compose passen aquestes variables al contenidor i donen
   prioritat a la configuració de l’entorn.
5. A Workspace, comprova que la política de l’organització permeti aquest
   client OAuth i l’accés a l’API de Gmail.
6. A **Ajustos → Correu**, tria un compte Gmail existent per convertir-lo, o un
   compte nou, i prem **Connecta amb Google**. Accepta els permisos i confirma
   l'adreça que Fem-ho mostra abans de desar la connexió.

El desplegament públic requereix HTTPS. Per desenvolupar es permet
`http://localhost`. El proxy ha de servir la ruta de retorn al mateix servidor;
evita registrar els paràmetres de consulta d'aquesta ruta als access logs del
proxy. El servidor Fem-ho no registra els codis del retorn.

L’API fa servir `gmail.readonly` i `openid email` per verificar la identitat.
Amb aquesta autorització Fem-ho pot llegir el correu i conserva l’estat dels
missatges a Gmail. Google classifica el permís de lectura com a restringit i
documenta els requisits de verificació i avaluació per a aplicacions que el fan
servir. [Permisos de l’API de Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

Els comptes IMAP existents segueixen amb les seves credencials. Els que feien
servir Google amb IMAP mantenen el permís `https://mail.google.com/` per
reconnectar amb el mateix mètode.

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

**Passa a l’API de Gmail** conserva el compte, les regles, els fils i els
correus importats. Cal autoritzar la mateixa adreça i, si ja feia servir Google,
la mateixa identitat. Fem-ho vincula les carpetes de les regles amb les
etiquetes del mateix nom i espera els missatges nous des de la primera lectura.
Les regles sense una coincidència inequívoca conserven l’àmbit i la configuració
i queden desactivades. Tria i desa l’etiqueta a la mateixa regla, i després
activa-la per començar a llegir-la. Per canviar d’adreça, connecta un altre
compte.

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

Després de configurar Google, connecta dos comptes de proves, confirma les
adreces i associa una etiqueta de cadascun a un àmbit diferent. Envia un correu
nou a cada compte i comprova que apareix una sola vegada a l’àmbit corresponent.
Reinicia el servidor i repeteix-ho després
de caducar el token d'accés; finalment revoca el consentiment a Google i comprova
que Fem-ho demana reconnectar. Les proves automatitzades simulen Google; no
substitueixen aquesta comprovació amb el consentiment i les polítiques reals.

Si Gmail ja no conserva el cursor d’historial, Fem-ho recupera per tandes els
missatges de les etiquetes configurades des de la darrera sincronització.
Els missatges antics que només han canviat d’etiqueta
durant un buit de l’historial poden quedar fora d’aquesta recuperació.

Referència del flux de servidor: [OAuth per a aplicacions web](https://developers.google.com/identity/protocols/oauth2/web-server).

El login OAuth de l'aplicació és una peça separada, estudiada a
[proposta d'OIDC per instància](login-oidc-proposta.md).
