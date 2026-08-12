/**
 * De qui és una tasca, quan qui la fa és un agent.
 *
 * **UN ÀMBIT, UN AGENT**
 * ----------------------
 * L'assignació no és per tasca sinó **per àmbit**, i és exclusiva: si «Feina» és d'en
 * Hermes, cap altre agent no hi entra. No cal triar agent en delegar una tasca —n'hi ha un
 * de sol que pugui fer-la— i «de qui és això» té sempre una resposta i només una.
 *
 * L'alternativa —una tasca amb `delegate_agent_id` a més de l'àmbit— donaria dos eixos que
 * poden dir coses diferents: una tasca de l'àmbit d'en Hermes delegada a un altre agent no
 * voldria dir res, i algú l'hauria de resoldre cada vegada.
 *
 * **`allScopes` ÉS UN INDICADOR I NO UNA LLISTA**
 * -----------------------------------------------
 * «Aquest agent ho porta tot» s'ha de mantenir cert demà. Si en desar-ho es copiessin els
 * àmbits d'avui, l'àmbit que es creï la setmana que ve no seria de ningú i la feina que hi
 * caigui no la faria mai cap agent, sense que res ho digués.
 *
 * **PER QUÈ L'ERROR HA DE DIR QUI EL TÉ**
 * ---------------------------------------
 * Un «no es pot» és una porta tancada; un «el té en Hermes» és el següent pas. Qui
 * configura això té la llista d'agents a la mà i el que li falta és saber a quin anar.
 *
 * Aquest fitxer és **pur**: sense base de dades i sense `async`. Qui el crida ja ha
 * carregat qui té què; aquí només es decideix.
 */

/** Un agent i el que té assignat, tal com surt de la base. */
export interface AgentAssignment {
  id: string;
  name: string;
  allScopes: boolean;
  scopeIds: string[];
}

/** El que es vol desar per a un agent. */
export interface WantedAssignment {
  allScopes: boolean;
  scopeIds: string[];
}

/**
 * Els àmbits que veu un agent.
 *
 * Amb `allScopes`, **tots els que hi hagi ara** —d'aquí que sigui un indicador—; si no, els
 * seus. Es passa la llista d'àmbits existents perquè la funció segueixi sent pura.
 */
export function scopesVisibleToAgent(agent: AgentAssignment, allExisting: string[]): string[] {
  return agent.allScopes ? [...allExisting] : [...agent.scopeIds];
}

/** Per què no es pot desar una assignació. `null` vol dir que sí que es pot. */
export type AssignmentConflict =
  | { reason: 'scope-taken'; scopeId: string; byAgentId: string; byAgentName: string }
  | { reason: 'all-taken'; byAgentId: string; byAgentName: string }
  | { reason: 'wants-all'; byAgentId: string; byAgentName: string };

/**
 * Si `wanted` es pot desar per a `agentId`, mirant qui té què.
 *
 * Els tres xocs possibles, i tots tres tenen el mateix remei —treure-ho a l'altre agent—,
 * per això tots tres diuen **quin** agent és:
 *
 *   - `scope-taken` — vols un àmbit que ja té un altre agent.
 *   - `all-taken`   — vols un àmbit qualsevol i hi ha un agent que ho porta tot.
 *   - `wants-all`   — vols portar-ho tot i hi ha un altre agent amb àmbits.
 */
export function assignmentConflict(
  agentId: string,
  wanted: WantedAssignment,
  others: AgentAssignment[],
): AssignmentConflict | null {
  const altres = others.filter((agent) => agent.id !== agentId);

  const totalitzador = altres.find((agent) => agent.allScopes);
  if (totalitzador !== undefined && (wanted.allScopes || wanted.scopeIds.length > 0)) {
    return {
      reason: 'all-taken',
      byAgentId: totalitzador.id,
      byAgentName: totalitzador.name,
    };
  }

  if (wanted.allScopes) {
    const ambAmbits = altres.find((agent) => agent.scopeIds.length > 0);
    if (ambAmbits !== undefined) {
      return { reason: 'wants-all', byAgentId: ambAmbits.id, byAgentName: ambAmbits.name };
    }
    return null;
  }

  for (const scopeId of wanted.scopeIds) {
    const amo = altres.find((agent) => agent.scopeIds.includes(scopeId));
    if (amo !== undefined) {
      return { reason: 'scope-taken', scopeId, byAgentId: amo.id, byAgentName: amo.name };
    }
  }

  return null;
}

/**
 * Quins àmbits pot marcar aquest agent, i quins li surten presos.
 *
 * Ho fa servir la pantalla per **desactivar la casella dient de qui és** en comptes de
 * deixar-la marcar i respondre amb un error després.
 */
export function availability(
  agentId: string,
  allExisting: string[],
  agents: AgentAssignment[],
): { scopeId: string; takenBy: { id: string; name: string } | null }[] {
  // Els propis no surten mai presos: desar el que ja tens és el cas normal.
  return holders(
    allExisting,
    agents.filter((agent) => agent.id !== agentId),
  ).map((row) => ({
    scopeId: row.scopeId,
    takenBy: row.agent === null ? null : { id: row.agent.id, name: row.agent.name },
  }));
}

/**
 * De qui és cada àmbit.
 *
 * La mateixa pregunta que `availability` amb un públic diferent: allà serveix per desactivar
 * caselles i aquí per dir **quins àmbits no té ningú**, que és el que fa que una tasca
 * delegada a un àmbit orfe no es quedi esperant per sempre sense que res ho digui.
 *
 * Una funció i dues vistes, i no dues còpies de la mateixa regla: el dia que l'exclusivitat
 * canviï, canvia aquí i les dues pantalles diuen el mateix.
 */
export function holders(
  allExisting: string[],
  agents: AgentAssignment[],
): { scopeId: string; agent: AgentAssignment | null }[] {
  const totalitzador = agents.find((agent) => agent.allScopes);

  return allExisting.map((scopeId) => {
    if (totalitzador !== undefined) return { scopeId, agent: totalitzador };
    return { scopeId, agent: agents.find((agent) => agent.scopeIds.includes(scopeId)) ?? null };
  });
}
