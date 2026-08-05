import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
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
    proxy: {
      // En desenvolupament la web i el servidor són processos diferents; en producció
      // el mateix procés serveix les dues coses i aquest proxy no existeix.
      '/api': 'http://localhost:8080',
      '/info': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
