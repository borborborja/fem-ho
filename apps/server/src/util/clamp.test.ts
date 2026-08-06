/**
 * `clampInt`.
 *
 * Existeix per una raó concreta: **el clamp obvi no és una barrera**. Aquestes proves
 * són el que ho fixa.
 */

import { describe, expect, it } from 'vitest';
import { clampInt } from './clamp.js';

const OPCIONS = { min: 1, max: 200, fallback: 50 };

describe('el cas que ho va motivar', () => {
  it('un NaN cau al valor per defecte, no passa de llarg', () => {
    // `Math.min(Math.max(NaN, 1), 200)` és NaN: totes dues comparacions són falses.
    expect(Math.min(Math.max(Number.NaN, 1), 200)).toBeNaN();
    expect(clampInt(Number.NaN, OPCIONS)).toBe(50);
  });

  it('una cadena que no és un número, també', () => {
    expect(clampInt('abc', OPCIONS)).toBe(50);
    expect(clampInt('', OPCIONS)).toBe(50);
    expect(clampInt('12abc', OPCIONS)).toBe(50);
  });
});

describe('la resta de coses que arriben de fora', () => {
  it.each([
    [undefined, 50],
    [null, 50],
    [{}, 50],
    [[], 50],
    [Number.POSITIVE_INFINITY, 50],
    [Number.NEGATIVE_INFINITY, 50],
  ])('%s → %s', (value, expected) => {
    expect(clampInt(value, OPCIONS)).toBe(expected);
  });

  it('un número dins de rang es respecta', () => {
    expect(clampInt(20, OPCIONS)).toBe(20);
    expect(clampInt('20', OPCIONS)).toBe(20);
  });

  it('es retalla als extrems', () => {
    expect(clampInt(-5, OPCIONS)).toBe(1);
    expect(clampInt(999_999, OPCIONS)).toBe(200);
  });

  it('un decimal es trunca', () => {
    expect(clampInt(20.9, OPCIONS)).toBe(20);
  });
});
