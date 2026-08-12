/**
 * Com se'n diu, d'un projecte, en aquesta casa.
 *
 * Qui treballa per encàrrec no té «projectes»: té **clients**, i cada vegada que la
 * pantalla diu una altra paraula ha de fer la traducció al cap. És una preferència per
 * àmbit (`scope_settings.project_noun`) i **només canvia la paraula de la interfície**: el
 * camp segueix sent `project_id` a la base, a l'API i a les tools d'MCP, que és el que la
 * regla 3 exigeix i el que fa que això sigui barat.
 *
 * **Amb diversos àmbits actius, mana «projecte» si algun ho diu.** És la direcció segura:
 * «projecte» és la paraula de la casa i la que entén tothom, i dir «client» a qui té la
 * meitat dels àmbits sense clients seria pitjor que la paraula genèrica.
 */

export type ProjectNoun = 'project' | 'client';

export function projectNoun(
  settings: { scope_id: string; project_noun?: string }[],
  activeScopeIds: string[],
): ProjectNoun {
  const actius = settings.filter((row) => activeScopeIds.includes(row.scope_id));
  if (actius.length === 0) return 'project';
  return actius.every((row) => row.project_noun === 'client') ? 'client' : 'project';
}

/** La clau del catàleg per a un text que parla de projectes. */
export function nounKey(noun: ProjectNoun, base: string): string {
  return noun === 'client' ? `${base}.client` : base;
}
