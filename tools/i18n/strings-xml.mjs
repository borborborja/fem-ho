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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from '../checks/lib/scan.mjs';

const I18N = join(ROOT, 'packages', 'contracts', 'i18n');
const RES = join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'res');

/**
 * L'idioma de reserva va a `values/`, i la resta a `values-xx/`.
 *
 * Android serveix `values/` quan la configuració del dispositiu no encaixa amb cap
 * altra carpeta. Hi va el **català** i no l'anglès perquè és el que fa `t()` a la web:
 * un sol lloc de reserva a les dues apps, i el que és font de veritat de les claus també
 * ho és del text quan no n'hi ha cap altre.
 */
const FALLBACK = 'ca';

/** Els idiomes són els fitxers que hi ha, no una llista escrita a part. */
export function locales() {
  return readdirSync(I18N)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/u, ''))
    .sort();
}

/** On va cada idioma dins de `res/`. */
export function outputFor(locale) {
  const dir = locale === FALLBACK ? 'values' : `values-${locale}`;
  return join(RES, dir, 'strings.xml');
}

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

export function buildStringsXml(catalog, locale = FALLBACK) {
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
    `  GENERAT des de packages/contracts/i18n/${locale}.json. NO s'edita a mà.`,
    '',
    '  docs/03 §1: les cadenes surten del mateix catàleg que la web, i cap literal viu al',
    '  codi. Per canviar un text, es canvia el catàleg i es regenera amb',
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
  const check = process.argv.includes('--check');
  let count = 0;

  for (const locale of locales()) {
    const catalog = JSON.parse(readFileSync(join(I18N, `${locale}.json`), 'utf8'));
    const xml = buildStringsXml(catalog, locale);
    const output = outputFor(locale);

    if (check) {
      if (!existsSync(output)) {
        console.error(
          `strings-xml · falta ${output}. Executa \`node tools/i18n/strings-xml.mjs\`.`,
        );
        process.exit(1);
      }
      if (readFileSync(output, 'utf8') !== xml) {
        console.error(
          `strings-xml · ${output} no coincideix amb el catàleg. Algú ha canviat les ` +
            'cadenes i no ha regenerat: Android es quedaria amb el text vell.\n' +
            'Executa `node tools/i18n/strings-xml.mjs` i compromet el resultat.',
        );
        process.exit(1);
      }
      count = Object.keys(catalog).filter((k) => !k.startsWith('$')).length;
      continue;
    }

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, xml, 'utf8');
    console.log(`strings-xml · escrit ${output}`);
  }

  if (check) {
    console.log(
      `strings-xml · ${count} cadenes × ${locales().length} idiomes, al dia amb el catàleg.`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
