/**
 * Multiàmbit o monoàmbit: qui decideix, i qui mana sobre qui.
 *
 * Fem-ho dona per fet que qui l'obre reparteix la vida en àmbits i els posa a la barra
 * com el primer eix de navegació. Per a molta gent és exactament el que vol; per a qui
 * fa servir l'eina per a **una sola cosa** —la seva feina, la seva empresa petita— és una
 * barra amb un sol xip que no fa res, i el que li caldria a dalt són els projectes.
 *
 * **AIXÒ ÉS UNA LENT, NO UN MODEL DE DADES DIFERENT**
 * ---------------------------------------------------
 * Tota tasca segueix vivint dins d'un àmbit (`instruccions.md`, regla 1), i els àmbits
 * col·lectius, el CalDAV per àmbit i els tokens d'abast limitat segueixen igual. El mode
 * només diu **què posa la interfície al davant**. Per això viu a `policy/` i no toca cap
 * taula de dades: és una decisió, no una estructura.
 *
 * **DOS QUI DECIDEIXEN, I UN ORDRE ENTRE ELLS**
 * ---------------------------------------------
 * La persona tria com vol treballar; qui allotja la instància pot acotar què es pot
 * triar. Un de sol no serviria:
 *
 *   - Només la persona: una empresa que desplega això per al seu equip no pot dir "aquí
 *     es treballa d'una manera", i acaba amb mitja plantilla a cada mode.
 *   - Només la instància: una casa on cadascú té el seu cap no pot deixar que un ho vegi
 *     d'una manera i l'altre d'una altra, que és justament el que fa que una eina
 *     autoallotjada valgui per a tothom qui hi viu.
 *
 * **EL DEFECTE ÉS `multi`, I NO ÉS ARBITRARI**
 * --------------------------------------------
 * `null` vol dir «aquesta persona encara no ho ha dit» —el wizard no li ha sortit— i no
 * «vol multi». La distinció és el que fa que el wizard sàpiga a qui ha de sortir sense
 * una segona columna a la base. I mentre no ho digui, val `multi`: és com funciona l'app
 * avui, i a qui ja la fa servir no se li ha de canviar la barra un matí sense demanar-ho.
 */

/** El que diu qui allotja la instància. `both` deixa triar. */
export type InstanceScopeMode = 'both' | 'single' | 'multi';

/** El que ha triat una persona. `null` és «encara no ho ha dit». */
export type UserScopeMode = 'single' | 'multi';

/**
 * Amb quina lent veu l'app aquesta persona.
 *
 * **La instància mana quan es mulla.** Si diu `single` o `multi`, la preferència de la
 * persona no s'esborra ni es toca: simplement no s'aplica mentre duri l'acotació. Si
 * l'operador la treu, cadascú recupera la seva —que és el que fa que acotar sigui una
 * decisió reversible i no una que perd dades.
 */
export function effectiveScopeMode(
  instance: InstanceScopeMode,
  user: UserScopeMode | null,
): UserScopeMode {
  if (instance !== 'both') return instance;
  return user ?? 'multi';
}

/**
 * Si aquesta persona pot canviar-ho.
 *
 * Ho fan servir dues pantalles: Ajustos, per ensenyar el commutador **desactivat amb el
 * motiu** en comptes d'amagar-lo —un ajust que desapareix fa pensar que l'app l'ha
 * perdut—, i el wizard, per no sortir quan no hi ha res a preguntar.
 */
export function canChooseScopeMode(instance: InstanceScopeMode): boolean {
  return instance === 'both';
}

/**
 * El text de l'entorn, validat.
 *
 * Un valor que no reconeixem **no s'accepta en silenci**: qui escriu `FEMHO_SCOPE_MODE=mono`
 * al compose espera que passi alguna cosa, i que passi el defecte és el pitjor dels casos
 * —sembla que l'opció no existeixi—. Aquí es torna a `invalid` i **qui crida llança**, com
 * ja fa `FEMHO_REGISTRATION`: el servidor no arrenca amb una configuració que no s'entén.
 * Es reparteix així perquè aquesta funció es pugui provar sense muntar cap entorn.
 */
export function parseInstanceScopeMode(raw: string | undefined): {
  mode: InstanceScopeMode;
  invalid: string | null;
} {
  if (raw === undefined || raw === '') return { mode: 'both', invalid: null };
  const value = raw.trim().toLowerCase();
  if (value === 'both' || value === 'single' || value === 'multi') {
    return { mode: value, invalid: null };
  }
  return { mode: 'both', invalid: raw };
}
