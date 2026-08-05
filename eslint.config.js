import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Plou ve vendoritzat tal com és i no es reescriu (docs/04 §1).
    // El prototip és una maqueta de referència amb un DSL que no és JavaScript vàlid.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/design-system/plou/**',
      'design/prototip/**',
      'packages/contracts/src/generated/**',
      'apps/android/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Regles generals. Van ABANS de les excepcions per fitxer: en configuració plana
  // guanya el bloc que ve més tard, o sigui que un bloc general al final anul·laria
  // totes les excepcions sense dir res.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // El vocabulari canònic el vigila tools/checks/vocab-lint.mjs, que sap de camps
      // i d'enums. Aquí només hi ha les regles de llenguatge.
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Les comprovacions permanents i els fitxers de configuració són scripts de Node:
    // process, console i URL hi són globals legítims.
    files: [
      'tools/**/*.mjs',
      '**/scripts/*.mjs',
      '**/scripts/*.ts',
      '**/*.config.ts',
      '**/*.config.js',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
    rules: {
      // Una comprovació de CI comunica el resultat per stdout. És la seva feina.
      'no-console': 'off',
    },
  },
  {
    // El servidor també és Node.
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // La web i les seves proves d'extrem a extrem corren al navegador.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
