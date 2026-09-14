#!/usr/bin/env node
/**
 * tokens-parity — el Kotlin de Compose no pot divergir del CSS de Plou.
 *
 * D7: **una direcció i prou.** El CSS és la font de veritat i `Tokens.kt` en surt. Sense
 * aquesta comprovació, afegir un token a Plou —o canviar-ne el valor— deixaria Android
 * pintant el color vell, i ningú se n'assabentaria fins que algú posés les dues
 * pantalles de costat.
 *
 * És la mateixa família de comprovació que `i18n-lint` fa amb `strings.xml`: hi ha un
 * generat, i el generat ha d'estar al dia.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, walk } from './lib/scan.mjs';

const ANDROID = join(ROOT, 'apps', 'android');

/**
 * Un ColorProvider aplicat com a tint d'un drawable de fons no és portable entre
 * llançadors: alguns el componen com a negre en mode clar. Els vectors monocroms sí que
 * es tenyeixen; les superfícies han de resoldre `values/values-night` des del recurs.
 */
const tintedWidgetBackground =
  /\.background\s*\(\s*ImageProvider\([\s\S]{0,200}?\)\s*,\s*colorFilter\s*=/u;

if (process.argv.includes('--self-test')) {
  const bad = `.background(
    ImageProvider(R.drawable.surface),
    colorFilter = ColorFilter.tint(palette.color { cardBg }),
  )`;
  const good = '.background(ImageProvider(R.drawable.surface))';
  if (!tintedWidgetBackground.test(bad) || tintedWidgetBackground.test(good)) {
    console.error('tokens-parity · l’autoprova del fons tenyit ha fallat');
    process.exit(1);
  }
  console.log('tokens-parity --self-test · detecta fons de widget tenyits');
  process.exit(0);
}

if (!existsSync(ANDROID)) {
  console.log('tokens-parity · encara no hi ha apps/android; res a comprovar');
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [join(ROOT, 'tools', 'gen', 'tokens-compose.mjs'), '--check'],
  { encoding: 'utf8' },
);

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.status !== 0) process.exit(result.status ?? 1);

const violations = [];
for (const file of walk(ANDROID, ['.kt'])) {
  if (!file.rel.includes('/widget/')) continue;
  if (tintedWidgetBackground.test(file.text)) violations.push(file.rel);
}
if (violations.length > 0) {
  console.error(
    'tokens-parity · un fons de widget usa ColorFilter amb un ColorProvider; ' +
      'fes servir un drawable amb recursos values/values-night:',
  );
  for (const file of violations) console.error(`  ${file}`);
  process.exit(1);
}
console.log('tokens-parity · cap superfície de widget depèn d’un tint de llançador');
