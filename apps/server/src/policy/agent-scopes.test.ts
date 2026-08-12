/**
 * L'exclusivitat, amb les combinacions que la trenquen.
 *
 * La regla és una frase —**un àmbit, un agent**— i té quatre maneres de fallar. Escrites
 * totes, perquè la que faltés seria la que un dia deixa dos agents fent la mateixa feina
 * sense que res ho digui.
 */

import { describe, expect, it } from 'vitest';
import {
  assignmentConflict,
  availability,
  scopesVisibleToAgent,
  type AgentAssignment,
} from './agent-scopes.js';

const hermes = (over: Partial<AgentAssignment> = {}): AgentAssignment => ({
  id: 'hermes',
  name: 'Hermes',
  allScopes: false,
  scopeIds: [],
  ...over,
});

const codex = (over: Partial<AgentAssignment> = {}): AgentAssignment => ({
  id: 'codex',
  name: 'Codex',
  allScopes: false,
  scopeIds: [],
  ...over,
});

describe('què veu un agent', () => {
  it('els seus àmbits', () => {
    expect(scopesVisibleToAgent(hermes({ scopeIds: ['feina'] }), ['feina', 'casa'])).toEqual([
      'feina',
    ]);
  });

  it("amb «tots», els que hi ha ara —inclòs el que s'ha creat després", () => {
    /**
     * **Aquesta és la raó que `allScopes` sigui un indicador i no una llista.** Amb una
     * còpia dels àmbits del dia que es va desar, «Nou» no seria de ningú i la feina que hi
     * caigués no la faria mai cap agent.
     */
    const tot = hermes({ allScopes: true, scopeIds: [] });
    expect(scopesVisibleToAgent(tot, ['feina', 'casa', 'nou'])).toEqual(['feina', 'casa', 'nou']);
  });
});

describe('qui pot agafar què', () => {
  it('un àmbit lliure es pot agafar', () => {
    expect(
      assignmentConflict('hermes', { allScopes: false, scopeIds: ['feina'] }, [codex()]),
    ).toBeNull();
  });

  it("un àmbit d'un altre agent, no —i es diu de qui és", () => {
    const xoc = assignmentConflict('hermes', { allScopes: false, scopeIds: ['feina'] }, [
      codex({ scopeIds: ['feina'] }),
    ]);
    expect(xoc?.reason).toBe('scope-taken');
    // El nom hi és perquè el missatge sigui el següent pas i no una porta tancada.
    expect(xoc).toMatchObject({ byAgentName: 'Codex', scopeId: 'feina' });
  });

  it('amb un agent que ho porta tot, no queda res per a ningú', () => {
    const xoc = assignmentConflict('hermes', { allScopes: false, scopeIds: ['casa'] }, [
      codex({ allScopes: true }),
    ]);
    expect(xoc?.reason).toBe('all-taken');
    expect(xoc).toMatchObject({ byAgentName: 'Codex' });
  });

  it('i no es pot portar tot si un altre ja en té algun', () => {
    const xoc = assignmentConflict('hermes', { allScopes: true, scopeIds: [] }, [
      codex({ scopeIds: ['feina'] }),
    ]);
    expect(xoc?.reason).toBe('wants-all');
    expect(xoc).toMatchObject({ byAgentName: 'Codex' });
  });

  it("però sí si no n'hi ha cap altre amb res", () => {
    expect(assignmentConflict('hermes', { allScopes: true, scopeIds: [] }, [codex()])).toBeNull();
  });

  it('i un agent no xoca mai amb ell mateix', () => {
    /**
     * Desar el mateix que ja tens és el cas normal —s'obre la pantalla i es desa sense
     * canviar res—, i si xoqués amb un mateix no es podria tocar res mai més.
     */
    const jo = hermes({ scopeIds: ['feina', 'casa'] });
    expect(
      assignmentConflict('hermes', { allScopes: false, scopeIds: ['feina', 'casa'] }, [
        jo,
        codex(),
      ]),
    ).toBeNull();
  });
});

describe('el que ensenya la pantalla', () => {
  it('marca de qui és cada àmbit pres, per poder desactivar la casella', () => {
    const estat = availability('hermes', ['feina', 'casa'], [codex({ scopeIds: ['feina'] })]);
    expect(estat).toEqual([
      { scopeId: 'feina', takenBy: { id: 'codex', name: 'Codex' } },
      { scopeId: 'casa', takenBy: null },
    ]);
  });

  it('amb un agent que ho porta tot, tots surten presos', () => {
    const estat = availability('hermes', ['feina', 'casa'], [codex({ allScopes: true })]);
    expect(estat.every((row) => row.takenBy?.name === 'Codex')).toBe(true);
  });

  it('i els propis no surten mai presos', () => {
    const estat = availability('hermes', ['feina'], [hermes({ scopeIds: ['feina'] })]);
    expect(estat[0]?.takenBy).toBeNull();
  });
});
