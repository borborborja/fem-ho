/**
 * El pany, amb totes les maneres de trencar-lo.
 *
 * Són poques regles i cada una té el seu cas de trencar-se; escrites totes, perquè la que
 * faltés seria la que un dia deixa una persona i un agent editant la mateixa tasca sense que
 * cap dels dos ho sàpiga.
 */

import { describe, expect, it } from 'vitest';
import { refuseTaskWrite, type TaskWriteState } from './ai-writes.js';

const HERMES = { kind: 'agent' as const, agentId: 'hermes' };
const BORJA = { kind: 'user' as const };
const FINS = '2026-08-12T11:00:00.000Z';

const delegada = (over: Partial<TaskWriteState> = {}): TaskWriteState => ({
  aiMode: 'delegated',
  lease: null,
  ...over,
});

const sevaLease = { agentId: 'hermes', userId: 'borja', expiresAt: FINS };
const altraLease = { agentId: 'codex', userId: 'borja', expiresAt: FINS };

describe('un agent només toca el que és seu i està reservat', () => {
  it('amb la seva reserva, endavant', () => {
    expect(refuseTaskWrite(HERMES, delegada({ lease: sevaLease }), 'move')).toBeNull();
  });

  it('sense reserva, no —i se li diu què ha de cridar', () => {
    expect(refuseTaskWrite(HERMES, delegada(), 'move')).toEqual({ reason: 'not-claimed' });
  });

  it("amb la reserva d'un altre agent, tampoc", () => {
    expect(refuseTaskWrite(HERMES, delegada({ lease: altraLease }), 'move')).toMatchObject({
      reason: 'claimed-by-other',
      agentId: 'codex',
      until: FINS,
    });
  });

  it('i en una tasca que ha assumit una persona, mai —encara que la tingui reservada', () => {
    /**
     * **Aquest és l'avís de la reclamació.** Un protocol de consulta no té timbre: el que
     * fa d'avís és que la següent cosa que provi digui exactament què ha passat.
     */
    expect(refuseTaskWrite(HERMES, { aiMode: 'manual', lease: sevaLease }, 'move')).toEqual({
      reason: 'human-took-over',
    });
  });

  it('editar-la també demana tenir-la: escriure a cegues és el mateix mal', () => {
    expect(refuseTaskWrite(HERMES, delegada(), 'edit')).toEqual({ reason: 'not-claimed' });
  });
});

describe('una persona no treu una tasca de sota un agent', () => {
  it('bloquejada, no es pot moure —i es diu qui la té i fins quan', () => {
    expect(refuseTaskWrite(BORJA, delegada({ lease: sevaLease }), 'move')).toEqual({
      reason: 'locked',
      agentId: 'hermes',
      until: FINS,
    });
  });

  it('ni reclamar', () => {
    expect(refuseTaskWrite(BORJA, delegada({ lease: sevaLease }), 'take-over')?.reason).toBe(
      'locked',
    );
  });

  it('desbloquejada, sí', () => {
    expect(refuseTaskWrite(BORJA, delegada(), 'take-over')).toBeNull();
  });

  it('editar-la sí que es pot, encara que estigui bloquejada', () => {
    /**
     * Afegir instruccions no li treu la tasca de sota a ningú. El que es protegeix és **on
     * és i de qui és**, no cada caràcter del títol: si editar també es bloquegés, la manera
     * de donar-li context a l'agent seria esperar mitja hora.
     */
    expect(refuseTaskWrite(BORJA, delegada({ lease: sevaLease }), 'edit')).toBeNull();
  });

  it("una reserva d'una persona no bloqueja ningú", () => {
    // Les reserves de persona no existeixen al producte, i el dia que existeixin no han de
    // fer de pany: el pany diu «hi ha un agent a dins».
    const humana = { agentId: null, userId: 'altre', expiresAt: FINS };
    expect(refuseTaskWrite(BORJA, delegada({ lease: humana }), 'move')).toBeNull();
  });
});
