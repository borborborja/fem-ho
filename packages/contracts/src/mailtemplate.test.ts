/**
 * `renderMailTitle`.
 *
 * És **l'únic punt on text que escriu un desconegut es converteix en una cadena desada i
 * mostrada**. La major part d'aquests casos no són sobre plantilles: són sobre què fa
 * aquesta funció amb un assumpte hostil.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAIL_TEMPLATE,
  MAIL_TITLE_MAX,
  renderMailTitle,
  unknownMailVars,
  type MailTemplateVars,
} from './mailtemplate.js';

const BASE: MailTemplateVars = {
  subject: 'La factura de març',
  from_name: 'Escola',
  from_email: 'secretaria@escola.test',
  from: 'Escola',
  date: '11/08/2026',
  folder: 'INBOX/Escola',
  account: 'Personal',
};

const amb = (canvis: Partial<MailTemplateVars>): MailTemplateVars => ({ ...BASE, ...canvis });
const SENSE = '(sense assumpte)';

describe('el cas normal', () => {
  it('substitueix el que hi ha', () => {
    expect(renderMailTitle('{{from}} - {{subject}}', BASE, SENSE)).toBe(
      'Escola - La factura de març',
    );
  });

  it('i el defecte és només l’assumpte', () => {
    expect(renderMailTitle(DEFAULT_MAIL_TEMPLATE, BASE, SENSE)).toBe('La factura de març');
  });

  it('`from` col·lapsa nom-o-adreça, que és el condicional que no cal', () => {
    expect(renderMailTitle('{{from}}', amb({ from: 'algu@example.test' }), SENSE)).toBe(
      'algu@example.test',
    );
  });
});

describe('una variable desconeguda es queda literal', () => {
  it('surt escrita al títol en comptes de desaparèixer', () => {
    // Un buit silenciós faria que una errata sembli un camp buit per sempre.
    expect(renderMailTitle('{{remitent}} - {{subject}}', BASE, SENSE)).toBe(
      '{{remitent}} - La factura de març',
    );
  });

  it('i la pantalla les pot marcar', () => {
    expect(unknownMailVars('{{remitent}} {{subject}} {{asunto}}')).toEqual([
      'asunto',
      'remitent',
    ]);
    expect(unknownMailVars('{{from}} - {{subject}}')).toEqual([]);
  });
});

describe('mai un títol buit', () => {
  it('un assumpte buit cau al recanvi', () => {
    expect(renderMailTitle(DEFAULT_MAIL_TEMPLATE, amb({ subject: '' }), SENSE)).toBe(SENSE);
  });

  it('i un que només són espais, també', () => {
    expect(renderMailTitle(DEFAULT_MAIL_TEMPLATE, amb({ subject: '   \t ' }), SENSE)).toBe(SENSE);
  });

  it('i si fins i tot el recanvi és buit, queda alguna cosa', () => {
    /**
     * `createTask` rebutja un títol buit amb un 422. Que la ingesta hi arribés seria un
     * correu que desapareix sense explicació.
     */
    expect(renderMailTitle('{{subject}}', amb({ subject: '' }), '')).not.toBe('');
  });
});

describe('el que arriba de fora i no s’ha de veure en un títol', () => {
  it('el plegat de capçalera es desplega', () => {
    // Un assumpte llarg arriba partit amb CRLF + espai. Sense això, el títol porta salts.
    const plegat = amb({ subject: 'Una cosa\r\n molt llarga\r\n\tencara més' });
    expect(renderMailTitle('{{subject}}', plegat, SENSE)).toBe('Una cosa molt llarga encara més');
  });

  it('una injecció de capçalera no sobreviu', () => {
    const dolent = amb({ subject: 'Hola\r\nBcc: victima@example.test' });
    const titol = renderMailTitle('{{subject}}', dolent, SENSE);
    expect(titol).not.toContain('\r');
    expect(titol).not.toContain('\n');
  });

  it('les marques bidireccionals se’n van', () => {
    /**
     * `U+202E` reordena el que es llegeix sense canviar el que hi ha: és com
     * `factura.txt.exe` es fa veure `factura.exe.txt`.
     */
    const truc = amb({ subject: 'factura‮gpj.exe' });
    expect(renderMailTitle('{{subject}}', truc, SENSE)).not.toContain('‮');
  });

  it('i les d’amplada zero també', () => {
    // Dos títols que es veuen iguals i no ho són.
    const invisible = amb({ subject: 'Fact​ura' });
    expect(renderMailTitle('{{subject}}', invisible, SENSE)).toBe('Fact ura');
  });

  it('un assumpte de 4 KiB es talla', () => {
    const llarg = amb({ subject: 'x'.repeat(4096) });
    const titol = renderMailTitle('{{subject}}', llarg, SENSE);
    expect(titol.length).toBeLessThanOrEqual(MAIL_TITLE_MAX);
    expect(titol.endsWith('…')).toBe(true);
  });
});

describe('una sola passada', () => {
  it('un assumpte que ÉS una variable no s’expandeix', () => {
    /**
     * **La prova que justifica tot el disseny.** Si el motor reescanegés el resultat, un
     * remitent podria posar `{{from_email}}` a l'assumpte i fer-lo expandir. Amb una
     * passada sobre la plantilla, el valor substituït no es torna a mirar mai.
     */
    const hostil = amb({ subject: '{{from_email}}' });
    expect(renderMailTitle('{{subject}}', hostil, SENSE)).toBe('{{from_email}}');
  });

  it('i tampoc encadenant-ho', () => {
    const hostil = amb({ subject: '{{subject}}' });
    expect(renderMailTitle('{{subject}} {{subject}}', hostil, SENSE)).toBe(
      '{{subject}} {{subject}}',
    );
  });
});

describe('plantilles mal escrites', () => {
  it.each([
    ['{{ sense tancar', '{{ sense tancar'],
    ['{{}}', '{{}}'],
    ['sense cap variable', 'sense cap variable'],
    ['{{ subject }}', 'La factura de març'],
  ])('%s → %s', (template, esperat) => {
    expect(renderMailTitle(template, BASE, SENSE)).toBe(esperat);
  });
});
