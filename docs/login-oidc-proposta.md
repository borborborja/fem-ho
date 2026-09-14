# Login OIDC opcional per instància — proposta

És viable afegir inici de sessió amb Google o amb un proveïdor OIDC de
l'organització. Aquesta entrega implementa OAuth del correu; **no activa login
OAuth**. El login actual, les sessions, CalDAV i els tokens d'API continuen igual.

## Abast acordat

Només persones amb un compte Fem-ho existent i **vinculat explícitament** poden
entrar amb OIDC. No es creen comptes a partir d'un correu Google, no es fusionen
per coincidència d'adreça i no es concedeixen rols per domini de correu.

| Instància | Proveïdor adequat | Política proposada |
| --- | --- | --- |
| Personal o familiar | Google opcional | Vinculació des d'una sessió Fem-ho existent |
| Organització Workspace | Google, amb domini verificat com a restricció addicional | Comptes existents vinculats; rols administrats a Fem-ho |
| Organització amb SSO propi | OIDC compatible, per exemple Keycloak o Authentik | Proveïdor configurat per l'administrador, emissor fix |

## Disseny proposat

La taula `user_identities` relacionaria `user_id` amb `(issuer, subject)` únic.
Aquest parell identifica la persona; l'adreça de correu serveix per mostrar-la.
Google documenta que `sub` és l'identificador estable i que l'email no s'ha
d'emprar com a identificador primari.
[Validació OIDC de Google](https://developers.google.com/identity/openid-connect/openid-connect).

La vinculació requeriria sessió Fem-ho recent, consentiment al navegador,
Authorization Code amb PKCE, state, nonce, verificació de signatura, emissor,
audiència i caducitat, i confirmació explícita dins la sessió inicial. La
desvinculació exigiria conservar una altra via d'accés vàlida. Caldria auditar
vinculacions, desvinculacions i accessos.

El login faria servir una autorització pròpia amb `openid email profile`, sense
permisos de Gmail. Mai reutilitzaria el refresh token del correu per iniciar
sessió. Desconnectar una bústia no expulsaria l'usuari ni canviaria les seves
credencials Fem-ho. Les sessions resultants mantindrien el mecanisme actual de
tokens Fem-ho i les mateixes comprovacions d'usuari desactivat i permisos.

La configuració del proveïdor seria exclusiva del servidor i opcional per
instància. Per a Google Workspace, `hd` verificat podria limitar l'organització;
el domini escrit a l'email o suggerit al formulari no seria una prova suficient.

Android necessitaria navegador del sistema i un retorn verificat o un intent
pendent confirmat per l'app; no portaria secrets de client ni WebView de login.
CalDAV i clients externs conservarien contrasenyes d'aplicació/tokens. S'hauria
de mantenir una via local de recuperació per a l'administrador.

## Implementació posterior i acceptació

1. Contractes d'avaluació de proveïdor, vinculació, desvinculació i login; migració
   d'identitats i política que refusi qualsevol compte no vinculat.
2. Servei OIDC independent del correu, emissió de sessions Fem-ho i recuperació.
3. Botons web i Android condicionats a la configuració, traduccions i auditoria.
4. Proves de compte desconegut, email coincident sense vinculació, canvi d'email,
   replay, emissor incorrecte, usuari desactivat, desvinculació concurrent i
   caiguda del proveïdor. Prova real amb una instància i un proveïdor configurats.

La part comuna aprofitable de l'entrega actual és la verificació criptogràfica
OIDC i el patró d'intent temporal. La política d'identitats i l'emissió de
sessions han de tenir serveis i proves propis.
