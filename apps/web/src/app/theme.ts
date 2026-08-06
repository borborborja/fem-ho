/**
 * Tema i accent.
 *
 * Plou tria el tema per `data-theme` a l'arrel i l'accent per `data-accent`
 * (`packages/design-system/plou/tokens`). Aquí només s'hi escriuen els atributs: cap
 * color surt d'aquest fitxer, que és el que `no-hardcoded-colors` vigila.
 *
 * **`system` no és un tercer tema**, és "el que digui el sistema operatiu": es resol al
 * moment i es torna a resoldre quan l'usuari canvia la preferència del sistema sense
 * tocar l'app. Sense el `matchMedia`, qui té el tema en automàtic es quedaria en clar
 * fins a recarregar.
 */

import type { Accent, Theme } from './types.js';

const QUERY = '(prefers-color-scheme: dark)';

let current: Theme = 'system';
let listening = false;

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches ? 'dark' : 'light';
}

function paint(): void {
  document.documentElement.dataset.theme = resolve(current);
}

export function applyTheme(theme: Theme): void {
  current = theme;
  paint();

  if (!listening && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    listening = true;
    window.matchMedia(QUERY).addEventListener('change', () => {
      if (current === 'system') paint();
    });
  }
}

export function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
}

/**
 * El tema abans que hi hagi sessió.
 *
 * La pantalla de login i la pàgina pública d'un enllaç compartit també s'han de veure
 * bé, i no tenen perfil d'usuari: es fa servir el del sistema.
 */
export function applyDefaults(): void {
  applyTheme('system');
  applyAccent('default');
}
