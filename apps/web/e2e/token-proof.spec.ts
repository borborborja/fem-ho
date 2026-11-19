/**
 * Comprovació visual de la fita M1.
 *
 * docs/13: "una pàgina de prova pinta un Button de Plou amb el gradient correcte als
 * quatre accents i als dos temes."
 *
 * Es comprova al navegador i no llegint el CSS, perquè els dos errors que això ha de
 * caçar només existeixen un cop resolta la cascada:
 *   - `accents.css` importat fora d'ordre: els quatre accents es veuen iguals i no hi
 *     ha cap error enlloc.
 *   - `--column-bg` absent en tema fosc: el fons de columna és invisible, que és
 *     literalment el bug del prototip.
 *
 * S'apunta per data-testid i no per [data-theme][data-accent]: l'arrel de la pàgina
 * porta els mateixos atributs que les cel·les i un selector per atributs l'agafaria a
 * ella.
 */

import { expect, test } from '@playwright/test';

const ACCENTS = ['default', 'soft', 'mono-warm', 'mono-cool'] as const;
const THEMES = ['light', 'dark'] as const;

const cell = (theme: string, accent: string) => `[data-testid="cell-${theme}-${accent}"]`;

test('el gradient de marca és diferent a cada accent', async ({ page }) => {
  await page.goto('/proof/tokens');

  const gradients = new Set<string>();
  for (const accent of ACCENTS) {
    const button = page.locator(`${cell('light', accent)} button`).first();
    const bg = await button.evaluate((el) => getComputedStyle(el).backgroundImage);

    expect(bg, `l'accent ${accent} no pinta cap gradient`).toContain('gradient');
    gradients.add(bg);
  }

  // Si accents.css no va l'últim, els quatre resolen al mateix gradient i aquest
  // conjunt té mida 1. És l'única manera de detectar-ho: no hi ha cap error de CSS.
  expect(gradients.size, 'els quatre accents pinten el mateix gradient: accents.css no mana').toBe(
    ACCENTS.length,
  );
});

test('el text del botó primari té contrast AA als vuit temes', async ({ page }) => {
  await page.goto('/proof/tokens');

  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      const ratio = await page
        .locator(`${cell(theme, accent)} button`)
        .first()
        .evaluate((el) => {
          const luminance = (rgb: string) => {
            const channels = (rgb.match(/\d+(?:\.\d+)?/g) ?? []).map((part) => {
              const value = Number(part) / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
          };
          const style = getComputedStyle(el);
          const foreground = luminance(style.color);
          const stops = style.backgroundImage.match(/rgb\([^)]+\)/g) ?? [];
          return stops.length === 0
            ? 0
            : Math.min(
                ...stops.map((stop) => {
                  const background = luminance(stop);
                  return (
                    (Math.max(foreground, background) + 0.05) /
                    (Math.min(foreground, background) + 0.05)
                  );
                }),
              );
        });
      expect(ratio, `${theme} · ${accent}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('el fons de columna es veu als dos temes', async ({ page }) => {
  await page.goto('/proof/tokens');

  for (const theme of THEMES) {
    const columna = page.locator(`${cell(theme, 'default')} [data-testid="column-bg"]`);

    const { fons, pare } = await columna.evaluate((el) => ({
      fons: getComputedStyle(el).backgroundColor,
      pare: getComputedStyle(el.parentElement as Element).backgroundColor,
    }));

    // check-ignore no-hardcoded-colors: no és un color de disseny, és el valor calculat
    // que retorna el navegador quan no hi ha fons. No hi ha cap token per a això.
    expect(fons, `--column-bg no s'aplica en tema ${theme}`).not.toBe('rgba(0, 0, 0, 0)');
    expect(fons, `--column-bg és idèntic al fons en tema ${theme}`).not.toBe(pare);
  }
});

test('captura dels 8 temes', async ({ page }) => {
  await page.goto('/proof/tokens');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('token-proof.png', { fullPage: true });
});
