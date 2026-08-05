/**
 * Lector de tokens de Plou i càlcul de color.
 *
 * Resol el valor efectiu d'una variable CSS per a una combinació concreta de tema i
 * accent, respectant l'ordre de cascada real de styles.css. Això importa: `accents.css`
 * va l'últim i els selectors `[data-accent]` i `:root` comparteixen especificitat, o
 * sigui que qui guanya ho decideix l'ordre del codi (docs/04 §1).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** L'ordre d'importació de styles.css. No és alfabètic i no es pot reordenar. */
export const TOKEN_FILES = [
  'fonts.css',
  'colors.css',
  'theme.css',
  'typography.css',
  'shape.css',
  'spacing.css',
  'elevation.css',
  'motion.css',
  'accents.css',
  'utilities.css',
];

export const THEMES = ['light', 'dark'];
export const ACCENTS = ['default', 'soft', 'mono-warm', 'mono-cool'];

/**
 * Trosseja un fitxer CSS en blocs { selector, declarations }, en ordre d'aparició.
 * No és un analitzador de CSS complet: els fitxers de tokens són plans i no tenen
 * anidament, i n'hi ha prou amb això.
 */
function parseBlocks(css) {
  const blocks = [];
  // Treu els comentaris abans de res, o els `{}` de dins confondrien el tall.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const selector = m[1].trim();
    const declarations = {};
    for (const decl of m[2].split(';')) {
      const idx = decl.indexOf(':');
      if (idx === -1) continue;
      const prop = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (prop.startsWith('--')) declarations[prop] = value;
    }
    blocks.push({ selector, declarations });
  }
  return blocks;
}

export function loadTokenBlocks(tokensDir) {
  const all = [];
  for (const file of TOKEN_FILES) {
    const css = readFileSync(join(tokensDir, file), 'utf8');
    for (const block of parseBlocks(css)) all.push({ ...block, file });
  }
  return all;
}

/** Un selector aplica a aquesta combinació de tema i accent? */
function selectorApplies(selector, theme, accent) {
  return selector.split(',').some((part) => {
    const s = part.trim();
    if (s === ':root') return true;
    const themeMatch = s.match(/\[data-theme="([^"]+)"\]/);
    const accentMatch = s.match(/\[data-accent="([^"]+)"\]/);
    if (themeMatch !== null && themeMatch[1] !== theme) return false;
    if (accentMatch !== null && accentMatch[1] !== accent) return false;
    // Un selector amb data-accent no aplica mai a l'accent `default`, que és l'absència
    // de l'atribut.
    if (accentMatch !== null && accent === 'default') return false;
    return themeMatch !== null || accentMatch !== null || s === ':root';
  });
}

/** Aplana els blocs a un mapa de variable → valor per a (tema, accent). */
export function resolveTokens(blocks, theme, accent) {
  const out = {};
  for (const block of blocks) {
    if (!selectorApplies(block.selector, theme, accent)) continue;
    Object.assign(out, block.declarations);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/** Analitza #rgb, #rrggbb, #rrggbbaa, rgb() i rgba(). Retorna {r,g,b,a} o null. */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();

  const hex = v.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex !== null) {
    const h = hex[1];
    const expand = (s) => parseInt(s.length === 1 ? s + s : s, 16);
    if (h.length === 3 || h.length === 4) {
      return {
        r: expand(h[0]),
        g: expand(h[1]),
        b: expand(h[2]),
        a: h.length === 4 ? expand(h[3]) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (rgb !== null) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }

  return null;
}

/** Totes les parades de color d'un linear-gradient(). */
export function gradientStops(value) {
  if (typeof value !== 'string' || !value.includes('gradient(')) return [];
  const stops = [];
  const re = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    const c = parseColor(m[0]);
    if (c !== null) stops.push(c);
  }
  return stops;
}

/** Composa un color amb alfa sobre un fons opac. */
export function composite(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Raó de contrast WCAG 2.x entre dos colors opacs. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
