/**
 * La identitat d'un correu i la del seu fil.
 *
 * Els dos casos que decideixen tot el disseny —i que en producció es veurien mesos
 * després— són el primer i l'últim: **`UIDVALIDITY` nou i moure de carpeta donen la
 * mateixa clau**, i **l'assumpte no agrupa mai**.
 */

import { describe, expect, it } from 'vitest';
import { messageKey, normalizeMessageId, threadKey } from './mail-identity.js';

const base = {
  messageId: '<abc123@escola.test>',
  sentAt: '2026-08-11T09:00:00.000Z',
  fromAddress: 'secretaria@escola.test',
  subject: 'La factura de març',
};

describe("la clau d'un correu", () => {
  it('el mateix correu dona la mateixa clau encara que canviï de lloc', () => {
    /**
     * **La prova que justifica no fer servir l'UID.** Quan el servidor reindexa,
     * `UIDVALIDITY` canvia i tots els UID que teníem deixen de valer; quan arrossegues un
     * correu entre etiquetes a Gmail, és `COPY`+`EXPUNGE` i l'UID és nou. Amb l'UID com a
     * clau, la primera cosa duplica cada tasca creada des del primer dia i la segona en
     * crea una de nova cada vegada que ordenes la bústia.
     *
     * Aquí no hi ha cap UID ni cap carpeta: la clau surt del correu i prou.
     */
    expect(messageKey(base)).toBe(messageKey({ ...base }));
  });

  it('el plegat de capçalera es desplega', () => {
    expect(messageKey({ ...base, messageId: '<abc123@\r\n escola.test>' })).toBe(messageKey(base));
  });

  it('i les majúscules del local-part NO s’igualen', () => {
    // L'RFC 5322 les fa significatives: `<A@x>` i `<a@x>` són dos correus diferents, i
    // igualar-los faria que el segon no entrés mai.
    expect(messageKey({ ...base, messageId: '<ABC123@escola.test>' })).not.toBe(messageKey(base));
  });

  it('sense Message-ID, el digest és determinista', () => {
    const sense = { ...base, messageId: null };
    expect(messageKey(sense)).toBe(messageKey({ ...sense }));
    expect(messageKey(sense)).toMatch(/^sha:[0-9a-f]{64}$/u);
  });

  it('i canviar qualsevol cosa del correu en canvia el digest', () => {
    const sense = { ...base, messageId: null };
    expect(messageKey({ ...sense, subject: 'Una altra cosa' })).not.toBe(messageKey(sense));
    expect(messageKey({ ...sense, fromAddress: 'altre@escola.test' })).not.toBe(messageKey(sense));
  });

  it('un remitent no pot fer passar el seu correu per un digest nostre', () => {
    /**
     * Sense el prefix, un `Message-ID` amb forma de `sha256` cauria al mateix espai de
     * noms que els nostres digests: es podria xocar amb un correu que ja hem vist, o
     * impedir que n'entrés un de legítim.
     */
    const hostil = messageKey({ ...base, messageId: `<${'a'.repeat(64)}>` });
    expect(hostil.startsWith('mid:')).toBe(true);
    expect(hostil.startsWith('sha:')).toBe(false);
  });

  it('un identificador absurdament llarg es trunca i és estable', () => {
    const llarg = `<${'x'.repeat(4000)}@escola.test>`;
    expect(normalizeMessageId(llarg)).toHaveLength(998);
    expect(messageKey({ ...base, messageId: llarg })).toBe(
      messageKey({ ...base, messageId: llarg }),
    );
  });
});

describe('el fil', () => {
  it("agafa l'arrel de la conversa i no el pare immediat", () => {
    /**
     * Així una branca que arriba **abans** que el seu pare acaba convergint igualment, en
     * comptes de quedar-se com un fil orfe que després ningú ajunta.
     */
    const clau = threadKey({
      own: 'mid:fulla@x',
      references: ['<arrel@x>', '<mig@x>'],
      inReplyTo: '<mig@x>',
    });
    expect(clau).toBe('mid:arrel@x');
  });

  it('sense References, el pare', () => {
    expect(threadKey({ own: 'mid:f@x', references: [], inReplyTo: '<pare@x>' })).toBe('mid:pare@x');
  });

  it('i un correu que no respon res és l’arrel del seu propi fil', () => {
    expect(threadKey({ own: 'mid:sol@x', references: [], inReplyTo: null })).toBe('mid:sol@x');
  });

  it("l'assumpte no agrupa mai", () => {
    /**
     * **És una propietat de seguretat i no una comoditat.** Agrupar per assumpte
     * normalitzat fusionaria correus de remitents diferents que comparteixen assumpte
     * —«Factura», «Reunió»—, i aquí una fusió errònia vol dir que el correu d'un
     * desconegut apareix com a comentari a una tasca teva.
     */
    const un = threadKey({ own: 'mid:un@banc.test', references: [], inReplyTo: null });
    const altre = threadKey({ own: 'mid:altre@desconegut.test', references: [], inReplyTo: null });
    expect(un).not.toBe(altre);
  });
});
