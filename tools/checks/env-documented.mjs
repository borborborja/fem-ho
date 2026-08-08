#!/usr/bin/env node
/**
 * env-documented — comprovació permanent.
 *
 * "Cap variable d'entorn documentada que el codi no llegeixi, ni cap que llegeixi i no
 * estigui documentada."
 *
 * EL DEFECTE QUE EXISTEIX PER ATURAR
 * ----------------------------------
 * `FEMHO_TRUSTED_PROXIES` sortia al `compose.yaml` que es reparteix, a `.env.example`, a
 * `docs/12` —dues vegades, una a la taula i una a les instruccions del proxy invers— i a
 * `docs/DEPLOY.md`. **No la llegia ningú.** Al codi només n'hi havia el nom, dins d'un
 * comentari que deia que algun dia caldria:
 *
 *     // els rangs de confiança es fixaran amb FEMHO_TRUSTED_PROXIES quan hi hagi
 *     // límits de ritme i sessions (M3)
 *     trustProxy: false,
 *
 * O sigui que qui muntés Fem-ho darrere d'un proxy invers i seguís les instruccions
 * posava aquella variable, no rebia cap error, i es quedava creient que les capçaleres
 * `X-Forwarded-*` es tenien en compte. La mena de cosa que només es descobreix el dia que
 * importa i mirant el codi.
 *
 * L'altra direcció fa el mateix mal a l'inrevés: una opció que existeix i que ningú sap
 * que hi és. `FEMHO_GRAVATAR` i `FEMHO_ALLOW_REGISTRATION` van néixer documentades perquè
 * es van escriure alhora, però res no ho garantia.
 *
 * COM ES COMPROVA
 * ---------------
 * **La font de veritat és el codi**, no cap llista mantinguda a mà: es busquen les
 * lectures de `process.env.FEMHO_*` i les crides als ajudants de `config.ts`, que porten
 * el nom sense prefix. Contra això es comparen els fitxers que un operador llegeix.
 *
 * `_FILE` no es compta a part: és un sufix que val per a qualsevol variable i està
 * explicat al costat de la taula.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, walk } from './lib/scan.mjs';

/** Els fitxers que un operador llegeix per saber què pot configurar. */
const DOCS = ['docs/12-desplegament.md', 'docs/DEPLOY.md', '.env.example'];

/**
 * Les de proves. No són opcions d'operador i no han de sortir a la guia de desplegament.
 */
const TEST_ONLY = /^FEMHO_TEST_/u;

/**
 * Una línia pot **anomenar** una variable sense oferir-la.
 *
 * Dos casos legítims, i tots dos han de dir-ho amb paraules a la mateixa línia:
 *
 * - L'especificació descriu el producte, no només el que ja hi ha: una variable de futur
 *   s'hi val si diu **"encara no"**.
 * - I una guia pot desmentir-ne una que circula per tutorials vells —"si has vist X, **no
 *   existeix**"—, que és més útil que callar.
 *
 * El que no val és nomenar-la com si funcionés, que és el defecte que això atura.
 */
const NOT_OFFERED = /encara no|no existeix|no ha existit/iu;

/** I el que se li reparteix ja fet. */
const COMPOSE = ['compose.yaml', 'compose.postgres.yaml'];

/**
 * Les que el codi llegeix de debò.
 *
 * Dues formes: `process.env.FEMHO_X` directament, i els ajudants de `config.ts`
 * —`env('X')`, `envInt('X', …)`, `envBool('X')`— que hi posen el prefix ells.
 */
export function readByCode(text) {
  const found = new Set();
  for (const match of text.matchAll(/process\.env\.(FEMHO_[A-Z0-9_]+)/gu)) {
    found.add(match[1]);
  }
  for (const match of text.matchAll(/\benv(?:Int|Bool)?\(\s*'([A-Z0-9_]+)'/gu)) {
    found.add(`FEMHO_${match[1]}`);
  }
  return found;
}

/** I les que un document anomena. Un nom dins d'un `_FILE` compta per la seva base. */
export function namedInDocs(text) {
  const found = new Set();
  for (const match of text.matchAll(/(FEMHO_[A-Z0-9_]+)/gu)) {
    found.add(match[1].replace(/_FILE$/u, ''));
  }
  return found;
}

if (process.argv.includes('--self-test')) {
  const cases = [
    ["process.env.FEMHO_SOURCE_URL ?? ''", readByCode, 'FEMHO_SOURCE_URL', true],
    ["env('BASE_URL')", readByCode, 'FEMHO_BASE_URL', true],
    ["envInt('PORT', 8080)", readByCode, 'FEMHO_PORT', true],
    ["envBool('GRAVATAR') ?? false", readByCode, 'FEMHO_GRAVATAR', true],
    // Un nom dins d'un comentari NO és una lectura: és exactament el cas del defecte.
    [
      '// es fixaran amb FEMHO_TRUSTED_PROXIES quan calgui',
      readByCode,
      'FEMHO_TRUSTED_PROXIES',
      false,
    ],
    ['| `FEMHO_PORT` | `8080` |', namedInDocs, 'FEMHO_PORT', true],
    // `namedInDocs` només mira noms; qui filtra les línies que desmenteixen és
    // `NOT_OFFERED`, i es prova a part.
    [
      '| `FEMHO_SMTP_HOST` | — | Correu. **Encara no** hi és |',
      namedInDocs,
      'FEMHO_SMTP_HOST',
      true,
    ],
    ['FEMHO_SECRET_FILE=/run/secrets/x', namedInDocs, 'FEMHO_SECRET', true],
  ];

  const markers = [
    ['| `FEMHO_SMTP_HOST` | — | **Encara no** hi és |', true],
    ['Si has vist `FEMHO_TRUSTED_PROXIES`: no existeix.', true],
    ['Aquí hi deia `FEMHO_SECRET_KEY`, que no ha existit mai', true],
    ["| `FEMHO_PORT` | `8080` | El port de l'aplicació |", false],
  ];

  let bad = 0;
  for (const [line, expected] of markers) {
    if (NOT_OFFERED.test(line) !== expected) {
      console.error(`  marcador: "${line}" esperava ${String(expected)}`);
      bad += 1;
    }
  }
  for (const [text, fn, name, expected] of cases) {
    if (fn(text).has(name) !== expected) {
      console.error(`  "${text}" → ${name} esperava ${String(expected)}`);
      bad += 1;
    }
  }
  console.log(`env-documented --self-test · ${String(cases.length + markers.length)} casos`);
  if (bad > 0) process.exit(1);
  console.log('  autoprova correcta.');
  process.exit(0);
}

// ---------------------------------------------------------------- el que llegeix el codi

const read = new Set();
for (const file of walk(join(ROOT, 'apps', 'server', 'src'), ['.ts'])) {
  if (file.rel.includes('.test.')) continue;
  /**
   * Els comentaris fora, i és el punt de tot això: el defecte era **un nom dins d'un
   * comentari** que els documents es van creure.
   */
  const sense = file.text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
  for (const name of readByCode(sense)) read.add(name);
}

// ------------------------------------------------------------ el que diuen els documents

const documented = new Map();
for (const rel of [...DOCS, ...COMPOSE]) {
  let text;
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    continue;
  }
  for (const line of text.split('\n')) {
    if (NOT_OFFERED.test(line)) continue;
    for (const name of namedInDocs(line)) {
      if (!documented.has(name)) documented.set(name, []);
      if (!documented.get(name).includes(rel)) documented.get(name).push(rel);
    }
  }
}

const violations = [];

for (const [name, files] of [...documented].sort()) {
  if (read.has(name)) continue;
  violations.push({
    rel: files[0],
    line: 0,
    rule: 'variable-inventada',
    message:
      `${name} es documenta a ${files.join(', ')} i **el codi no la llegeix enlloc**. ` +
      'Qui la posi no rebrà cap error i es quedarà creient que fa alguna cosa.',
    excerpt: name,
  });
}

/** Documentada vol dir **a la taula de referència**, no de passada en un exemple. */
const reference = readFileSync(join(ROOT, 'docs', 'DEPLOY.md'), 'utf8');
const inReference = namedInDocs(reference);

for (const name of [...read].sort()) {
  if (TEST_ONLY.test(name) || inReference.has(name)) continue;
  violations.push({
    rel: 'docs/DEPLOY.md',
    line: 0,
    rule: 'variable-sense-documentar',
    message:
      `El codi llegeix ${name} i no surt a la referència de desplegament. ` +
      'Una opció que ningú sap que hi és, és una opció que no existeix.',
    excerpt: name,
  });
}

if (violations.length === 0) {
  console.log(`env-documented · ${String(read.size)} variables, totes documentades`);
  process.exit(0);
}

console.error(`env-documented · ${String(violations.length)} infraccions:`);
for (const v of violations) {
  console.error(`  ${v.rel}  [${v.rule}] ${v.message}`);
}
process.exit(1);
