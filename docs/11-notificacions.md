# 11 · Notificacions

Recordatoris de tasques i esdeveniments, i avisos d'activitat. Tres canals: **push**, **email** i **webhook**.

---

## 1 · La simplificació que ho fa viable

Web Push (navegador i PWA) i UnifiedPush (Android sense Google) **fan servir les mateixes RFC i el mateix xifratge**.

Això vol dir que Fem-ho necessita **una sola taula de subscripcions i una sola crida d'enviament** per als dos clients. No calen dos subsistemes.

```sql
CREATE TABLE push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('web','android')),
  user_agent  TEXT,
  created_at  TEXT NOT NULL,
  last_ok_at  TEXT,
  fail_count  INTEGER NOT NULL DEFAULT 0
);
```

---

## 2 · Les claus VAPID són infraestructura, no un secret rotable

**Això és el que trenca instal·lacions senceres si es fa malament.**

El parell de claus VAPID identifica el servidor davant dels serveis de push. Canviar-lo **obliga a resubscriure tots els navegadors**. No hi ha manera de migrar-ho: les subscripcions existents deixen de funcionar i l'usuari només ho pot arreglar esborrant els permisos del lloc.

Conseqüències directes:

1. **Es genera un sol cop, al primer arrencament, i es persisteix a la base de dades i al volum.** Generar-lo a l'inici del contenidor mata silenciosament totes les subscripcions a cada reinici.
2. Ha de sortir a la guia de còpia de seguretat, al costat del secret de xifratge.
3. **No hi ha rotació.** Si s'ha de canviar per força, cal invalidar totes les subscripcions i avisar la gent que ha de tornar a activar les notificacions.

Un detall relacionat: **resubscriure's amb una clau diferent sense fer `unsubscribe()` abans llança un error** i deixa el client en un estat del qual no se'n surt sol. El codi de subscripció ha de comprovar si ja n'hi ha una amb una clau diferent i desfer-la primer.

---

## 3 · Els recordatoris els envia el servidor. Sempre.

L'API del navegador per programar notificacions locals **mai es va arribar a implementar i està abandonada**. No existeix cap manera de programar una notificació al client web.

Per tant **tota notificació web surt d'una feina programada al servidor** que consulta els recordatoris pendents. No és una tria d'arquitectura: és l'única possibilitat.

La feina s'executa cada 30 segons, agafa els recordatoris amb `fired_at IS NULL` i el moment ja passat, els envia i marca `fired_at`. Ha de ser idempotent: si el procés cau entremig, no es pot enviar dues vegades.

---

## 4 · Què esperar de cada plataforma

Això s'ha de dir a la interfície, no només a la documentació:

| Plataforma | Realitat |
| --- | --- |
| Chrome, Edge i Firefox d'escriptori | **Només reben push mentre el navegador s'està executant.** |
| Safari de macOS | Rep amb el navegador tancat. |
| **iOS i iPadOS** | **Cal afegir la web a la pantalla d'inici.** En una pestanya de Safari no funciona. |
| Android amb la PWA | Funciona. |
| Android amb l'app | UnifiedPush, o consulta periòdica si no hi ha distribuïdor. |

**El parany d'iOS**: en una pestanya de Safari, l'API de notificacions existeix però la de subscripció no. Una detecció ingènua de funcionalitats passa i després falla en silenci. Cal comprovar **les dues** i, si estem a iOS sense estar instal·lat, ensenyar les instruccions d'afegir a la pantalla d'inici en comptes d'un error.

Altres diferències que impedeixen fer-hi dependre res:

- **Safari ignora l'agrupació de notificacions.** No es pot confiar que dos avisos es col·lapsin.
- **Safari no té botons d'acció** a les notificacions. Els botons "Fet" i "Ajorna" són una millora d'Android, no una funció bàsica.

L'API de comptador d'insígnia serveix per posar el nombre de l'Inbox a la icona de la PWA instal·lada, on estigui disponible.

---

## 5 · Demanar permís

Les dades sobre això són brutals: la gran majoria de peticions de permís de notificació es rebutgen, i alguns navegadors ja rebutguen directament la promesa si no ve d'un gest de l'usuari.

**Fem-ho demana el permís en un sol moment: quan l'usuari desa el seu primer recordatori.** Mai en obrir l'app, mai a l'onboarding, mai amb un banner.

Si es denega, es diu clarament que els recordatoris arribaran per correu i com es pot canviar d'opinió des dels ajustos del navegador.

---

## 6 · Email

**Fem-ho envia correu com a client SMTP cap a un relé. Mai com a servidor de correu.**

Enviar directament des d'una IP domèstica no funciona a la pràctica: aquestes IP són a les llistes de bloqueig de correu massiu per disseny, i molts proveïdors de núvol bloquegen el port de sortida.

Configuració per variables d'entorn: amfitrió, port, usuari, contrasenya, xifratge, adreça de remitent. Amb un botó d'**enviar correu de prova** als ajustos, que és el que estalvia les hores de depuració.

Correus que s'envien: recordatoris, invitació a la instància, restabliment de contrasenya, i el resum diari opcional. **Cap correu de màrqueting, cap resum que ningú ha demanat.**

Plantilles en HTML i text pla, curtes, amb les convencions catalanes del glossari.

Si no hi ha SMTP configurat, la interfície ho ha de dir on toca (a la configuració de recordatoris), no fallar en silenci.

---

## 7 · Webhook

El canal escapatòria, i el més útil per a qui s'autoallotja: amb un sol adaptador es cobreixen Apprise, ntfy, Home Assistant, n8n, Matrix i el que sigui.

Per a una casa sense SMTP i sense serveis de Google, aquesta és sovint **l'única via que funciona de veritat**. Val la pena que estigui ben feta i ben documentada.

Format i signatura, els mateixos que els webhooks de [`05-api-rest.md`](05-api-rest.md) §6.

---

## 8 · Preferències

A Ajustos → General, per usuari:

| Què | Canals |
| --- | --- |
| Recordatoris de tasques | push · email · webhook |
| Recordatoris d'esdeveniments | push · email · webhook |
| M'han assignat una tasca | push · email |
| M'han comentat | push · email |
| La IA ha canviat alguna cosa meva | push · email |
| Resum diari | email, amb hora configurable |

Per defecte: recordatoris per push, assignacions per push, la resta desactivat. **Fem-ho no ha de ser sorollós.**

Hores de silenci configurables: els avisos que caurien dins es retenen fins que acaba, excepte els recordatoris amb hora exacta.

---

## 9 · Higiene de subscripcions

Un punt final de push mort retorna un error definitiu. Quan passa, **la subscripció s'esborra immediatament**; no s'hi reintenta.

Els navegadors poden canviar el punt final d'una subscripció pel seu compte. El *service worker* ha d'escoltar aquest esdeveniment i tornar-se a subscriure automàticament: sense això, les notificacions deixen de funcionar de mica en mica i ningú sap per què.

`fail_count` compta les fallades transitòries; a partir de 10 consecutives, la subscripció es dona per morta.

---

## 10 · Temps de venciment

La llibreria d'enviament sol portar un temps de vida per defecte molt llarg — de setmanes. **Per a un recordatori això és catastròfic**: un avís de "reunió d'aquí a 1 hora" no s'ha d'entregar tres dies després.

Cal fixar-lo explícitament:

| Tipus | Temps de vida |
| --- | --- |
| Recordatori | 1 hora |
| Assignació o comentari | 24 hores |
| Resum diari | 6 hores |

---

## 11 · Proves

1. **Cicle complet**: crear un recordatori d'aquí a un minut i comprovar que arriba a la PWA i a Android.
2. **Persistència de VAPID**: reiniciar el contenidor i comprovar que les subscripcions existents segueixen funcionant. **Aquesta és la prova que impedeix la regressió més cara del document.**
3. **Punt final mort**: simular la resposta d'un punt final caducat i comprovar que la subscripció s'esborra.
4. **Idempotència**: matar el procés a mig enviar el lot i comprovar que en reprendre no es duplica cap avís.
5. **Detecció d'iOS**: en una pestanya de Safari, comprovar que es mostren les instruccions d'instal·lació i no un error.
6. **Sense SMTP**: comprovar que la interfície ho diu i que no es perd cap recordatori en silenci.
