# Compatibilitat CalDAV: què s'ha provat i què no

`docs/07` §11 és explícit: **CalDAV no es pot donar per bo amb tests unitaris.** Aquest
document diu, sense adornar-ho, quina part està verificada i quina no.

## Automatitzat i verd

| Prova | Què cobreix |
| --- | --- |
| `apps/server/src/dav/xml.test.ts` | El mateix document amb els prefixos de DAVx⁵ i amb els d'Apple dona el mateix resultat |
| `apps/server/src/dav/server.test.ts` | Descobriment sencer, `supported-calendar-component-set`, ctag i sync-token, contra el servidor viu |
| `apps/server/src/dav/write.test.ts` | `PUT`/`DELETE`, precondicions amb `412`, round-trip que no perd propietats |
| `apps/server/src/dav/fetch-safe.test.ts` | Les set mitigacions d'SSRF de `docs/10` §7 |
| `apps/server/src/dav/client.test.ts` | Refresc d'orígens externs, alarmes, credencials xifrades |
| `apps/server/src/dav/reference.test.ts` | Comparació amb **Radicale** i **Xandikos** aixecats amb Compose |

Per aixecar les referències:

```
sudo docker compose -f tools/caldav-reference/compose.yaml up -d
npx vitest run apps/server/src/dav/reference.test.ts
sudo docker compose -f tools/caldav-reference/compose.yaml down
```

Si no hi són, aquelles proves surten com a **saltades** i el nom del bloc diu
`referències disponibles: CAP`. No passen en silenci.

## Pendent de provar a mà — cal la teva intervenció

Això no es pot automatitzar i **no s'ha fet**. Fins que no es faci, la compatibilitat
amb aquests clients és una expectativa raonable, no un fet.

| Client | Què cal comprovar |
| --- | --- |
| **DAVx⁵** (+ Tasks.org, jtx Board) | Que vegi les dues col·leccions per contenidor i les classifiqui bé. Si `supported-calendar-component-set` no li agrada, no ensenya res i no diu per què |
| **Apple Recordatoris i Calendari** | Els `PUT` amb `Expect: 100-continue`, i la sensibilitat al `VTIMEZONE` |
| **Thunderbird** | Que les propietats `X-MOZ-*` sobrevisquin un round-trip |
| **Evolution** | Comportament general |
| **Nextcloud Tasks** | `X-OC-HIDESUBTASKS` |

## Coses que sabem que encara no hi són

- **Baïkal** no és a la comparació: la imatge oficial necessita una instal·lació per web
  abans de respondre res, i automatitzar-ho hauria estat més fràgil que útil. Radicale i
  Xandikos ja donen dos punts de vista independents.
- **`MKCALENDAR` i `MKCOL` s'anuncien a `Allow` però responen `405`.** L'`Allow` és el
  que `docs/07` §3 fixa literalment, i els clients el fan servir per saber què sap fer el
  servidor en general. Fem-ho no deixa que un client creï col·leccions perquè les
  col·leccions són el reflex dels àmbits i projectes, no a l'inrevés.
- **La preservació de `X-FEMHO-*` en servidors de tercers és una suposició**, com ja
  avisa `docs/07` §7. Per a les col·leccions que publica Fem-ho no hi ha problema —les
  guardem nosaltres i a més tenim `raw_ical`—; el risc és només quan Fem-ho escriu a un
  origen extern, i s'ha de provar per origen.
