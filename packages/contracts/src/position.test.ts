/**
 * docs/13 M4 · comprovació de la fita: `test: tasks + positions`.
 *
 * "Inclou una prova de mil moviments aleatoris que verifica que l'ordre és sempre el
 * correcte" i que "mil moviments consecutius no degeneren les claus de posició".
 *
 * Les claus **no s'escriuen a mà**: totes surten de `generatePosition`. Una clau
 * inventada com `"a"` no és vàlida —la capçalera 'a' anuncia dos caràcters— i provar
 * amb claus impossibles només demostra coses sobre claus impossibles.
 */

import { describe, expect, it } from 'vitest';
import {
  ALPHABET,
  InvalidPositionError,
  comparePositions,
  generatePosition,
  generatePositions,
} from './position.js';

/** Generador determinista, perquè una fallada es pugui reproduir exactament. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32. No cal qualitat criptogràfica: només repartir.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const MIN_DIGIT = ALPHABET[0]!;

/** La part fraccionària d'una clau, saltant-se la capçalera i els seus dígits. */
function fractionOf(key: string): string {
  const head = key[0]!;
  const length =
    head >= 'a' && head <= 'z'
      ? head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
      : 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  return key.slice(length);
}

describe("l'alfabet", () => {
  it('està en ordre ASCII estricte', () => {
    // Si això falla, l'ordre de les claus i el de la base de dades divergeixen i les
    // targetes es desordenen sense cap error visible.
    for (let i = 1; i < ALPHABET.length; i += 1) {
      expect(ALPHABET[i - 1]! < ALPHABET[i]!, `${ALPHABET[i - 1]} < ${ALPHABET[i]}`).toBe(true);
    }
  });
});

describe('generatePosition', () => {
  it('la primera targeta de la columna', () => {
    const primera = generatePosition(null, null, seededRandom(1));
    expect(primera.length).toBeGreaterThan(1);
  });

  it('sempre cau estrictament entre els veïns', () => {
    const random = seededRandom(42);
    const a = generatePosition(null, null, random);
    const b = generatePosition(a, null, random);
    const entremig = generatePosition(a, b, random);

    expect(comparePositions(a, entremig)).toBe(-1);
    expect(comparePositions(entremig, b)).toBe(-1);
  });

  it('sap inserir abans de la primera', () => {
    const random = seededRandom(8);
    const primera = generatePosition(null, null, random);
    const abans = generatePosition(null, primera, random);
    expect(comparePositions(abans, primera)).toBe(-1);
  });

  it('el jitter fa que dues insercions al mateix buit no coincideixin', () => {
    // Aquest és el motiu pel qual D3 el demana: dos clients offline que insereixin al
    // mateix lloc han de produir claus DIFERENTS, o l'empat el resol cada client a la
    // seva manera i acaben veient ordres distints.
    const base = seededRandom(3);
    const a = generatePosition(null, null, base);
    const b = generatePosition(a, null, base);

    const clientA = generatePosition(a, b, seededRandom(1));
    const clientB = generatePosition(a, b, seededRandom(999));

    expect(clientA).not.toBe(clientB);
    for (const clau of [clientA, clientB]) {
      expect(comparePositions(a, clau)).toBe(-1);
      expect(comparePositions(clau, b)).toBe(-1);
    }
  });

  it('rebutja un rang invertit en comptes de tornar una clau equivocada', () => {
    const random = seededRandom(2);
    const a = generatePosition(null, null, random);
    const b = generatePosition(a, null, random);
    expect(() => generatePosition(b, a, random)).toThrow(InvalidPositionError);
    expect(() => generatePosition(a, a, random)).toThrow(InvalidPositionError);
  });
});

describe('generatePositions', () => {
  it('en genera N en ordre', () => {
    const claus = generatePositions(10, null, null, seededRandom(3));
    expect(claus).toHaveLength(10);
    for (let i = 1; i < claus.length; i += 1) {
      expect(comparePositions(claus[i - 1]!, claus[i]!)).toBe(-1);
    }
  });
});

describe('AQUESTA és la de docs/13: mil moviments aleatoris', () => {
  it("l'ordre és sempre el correcte i les claus no degeneren", () => {
    const random = seededRandom(20260805);

    interface Targeta {
      id: number;
      position: string;
    }
    const columna: Targeta[] = generatePositions(20, null, null, random).map((position, id) => ({
      id,
      position,
    }));

    for (let moviment = 0; moviment < 1000; moviment += 1) {
      // S'ordena com ho faria la base de dades abans de decidir els veïns.
      columna.sort((x, y) => comparePositions(x.position, y.position));

      const desde = Math.floor(random() * columna.length);
      const fins = Math.floor(random() * columna.length);

      const [targeta] = columna.splice(desde, 1);
      if (targeta === undefined) continue;

      const insercio = Math.min(fins, columna.length);
      const abans = insercio === 0 ? null : (columna[insercio - 1]?.position ?? null);
      const despres = insercio >= columna.length ? null : (columna[insercio]?.position ?? null);

      targeta.position = generatePosition(abans, despres, random);
      columna.splice(insercio, 0, targeta);

      // La invariant, a cada moviment: l'ordre que dona la base de dades ha de ser
      // exactament el que la interfície acaba de construir.
      const segonsBase = [...columna]
        .sort((x, y) => comparePositions(x.position, y.position))
        .map((t) => t.id);
      expect(segonsBase, `moviment ${moviment}`).toEqual(columna.map((t) => t.id));
    }

    // Cap targeta s'ha perdut ni duplicat.
    expect(new Set(columna.map((t) => t.id)).size).toBe(20);

    const maxLongitud = Math.max(...columna.map((t) => t.position.length));
    expect(maxLongitud, `la clau més llarga fa ${maxLongitud} caràcters`).toBeLessThan(40);
  });

  it('afegir al final mil vegades gairebé no allarga les claus', () => {
    // AQUEST és el patró real: escriure tasques una darrere l'altra al peu d'una
    // columna. És per fer-lo barat que la part entera porta capçalera de llargada:
    // sense ella aquesta mateixa prova donava claus de 197 caràcters.
    const random = seededRandom(5);
    let anterior: string | null = null;
    let maxLongitud = 0;

    for (let i = 0; i < 1000; i += 1) {
      const nova: string = generatePosition(anterior, null, random);
      if (anterior !== null) expect(comparePositions(anterior, nova)).toBe(-1);
      maxLongitud = Math.max(maxLongitud, nova.length);
      anterior = nova;
    }

    expect(maxLongitud, `la clau més llarga fa ${maxLongitud} caràcters`).toBeLessThan(12);
  });

  it('mil insercions al principi tampoc degeneren', () => {
    // Simètric de l'afegit al final: la capçalera en majúscules fa que anar cap avall
    // també sigui comptar, no partir per la meitat.
    const random = seededRandom(9);
    let primera = generatePosition(null, null, random);
    let maxLongitud = primera.length;

    for (let i = 0; i < 1000; i += 1) {
      const nova = generatePosition(null, primera, random);
      expect(comparePositions(nova, primera)).toBe(-1);
      maxLongitud = Math.max(maxLongitud, nova.length);
      primera = nova;
    }

    expect(maxLongitud, `la clau més llarga fa ${maxLongitud} caràcters`).toBeLessThan(12);
  });

  it("dins d'un buit ACOTAT creixen, i això és inevitable", () => {
    // El pitjor cas possible: inserir sempre dins del mateix buit, que es va estrenyent.
    // Mil insercions el divideixen mil vegades, o sigui que calen ~1000 bits per
    // distingir-les: 1000 / log2(62) ≈ 168 caràcters. NO és degeneració, és el mínim
    // teòric — un algorisme que ho fes amb menys estaria perdent ordre.
    //
    // La prova hi és per fixar que ens hi acostem i no ens n'allunyem: si algun canvi
    // fa que passi de 250, és que s'ha introduït creixement de debò.
    const random = seededRandom(11);
    const inici = generatePosition(null, null, random);
    const fi = generatePosition(inici, null, random);

    let anterior = inici;
    let maxLongitud = 0;
    for (let i = 0; i < 1000; i += 1) {
      const nova = generatePosition(anterior, fi, random);
      expect(comparePositions(anterior, nova)).toBe(-1);
      expect(comparePositions(nova, fi)).toBe(-1);
      maxLongitud = Math.max(maxLongitud, nova.length);
      anterior = nova;
    }

    expect(maxLongitud, `la clau més llarga fa ${maxLongitud} caràcters`).toBeLessThan(250);
  });
});

describe('la invariant: cap fracció acaba amb el dígit més baix', () => {
  it('en desenes de milers de claus generades', () => {
    // Si una FRACCIÓ acabés amb el dígit més baix, no s'hi podria inserir res just
    // abans i la targeta seria ininserible sense cap error visible. Va passar de
    // veritat mentre s'escrivia això, dues vegades.
    //
    // Als ENTERS sí que hi val acabar amb el dígit més baix: davant de "b00" hi cap
    // "az" seguit de fracció, que és lexicogràficament menor.
    const random = seededRandom(777);
    let comprovades = 0;

    const claus = generatePositions(500, null, null, random);
    for (const clau of claus) {
      const fraccio = fractionOf(clau);
      expect(
        fraccio === '' || !fraccio.endsWith(MIN_DIGIT),
        `la fracció de "${clau}" acaba amb "${MIN_DIGIT}"`,
      ).toBe(true);
      comprovades += 1;
    }

    for (let i = 1; i < claus.length; i += 1) {
      for (let t = 0; t < 20; t += 1) {
        const entremig = generatePosition(claus[i - 1]!, claus[i]!, random);
        const fraccio = fractionOf(entremig);
        expect(
          fraccio === '' || !fraccio.endsWith(MIN_DIGIT),
          `la fracció de "${entremig}" acaba amb "${MIN_DIGIT}"`,
        ).toBe(true);
        comprovades += 1;
      }
    }

    expect(comprovades).toBeGreaterThan(10_000);
  });

  it("inserir repetidament entre dues claus consecutives no trenca mai l'ordre", () => {
    // La cerca que va destapar que entre "0" i "00" no hi cabia res. Ara es fa sobre
    // claus generades de veritat, i el que s'exigeix és que el resultat hi caigui
    // sempre entremig.
    const random = seededRandom(4242);
    const claus = generatePositions(200, null, null, random);

    for (let i = 1; i < claus.length; i += 1) {
      let esquerra = claus[i - 1]!;
      const dreta = claus[i]!;
      for (let t = 0; t < 10; t += 1) {
        const nova = generatePosition(esquerra, dreta, random);
        expect(comparePositions(esquerra, nova), `${esquerra} < ${nova}`).toBe(-1);
        expect(comparePositions(nova, dreta), `${nova} < ${dreta}`).toBe(-1);
        esquerra = nova;
      }
    }
  });
});
