#!/usr/bin/env node
/**
 * Generador dels favicons de la versió web.
 *
 * PER QUÈ ES GENERA I NO S'ESCRIU
 * -------------------------------
 * El favicon és la marca de Fem-ho. Si els colors s'escriuen a mà, es desincronitzaran
 * el dia que el design system canviï. Aquest script llegeix els tokens de Plou i
 * genera els SVG i PNG necessaris sense cap dependència externa.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS = join(ROOT, 'packages', 'design-system', 'plou', 'tokens');
const PUBLIC = join(ROOT, 'apps', 'web', 'public');

/** El valor d'un token del CSS de Plou. */
function token(file, name) {
  const text = readFileSync(join(TOKENS, file), 'utf8');
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'u').exec(text);
  if (match === null) throw new Error(`no s'ha trobat --${name} a ${file}`);
  return match[1].trim();
}

/** Els colors d'un `linear-gradient(...)`, en ordre. */
function stops(gradient) {
  return [...gradient.matchAll(/#[0-9a-f]{3,8}/giu)].map((m) => m[0]);
}

const marca = stops(token('colors.css', 'gradient-brand'));
if (marca.length < 3) throw new Error('el degradat de marca hauria de tenir tres parades');

const onBrand = token('colors.css', 'on-brand');

const CAPCALERA = "<!-- GENERAT · no l'editis a mà. Surt de tools/gen/favicon.mjs -->";

function svg() {
  return `${CAPCALERA}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <defs>
    <linearGradient id="marca" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${marca[0]}"/>
      <stop offset="55%" stop-color="${marca[1]}"/>
      <stop offset="100%" stop-color="${marca[2]}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="108" height="108" rx="24" fill="url(#marca)"/>
  <path d="M34,55 L48,69 L75,40" fill="none" stroke="${onBrand}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

// PNG Encoder
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePNG(width, height, rgbaData) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = createChunk('IHDR', ihdrData);

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0;
    rgbaData.copy(scanlines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idatData = deflateSync(scanlines);
  const idat = createChunk('IDAT', idatData);
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function parseHex(hex) {
  if (hex.length === 4) {
    return [
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      parseInt(hex[3] + hex[3], 16),
    ];
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax,
    pay = py - ay;
  const bax = bx - ax,
    bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy);
}

function sdCheckmark(px, py, scale) {
  const d1 = sdSegment(px, py, 34 * scale, 55 * scale, 48 * scale, 69 * scale);
  const d2 = sdSegment(px, py, 48 * scale, 69 * scale, 75 * scale, 40 * scale);
  return Math.min(d1, d2);
}

function renderIcon(N, isBleed) {
  const data = Buffer.alloc(N * N * 4);
  const scale = N / 108;
  const r = 24 * scale;
  const cx = N / 2;
  const cy = N / 2;
  const mig = N / 2;

  const c0 = parseHex(marca[0]);
  const c1 = parseHex(marca[1]);
  const c2 = parseHex(marca[2]);
  const onBrandColor = parseHex(onBrand);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const t = (px + py) / (2 * N);
      let gradColor;
      if (t <= 0.55) {
        gradColor = lerpColor(c0, c1, t / 0.55);
      } else {
        gradColor = lerpColor(c1, c2, (t - 0.55) / 0.45);
      }

      let rectAlpha = 1;
      if (!isBleed) {
        const dx = Math.abs(px - cx) - (mig - r);
        const dy = Math.abs(py - cy) - (mig - r);
        const dist = Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) - r;
        rectAlpha = Math.max(0, Math.min(1, 0.5 - dist));
      }

      const dist_px = sdCheckmark(px, py, scale);
      const checkAlpha = Math.max(0, Math.min(1, 0.5 + (4 * scale - dist_px)));

      const finalR = gradColor[0] * (1 - checkAlpha) + onBrandColor[0] * checkAlpha;
      const finalG = gradColor[1] * (1 - checkAlpha) + onBrandColor[1] * checkAlpha;
      const finalB = gradColor[2] * (1 - checkAlpha) + onBrandColor[2] * checkAlpha;

      const idx = (y * N + x) * 4;
      data[idx] = Math.round(finalR);
      data[idx + 1] = Math.round(finalG);
      data[idx + 2] = Math.round(finalB);
      data[idx + 3] = Math.round(rectAlpha * 255);
    }
  }
  return encodePNG(N, N, data);
}

mkdirSync(PUBLIC, { recursive: true });

writeFileSync(join(PUBLIC, 'favicon.svg'), svg());
writeFileSync(join(PUBLIC, 'favicon-16.png'), renderIcon(16, false));
writeFileSync(join(PUBLIC, 'favicon-32.png'), renderIcon(32, false));
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), renderIcon(180, true));

console.log(
  `favicon · escrits els 4 favicons a apps/web/public (marca: ${marca.join(' → ')}, on-brand: ${onBrand})`,
);
