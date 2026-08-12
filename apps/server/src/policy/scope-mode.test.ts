/**
 * Les nou combinacions del mode, i el defecte que protegeix qui ja fa servir l'app.
 *
 * És una funció de dues entrades amb tres i tres valors: escriure-les totes costa el
 * mateix que escriure'n la meitat, i la que faltaria seria la que un dia canvia.
 */

import { describe, expect, it } from 'vitest';
import {
  canChooseScopeMode,
  effectiveScopeMode,
  parseInstanceScopeMode,
  type InstanceScopeMode,
  type UserScopeMode,
} from './scope-mode.js';

describe('el mode efectiu', () => {
  it.each([
    // instància, persona, efectiu
    ['both', null, 'multi'],
    ['both', 'multi', 'multi'],
    ['both', 'single', 'single'],
    ['single', null, 'single'],
    ['single', 'multi', 'single'],
    ['single', 'single', 'single'],
    ['multi', null, 'multi'],
    ['multi', 'multi', 'multi'],
    ['multi', 'single', 'multi'],
  ] as [InstanceScopeMode, UserScopeMode | null, UserScopeMode][])(
    'instància %s + persona %s = %s',
    (instance, user, esperat) => {
      expect(effectiveScopeMode(instance, user)).toBe(esperat);
    },
  );

  it("sense haver triat res, val multi: és com funciona l'app avui", () => {
    /**
     * **Aquest és el cas que protegeix a qui ja hi és.** `null` vol dir que el wizard no
     * li ha sortit mai —perquè el seu compte és anterior—, i el dia que s'actualitzi el
     * servidor no se li ha de canviar la barra sense demanar-li res.
     */
    expect(effectiveScopeMode('both', null)).toBe('multi');
  });

  it('la instància acotada no esborra el que la persona havia triat', () => {
    /**
     * Mentre l'operador acota, la preferència no s'aplica; quan la treu, torna. Acotar ha
     * de ser reversible: si en acotar es perdés el que cadascú va triar, treure
     * l'acotació deixaria tothom al defecte i semblaria que l'app ho ha oblidat.
     */
    expect(effectiveScopeMode('single', 'multi')).toBe('single');
    expect(effectiveScopeMode('both', 'multi')).toBe('multi');
  });
});

describe('qui pot triar', () => {
  it('només amb la instància a both', () => {
    expect(canChooseScopeMode('both')).toBe(true);
    expect(canChooseScopeMode('single')).toBe(false);
    expect(canChooseScopeMode('multi')).toBe(false);
  });
});

describe("el que ve de l'entorn", () => {
  it('accepta els tres valors, sense mirar espais ni majúscules', () => {
    expect(parseInstanceScopeMode('single').mode).toBe('single');
    expect(parseInstanceScopeMode(' MULTI ').mode).toBe('multi');
    expect(parseInstanceScopeMode('both').mode).toBe('both');
  });

  it('sense res, both', () => {
    expect(parseInstanceScopeMode(undefined)).toEqual({ mode: 'both', invalid: null });
    expect(parseInstanceScopeMode('')).toEqual({ mode: 'both', invalid: null });
  });

  it('un valor inventat no passa en silenci', () => {
    /**
     * Qui escriu `FEMHO_SCOPE_MODE=mono` espera que passi alguna cosa. Que passi el
     * defecte sense dir res és el pitjor dels casos: sembla que l'opció no existeixi, i
     * es va a buscar el problema a un altre lloc.
     */
    const resultat = parseInstanceScopeMode('mono');
    expect(resultat.mode).toBe('both');
    expect(resultat.invalid).toBe('mono');
  });
});
