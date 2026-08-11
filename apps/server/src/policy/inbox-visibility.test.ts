/**
 * `isInInbox`.
 *
 * El que aquestes proves fixen no és que la funció "funcioni": és **l'ordre dels cinc
 * nivells**, que és l'única part difícil del disseny. Un ordre canviat compila igual,
 * passa qualsevol prova de camí feliç, i es manifesta com "de vegades no em fa cas",
 * que és el pitjor error possible en una preferència.
 */

import { describe, expect, it } from 'vitest';
import { defaultInInbox, isInInbox, type InboxVisibilityInput } from './inbox-visibility.js';

/** Un calendari subscrit corrent, sense cap excepció enlloc. */
const BASE: InboxVisibilityInput = {
  origin: 'subscription',
  sourceKind: 'caldav',
  calendarInboxVisible: null,
  seriesMark: null,
  occurrenceMark: null,
  hasLiveTask: false,
};

const amb = (canvis: Partial<InboxVisibilityInput>): InboxVisibilityInput => ({
  ...BASE,
  ...canvis,
});

describe('el defecte, quan ningú ha dit res', () => {
  it.each([
    ['un CalDAV subscrit', 'subscription', 'caldav', true],
    ['un .ics publicat', 'subscription', 'ical', true],
    ['un canal RSS', 'subscription', 'rss', false],
    ["un calendari d'aquesta casa", 'local', null, true],
  ] as const)('%s → %s', (_nom, origin, sourceKind, esperat) => {
    expect(defaultInInbox(origin, sourceKind)).toBe(esperat);
    expect(isInInbox(amb({ origin, sourceKind }))).toBe(esperat);
  });

  it('un local amb source_kind buit no cau al camí dels RSS', () => {
    // Els locals no en tenen, i `null !== 'rss'` donaria cert per casualitat. Que sigui
    // per la branca de `local` i no per accident és el que es comprova aquí.
    expect(defaultInInbox('local', null)).toBe(true);
  });
});

describe("l'ajust del calendari mana sobre el defecte", () => {
  it('un RSS encès hi surt', () => {
    expect(isInInbox(amb({ sourceKind: 'rss', calendarInboxVisible: true }))).toBe(true);
  });

  it('un calendari apagat no hi surt', () => {
    expect(isInInbox(amb({ calendarInboxVisible: false }))).toBe(false);
  });

  it('`null` no és `false`: vol dir "no s\'ha dit res"', () => {
    // Si algú llegís el tri-estat com un booleà, això donaria fals i el calendari
    // desapareixeria de la bústia de tothom sense que ningú ho hagués demanat.
    expect(isInInbox(amb({ calendarInboxVisible: null }))).toBe(true);
  });
});

describe('les marques manen sobre el calendari', () => {
  it('la marca de la sèrie guanya a un calendari encès', () => {
    expect(isInInbox(amb({ calendarInboxVisible: true, seriesMark: false }))).toBe(false);
  });

  it("i a un d'apagat, en l'altre sentit", () => {
    expect(isInInbox(amb({ calendarInboxVisible: false, seriesMark: true }))).toBe(true);
  });

  it("l'ocurrència guanya a la sèrie", () => {
    // El cas d'ús sencer: amagues totes les reunions i en recuperes una.
    expect(isInInbox(amb({ seriesMark: false, occurrenceMark: true }))).toBe(true);
    expect(isInInbox(amb({ seriesMark: true, occurrenceMark: false }))).toBe(false);
  });

  it('una marca en un RSS el fa sortir encara que el defecte digui que no', () => {
    expect(isInInbox(amb({ sourceKind: 'rss', occurrenceMark: true }))).toBe(true);
  });
});

describe('una tasca viva guanya a tot', () => {
  it.each([
    ['res més', {}],
    ['una marca que diu que sí', { occurrenceMark: true }],
    ['una marca de sèrie que diu que sí', { seriesMark: true }],
    ['el calendari encès', { calendarInboxVisible: true }],
    [
      'les tres coses alhora',
      { occurrenceMark: true, seriesMark: true, calendarInboxVisible: true },
    ],
  ] as const)('amb %s, no hi surt', (_nom, canvis) => {
    expect(isInInbox(amb({ ...canvis, hasLiveTask: true }))).toBe(false);
  });
});

describe("l'esborrat per defecte no necessita escriure res", () => {
  /**
   * És la prova que justifica tot el disseny de `return_to_inbox`, i val la pena dir per
   * què: la conversió NO deixa cap marca. L'esdeveniment desapareix de la bústia només
   * perquè `hasLiveTask` és cert; en esborrar-se la tasca, aquell cert es torna fals i
   * l'esdeveniment torna sol. Sense cap fila, sense cap neteja, sense res que es pugui
   * quedar penjat.
   */
  it("amb la mateixa entrada, la vida de la tasca és l'única cosa que canvia", () => {
    const abans = amb({ hasLiveTask: false });
    const durant = amb({ hasLiveTask: true });

    expect(isInInbox(abans)).toBe(true);
    expect(isInInbox(durant)).toBe(false);
    // I en esborrar-la es torna a l'estat de partida, que és literalment el mateix objecte.
    expect(isInInbox(abans)).toBe(true);
  });
});
