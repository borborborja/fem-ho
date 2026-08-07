/**
 * Gravatar.
 *
 * **No es pica el gravatar.com de debò.** Una prova que depèn d'un servei de tercers falla
 * el dia que ells tinguin un mal moment i no diu res del nostre codi. Es munta un servidor
 * a loopback que respon com el seu, i el que es comprova és el que és nostre: que la còpia
 * al disc estalvia peticions, que un 404 també es recorda, que la instància apagada no
 * pregunta res, i que qui ha dit que no, no surt.
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { isBlockedAddress, SsrfError } from '../dav/fetch-safe.js';
import { PolicyError } from '../policy/errors.js';
import { avatarFor, gravatarHash, profileFor } from './gravatar.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-grav-'));
const NOW = '2026-08-07T18:00:00.000Z';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

let conn: Connection;
let fals: Server;
let base = '';
let userId = '';
let sensePref = '';

/** Quantes vegades s'ha demanat res al servei. És el que fa visible la memòria cau. */
let peticions = 0;
let respon: 'foto' | 'gens' = 'foto';

/** Igual d'estricta que la de debò, menys per al servidor de proves a loopback. */
const permetLoopback = {
  guard: async (url: URL) => {
    const host = url.hostname;
    if (host !== '127.0.0.1' && isBlockedAddress(host)) {
      throw new SsrfError(`"${host}" és una adreça interna.`);
    }
    return { address: host, family: 4 as const };
  },
};

/**
 * El servei de mentida es fa passar per gravatar.com **canviant l'amfitrió a la funció**.
 *
 * `avatarFor` va sempre a `https://gravatar.com`, que és el que ha de fer en producció: si
 * l'amfitrió sortís de la configuració, un desplegament podria apuntar les cares de casa
 * on volgués. Per provar-ho, doncs, s'hi arriba per l'única porta que la funció deixa
 * oberta —les opcions de `safeFetch`— amb un guarda que a més reescriu on va la petició.
 */
function capALoopback() {
  return {
    ...permetLoopback,
    guard: async (url: URL) => {
      url.protocol = 'http:';
      url.host = base.replace('http://', '');
      return permetLoopback.guard(url);
    },
  };
}

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'g.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  fals = createServer((req, res) => {
    peticions += 1;
    if (req.url?.includes('/profiles/') === true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      // La forma del v3: camps plans, no l'`entry[]` del `.json` antic.
      res.end(JSON.stringify({ display_name: 'La Berta', location: 'Girona' }));
      return;
    }
    if (respon === 'gens') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  });
  await new Promise<void>((resolve) => fals.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((fals.address() as AddressInfo).port)}`;

  userId = uuidv7();
  sensePref = uuidv7();
  for (const [id, email] of [
    [userId, 'berta@e.com'],
    [sensePref, 'arnau@e.com'],
  ] as const) {
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${id}, ${email}, 'Algú', 'x', 'human', 'member', ${NOW}, ${NOW})
    `.execute(conn.db);
  }
  // Una fila de preferències per a la primera; la segona no en té, que és el cas de qui
  // no ha tocat mai res.
  await sql`
    INSERT INTO user_settings (user_id, gravatar, notify_prefs, updated_at)
    VALUES (${userId}, 1, '{}', ${NOW})
  `.execute(conn.db);
});

beforeEach(() => {
  peticions = 0;
  respon = 'foto';
  rmSync(join(tmp, 'avatars'), { recursive: true, force: true });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    fals.close(() => {
      resolve();
    });
  });
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('el hash', () => {
  /**
   * El format que el servei demana: retallat, en minúscules i SHA-256. **No és cap
   * protecció**: per a una adreça que algú ja sospita, comprovar-la és fer això mateix.
   */
  it('no distingeix majúscules ni espais, que és el que Gravatar espera', () => {
    expect(gravatarHash('  Berta@Exemple.ORG ')).toBe(gravatarHash('berta@exemple.org'));
    expect(gravatarHash('berta@exemple.org')).toHaveLength(64);
  });
});

describe('amb la instància apagada', () => {
  /** El cas per defecte: **no es pregunta res de ningú a cap tercer.** */
  it('no es demana res, ni tan sols per saber si en té', async () => {
    await expect(avatarFor(conn.db, userId, tmp, { enabled: false })).rejects.toBeInstanceOf(
      PolicyError,
    );
    expect(peticions).toBe(0);
  });

  it('i el perfil tampoc es va a buscar', async () => {
    expect(await profileFor('berta@e.com', { enabled: false })).toBeNull();
    expect(peticions).toBe(0);
  });
});

describe('amb la instància encesa', () => {
  const opcions = () => ({ enabled: true, fetchOptions: capALoopback() });

  it('la foto arriba i el tipus surt del contingut', async () => {
    const found = await avatarFor(conn.db, userId, tmp, opcions());
    expect(found.mimeType).toBe('image/png');
    expect(found.data.equals(PNG)).toBe(true);
  });

  /**
   * **La còpia al disc és el que fa que això no piqui un tercer a cada càrrega de pàgina**,
   * i el que fa que la cara segueixi sortint sense connexió.
   */
  it('i la segona vegada surt del disc, sense tornar a preguntar', async () => {
    await avatarFor(conn.db, userId, tmp, opcions());
    expect(peticions).toBe(1);

    await avatarFor(conn.db, userId, tmp, opcions());
    expect(peticions).toBe(1);
  });

  /**
   * **Un 404 també es recorda.** Si no, una casa amb deu persones sense Gravatar
   * preguntaria deu vegades a cada càrrega de pàgina, per sempre.
   */
  it('i qui no en té dona 404, que també es recorda', async () => {
    respon = 'gens';
    await expect(avatarFor(conn.db, userId, tmp, opcions())).rejects.toBeInstanceOf(PolicyError);
    expect(peticions).toBe(1);

    await expect(avatarFor(conn.db, userId, tmp, opcions())).rejects.toBeInstanceOf(PolicyError);
    expect(peticions).toBe(1);
  });

  it('però passat el temps es torna a mirar, que la gent es canvia la foto', async () => {
    await avatarFor(conn.db, userId, tmp, opcions());
    expect(peticions).toBe(1);

    // Un dia i escaig més tard.
    const dema = Date.now() + 25 * 60 * 60 * 1000;
    await avatarFor(conn.db, userId, tmp, { ...opcions(), now: dema });
    expect(peticions).toBe(2);
  });

  it('qui no ha tocat res també en té: el valor per defecte és sí', async () => {
    const found = await avatarFor(conn.db, sensePref, tmp, opcions());
    expect(found.mimeType).toBe('image/png');
  });

  /**
   * **La casella és de cadascú.** El correu que es converteix en hash i viatja és el seu,
   * no el de qui administra la instància.
   */
  it('i qui ha dit que no, no surt: ni es pregunta', async () => {
    await sql`UPDATE user_settings SET gravatar = 0 WHERE user_id = ${userId}`.execute(conn.db);

    await expect(avatarFor(conn.db, userId, tmp, opcions())).rejects.toBeInstanceOf(PolicyError);
    expect(peticions).toBe(0);

    await sql`UPDATE user_settings SET gravatar = 1 WHERE user_id = ${userId}`.execute(conn.db);
  });

  it('i qui no té correu tampoc: els usuaris ombra i la fila de la IA', async () => {
    const ombra = uuidv7();
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${ombra}, ${null}, 'Una altra casa', ${null}, 'remote', 'member', ${NOW}, ${NOW})
    `.execute(conn.db);

    await expect(avatarFor(conn.db, ombra, tmp, opcions())).rejects.toBeInstanceOf(PolicyError);
    expect(peticions).toBe(0);
  });

  it('el perfil torna el que hi ha, per proposar-ho', async () => {
    const found = await profileFor('berta@e.com', {
      enabled: true,
      fetchOptions: capALoopback(),
    });
    expect(found).toMatchObject({ display_name: 'La Berta', location: 'Girona' });
  });
});
