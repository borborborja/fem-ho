/**
 * docs/13 M6 · comprovació de la fita: `test: quickadd-parser` amb els fixtures
 * compartits.
 *
 * Els casos NO s'escriuen aquí: surten de `fixtures/quickadd.json`, que és el mateix
 * fitxer que farà servir Kotlin a M13. Escriure'ls aquí seria garantir la divergència
 * que docs/03 §1 avisa.
 */

import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/quickadd.json' with { type: 'json' };
import { parseQuickAdd, revertToken, type QuickAddContext } from './quickadd.js';

interface FixtureCase {
  name: string;
  input: string;
  expect: Record<string, unknown>;
}

const context = fixtures.context as QuickAddContext;

/** Compara només els camps que el fixture declara: la resta no és part del contracte. */
function assertMatches(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key], `camp "${key}"`).toEqual(value);
  }
}

describe('parseQuickAdd · fixtures compartits amb Kotlin', () => {
  it.each(fixtures.cases as FixtureCase[])('$name', (testCase) => {
    const result = parseQuickAdd(testCase.input, context);
    assertMatches(result as unknown as Record<string, unknown>, testCase.expect);
  });
});

describe('parseQuickAdd · amb un sol àmbit actiu', () => {
  const single: QuickAddContext = {
    ...context,
    activeScopeIds: fixtures.singleActiveScope.activeScopeIds,
  };

  it.each(fixtures.singleActiveScope.cases as FixtureCase[])('$name', (testCase) => {
    const result = parseQuickAdd(testCase.input, single);
    assertMatches(result as unknown as Record<string, unknown>, testCase.expect);
  });
});

describe('AQUESTA és la de docs/13: el xip es pot tornar a text pla', () => {
  it("desfer un xip d'àmbit deixa el nom escrit", () => {
    // "Sense això, un parser agressiu és una trampa — és el mecanisme amb què Todoist
    // se'l pot permetre" (docs/02 §4, D12).
    const text = '#Feina Enviar proposta';
    const { tokens } = parseQuickAdd(text, context);
    const scopeToken = tokens.find((token) => token.kind === 'scope');
    expect(scopeToken).toBeDefined();

    const desfet = revertToken(text, scopeToken!);
    expect(desfet).toBe('Feina Enviar proposta');
    // I ara ja no es reconeix com a àmbit: ha tornat a ser text.
    expect(parseQuickAdd(desfet, context).scopeId).toBeNull();
  });

  it('desfer un xip de persona també', () => {
    const text = '#Feina Reunió @Alba';
    const { tokens } = parseQuickAdd(text, context);
    const person = tokens.find((token) => token.kind === 'person');
    expect(revertToken(text, person!)).toBe('#Feina Reunió Alba');
  });

  it('cada xip sap on era, per poder-lo pintar al lloc', () => {
    const text = '#Feina/Client Salt Enviar proposta @Alba';
    const { tokens } = parseQuickAdd(text, context);

    for (const token of tokens) {
      expect(text.slice(token.start, token.end)).toBe(token.raw);
    }
  });
});

describe('el cas que docs/03 §1 avisa', () => {
  it('#Feina/Client Salt amb un espai al mig es resol bé', () => {
    // "Sense això, les dues implementacions divergeixen i ningú se n'adona fins que un
    // usuari escriu #Feina/Client Salt amb un espai."
    const result = parseQuickAdd('#Feina/Client Salt Enviar proposta @Alba', context);

    expect(result.scopeId).toBe('scope-feina');
    expect(result.projectId).toBe('proj-client-salt');
    expect(result.assigneeIds).toEqual(['user-alba']);
    // El títol queda NET: ni el sigil, ni el projecte, ni la persona.
    expect(result.title).toBe('Enviar proposta');
  });
});
