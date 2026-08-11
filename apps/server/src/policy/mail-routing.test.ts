/**
 * `routeMail`.
 *
 * El que aquestes proves fixen és **l'ordre dels quatre nivells**, que és l'única part
 * difícil. Un ordre canviat compila, passa el camí feliç, i es manifesta com tasques
 * duplicades o com una resposta que n'obre una de nova — les dues coses que fan una funció
 * així inservible.
 */

import { describe, expect, it } from 'vitest';
import { folderDepth, normalizeFolder, routeMail, type MailRule } from './mail-routing.js';

const regla = (canvis: Partial<MailRule> = {}): MailRule => ({
  id: 'r1',
  folder: 'INBOX',
  action: 'inbox',
  inboxVisible: true,
  position: 'a1',
  enabled: true,
  ...canvis,
});

const base = {
  folders: ['INBOX'],
  delimiter: '/',
  rules: [regla()],
  alreadyIngested: false,
  threadTaskId: null,
};

describe('el cas normal', () => {
  it('la regla diu què se’n fa', () => {
    expect(routeMail(base).kind).toBe('inbox');
    expect(routeMail({ ...base, rules: [regla({ action: 'task' })] }).kind).toBe('task');
  });

  it('i una carpeta sense regla no es llegeix', () => {
    // Cap fila, cap descàrrega: el correu d'algú és seu.
    const fora = routeMail({ ...base, folders: ['INBOX/Altres'] });
    expect(fora).toEqual({ kind: 'skip', reason: 'no-rule' });
  });

  it('una regla apagada no compta', () => {
    expect(routeMail({ ...base, rules: [regla({ enabled: false })] }).kind).toBe('skip');
  });
});

describe('ja ingerit guanya a tot', () => {
  it('és la línia que salva un UIDVALIDITY rotat', () => {
    /**
     * Quan el servidor reindexa, tornem a veure la bústia sencera. Sense aquest nivell,
     * cada tasca creada des del primer dia es duplicaria.
     */
    const res = routeMail({
      ...base,
      alreadyIngested: true,
      threadTaskId: 'task-1',
      rules: [regla({ action: 'task' })],
    });
    expect(res).toEqual({ kind: 'skip', reason: 'duplicate' });
  });
});

describe('una resposta comenta, i no obre res', () => {
  it('guanya fins i tot sobre una regla que diu «fes-ne una tasca»', () => {
    // Si no, el fil acabaria partit en dues coses a fer.
    const res = routeMail({
      ...base,
      threadTaskId: 'task-1',
      rules: [regla({ action: 'task' })],
    });
    expect(res).toEqual({ kind: 'comment', taskId: 'task-1' });
  });
});

describe('la més específica guanya', () => {
  it('l’etiqueta de Gmail contra All Mail', () => {
    /**
     * **El cas que decideix el disseny.** A Gmail cada correu és a `[Gmail]/All Mail` i a
     * la seva etiqueta alhora; si algú mapa les dues, cal una regla determinista.
     */
    const res = routeMail({
      ...base,
      folders: ['[Gmail]/All Mail', 'INBOX/Feina/Clients'],
      rules: [
        regla({ id: 'tot', folder: '[Gmail]/All Mail', action: 'inbox' }),
        regla({ id: 'clients', folder: 'INBOX/Feina/Clients', action: 'task' }),
      ],
    });
    expect(res.kind).toBe('task');
    expect(res.kind === 'task' && res.rule.id).toBe('clients');
  });

  it('i amb la mateixa profunditat desempata la posició', () => {
    const res = routeMail({
      ...base,
      folders: ['A', 'B'],
      rules: [
        regla({ id: 'segona', folder: 'B', position: 'b0' }),
        regla({ id: 'primera', folder: 'A', position: 'a0' }),
      ],
    });
    expect(res.kind === 'inbox' && res.rule.id).toBe('primera');
  });

  it('el delimitador el diu el servidor: Dovecot fa servir un punt', () => {
    expect(folderDepth('INBOX.Feina.Clients', '.')).toBe(3);
    expect(folderDepth('INBOX/Feina/Clients', '/')).toBe(3);
    // Un servidor sense jerarquia dona delimitador buit i tot és profunditat 1.
    expect(folderDepth('Qualsevol', '')).toBe(1);
  });
});

describe('els noms de carpeta', () => {
  it('INBOX és insensible a majúscules i la resta no', () => {
    /**
     * L'RFC 3501 només ho diu d'`INBOX`. Abaixar-ho tot fusionaria `Feina` i `feina`, que
     * en un servidor són dues carpetes i poden anar a dos projectes diferents.
     */
    expect(normalizeFolder('inbox')).toBe('INBOX');
    expect(normalizeFolder('InBoX')).toBe('INBOX');
    expect(normalizeFolder('Feina')).toBe('Feina');
    expect(normalizeFolder('feina')).not.toBe(normalizeFolder('Feina'));
  });

  it('i per això una regla en minúscules encaixa amb la safata', () => {
    expect(
      routeMail({ ...base, folders: ['inbox'], rules: [regla({ folder: 'INBOX' })] }).kind,
    ).toBe('inbox');
  });
});
