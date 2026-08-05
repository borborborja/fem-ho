import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les proves viuen al costat del codi que proven.
    include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    // El prototip i Plou no es proven: ni són nostres ni són codi del projecte.
    exclude: ['**/node_modules/**', '**/dist/**', 'design/**'],
  },
});
