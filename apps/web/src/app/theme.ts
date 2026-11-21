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

import { useSyncExternalStore } from 'react';
import type { Accent, Theme } from './types.js';

export type Appearance = 'standard' | 'high-contrast' | 'eink';

const COLOR_SCHEME = '(prefers-color-scheme: dark)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const STORAGE_KEY = 'femho.appearance';
const listeners = new Set<() => void>();

interface DeviceAppearance {
  appearance: Appearance;
  base: Theme | null;
}

let profileTheme: Theme = 'system';
let device = readDeviceAppearance();
let listening = false;

function readDeviceAppearance(): DeviceAppearance {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as DeviceAppearance;
    const { appearance, base } = stored;
    return {
      appearance: appearance === 'high-contrast' || appearance === 'eink' ? appearance : 'standard',
      base: base === 'system' || base === 'light' || base === 'dark' ? base : null,
    };
  } catch {
    return { appearance: 'standard', base: null };
  }
}

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia(COLOR_SCHEME).matches ? 'dark' : 'light';
}

function paint(): void {
  const root = document.documentElement;
  const { appearance, base } = device;
  root.dataset.appearance = appearance;
  root.dataset.theme =
    appearance === 'eink'
      ? 'light'
      : resolve(appearance === 'standard' ? profileTheme : (base ?? profileTheme));
}

export function applyTheme(theme: Theme): void {
  profileTheme = theme;
  paint();

  if (listening) return;
  listening = true;
  window.matchMedia(COLOR_SCHEME).addEventListener('change', paint);
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    device = readDeviceAppearance();
    paint();
    for (const notify of listeners) notify();
  });
}

export function setAppearance(appearance: Appearance): void {
  // En sortir de la tinta electrònica cal recuperar el tema de base, no el blanc forçat.
  const base = device.appearance === 'standard' ? profileTheme : (device.base ?? profileTheme);
  device = { appearance, base };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
  } catch {
    // La tria d'aquesta pestanya segueix disponible si el navegador bloqueja l'emmagatzematge.
  }
  paint();
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => device.appearance);
}

export function reduceMotion(): boolean {
  return device.appearance === 'eink' || window.matchMedia(REDUCED_MOTION).matches;
}

export function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
}

/**
 * El tema abans que hi hagi sessió.
 *
 * La pantalla de login i la pàgina pública d'un enllaç compartit també s'han de veure
 * bé sense perfil d'usuari. Els ajustos d'aquest dispositiu valen també abans d'entrar.
 */
export function applyDefaults(): void {
  applyTheme('system');
  applyAccent('default');
}
