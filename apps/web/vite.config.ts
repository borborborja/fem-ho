import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
