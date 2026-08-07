/**
 * Avatars i dades de Gravatar.
 *
 * QUÈ ÉS I QUÈ COSTA
 * ------------------
 * Gravatar dona una foto a partir del hash del correu. És còmode i és de tercers
 * —Automattic—, i en un producte autoallotjat això no és un detall: encendre-ho vol dir
 * que la cara de la gent de casa la serveix algú altre.
 *
 * Per això aquí es fan tres coses que la manera fàcil no fa:
 *
 * **1 · Va pel servidor, no pel navegador.**
 *
 * La manera fàcil és un `<img src="https://gravatar.com/avatar/…">` i s'ha acabat. Però
 * llavors **cada navegador de casa parla amb Gravatar directament**, i a cada càrrega de
 * pàgina els arriba la IP de cadascú, la pàgina d'on ve i el hash del correu. Passant-hi
 * pel servidor, Gravatar veu una sola màquina i prou.
 *
 * **2 · Es guarda al volum, i per això segueix funcionant sense connexió.**
 *
 * Un `<img>` extern amb el wifi caigut és un quadre trencat. Amb la còpia al disc, la
 * cara hi és igual. La regla 6 diu que offline-first no és una capa que s'afegeix després,
 * i un avatar que només existeix quan hi ha internet la trencaria en el lloc més visible
 * de la interfície.
 *
 * **3 · El hash del correu NO és anonimat, i es diu.**
 *
 * Es llegeix sovint que "només s'envia un hash". Per a una adreça que algú ja sospita,
 * comprovar-la és calcular-ne el SHA-256 i comparar: no protegeix de res. Qui encengui
 * això ha de saber que està dient a un tercer quines adreces té la seva instància, i per
 * això hi ha l'interruptor per persona: **és el seu correu, no el de qui administra.**
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import { isTrue } from '../db/bool.js';
import { safeFetch, type SafeFetchOptions } from '../dav/fetch-safe.js';
import { notFound } from '../policy/errors.js';

/**
 * Les dues màquines amb què es parla. **No surten de la configuració a posta**: si
 * l'amfitrió fos una variable, un desplegament podria apuntar les cares de casa on
 * volgués.
 */
const IMAGES = 'https://gravatar.com';
const API = 'https://api.gravatar.com/v3';

/**
 * Quant dura una còpia abans de tornar-la a demanar.
 *
 * Un dia. Qui es canvia la foto vol veure-la aviat, i preguntar-ho a cada càrrega de
 * pàgina seria fer treballar un servei de tercers per una cara que canvia un cop l'any.
 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * El hash del correu, tal com Gravatar l'espera: **retallat, en minúscules i SHA-256**.
 *
 * MD5 és el que es feia servir històricament i encara funciona; SHA-256 és el que la seva
 * documentació recomana avui i és el que es fa servir aquí. No és cap protecció —veure la
 * capçalera— sinó el format que el servei demana.
 */
export function gravatarHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

export interface AvatarBytes {
  data: Buffer;
  mimeType: string;
}

/**
 * Qui té avatar, i quin correu li correspon.
 *
 * Torna `null` quan **aquesta persona no vol** —l'interruptor per usuari— o quan no té
 * correu, que és el cas dels usuaris ombra de la federació i de la fila de la IA.
 */
async function emailFor(db: MigrationDb, userId: string): Promise<string | null> {
  const found = await sql<{ email: string | null; gravatar: number | boolean | null }>`
    SELECT u.email, s.gravatar
    FROM users u
    LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE u.id = ${userId} AND u.deleted_at IS NULL AND u.kind = 'human'
  `.execute(db);

  const row = found.rows[0];
  if (row === undefined || row.email === null) return null;
  // Sense fila de preferències encara, val el valor per defecte de la columna: sí.
  if (row.gravatar !== null && !isTrue(row.gravatar)) return null;
  return row.email;
}

/**
 * L'avatar d'una persona, del disc si hi és i de Gravatar si no.
 *
 * `d=404` és el que fa que això sigui utilitzable: sense aquell paràmetre, Gravatar
 * respon **sempre** amb una silueta genèrica, i llavors no hi ha manera de distingir "no
 * té foto" de "en té una". Amb ell, qui no en té dona 404 i la interfície es queda amb les
 * inicials, que per a una casa és millor que una silueta igual per a tothom.
 */
export async function avatarFor(
  db: MigrationDb,
  userId: string,
  dataDir: string,
  options: { enabled: boolean; now?: number; fetchOptions?: SafeFetchOptions } = {
    enabled: false,
  },
): Promise<AvatarBytes> {
  if (!options.enabled) throw notFound('avatar', userId);

  const email = await emailFor(db, userId);
  if (email === null) throw notFound('avatar', userId);

  const hash = gravatarHash(email);
  const cached = join(dataDir, 'avatars', `${hash}.img`);
  const now = options.now ?? Date.now();

  const fresh = await stat(cached)
    .then((info) => now - info.mtimeMs < CACHE_TTL_MS)
    .catch(() => false);

  if (fresh) {
    const data = await readFile(cached);
    // Un fitxer buit és la marca de "aquesta persona no en té": es guarda igualment per
    // no tornar a preguntar-ho a cada càrrega de pàgina.
    if (data.length === 0) throw notFound('avatar', userId);
    return { data, mimeType: sniffImage(data) };
  }

  /**
   * **Que la xarxa falli no és un error del producte, és "avui no hi ha foto".**
   *
   * Sense aquest `catch`, una caiguda de Gravatar —o un DNS que no respon, o un guarda
   * que bloca— sortia com un 500 a la ruta de l'avatar. La cara de algú no ha de fer que
   * una pantalla es vegi trencada: es queda amb les inicials i ja està.
   *
   * I **no es recorda**, a diferència del 404: un tall de connexió no vol dir que aquesta
   * persona no tingui foto, i guardar-ho un dia sencer per un blip seria decidir-ho
   * malament.
   */
  const response = await safeFetch(`${IMAGES}/avatar/${hash}?s=160&d=404`, {
    ...options.fetchOptions,
    // Una foto de 160px no arriba enlloc a prop del límit per defecte, i posar-hi un
    // sostre propi evita que una resposta rara ompli el volum.
    maxBytes: 512 * 1024,
  }).catch(() => null);

  if (response === null) throw notFound('avatar', userId);

  await mkdir(dirname(cached), { recursive: true });

  if (response.status !== 200 || response.bytes.length === 0) {
    /**
     * **Un 404 també es recorda, i una caiguda també.**
     *
     * Si no, una instància amb deu persones sense Gravatar preguntaria deu vegades a cada
     * càrrega de pàgina, per sempre. El fitxer buit caduca amb el mateix TTL que els bons,
     * o sigui que qui es faci un compte hi apareixerà l'endemà.
     */
    await writeFile(cached, Buffer.alloc(0), { mode: 0o600 });
    throw notFound('avatar', userId);
  }

  await writeFile(cached, response.bytes, { mode: 0o600 });
  return { data: response.bytes, mimeType: sniffImage(response.bytes) };
}

export interface GravatarProfile {
  display_name: string | null;
  location: string | null;
  description: string | null;
  pronouns: string | null;
  job_title: string | null;
  company: string | null;
}

/**
 * Les dades públiques del perfil.
 *
 * **Va a `api.gravatar.com/v3`, no al `gravatar.com/<hash>.json` de tota la vida.** Aquell
 * és el que surt a mig internet i **ja no funciona**: respon `404 "User not found"` fins i
 * tot per a un correu que sí que té perfil i té foto. Es va veure provant-ho contra el
 * servei real, no llegint-ho enlloc; la documentació d'avui només documenta el v3.
 *
 * Sense clau d'API funciona igualment —cent peticions per hora en comptes de mil— i dona
 * els camps que aquí interessen. Els que queden fora de la versió no autenticada són
 * enllaços, interessos i galeria, que no els volem.
 *
 * **Serveix per PROPOSAR, no per aplicar.** Ho torna qui pregunta pel seu propi perfil, i
 * la pantalla d'Ajustos ofereix omplir-hi el que tingui buit. Sobreescriure el nom que
 * algú ja ha escrit aquí amb el que va posar fa cinc anys en un altre lloc és canviar-li
 * les dades sense demanar-ho.
 */
export async function profileFor(
  email: string,
  options: { enabled: boolean; fetchOptions?: SafeFetchOptions } = { enabled: false },
): Promise<GravatarProfile | null> {
  if (!options.enabled) return null;

  const response = await safeFetch(
    `${API}/profiles/${gravatarHash(email)}`,
    options.fetchOptions ?? {},
  ).catch(() => null);
  if (response === null || response.status !== 200) return null;

  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    return null;
  }

  const text = (key: string): string | null => {
    const value = entry[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 200) : null;
  };

  return {
    display_name: text('display_name'),
    location: text('location'),
    description: text('description'),
    pronouns: text('pronouns'),
    job_title: text('job_title'),
    company: text('company'),
  };
}

/**
 * El tipus surt **del contingut**, com als adjunts (`docs/10` §8).
 *
 * El que ve de fora no marca el `Content-Type` amb què ho tornem a servir, encara que
 * aquí l'origen sigui conegut: és una regla que no val la pena tenir a mitges.
 */
function sniffImage(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (data[0] === 0x52 && data[1] === 0x49) return 'image/webp';
  return 'application/octet-stream';
}
