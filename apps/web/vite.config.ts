import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * El color del manifest surt del token de Plou, no d'un literal.
 *
 * `--app-bg` és un gradient i el manifest només accepta un color pla, o sigui que s'hi
 * agafa la primera parada: és el que es veu a la pantalla de càrrega, que és exactament
 * el que el manifest pinta. Llegir-lo aquí en comptes de copiar-lo fa que canviar el
 * tema no deixi la pantalla de càrrega d'un color que ja no existeix.
 */
function tokenColor(tokenName: string): string {
  const css = readFileSync(
    fileURLToPath(new URL('../../packages/design-system/plou/tokens/theme.css', import.meta.url)),
    'utf8',
  );
  const declaration = new RegExp(`--${tokenName}\\s*:([^;]+);`).exec(css)?.[1] ?? '';
  const color = /#[0-9a-f]{3,8}/i.exec(declaration)?.[0];
  if (color === undefined) throw new Error(`El token --${tokenName} no porta cap color.`);
  return color;
}

const APP_BG = tokenColor('app-bg');

/**
 * En desenvolupament la web i el servidor són processos diferents; en producció el
 * mateix procés serveix les dues coses i aquest proxy no existeix.
 */
const API = process.env.FEMHO_API_ORIGIN ?? 'http://localhost:8080';
/**
 * `/setup` i `/invite/{token}` són **una pàgina i un endpoint alhora**.
 *
 * `GET` ha de donar el formulari (docs/12 §3: "`/setup` mostra un formulari"), i `POST`
 * ha d'arribar al servidor. En producció això surt sol —el mateix procés serveix les
 * dues coses i la ruta declarada guanya el gestor de "no trobat"—, però amb el proxy de
 * desenvolupament cal dir-ho: sense això, obrir `/setup` al navegador descarregava un
 * JSON en comptes de pintar el formulari.
 */
const pageOrApi: ProxyOptions = {
  target: API,
  bypass: (req) => (req.method === 'GET' || req.method === 'HEAD' ? '/index.html' : undefined),
};

const PROXY = {
  '/api': API,
  '/info': API,
  '/healthz': API,
  // `/s/{token}` és pàgina i endpoint, com `/setup` i `/invite`: el `GET` ha de pintar
  // l'app —és l'enllaç que s'envia a algú de fora— i el `POST` ha d'arribar al servidor.
  '/s/': pageOrApi,
  '/setup': pageOrApi,
  '/invite': pageOrApi,
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // `autoUpdate`: una app de tasques no ha de demanar permís per actualitzar-se.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fem-ho',
        short_name: 'Fem-ho',
        description: 'Gestor de tasques personal i familiar',
        lang: 'ca',
        start_url: '/',
        display: 'standalone',
        background_color: APP_BG,
        theme_color: APP_BG,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // L'API NO es guarda a la memòria cau del servei de treball: l'estat offline el
        // porta Dexie (docs/06 §1), i dues memòries cau del mateix contingut acaben
        // discrepant. `/stream` i `/mcp` no s'hi acosten mai.
        navigateFallbackDenylist: [/^\/api/, /^\/mcp/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: PROXY,
  },
  /**
   * `preview` porta el MATEIX proxy que `server`.
   *
   * Les proves de navegador corren contra la construcció de producció (playwright.config)
   * i allà l'API segueix sent un altre procés. Sense aquest bloc, cada crida acabava en
   * el `index.html` de la SPA i el client rebia HTML on esperava JSON —un error que no
   * diu res del que passa de veritat.
   */
  preview: {
    port: 4173,
    proxy: PROXY,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
