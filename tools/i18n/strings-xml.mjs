#!/usr/bin/env node
/**
 * Exporta el catàleg català a `strings.xml` d'Android.
 *
 * `docs/03` §1: *"Les cadenes catalanes surten del mateix catàleg, exportat a
 * `strings.xml`. **Cap literal al codi.**"*
 *
 * **Una direcció i prou**: `packages/contracts/i18n/ca.json` és la font de veritat i
 * `strings.xml` en surt. Editar el generat és inútil —es reescriu— i és per això que
 * porta la capçalera que ho diu.
 *
 *   node tools/i18n/strings-xml.mjs           genera
 *   node tools/i18n/strings-xml.mjs --check   comprova que el generat estigui al dia
 *
 * El mode `--check` és el que va a CI: si algú afegeix una cadena al catàleg i no
 * regenera, Android es queda amb el text vell i ningú se n'adona fins que algú mira
 * l'app.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from '../checks/lib/scan.mjs';

const CATALOG = join(ROOT, 'packages', 'contracts', 'i18n', 'ca.json');
const OUTPUT = join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');

/**
 * Una clau del catàleg a un nom de recurs d'Android.
 *
 * `activity.verb.token_created` → `activity_verb_token_created`. Android només accepta
 * lletres minúscules, números i guions baixos, i el nom ha de començar per lletra.
 */
export function resourceName(key) {
  const name = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return /^[a-z]/u.test(name) ? name : `s_${name}`;
}

/**
 * Escapa una cadena per a `strings.xml`.
 *
 * Els apòstrofs i les cometes **s'han d'escapar amb barra invertida**, no amb entitats
 * XML: Android els llegeix com a text i un `&apos;` sortiria literalment a la pantalla.
 * En català això surt a la primera frase que porti un article elidit.
 */
export function escapeAndroid(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n');
}

export function buildStringsXml(catalog) {
  const entries = Object.entries(catalog)
    .filter(([key]) => !key.startsWith('$'))
    .sort(([a], [b]) => a.localeCompare(b));

  // Dues claus diferents que donin el mateix nom de recurs es trepitjarien en silenci.
  const seen = new Map();
  for (const [key] of entries) {
    const name = resourceName(key);
    if (seen.has(name)) {
      throw new Error(
        `Les claus "${seen.get(name)}" i "${key}" donen el mateix recurs "${name}". ` +
          "Canvia'n una: si no, una de les dues desapareix sense avisar.",
      );
    }
    seen.set(name, key);
  }

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!--',
    "  GENERAT des de packages/contracts/i18n/ca.json. NO s'edita a mà.",
    '',
    '  docs/03 §1: les cadenes catalanes surten del mateix catàleg que la web, i cap',
    '  literal viu al codi. Per canviar un text, es canvia el catàleg i es regenera amb',
    '  `node tools/i18n/strings-xml.mjs`.',
    '-->',
    '<resources>',
    ...entries.map(([key, value]) => {
      const name = resourceName(key);
      return `    <string name="${name}">${escapeAndroid(String(value))}</string>`;
    }),
    '</resources>',
    '',
  ];

  return lines.join('\n');
}

function main() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const xml = buildStringsXml(catalog);
  const check = process.argv.includes('--check');

  if (check) {
    if (!existsSync(OUTPUT)) {
      console.error(`strings-xml · falta ${OUTPUT}. Executa \`node tools/i18n/strings-xml.mjs\`.`);
      process.exit(1);
    }
    if (readFileSync(OUTPUT, 'utf8') !== xml) {
      console.error(
        'strings-xml · el strings.xml no coincideix amb el catàleg. Algú ha canviat les ' +
          'cadenes i no ha regenerat: Android es quedaria amb el text vell.\n' +
          'Executa `node tools/i18n/strings-xml.mjs` i compromet el resultat.',
      );
      process.exit(1);
    }
    const count = Object.keys(catalog).filter((k) => !k.startsWith('$')).length;
    console.log(`strings-xml · ${count} cadenes, al dia amb el catàleg.`);
    return;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, xml, 'utf8');
  console.log(`strings-xml · escrit ${OUTPUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
