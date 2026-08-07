#!/usr/bin/env node
/**
 * Exporta els tokens de Plou a Compose.
 *
 * D7: **una direcció i prou.** El CSS de Plou és la font de veritat i el Kotlin en surt.
 * Editar el generat és inútil —es reescriu— i per això porta la capçalera que ho diu.
 *
 *   node tools/gen/tokens-compose.mjs           genera
 *   node tools/gen/tokens-compose.mjs --check   comprova que el generat estigui al dia
 *
 * Es llegeixen `theme.css` (els dos temes) i `accents.css` (els quatre accents), més
 * `tokens.css` de Fem-ho, que és on viuen `--column-bg`, `--scrim` i els vuit colors
 * d'àmbit. **Els gradients no s'exporten com a color**: a Compose un gradient és un
 * `Brush` i no un `Color`, i convertir-lo en una parada sola donaria un pla on hi ha
 * d'haver un degradat. S'exporten les seves parades i el codi de Compose les munta.
 *
 * Escrit a mà i no amb Style Dictionary per la mateixa raó que el runtime d'i18n és
 * propi: el que fa falta és llegir unes variables CSS i escriure un fitxer de Kotlin, i
 * una eina de transformació de tokens porta un model de plataformes, transformacions i
 * formats que aquí no s'usaria.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from '../checks/lib/scan.mjs';

const PLOU = join(ROOT, 'packages', 'design-system', 'plou', 'tokens');
const FEMHO = join(ROOT, 'packages', 'design-system', 'femho', 'tokens.css');
const OUTPUT = join(
  ROOT,
  'apps',
  'android',
  'core-designsystem',
  'src',
  'main',
  'kotlin',
  'ho',
  'fem',
  'designsystem',
  'Tokens.kt',
);

/**
 * La segona sortida: colors com a **recursos d'Android**.
 *
 * Els widgets de la pantalla d'inici no poden arrodonir una cantonada per sota d'API 31
 * (`GlanceModifier.cornerRadius` és `@RequiresApi(31)`), i la manera de fer-ho és un
 * `<shape>` drawable. Un drawable no llegeix un `ColorProvider` de Kotlin: vol un
 * `@color/...`. Sense aquest fitxer, cada forma portaria un `#14161e` escrit a mà que
 * es quedaria enrere el dia que Plou canviés — i **`no-hardcoded-colors` no escaneja
 * `.xml`**, o sigui que no ho diria ningú.
 */
const RES = join(ROOT, 'apps', 'android', 'core-widget', 'src', 'main', 'res');

/**
 * Els tokens que necessiten forma, i per tant recurs.
 *
 * Són **tots neutres a posta**: els accents només sobreescriuen colors de marca
 * (`plou*`, `dot*`, `kicker`, `onBrand`, `ringRadar`), o sigui que aquests valen igual
 * per als quatre i un sol parell clar/fosc els cobreix. El que sí que canvia amb
 * l'accent es pinta amb un vector tenyit en temps d'execució, que no té aquest límit.
 *
 * Si algun dia un accent en toqués un, el generat seria correcte només per al primer
 * accent i ningú ho veuria: per això `assertNeutral` peta en comptes de continuar.
 */
const SHAPE_TOKENS = [
  /**
   * La superfície del widget és `--dialog-bg`, **no `--card-bg`**.
   *
   * A l'app una targeta és translúcida (a fosc, blanc al 6%) perquè seu damunt d'un
   * panell que li dona el fons. Un widget no té panell a sota: té el fons de pantalla de
   * qui sigui, que pot ser una foto clara. Amb `--card-bg` el text quedaria damunt del
   * que hi hagués, i el contrast que `contrast-check` garanteix deixaria de valer.
   *
   * `--dialog-bg` és justament el token pensat per seure damunt d'una cosa que no
   * controlem, i és opac als dos temes.
   */
  '--dialog-bg',
  '--panel-bg',
  '--card-bg',
  '--card-border',
  '--column-bg',
  '--input-bg',
  '--input-border',
  '--danger-bg',
  '--divider',
];

/** `--card-bg` → `cardBg`. */
export function kotlinName(cssName) {
  return cssName
    .replace(/^--/u, '')
    .split('-')
    .filter((part) => part !== '')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/**
 * Un color CSS a `0xAARRGGBB`.
 *
 * S'accepten `#rgb`, `#rrggbb`, `#rrggbbaa` i `rgba()`. Qualsevol altra cosa —un
 * gradient, una funció `color-mix`, una referència a una altra variable— torna `null` i
 * **no s'exporta**: val més que un token falti a Compose i es vegi, que no pas que hi
 * sigui amb un valor inventat.
 */
export function toArgb(value) {
  const raw = value.trim();

  const hex = /^#([0-9a-f]{3,8})$/iu.exec(raw);
  if (hex !== null) {
    let digits = hex[1];
    if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
    if (digits.length === 6) return `0xFF${digits.toUpperCase()}`;
    if (digits.length === 8) {
      // CSS és `#rrggbbaa`; Compose vol `0xAARRGGBB`.
      const rgb = digits.slice(0, 6);
      const alpha = digits.slice(6, 8);
      return `0x${alpha.toUpperCase()}${rgb.toUpperCase()}`;
    }
    return null;
  }

  const rgba = /^rgba?\(([^)]+)\)$/iu.exec(raw);
  if (rgba !== null) {
    const parts = rgba[1].split(/[,\s/]+/u).filter((part) => part !== '');
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((part) => Number(part));
    if (channels.some((channel) => !Number.isFinite(channel))) return null;
    const alpha = parts.length > 3 ? Number(parts[3]) : 1;
    if (!Number.isFinite(alpha)) return null;

    const byte = (n) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, '0');
    return `0x${byte(alpha * 255).toUpperCase()}${channels.map(byte).join('').toUpperCase()}`;
  }

  return null;
}

/**
 * Els parells `--nom: valor` d'un bloc de selector concret.
 *
 * **Les cometes del selector no compten.** `plou/tokens/theme.css` escriu
 * `[data-theme="dark"]` amb dobles i `femho/tokens.css` amb simples, i buscar-ne una
 * mena literal feia que el bloc fosc de Plou no es trobés mai: `darkColors` sortia com
 * una còpia de `lightColors` i **el tema fosc d'Android pintava les superfícies clares**.
 * Res fallava —el fitxer es generava, `tokens-parity` el comparava contra ell mateix— i
 * l'única manera de veure-ho era mirar el fosc al costat del clar.
 *
 * És la mateixa família de defecte que ja s'havia corregit per als accents; aquí havia
 * quedat.
 */
function readBlock(css, selector) {
  // El selector es busca amb qualsevol de les dues cometes.
  const pattern = new RegExp(
    selector
      .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      .replace(/\\\[|['"]/gu, (match) => (match === '\\[' ? '\\[' : `["']`)),
    'u',
  );
  const found = pattern.exec(css);
  const start = found === null ? -1 : found.index;
  if (start === -1) return {};
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return {};

  const values = {};
  for (const line of css.slice(open + 1, close).split('\n')) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/iu.exec(line);
    if (match !== null) values[match[1]] = match[2].trim();
  }
  return values;
}

/**
 * Les parades d'un gradient CSS.
 *
 * A Compose un gradient és un `Brush` amb una llista de colors, no un `Color`: exportar
 * `--page-bg` com a color donaria un pla on hi ha d'haver un degradat, i exportar-lo com
 * a text seria fer que Kotlin analitzés CSS en temps d'execució. S'exporten les parades
 * i el codi de Compose munta el `Brush`.
 *
 * L'angle i el tipus (`linear` o `radial`) **no** s'exporten: Compose els expressa amb
 * altres primitives i traduir-los automàticament donaria angles que semblen correctes i
 * no ho són. Cada gradient es munta a mà una vegada a `Theme.kt`.
 */
export function gradientStops(value) {
  const match = /^(linear|radial)-gradient\(([\s\S]+)\)$/iu.exec(value.trim());
  if (match === null) return null;

  // Les parades se separen per comes de primer nivell: dins d'`rgba(...)` també n'hi ha.
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of match[2]) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  const stops = parts
    .map((part) => part.trim())
    // La primera part pot ser la direcció (`135deg`, `circle at 20% 10%`): no és color.
    .map((part) => /(#[0-9a-f]{3,8}|rgba?\([^)]*\))/iu.exec(part)?.[1])
    .filter((color) => color !== undefined)
    .map(toArgb)
    .filter((argb) => argb !== null);

  return stops.length >= 2 ? stops : null;
}

function gradientsOf(values) {
  const out = {};
  for (const [name, value] of Object.entries(values)) {
    const stops = gradientStops(value);
    if (stops !== null) out[name] = stops;
  }
  return out;
}

function colorsOf(values) {
  const out = {};
  for (const [name, value] of Object.entries(values)) {
    const argb = toArgb(value);
    if (argb !== null) out[name] = argb;
  }
  return out;
}

/**
 * Com `readBlock`, però un bloc buit és un error.
 *
 * El defecte de les cometes va viure perquè un selector que no es troba tornava `{}` en
 * silenci i la reserva `?? light[name]` el tapava amb un valor plausible. Un bloc que no
 * hi és o que no té cap color **no és un bloc buit: és un fitxer que ha canviat de forma**
 * i que s'ha de mirar.
 */
function readBlockRequired(css, selector, label) {
  const block = readBlock(css, selector);
  if (Object.keys(block).length === 0) {
    console.error(
      `tokens-compose · el bloc ${selector} de ${label} no s'ha trobat o és buit.\n` +
        "  Sense això el tema sortiria com una còpia de l'altre i no fallaria res.",
    );
    process.exit(1);
  }
  return block;
}

export function buildTokens() {
  const theme = readFileSync(join(PLOU, 'theme.css'), 'utf8');
  const accents = readFileSync(join(PLOU, 'accents.css'), 'utf8');
  const colors = readFileSync(join(PLOU, 'colors.css'), 'utf8');
  const femho = readFileSync(FEMHO, 'utf8');

  /**
   * `colors.css` hi entra primer.
   *
   * És on viuen la paleta i `--on-brand`, que és el color del text damunt del gradient
   * de marca. Sense ell, els accents que el canvien —`soft` el passa a tinta perquè un
   * pastel no aguanta text blanc— no tindrien res a sobreescriure i la seva
   * sobreescriptura desapareixeria en silenci.
   */
  const light = colorsOf({
    ...readBlock(colors, ':root'),
    ...readBlock(theme, ':root'),
    ...readBlock(theme, "[data-theme='light']"),
    ...readBlock(femho, ':root'),
  });
  // Els dos blocs foscos són OBLIGATORIS. Que un no es trobés és exactament el que va
  // fer que el tema fosc d'Android fos una còpia del clar durant tot el projecte.
  const dark = colorsOf({
    ...readBlockRequired(theme, "[data-theme='dark']", 'plou/theme.css'),
    ...readBlockRequired(femho, "[data-theme='dark']", 'femho/tokens.css'),
  });

  /**
   * Els accents.
   *
   * Els fitxers de Plou fan servir cometes DOBLES als selectors (`[data-accent="soft"]`)
   * i els de Fem-ho, simples. Buscar-ne només una mena donava zero accents i un fitxer
   * generat que semblava correcte: quatre accents col·lapsats en un. `readBlock` ja no
   * en distingeix, però el nom del bloc es continua escrivint amb simples per costum.
   *
   * **`default` no porta atribut**: és la tríada original i no té bloc propi. Es
   * representa com un accent sense cap sobreescriptura, que és exactament el que és.
   */
  const accentNames = [...accents.matchAll(/\[data-accent=["']([a-z-]+)["']\]/gu)].map((m) => m[1]);
  const accentBlocks = { default: {} };
  for (const name of [...new Set(accentNames)]) {
    accentBlocks[name] = colorsOf(readBlock(accents, `[data-accent="${name}"]`));
  }

  const lightRaw = {
    ...readBlock(colors, ':root'),
    ...readBlock(theme, ':root'),
    ...readBlock(theme, "[data-theme='light']"),
  };
  const darkRaw = readBlock(theme, "[data-theme='dark']");

  return {
    light,
    dark,
    accents: accentBlocks,
    gradients: { light: gradientsOf(lightRaw), dark: gradientsOf(darkRaw) },
  };
}

function render({ light, dark, accents, gradients }) {
  // Un token només entra a l'esquema si el tema clar el té: així l'esquema és tancat i
  // el dia que Plou n'afegeixi un, el fitxer canvia i el `--check` ho diu.
  const names = Object.keys(light).sort();

  const field = (name) => `    val ${kotlinName(name)}: Color,`;
  const value = (name, block, fallback) =>
    `        ${kotlinName(name)} = Color(${block[name] ?? fallback[name]}),`;

  // `default` hi entra encara que no sobreescrigui res: sense ell, l'enum no tindria
  // l'accent per defecte i no es podria representar l'estat inicial.
  const accentEntries = Object.entries(accents).sort(([a], [b]) => a.localeCompare(b));

  return `/*
 * GENERAT · no l'editis a mà.
 *
 * Surt de \`packages/design-system/plou/tokens\` i de \`femho/tokens.css\` amb
 * \`node tools/gen/tokens-compose.mjs\`. D7: **una direcció i prou.** El CSS és la font
 * de veritat; qualsevol canvi fet aquí desapareix a la propera generació.
 *
 * Els gradients no hi són: a Compose són \`Brush\` i no \`Color\` (veure \`Brand.kt\`).
 */
@file:Suppress("MagicNumber", "LongMethod")

package ho.fem.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

@Immutable
data class FemhoColors(
${names.map(field).join('\n')}
)

/** Els accents de Plou. Canvien els colors de marca, no la resta de l'esquema. */
enum class FemhoAccent { ${accentEntries.map(([name]) => kotlinName(name).toUpperCase()).join(', ')} }

internal val lightColors = FemhoColors(
${names.map((name) => value(name, light, light)).join('\n')}
)

internal val darkColors = FemhoColors(
${names.map((name) => value(name, dark, light)).join('\n')}
)

@Immutable
data class FemhoGradientStops(
${Object.keys(gradients.light)
  .sort()
  .map((name) => `    val ${kotlinName(name)}: List<Color>,`)
  .join('\n')}
)

internal val lightGradients = FemhoGradientStops(
${Object.keys(gradients.light)
  .sort()
  .map(
    (name) =>
      `        ${kotlinName(name)} = listOf(${gradients.light[name].map((s) => `Color(${s})`).join(', ')}),`,
  )
  .join('\n')}
)

internal val darkGradients = FemhoGradientStops(
${Object.keys(gradients.light)
  .sort()
  .map((name) => {
    const stops = gradients.dark[name] ?? gradients.light[name];
    return `        ${kotlinName(name)} = listOf(${stops.map((s) => `Color(${s})`).join(', ')}),`;
  })
  .join('\n')}
)

/** Els colors que cada accent sobreescriu, aplicats damunt de l'esquema del tema. */
internal fun applyAccent(base: FemhoColors, accent: FemhoAccent): FemhoColors = when (accent) {
${accentEntries
  .map(([name, block]) => {
    const overrides = Object.keys(block)
      .filter((key) => names.includes(key))
      .sort();
    if (overrides.length === 0) return `    FemhoAccent.${kotlinName(name).toUpperCase()} -> base`;
    return `    FemhoAccent.${kotlinName(name).toUpperCase()} -> base.copy(
${overrides.map((key) => `        ${kotlinName(key)} = Color(${block[key]}),`).join('\n')}
    )`;
  })
  .join('\n')}
}
`;
}

/** `--card-bg` → `femho_card_bg`. El prefix evita xocar amb res del sistema. */
export function resName(cssName) {
  return `femho_${cssName.replace(/^--/u, '').replace(/-/gu, '_')}`;
}

/** `0xAARRGGBB` → `#AARRGGBB`. */
function toResColor(argb) {
  return `#${argb.replace(/^0x/iu, '').toUpperCase()}`;
}

/**
 * Cap token amb forma pot dependre de l'accent.
 *
 * Si en depengués, el `values/` generat només seria correcte per a un accent dels
 * quatre i les cantonades es veurien d'un altre color que la resta del widget. És
 * exactament el tipus de defecte que no fa fallar res i que ningú mira.
 */
function assertNeutral(accents) {
  const guilty = [];
  for (const [name, block] of Object.entries(accents)) {
    for (const token of SHAPE_TOKENS) {
      if (token in block) guilty.push(`${token} (accent ${name})`);
    }
  }
  if (guilty.length > 0) {
    console.error(
      "tokens-compose · un token amb forma depèn de l'accent i el recurs XML no ho pot expressar:\n" +
        guilty.map((entry) => `  ${entry}`).join('\n') +
        "\n  Treu-lo de SHAPE_TOKENS i pinta'l amb un vector tenyit.",
    );
    process.exit(1);
  }
}

function renderRes({ light, dark }, variant) {
  const block = variant === 'night' ? dark : light;
  const rows = SHAPE_TOKENS.map((token) => {
    const argb = block[token] ?? light[token];
    if (argb === undefined) {
      console.error(`tokens-compose · falta el token ${token} al CSS de Plou.`);
      process.exit(1);
    }
    return `    <color name="${resName(token)}">${toResColor(argb)}</color>`;
  });

  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  GENERAT · no l'editis a mà.

  Surt dels mateixos tokens que \`Tokens.kt\`, amb \`node tools/gen/tokens-compose.mjs\`.
  Existeix perquè els \`<shape>\` dels widgets necessiten un \`@color/...\` i no poden
  llegir un \`ColorProvider\` de Kotlin.
-->
<resources>
${rows.join('\n')}
</resources>
`;
}

const source = buildTokens();
const generated = render(source);
assertNeutral(source.accents);

const outputs = [
  [OUTPUT, generated],
  [join(RES, 'values', 'femho_widget_colors.xml'), renderRes(source, 'day')],
  [join(RES, 'values-night', 'femho_widget_colors.xml'), renderRes(source, 'night')],
];

if (process.argv.includes('--check')) {
  for (const [path, expected] of outputs) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (current !== expected) {
      console.error(
        `tokens-compose · el generat no coincideix amb els tokens CSS: ${path}\n` +
          '  Android pintaria colors vells. Executa `node tools/gen/tokens-compose.mjs`.',
      );
      process.exit(1);
    }
  }
  console.log(`tokens-compose · al dia (${String(Object.keys(source.light).length)} colors)`);
} else {
  for (const [path, contents] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  console.log(
    `tokens-compose · escrit ${OUTPUT} (${String(Object.keys(source.light).length)} colors, ` +
      `${String(Object.keys(source.accents).length)} accents) i ` +
      `${String(SHAPE_TOKENS.length)} colors de forma a ${RES}`,
  );
}
