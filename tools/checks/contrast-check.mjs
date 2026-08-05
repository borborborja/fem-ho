#!/usr/bin/env node
/**
 * contrast-check — comprovació permanent de docs/13.
 *
 * "Contrast insuficient als 8 temes (2 modes × 4 accents)."
 *
 * docs/04 §8 fixa el llistó: text normal 4.5:1, text gran 3:1, als dos temes i als
 * quatre accents. L'accent `soft` és el que menys marge té, i és per això que hi
 * --on-brand passa a fosc: és exactament el parell que aquesta comprovació vigila.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACCENTS,
  THEMES,
  composite,
  contrastRatio,
  gradientStops,
  loadTokenBlocks,
  parseColor,
  resolveTokens,
} from './lib/tokens.mjs';

const TOKENS_DIR = fileURLToPath(
  new URL('../../packages/design-system/plou/tokens', import.meta.url),
);

// docs/04 §8: text normal 4,5:1 i text gran 3:1. Ara mateix cap parell de la llista és
// text gran —els botons de Plou van a 12-13,5px— o sigui que només cal aquest llindar.
const AA_NORMAL = 4.5;

/**
 * Els parells que es comproven.
 *
 * `stack` és la pila de superfícies, de sota a dalt. No es pot resumir en un sol fons:
 * en tema fosc `--card-bg` és rgba(255,255,255,0.06) i `--tag-bg` rgba(255,255,255,0.08),
 * o sigui que una pastilla dins d'una targeta són DUES capes translúcides sobre el
 * panell. Comparar el text contra `--tag-bg` sense compondre tota la pila dona 1.00:1 i
 * és mentida.
 *
 * `--ink-faint` no hi és a propòsit: Plou el fa servir per a text decoratiu i
 * marcadors de posició, que WCAG no exigeix que passin. Fem-ho no l'ha de fer servir
 * per a cap informació que calgui llegir — i això ho vigila la revisió, no un script.
 */
const PAIRS = [
  {
    fg: '--ink',
    stack: ['--panel-bg', '--card-bg'],
    min: AA_NORMAL,
    what: 'text principal sobre targeta',
  },
  {
    fg: '--ink-soft',
    stack: ['--panel-bg', '--card-bg'],
    min: AA_NORMAL,
    what: 'text secundari sobre targeta',
  },
  { fg: '--ink', stack: ['--panel-bg'], min: AA_NORMAL, what: 'text principal sobre panell' },
  {
    fg: '--tag-text',
    stack: ['--panel-bg', '--card-bg', '--tag-bg'],
    min: AA_NORMAL,
    what: "text de pastilla dins d'una targeta",
  },
  {
    fg: '--danger-text',
    stack: ['--panel-bg', '--card-bg', '--danger-bg'],
    min: AA_NORMAL,
    what: 'text destructiu',
  },
  {
    fg: '--ghost-text',
    stack: ['--panel-bg', '--card-bg', '--ghost-bg'],
    min: AA_NORMAL,
    what: 'text de botó fantasma',
  },
  {
    fg: '--column-bg',
    stack: ['--panel-bg'],
    min: 0,
    what: 'fons de columna (només ha de ser visible, no llegible)',
    visibleOnly: true,
  },
];

/**
 * El text sobre el gradient de marca: es comprova contra CADA parada, no contra la
 * mitjana. El text ha de ser llegible al punt pitjor.
 *
 * El llindar és AA_NORMAL i no AA_LARGE. Els botons de Plou van a --text-label (12px),
 * --text-body-xs (13px) i --text-body-sm (13,5px), sempre amb --weight-bold (700).
 * WCAG considera "text gran" a partir de 18,66px en negreta, o sigui que cap mida de
 * botó de Plou hi arriba: s'aplica 4,5:1.
 */
const GRADIENT_PAIR = {
  fg: '--on-brand',
  gradient: '--gradient-brand',
  min: AA_NORMAL,
  what: 'text sobre el gradient de marca',
};

/**
 * Composa una pila de superfícies de sota a dalt i retorna el color opac resultant.
 * La primera de la pila ha de ser opaca; si no ho és, no hi ha res a sota i la pila
 * està mal definida.
 */
function flattenStack(tokens, stack) {
  let acc = null;
  for (const name of stack) {
    const layer = parseColor(tokens[name]);
    if (layer === null) return { color: null, missing: name };
    if (acc === null) {
      if (layer.a < 1) return { color: null, missing: `${name} (la base ha de ser opaca)` };
      acc = layer;
    } else {
      acc = composite(layer, acc);
    }
  }
  return { color: acc, missing: null };
}

const blocks = loadTokenBlocks(TOKENS_DIR);
const failures = [];
const skipped = [];
let checked = 0;

for (const theme of THEMES) {
  for (const accent of ACCENTS) {
    const tokens = resolveTokens(blocks, theme, accent);
    const label = `${theme} · ${accent}`;

    for (const pair of PAIRS) {
      const { color: bg, missing } = flattenStack(tokens, pair.stack);
      const fgRaw = parseColor(tokens[pair.fg]);
      if (bg === null || fgRaw === null) {
        skipped.push(
          `${label} · ${pair.what}: no es pot resoldre ${missing ?? pair.fg} a color opac`,
        );
        continue;
      }
      const fg = fgRaw.a >= 1 ? fgRaw : composite(fgRaw, bg);
      const ratio = contrastRatio(fg, bg);
      checked += 1;

      if (pair.visibleOnly === true) {
        // Un fons de columna no ha de ser llegible; ha de distingir-se del que té a
        // sota. Si la raó és 1.00 és que és literalment invisible, que és el bug del
        // prototip que --column-bg existeix per arreglar.
        if (ratio < 1.005) {
          failures.push(`${label} · ${pair.what}: invisible (raó ${ratio.toFixed(3)})`);
        }
        continue;
      }

      if (ratio < pair.min) {
        failures.push(
          `${label} · ${pair.what} (${pair.fg}): ` + `${ratio.toFixed(2)}:1, cal ${pair.min}:1`,
        );
      }
    }

    // Gradient: cada parada per separat. La mitjana no serveix — el text ha de ser
    // llegible al punt pitjor, no de mitjana.
    const stops = gradientStops(tokens[GRADIENT_PAIR.gradient]);
    const onBrand = parseColor(tokens[GRADIENT_PAIR.fg]);
    if (stops.length === 0 || onBrand === null) {
      skipped.push(`${label} · ${GRADIENT_PAIR.gradient}: no s'han pogut llegir les parades`);
    } else {
      for (const [i, stop] of stops.entries()) {
        const ratio = contrastRatio(onBrand, stop);
        checked += 1;
        if (ratio < GRADIENT_PAIR.min) {
          failures.push(
            `${label} · ${GRADIENT_PAIR.what}, parada ${i + 1}: ` +
              `${ratio.toFixed(2)}:1, cal ${GRADIENT_PAIR.min}:1`,
          );
        }
      }
    }
  }
}

console.log(
  `contrast-check · ${checked} parells comprovats en ${THEMES.length * ACCENTS.length} temes`,
);
for (const s of skipped) console.warn(`  omès: ${s}`);

/**
 * Línia base de deute conegut.
 *
 * Plou tal com ve NO compleix el llistó que docs/04 §8 exigeix, i docs/04 §1 diu que
 * Plou no es reescriu. Les dues regles xoquen de veritat, i qui ho ha de resoldre és
 * qui és propietari de la marca, no aquest script.
 *
 * Mentre no es resolgui, la comprovació fa dues coses útils:
 *   - Falla amb qualsevol violació NOVA. El deute no creix.
 *   - Falla també si una violació de la línia base ja no hi és, per obligar a treure-la
 *     de la llista. Una línia base que no minva deixa de significar res.
 */
const baseline = new Set(
  JSON.parse(readFileSync(new URL('./contrast-baseline.json', import.meta.url), 'utf8')).known,
);

const nova = failures.filter((f) => !baseline.has(f));
const resolta = [...baseline].filter((b) => !failures.includes(b));

if (failures.length > 0) {
  console.warn(`\n  ${failures.length} parells per sota del llindar (deute conegut de Plou):`);
  for (const f of failures) console.warn(`    ${f}`);
}

if (nova.length > 0) {
  console.error(`\n${nova.length} violacions NOVES, no són a la línia base:`);
  for (const f of nova) console.error(`  ${f}`);
}
if (resolta.length > 0) {
  console.error(`\n${resolta.length} entrades de la línia base ja no fallen. Treu-les del fitxer:`);
  for (const f of resolta) console.error(`  ${f}`);
}

if (nova.length > 0 || resolta.length > 0) process.exit(1);

console.log(
  failures.length === 0
    ? '  cap parell per sota del llindar.'
    : '  cap violació nova. El deute conegut no ha crescut.',
);
