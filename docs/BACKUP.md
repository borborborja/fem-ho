# Còpies de seguretat i restauració

`docs/12` §6 demana tres coses, i **la tercera és la que ningú fa**: un procediment de
restauració que l'autor hagi executat de veritat. El d'aquest document està executat, i
els números que hi surten són els que va donar.

---

## Què copiar

**El volum `/data` sencer.** A dins hi ha:

| Què | Per què no es pot perdre |
| --- | --- |
| `femho.db` (+ `-wal` i `-shm`) | Les dades |
| `secret.key` | El pebre dels enllaços compartits i la clau de les credencials d'orígens externs. **Sense ell, tots els enllaços compartits deixen de servir i les credencials no es poden desxifrar** |
| `backups/` | Les còpies automàtiques d'abans de cada migració |
| Adjunts | |

I a la base de dades, a `instance_settings`, **les claus VAPID**. No hi ha rotació: si es
perden, tothom ha de tornar a activar les notificacions (`docs/11` §2).

Amb PostgreSQL, el volum **més** un bolcat de la base.

---

## Com NO es fa

```
cp /data/femho.db /on/sigui/copia.db     # ← MAI amb el servidor engegat
```

Això no és una advertència teòrica. Executat amb el mode WAL actiu i escriptures en
curs, aquest és el resultat real:

```
1 · base creada amb 500 files, WAL actiu
2 · còpia amb cp: 495 files (la base en té 501)
3 · còpia en línia: 501 files
```

**Sis files perdudes, i cap error.** El fitxer copiat s'obre, passa l'`integrity_check` i
sembla correcte: el que falta és el que encara era al registre WAL i no s'havia
consolidat. Una còpia així es descobreix el dia que es restaura.

---

## Com es fa

### Amb el servidor engegat

L'API de còpia en línia de SQLite. Fem-ho ja la fa servir abans de cada migració
(`apps/server/src/db/migrator.ts`), i es pot invocar a mà:

```sh
docker compose exec -w /app/apps/server femho \
  node -e "new (require('better-sqlite3'))('/data/femho.db').backup('/data/backups/manual-'+Date.now()+'.db')"
```

**El `-w /app/apps/server` no és decoració.** La imatge és un monorepo i `better-sqlite3`
viu al `node_modules` del servidor, no al de l'arrel: sense el directori de treball, el
comandament falla amb `Cannot find module 'better-sqlite3'`.

Aquí ho deia sense el `-w`, i el comandament **no ha funcionat mai a la imatge publicada**.
Es va descobrir el dia que va caldre fer una còpia de veritat abans d'una migració, que és
exactament el pitjor dia per descobrir-ho. Ara ho comprova el flux de la imatge a cada
construcció: veure «Còpia de seguretat» a la sortida de CI vol dir que aquesta línia,
literalment aquesta, ha funcionat.

**La imatge no porta el binari `sqlite3`**, i per això aquí no n'hi ha cap comandament: la
còpia la fa el mateix `better-sqlite3` que fa servir el servidor, que és el que ja invoca
`apps/server/src/db/migrator.ts` abans de cada migració.

### Amb el servidor aturat

Aturar-lo net i copiar el volum sencer és igual de vàlid i més simple:

```sh
docker compose stop femho
docker run --rm -v femho-data:/data -v "$PWD:/sortida" alpine \
  tar czf /sortida/femho-$(date +%F).tar.gz -C /data .
docker compose start femho
```

`docker compose stop` envia `SIGTERM`, i el contenidor el rep de debò perquè hi ha
`tini` de PID 1 (`docs/12` §1). Sense això, l'aturada seria un tall brusc.

### Còpies contínues

Per a qui en vulgui, [Litestream](https://litestream.io) replica SQLite a
emmagatzematge d'objectes en continu. No hi ha res a Fem-ho que hi calgui canviar.

---

## Com restaurar — **procediment executat**

Els passos de sota són els que es van executar per escriure aquest document. La sortida
és la real.

### 1. Aturar el servidor

```sh
docker compose stop femho
```

**Primer això.** Restaurar per sota d'un procés que està escrivint deixa la base en un
estat pitjor que el que s'intentava arreglar.

### 2. Treure el que hi ha

```sh
docker run --rm -v femho-data:/data alpine \
  sh -c 'rm -f /data/femho.db /data/femho.db-wal /data/femho.db-shm'
```

**Els tres fitxers, no només el primer.** Si es deixa un `-wal` de la base vella al
costat de la restaurada, SQLite hi aplicarà transaccions que no li pertoquen.

### 3. Posar-hi la còpia

```sh
docker run --rm -v femho-data:/data -v "$PWD:/entrada" alpine \
  cp /entrada/copia-en-linia.db /data/femho.db
```

### 4. Comprovar-ho abans d'arrencar

```sh
docker compose run --rm --no-deps -w /app/apps/server femho \
  node -e "const d=new (require('better-sqlite3'))('/data/femho.db',{readonly:true});
           console.log(d.prepare('PRAGMA integrity_check').get(),
                       d.prepare('SELECT COUNT(*) AS n FROM tasks').get());"
```

**Amb la imatge de Fem-ho i no amb una de SQLite de fora**: la que hi havia aquí demanava
una imatge amb el binari `sqlite3`, que ni la nostra porta ni cal baixar —el servidor ja
duu la llibreria que ho fa.

Sortida de la prova real:

```
5 · restaurat: 501 files, integrity_check = ok
```

Si `integrity_check` no diu `ok`, **no s'arrenca**: es prova una altra còpia.

### 5. Arrencar

```sh
docker compose start femho
docker compose logs -f femho
```

Els registres han de dir de quina versió d'esquema a quina va la migració, si n'hi ha
cap pendent. Si una migració falla, **el procés no arrenca** i això és volgut: val més
no arrencar que arrencar amb l'esquema a mitges (`docs/12` §5).

---

## Què comprovar després

1. **Entrar-hi.** Si el `secret.key` és el bo, la sessió va.
2. **Un enllaç compartit d'abans.** Si dona "cal contrasenya" quan no en tenia, el
   `secret.key` **no** és el que tocava: els `token_hmac` es van calcular amb un altre
   pebre i cap enllaç antic tornarà a servir.
3. **Les notificacions.** Si han deixat d'arribar, les claus VAPID no són les d'abans.
4. **Un calendari des de DAVx⁵ o Apple**, que és el que confirma que el CalDAV encara
   respon el mateix.

---

## Freqüència

Fem-ho **ja fa una còpia abans de cada migració** i en guarda les últimes cinc a
`/data/backups/`. Això cobreix el cas d'una actualització que surti malament, i **no
cobreix res més**: ni un disc que mor, ni un esborrat per error, ni un contenidor que es
recrea sense el volum. Per a això cal una còpia teva, fora de la màquina.
