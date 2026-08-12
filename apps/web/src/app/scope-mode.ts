/**
 * Amb quina lent es veu l'app, resolt un sol cop per a tothom qui ho pregunti.
 *
 * La regla és la mateixa que al servidor (`apps/server/src/policy/scope-mode.ts`) i **no
 * és una segona implementació**: allà decideix qui pot desar i aquí què es pinta, i totes
 * dues han de dir el mateix o la pantalla ensenyaria una cosa que el servidor no accepta.
 * És prou petita perquè duplicar-la sigui més barat que fer-la viatjar, i prou important
 * perquè tingui la seva prova a banda.
 *
 * **Què vol dir cada mode, en una frase:**
 *
 *   - `multi` — els **àmbits** són el primer eix: hi ha els xips de sempre, se'n poden
 *     mirar diversos alhora, i els projectes pengen de cada xip.
 *   - `single` — s'està **en un àmbit** i el primer eix són els seus **projectes**. El
 *     selector d'àmbit surt a l'esquerra del commutador, i només si n'hi ha més d'un.
 */

import type { Info, UserSettings } from './types.js';

export type ScopeMode = 'single' | 'multi';

/** El que val de debò, amb el que diu la instància per damunt del que ha triat la persona. */
export function resolveScopeMode(instance: Info, settings: UserSettings): ScopeMode {
  const policy = instance.scope_mode ?? 'both';
  if (policy !== 'both') return policy;
  return settings.scope_mode ?? 'multi';
}

/** Si aquesta persona pot canviar-ho, o la instància ja ho ha decidit per tothom. */
export function canChooseScopeMode(instance: Info): boolean {
  return (instance.scope_mode ?? 'both') === 'both';
}

/**
 * Si li toca el wizard.
 *
 * Les dues condicions són necessàries: **no ho ha dit mai** i **hi ha res a triar**. Si
 * l'operador ja ha decidit com es treballa aquí, preguntar-ho igualment seria teatre —i
 * pitjor: faria pensar que la tria serveix d'alguna cosa.
 */
export function needsScopeModeWizard(instance: Info, settings: UserSettings): boolean {
  return settings.scope_mode == null && canChooseScopeMode(instance);
}
