#!/usr/bin/env node
/**
 * i18n-parity — els catàlegs han de dir les mateixes coses en idiomes diferents.
 *
 * Amb un sol idioma no hi havia res a comparar. Amb tres apareixen dos errors que no
 * fallen enlloc i que ningú veu fins que algú obre l'app en l'idioma equivocat:
 *
 * 1. **Una clau que falta.** El text cau al català per la cadena de reserva de `t()`, o
 *    sigui que no es trenca res: simplement, una frase surt en un altre idioma enmig de
 *    la pantalla. És el fracàs més silenciós que hi ha.
 * 2. **Un marcador que no hi és.** `"{count} pendents"` traduït com a `"pendientes"` no
 *    peta: `t()` substitueix el que troba i el número **desapareix**. La frase es llegeix
 *    bé i diu una cosa diferent.
 *
 * `ca.json` és la font de veritat de les claus perquè és on s'escriuen les noves. Un
 * idioma amb una clau que el català no té no és una traducció: és una clau òrfena que no
 * es pintarà mai, i també es marca.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, report } from './lib/scan.mjs';

const DIR = join(ROOT, 'packages', 'contracts', 'i18n');
const SOURCE = 'ca';

/** Els marcadors `{nom}` d'un missatge, com a conjunt ordenat. */
export function placeholders(message) {
  return [...message.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort();
}

/** Les claus de traducció d'un catàleg. Les entrades `$` són comentaris. */
function messages(catalog) {
  return Object.fromEntries(
    Object.entries(catalog).filter(
      ([key, value]) => !key.startsWith('$') && typeof value === 'string',
    ),
  );
}

export function compare(source, catalogs) {
  const problems = [];
  const base = messages(source);

  for (const [locale, catalog] of Object.entries(catalogs)) {
    const other = messages(catalog);
    const rel = `packages/contracts/i18n/${locale}.json`;

    for (const key of Object.keys(base)) {
      if (!(key in other)) {
        problems.push({
          rel,
          line: 0,
          rule: 'clau-que-falta',
          message:
            `Falta "${key}". El text sortirà en català enmig de la pantalla i no fallarà ` +
            'res: és el fracàs més silenciós que hi ha.',
          excerpt: base[key],
        });
        continue;
      }

      const want = placeholders(base[key]);
      const have = placeholders(other[key]);
      if (want.join(',') !== have.join(',')) {
        problems.push({
          rel,
          line: 0,
          rule: 'marcador-que-no-quadra',
          message:
            `"${key}" hauria de portar {${want.join('}, {')}} i porta ` +
            `${have.length === 0 ? 'cap marcador' : `{${have.join('}, {')}}`}. ` +
            'El valor que falti desapareix de la frase sense petar.',
          excerpt: other[key],
        });
      }
    }

    for (const key of Object.keys(other)) {
      if (key in base) continue;
      problems.push({
        rel,
        line: 0,
        rule: 'clau-orfena',
        message:
          `"${key}" no és a ${SOURCE}.json. Cap codi la demanarà mai: les claus noves ` +
          `s'escriuen primer a ${SOURCE}.json.`,
        excerpt: other[key],
      });
    }
  }

  return problems;
}

function load(locale) {
  return JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8'));
}

/** Els idiomes són els fitxers que hi ha, no una llista escrita a part. */
function locales() {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/u, ''))
    .filter((locale) => locale !== SOURCE)
    .sort();
}

if (process.argv.includes('--self-test')) {
  const source = { 'a.b': 'Hi ha {count} coses', 'a.c': 'Res' };
  const found = compare(source, {
    xx: { 'a.b': 'Hay cosas', 'a.d': 'Sobrera' },
  });
  const rules = found.map((problem) => problem.rule).sort();
  const expected = ['clau-orfena', 'clau-que-falta', 'marcador-que-no-quadra'];
  if (rules.join(',') !== expected.join(',')) {
    console.error(`i18n-parity · autoprova fallida: esperava ${expected} i ha trobat ${rules}`);
    process.exit(1);
  }
  if (compare(source, { xx: source }).length !== 0) {
    console.error('i18n-parity · autoprova fallida: un catàleg idèntic no ha de donar cap avís');
    process.exit(1);
  }
  console.log('i18n-parity · autoprova correcta');
  process.exit(0);
}

const others = locales();
const problems = compare(
  load(SOURCE),
  Object.fromEntries(others.map((locale) => [locale, load(locale)])),
);

console.log(`i18n-parity · ${String(others.length + 1)} idiomes (${SOURCE}, ${others.join(', ')})`);
process.exit(report('i18n-parity', problems));
