#!/usr/bin/env node
/**
 * android-strings-exist — la clau que es va endur l'APK, tres vegades.
 *
 * `i18n-keys-exist` fa això mateix per a la web, i el mateix forat existeix a Android
 * amb una diferència que el fa pitjor: allà una clau que falta **no s'ensenya crua, no
 * compila**. `R.string.una_que_no_hi_és` és un `Unresolved reference` i l'aplicació no
 * arriba a existir.
 *
 * I res del que corre en aquest repositori ho veia:
 *
 *   - `npm run check` no toca Kotlin.
 *   - `npm run test:android` només passa les proves unitàries dels mòduls, que no
 *     compilen `:app` ni resolen `R`.
 *   - Muntar l'APK necessita l'SDK d'Android i **un minut**, o sigui que no es fa a cada
 *     canvi i el trencament es descobreix dies després.
 *
 * Ha passat tres vegades i sempre igual: es reanomena o s'esborra una clau del catàleg
 * —que és la font de `strings.xml` (docs/03 §1)— i el Kotlin que la feia servir es queda
 * enrere. `inbox_event_remove` en va ser la segona; `board_quickadd_placeholder`, la
 * tercera.
 *
 * Aquí es llegeixen totes les referències `R.string.X` del Kotlin i es comprova que
 * existeixin al `strings.xml` generat. Costa mil·lisegons i no vol l'SDK.
 *
 * **El que NO fa**: cap altre recurs. `R.drawable`, `R.id` i companyia no surten d'un
 * catàleg compartit i no tenen aquest problema; incloure'ls seria fer una comprovació
 * més gran per protegir una cosa que no ha fallat mai.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, report } from './lib/scan.mjs';

const KOTLIN = join(ROOT, 'apps', 'android');
const STRINGS = join(KOTLIN, 'app', 'src', 'main', 'res', 'values', 'strings.xml');

/** Els noms declarats a un `strings.xml`. */
export function declared(xml) {
  return new Set([...xml.matchAll(/<string\s+name="([^"]+)"/gu)].map((match) => match[1]));
}

/**
 * Les referències `R.string.X` d'un font de Kotlin.
 *
 * Les línies de comentari se salten pel mateix motiu que a `i18n-keys-exist`: els blocs
 * de documentació d'aquest projecte citen claus, i marcar-les obligaria a no explicar-se.
 */
export function references(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/u.test(line)) return;
    for (const match of line.matchAll(/\bR\.string\.([A-Za-z0-9_]+)/gu)) {
      found.push({ name: match[1], line: index + 1, text: line.trim() });
    }
  });
  return found;
}

export function missing(sources, names) {
  const problems = [];
  for (const file of sources) {
    for (const use of references(file.text)) {
      if (names.has(use.name)) continue;
      problems.push({
        rel: file.rel,
        line: use.line,
        rule: 'cadena-android-inexistent',
        message:
          `"R.string.${use.name}" no és a strings.xml. Android **no compilarà**: és un ` +
          'error de resolució, no un text que falti. Si la clau del catàleg ha canviat ' +
          'de nom, canvia-la també aquí; strings.xml es regenera amb ' +
          "`node tools/i18n/strings-xml.mjs` i no s'edita.",
        excerpt: use.text,
      });
    }
  }
  return problems;
}

/** Els `.kt` de sota `apps/android`, saltant-se el que genera Gradle. */
function* kotlinFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'build' || entry === '.gradle') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* kotlinFiles(full);
    else if (entry.endsWith('.kt'))
      yield {
        rel: full.slice(ROOT.length).replace(/^[/\\]+/u, ''),
        text: readFileSync(full, 'utf8'),
      };
  }
}

if (process.argv.includes('--self-test')) {
  const noms = declared('<string name="board_column_inbox">Inbox</string>');
  const found = missing(
    [
      { rel: 'A.kt', text: 'val a = stringResource(R.string.board_column_inbox)' },
      { rel: 'B.kt', text: 'val b = stringResource(R.string.board_quickadd_placeholder)' },
      { rel: 'C.kt', text: ' * Fa servir R.string.una_que_no_hi_es, deia el comentari.' },
    ],
    noms,
  );
  if (found.length !== 1 || found[0].rel !== 'B.kt') {
    console.error(
      'android-strings-exist · autoprova fallida: ha de marcar NOMÉS la referència morta ' +
        `i no la citada dins d'un comentari. Ha marcat: ${JSON.stringify(found.map((p) => p.rel))}`,
    );
    process.exit(1);
  }
  console.log('android-strings-exist · autoprova correcta');
  process.exit(0);
}

const names = declared(readFileSync(STRINGS, 'utf8'));
const sources = [...kotlinFiles(KOTLIN)];
const problems = missing(sources, names);

console.log(
  `android-strings-exist · ${String(names.size)} cadenes declarades, ` +
    `${String(sources.length)} fitxers de Kotlin mirats`,
);
process.exit(report('android-strings-exist', problems));
