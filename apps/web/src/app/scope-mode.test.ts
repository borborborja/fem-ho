/**
 * La lent, decidida igual que al servidor.
 *
 * Aquestes tres funcions són el bessó de `apps/server/src/policy/scope-mode.ts`. La prova
 * hi és perquè el dia que una de les dues canviï, l'altra falli: si divergissin, la
 * pantalla ensenyaria una tria que el servidor no accepta —o l'amagaria quan sí que es pot.
 */

import { describe, expect, it } from 'vitest';
import { canChooseScopeMode, needsScopeModeWizard, resolveScopeMode } from './scope-mode.js';
import type { Info, UserSettings } from './types.js';

const instancia = (mode: Info['scope_mode']): Info =>
  ({ name: 'Fem-ho', version: '0', registration: 'disabled', scope_mode: mode }) as Info;

const ajustos = (mode: UserSettings['scope_mode']): UserSettings =>
  ({ scope_mode: mode }) as UserSettings;

describe('la lent que toca', () => {
  it.each([
    ['both', null, 'multi'],
    ['both', 'multi', 'multi'],
    ['both', 'single', 'single'],
    ['single', null, 'single'],
    ['single', 'multi', 'single'],
    ['multi', 'single', 'multi'],
  ] as [Info['scope_mode'], UserSettings['scope_mode'], string][])(
    'instància %s + persona %s = %s',
    (policy, user, esperat) => {
      expect(resolveScopeMode(instancia(policy), ajustos(user))).toBe(esperat);
    },
  );

  it('sense el camp, val multi: un servidor vell no ha de canviar la barra de ningú', () => {
    /**
     * Una web nova contra un servidor que encara no publica `scope_mode` és el cas normal
     * durant un desplegament. Sense el `?? 'both'` i el `?? 'multi'`, la barra quedaria
     * indefinida justament mentre s'està actualitzant.
     */
    const vell = { name: 'Fem-ho', version: '0', registration: 'disabled' } as Info;
    expect(resolveScopeMode(vell, {} as UserSettings)).toBe('multi');
  });
});

describe('qui pot triar', () => {
  it('només si la instància no ho ha decidit', () => {
    expect(canChooseScopeMode(instancia('both'))).toBe(true);
    expect(canChooseScopeMode(instancia('single'))).toBe(false);
  });
});

describe('a qui li surt el wizard', () => {
  it('a qui no ho ha dit mai, si hi ha res a triar', () => {
    expect(needsScopeModeWizard(instancia('both'), ajustos(null))).toBe(true);
  });

  it('i a ningú més', () => {
    // Ja ho ha dit.
    expect(needsScopeModeWizard(instancia('both'), ajustos('multi'))).toBe(false);
    // No ho ha dit, però no hi ha res a triar: preguntar-ho seria teatre.
    expect(needsScopeModeWizard(instancia('single'), ajustos(null))).toBe(false);
  });
});
