#!/usr/bin/env node
/**
 * La portada del README, generada des dels tokens.
 *
 * PER QUÈ ES GENERA I NO S'ESCRIU
 * -------------------------------
 * GitHub no executa CSS: una portada amb la cara del producte només pot ser una imatge. I
 * una imatge amb els colors escrits a mà és exactament el que `no-hardcoded-colors`
 * existeix per impedir a tot arreu menys aquí —els `.svg` no els escaneja—, o sigui que
 * seria l'únic lloc del repositori on la marca es podria desincronitzar en silenci.
 *
 * Es fa com `Tokens.kt` i `strings.xml`: **el CSS de Plou és la font i això en surt**. El
 * dia que el degradat de marca canviï, es torna a executar i la portada el segueix.
 *
 * DUES VERSIONS, CLARA I FOSCA
 * ----------------------------
 * GitHub deixa triar imatge segons el tema amb `<picture>` i `prefers-color-scheme`. Un
 * producte que presumeix de tenir vuit temes no pot tenir una portada que només es vegi bé
 * en un.
 *
 *   node tools/gen/readme-banner.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKENS = join(ROOT, 'packages', 'design-system', 'plou', 'tokens');

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

/**
 * El tema clar i el fosc.
 *
 * `theme.css` defineix els mateixos noms dues vegades —arrel i `[data-theme="dark"]`— i
 * per això el fosc es llegeix del segon bloc. **Cap color s'escriu aquí**: la primera
 * versió d'aquest fitxer en tenia quatre a mà i `no-hardcoded-colors` la va aturar, que
 * és exactament el que ha de fer — el sentit de generar la portada era que la marca no es
 * pogués desincronitzar en silenci, i escriure-hi el fons a mà l'hauria buidat de sentit.
 */
const temaCSS = readFileSync(join(TOKENS, 'theme.css'), 'utf8');
const tallFosc = temaCSS.indexOf('[data-theme="dark"]');
if (tallFosc === -1) throw new Error("no s'ha trobat el bloc del tema fosc a theme.css");

function delTema(name, dark) {
  const zona = dark ? temaCSS.slice(tallFosc) : temaCSS.slice(0, tallFosc);
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'u').exec(zona);
  if (match === null) throw new Error(`no s'ha trobat --${name} al tema ${dark ? 'fosc' : 'clar'}`);
  return match[1].trim();
}

/**
 * El fons de la portada surt de **la primera parada de `--page-bg`**.
 *
 * `--page-bg` és un degradat i una portada vol un pla; la primera parada és el to on
 * neix, o sigui el color amb què la gent associa el fons de l'aplicació.
 */
function fonsDe(dark) {
  const parades = stops(delTema('page-bg', dark));
  if (parades.length === 0) throw new Error('--page-bg hauria de portar colors');
  return parades[0];
}

const CAPCALERA = "<!-- GENERAT · no l'editis a mà. Surt de tools/gen/readme-banner.mjs -->";

/**
 * La portada.
 *
 * **Sense text de reclam dins de la imatge**, i és deliberat: el que va dins d'un SVG no
 * el llegeix cap cercador, no es pot copiar i no es tradueix. La imatge porta la marca i
 * prou; el que s'ha de llegir va al Markdown, que sí que és text.
 */
function svg({ ink, fons, subtil }) {
  return `${CAPCALERA}
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="320" viewBox="0 0 1280 320" role="img" aria-label="Fem-ho">
  <defs>
    <linearGradient id="marca" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${marca[0]}"/>
      <stop offset="55%" stop-color="${marca[1]}"/>
      <stop offset="100%" stop-color="${marca[2]}"/>
    </linearGradient>
  </defs>

  <rect width="1280" height="320" fill="${fons}"/>

  <!-- La franja de marca: el mateix degradat que el wordmark de l'app. -->
  <rect x="0" y="0" width="1280" height="6" fill="url(#marca)"/>

  <!-- **Només el wordmark.** Cap frase aquí dins: el text d'un SVG no el llegeix cap
       cercador, no es pot copiar i **no es tradueix** — i aquesta portada la comparteixen
       les tres llengües. El que s'ha de llegir va al Markdown, que sí que és text. -->
  <text x="80" y="186" font-family="Roboto, ui-sans-serif, system-ui, sans-serif"
        font-size="96" font-weight="900" fill="url(#marca)">Fem-ho</text>
  <text x="86" y="232" font-family="Roboto, ui-sans-serif, system-ui, sans-serif"
        font-size="17" font-weight="400" fill="${subtil}">AGPL · CalDAV · MCP</text>

  <!-- Les quatre columnes del tauler, insinuades. La primera és la bústia i per això
       és sòlida: les altres tres són contenidors (docs/02 §4). -->
  <g transform="translate(880, 88)">
    <rect x="0" y="0" width="72" height="144" rx="14" fill="url(#marca)" opacity="0.92"/>
    <rect x="86" y="0" width="72" height="144" rx="14" fill="${ink}" opacity="0.10"/>
    <rect x="172" y="0" width="72" height="144" rx="14" fill="${ink}" opacity="0.10"/>
    <rect x="258" y="0" width="72" height="144" rx="14" fill="${ink}" opacity="0.10"/>
  </g>
</svg>
`;
}

const dir = join(ROOT, 'docs', 'img');
mkdirSync(dir, { recursive: true });

for (const [nom, dark] of [
  ['portada-clar.svg', false],
  ['portada-fosc.svg', true],
]) {
  writeFileSync(
    join(dir, nom),
    svg({
      ink: delTema('ink', dark),
      subtil: delTema('ink-soft', dark),
      fons: fonsDe(dark),
    }),
  );
}

console.log(`readme-banner · escrites les dues portades a docs/img (marca: ${marca.join(' → ')})`);
