# 10 · Compartits i seguretat

Dues parts: els enllaços públics que demana el brief (línia 60), i el model de seguretat de tota l'app.

---

## 1 · Què es comparteix

Una **tasca amb les seves subtasques i llistes**, o una **llista senzilla** sola.

El cas del brief és exacte: la tasca "Fer la maleta" amb la llista "Maleta Borja" a dins, compartida amb algú de fora perquè pugui anar marcant.

**Per aquesta via** no es comparteixen projectes ni àmbits sencers: un enllaç públic és per
a una cosa concreta i acotada, i qui l'obre és algú sense compte de qui no en sabem res.

Un àmbit sencer sí que es comparteix, però **per una altra via i amb una altra gent**: amb
persones que tenen compte, que hi entren com a membres i que es poden expulsar. Veure
`docs/14` P5, que explica per què la diferència no és de mida sinó de qui hi ha a l'altra
banda.

---

## 2 · Crear l'enllaç

Diàleg `ShareDialog` des del modal de tasca o des d'una llista:

| Opció | Valors |
| --- | --- |
| Què | La tasca sencera, o una llista concreta |
| Permís | **Veure** · **Marcar** · **Comentar** |
| Caducitat | Cap · 24 h · 7 dies · 30 dies · data concreta |
| Contrasenya | Opcional |
| Demanar nom | Sí o no |
| Límit de visites | Opcional |

**No hi ha permís d'edició.** Un convidat anònim marca ítems i comenta; no reescriu tasques (D10).

L'enllaç generat:

```
https://femho.example.com/s/<token>
```

El token és aleatori, prou llarg per no ser endevinable, i amb un alfabet segur per a URL.

---

## 3 · Com es guarda

Tres coses que no són opcionals:

**El token no es guarda mai en clar.** A la base de dades hi ha `token_hmac`, calculat amb un pebre del servidor. Si algú es queda una còpia de la base, no en pot treure cap enllaç funcional. `secret_version` permet rotar el pebre sense invalidar-ho tot de cop.

**No hi ha cap columna d'IP enlloc.** És una decisió de privadesa deliberada. Els accessos es registren amb un identificador pseudònim (`guest_ref`), no amb dades de xarxa.

**La contrasenya del compartit es xifra amb argon2id**, igual que les dels usuaris.

---

## 4 · Entrar-hi

1. El convidat obre l'enllaç.
2. Si té contrasenya, es demana. Si demana nom, es demana.
3. En encertar, s'emet una **sessió de convidat de vida curta, limitada a aquest enllaç**. No és una sessió d'usuari i no serveix per a res més.
4. El convidat veu el contingut i pot fer el que el permís deixi.

**No es filtra si un enllaç existeix.** Un token inventat i un de revocat donen exactament la mateixa resposta i triguen el mateix. Si un dona 404 i l'altre demana contrasenya, es poden enumerar enllaços.

**Bloqueig per força bruta**: 5 intents per 15 minuts, i `locked_until` amb espera creixent. Es compta per enllaç, no per IP.

**Fuita per referent**: la pàgina compartida va amb `Referrer-Policy: no-referrer`. Sense això, si el convidat clica un enllaç extern, el token viatja a la capçalera de referent d'un servidor de tercers.

El token **no ha d'aparèixer als registres del servidor**. Les rutes `/s/*` es registren amb el token anonimitzat.

---

## 5 · Qui és el convidat

Això és el que demana el brief: *"si l'usuari ha posat nom s'identifica com extern i el nom, si no s'ha activat el nom doncs s'identifica com a extern i amb algun identificador unic"*.

- Amb nom demanat → l'historial diu **"Extern · Marta"**.
- Sense nom → **"Extern · a4f2"**, amb un identificador pseudònim estable per sessió.

`guest_ref` es genera aleatòriament per sessió de convidat. **No es deriva de dades personals** ni de l'agent d'usuari ni de res que identifiqui la persona.

Marcar un ítem des d'un enllaç compartit **escriu a les dades reals** i deixa la seva entrada a `activity_log` amb `actor_type='guest'` i `source='share'`. La cascada amunt s'aplica igual.

---

## 6 · Ajustos → Compartits

Brief línia 60. Taula amb: a què apunta, permís, si té contrasenya, caducitat, visites, últim accés, i qui hi ha entrat.

Accions: editar la configuració, revocar, i copiar l'enllaç de nou — **només si no s'ha perdut**, perquè el token no es pot recuperar del hash. Si l'usuari el perd, ha de crear-ne un de nou. Cal dir-l'hi clarament en crear-lo.

Els enllaços caducats es mostren en gris amb l'etiqueta "Caducat" fins que es netegin.

---

## 7 · SSRF: la vulnerabilitat més seriosa del projecte

**L'usuari dona una URL i el servidor hi va.** És la funció de calendari d'origen ([`07-caldav.md`](07-caldav.md) §9), i és una falsificació de peticions del costat servidor de manual.

Un atacant amb un compte pot fer que el servidor faci peticions a la xarxa interna de la casa: el router, altres contenidors, serveis d'administració sense autenticar.

Les mitigacions, i cap és opcional:

1. **Només `http` i `https`.** Res de `file://`, `gopher://`, `ftp://`.
2. **Resoldre el DNS primer i comprovar la IP resolta**, no la cadena de l'amfitrió.
3. **Bloquejar rangs privats i especials**: loopback, enllaç local (incloent-hi el `169.254.169.254` dels serveis de metadades), privats de la RFC 1918, multicast, i els equivalents d'IPv6.
4. **Protegir-se de la reassignació de DNS**: resoldre, validar, i **connectar a la IP validada**, no tornar a resoldre el nom. Si el client HTTP no ho permet, cal un agent de connexió que ho faci.
5. **Validar també les redireccions.** Cada salt es torna a validar. Màxim 3.
6. **Temps màxim i mida màxima** de resposta.
7. **Llista blanca opcional** per a qui vulgui apretar més, configurable per variable d'entorn.

**Un servidor que s'autoallotja a casa és exactament el cas on això fa mal**, perquè la xarxa interna sol tenir serveis sense autenticar.

---

## 8 · Seguretat general

### Contrasenyes i sessions

argon2id amb paràmetres fixats en fer l'scaffold. Mínim 10 caràcters, sense regles d'estil absurdes, i comprovació contra una llista de contrasenyes filtrades si es pot fer localment.

Tokens de refresc rotatius; reutilitzar-ne un de gastat revoca tota la família de sessions. Galetes `HttpOnly`, `Secure`, `SameSite=Lax` a la web; `Bearer` a Android.

### CSRF

Amb galetes, cal protecció CSRF a totes les mutacions. `SameSite=Lax` cobreix molt, però no els `POST` de formularis d'altres orígens: cal token de doble enviament o comprovació d'origen.

L'API amb `Bearer` no la necessita, i és una raó més per no barrejar els dos mecanismes al mateix camí.

### CORS

L'API l'han de poder cridar l'app Android i clients d'IA de tercers. **Els orígens permesos es configuren**; no s'obre a `*` amb credencials, que a més els navegadors no permeten.

### CSP i el problema dels estils en línia

**El design system Plou fa servir estils en línia a tots els components.** Això xoca de cara amb una CSP estricta.

Les opcions, en ordre de preferència:

1. **Nonce per petició**, amb els estils recollits en un `<style>` amb nonce. Requereix HTML generat pel servidor per a l'esquelet.
2. Extreure els estils a classes en temps de compilació.
3. `'unsafe-inline'` només a `style-src`, mantenint `script-src` estricte.

**L'opció 3 és acceptable com a punt de partida** — el risc real d'injecció d'estil és molt menor que el de script — però s'ha d'escriure com a decisió conscient, no deixar-la per descuit.

`script-src` **mai** porta `'unsafe-inline'` ni `'unsafe-eval'`.

### Adjunts

Fora de l'arrel web, servits per un handler que comprova permisos. Mai per ruta endevinable.

`Content-Disposition: attachment` per defecte i `X-Content-Type-Options: nosniff`. El tipus s'infereix del contingut, no de l'extensió ni del que digui el client. Límit de mida configurable.

### Secrets en repòs

Les credencials dels calendaris externs es xifren amb una clau derivada d'un secret de la instància.

Aquest secret **es genera al primer arrencament i es persisteix al volum**. Si es regenera, es perden totes les credencials guardades. Ha d'estar documentat a la guia de còpia de seguretat.

### Capçaleres

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

A les pàgines de compartits, `Referrer-Policy: no-referrer`.

---

## 9 · Dades personals

**Exportació.** `GET /api/v1/export` retorna tot el que és de l'usuari en JSON, més els adjunts. Sense demanar-ho a ningú.

**Esborrar un compte.** L'admin pot esborrar un usuari. Les tasques dels àmbits col·lectius es conserven amb l'autor anonimitzat; les dels àmbits individuals s'esborren. Cal preguntar-ho explícitament, no decidir-ho pel seu compte.

**Netejar instància** (brief línia 43). A Ajustos → Admin. Esborra tots els usuaris menys el que ho executa, tots els àmbits, tasques, esdeveniments, adjunts, compartits, tokens i historial. Conserva la configuració de la instància i el secret de xifratge.

Confirmació escrivint el nom de la instància. **Còpia de seguretat automàtica de la base de dades abans d'executar-ho**, amb la ruta a la pantalla.

És irreversible i s'ha de dir amb aquestes paraules.

---

## 10 · Proves de seguretat

Les que han d'estar a CI:

1. **SSRF**: intentar afegir un calendari amb URL a loopback, a un rang privat i a l'adreça de metadades. Els tres han de fallar. I una amb redirecció cap a un rang privat.
2. **Enumeració de compartits**: un token inexistent i un de revocat donen la mateixa resposta.
3. **Força bruta**: 6 intents de contrasenya fan saltar el bloqueig.
4. **Abast de token**: un token d'un sol àmbit no veu ni toca res d'un altre, per API i per MCP.
5. **Escalada de convidat**: una sessió de convidat no serveix per a cap altre enllaç ni per a cap ruta de l'API.
6. **CSRF**: una mutació amb galeta i origen extern es rebutja.
7. **Pujada**: un fitxer amb extensió enganyosa no es serveix amb el tipus que diu l'extensió.
