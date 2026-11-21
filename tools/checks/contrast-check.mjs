#!/usr/bin/env node
/**
 * contrast-check — comprovació permanent de docs/13.
 *
 * docs/04 §8 fixa el llistó: text normal 4.5:1, text gran 3:1, als dos temes i als
 * quatre accents. Les aparences accessibles també comproven el focus, les vores i
 * la llegibilitat dels colors d’àmbit. Es mesuren els valors efectius de la cascada.
 */

import { fileURLToPath } from 'node:url';
import {
  ACCENTS,
  APPEARANCES,
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
const ACCESSIBLE_TEXT = 7;
const NON_TEXT_CONTRAST = 3;

if (process.argv.includes('--self-test')) {
  const fixture = [
    {
      selector: ':root',
      declarations: { '--text': '#eee' },
    },
    {
      selector: "[data-appearance='eink'][data-theme='dark']",
      declarations: { '--text': 'var(--ink)', '--ink': '#141414' },
    },
    {
      selector: "[data-theme='dark']",
      declarations: { '--text': '#dfdfdf' },
    },
  ];
  if (
    resolveTokens(fixture, 'dark', 'default', 'eink')['--text'] !== '#141414' ||
    resolveTokens(fixture, 'dark', 'default')['--text'] !== '#dfdfdf' ||
    resolveTokens(fixture, 'light', 'default')['--text'] !== '#eee'
  ) {
    console.error('contrast-check · la cascada confon les aparences o els temes.');
    process.exit(1);
  }
  console.log(
    'contrast-check --self-test · resoldre una aparença respecta l’especificitat i els àlies.',
  );
  process.exit(0);
}

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
    fg: '--on-brand',
    stack: ['--plou-blue'],
    min: AA_NORMAL,
    what: 'text del botó de tasques amb IA a Android',
  },
  {
    fg: '--column-bg',
    stack: ['--panel-bg'],
    min: 0,
    what: 'fons de columna (només ha de ser visible, no llegible)',
    visibleOnly: true,
  },
];

const SCOPE_COLORS = [
  '--plou-blue',
  '--plou-orange',
  '--plou-pink',
  ...Array.from({ length: 8 }, (_, index) => `--femho-scope-${index + 1}`),
];
const SPECIAL_PAIRS = [
  { fg: '--ink-faint', stack: ['--card-bg'], min: ACCESSIBLE_TEXT, what: 'text terciari' },
  { fg: '--ink', stack: ['--input-bg'], min: ACCESSIBLE_TEXT, what: 'text de camp' },
  { fg: '--nav-idle', stack: ['--panel-bg'], min: ACCESSIBLE_TEXT, what: 'navegació inactiva' },
  { fg: '--seg-text', stack: ['--seg-bg'], min: ACCESSIBLE_TEXT, what: 'opció inactiva' },
  { fg: '--kicker', stack: ['--panel-bg'], min: ACCESSIBLE_TEXT, what: 'accent sobre panell' },
  ...SCOPE_COLORS.flatMap((scope) => [
    { fg: '--on-brand', stack: [scope], min: ACCESSIBLE_TEXT, what: `etiqueta sobre ${scope}` },
    { fg: scope, stack: ['--card-bg'], min: NON_TEXT_CONTRAST, what: 'identificador d’àmbit' },
  ]),
  ...['--focus-ring', '--essential-border'].flatMap((fg) =>
    ['--page-bg', '--dialog-bg', '--card-bg', '--input-bg'].map((surface) => ({
      fg,
      stack: [surface],
      min: NON_TEXT_CONTRAST,
      what: `control sobre ${surface}`,
    })),
  ),
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

const blocks = loadTokenBlocks(
  TOKENS_DIR,
  new URL('../../packages/design-system/femho/tokens.css', import.meta.url),
);
const failures = [];
const skipped = [];
let checked = 0;

const combinations = APPEARANCES.flatMap((appearance) =>
  THEMES.flatMap((theme) => ACCENTS.map((accent) => ({ appearance, theme, accent }))),
);
for (const { appearance, theme, accent } of combinations) {
  const tokens = resolveTokens(blocks, theme, accent, appearance);
  const label = `${appearance} · ${theme} · ${accent}`;
  const special = appearance !== 'standard';

  for (const pair of special ? [...PAIRS, ...SPECIAL_PAIRS] : PAIRS) {
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

    const min = special && pair.min === AA_NORMAL ? ACCESSIBLE_TEXT : pair.min;
    if (ratio < min) {
      failures.push(
        `${label} · ${pair.what} (${pair.fg}): ` + `${ratio.toFixed(2)}:1, cal ${min}:1`,
      );
    }
  }

  // Gradient: cada parada per separat. La mitjana no serveix — el text ha de ser
  // llegible al punt pitjor, no de mitjana.
  const fill = tokens[GRADIENT_PAIR.gradient];
  const stops = gradientStops(fill);
  const solid = parseColor(fill);
  if (solid !== null) stops.push(solid);
  const onBrand = parseColor(tokens[GRADIENT_PAIR.fg]);
  if (stops.length === 0 || onBrand === null) {
    skipped.push(`${label} · ${GRADIENT_PAIR.gradient}: no s'han pogut llegir les parades`);
  } else {
    for (const [i, stop] of stops.entries()) {
      const ratio = contrastRatio(onBrand, stop);
      checked += 1;
      const min = special ? ACCESSIBLE_TEXT : GRADIENT_PAIR.min;
      if (ratio < min) {
        failures.push(
          `${label} · ${GRADIENT_PAIR.what}, parada ${i + 1}: ` +
            `${ratio.toFixed(2)}:1, cal ${min}:1`,
        );
      }
    }
  }
  if (appearance !== 'eink') continue;
  for (const [name, value] of Object.entries(tokens)) {
    const color = parseColor(value);
    const colors = color === null ? gradientStops(value) : [color];
    if (colors.some(({ r, g, b }) => r !== g || g !== b))
      failures.push(`${label} · ${name} ha de ser acromàtic.`);
  }
  for (const key of [
    '--page-bg',
    '--app-bg',
    '--outer-bg',
    '--gradient-brand',
    '--gradient-brand-2stop',
  ]) {
    if (parseColor(tokens[key])?.a !== 1) failures.push(`${label} · ${key} ha de ser opac i pla.`);
  }
}

console.log(
  `contrast-check · ${checked} parells comprovats en ${combinations.length} combinacions`,
);
for (const s of skipped) console.warn(`  omès: ${s}`);

for (const failure of failures) console.error(`  ${failure}`);
if (failures.length > 0 || skipped.length > 0) process.exit(1);
console.log('  cap parell per sota del llindar.');
