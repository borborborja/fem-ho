/**
 * Un correu dins de la bústia.
 *
 * **Tres coses a la vegada, i cap d'elles és igual que les altres dues.** `docs/02` vol que
 * una tasca, una cita i un correu no s'hagin de llegir per saber què són:
 *
 * | | Tasca | Cita | Correu |
 * | --- | --- | --- | --- |
 * | Vora | sòlida | **discontínua** | sòlida + **regle esquerre** |
 * | Primera línia | títol | **hora** | **remitent** |
 * | Casella i arrossegar | sí | no | **no** |
 *
 * El regle esquerre és el que ho fa reconeixible d'una ullada sense tocar el contrast: la
 * cita és discontínua perquè «encara no és teva», i el correu és sòlid perquè **sí que ha
 * arribat de debò** —el que no ha passat encara és que decideixis què en fas.
 *
 * I com a la targeta de cita, **la diferència no va al contrast**. `docs/04` §8 reserva
 * `--ink-faint` per al que no cal llegir, i un remitent cal llegir-lo: és exactament la
 * dada que et fa decidir si allò val la pena.
 *
 * **El remitent és el de debò i no el de la plantilla.** Surt de `from_address`, que ve del
 * correu i no del títol que hagi sortit de `title_template`: és el que fa que ningú es
 * pugui fer passar per un altre escrivint-ho a l'assumpte.
 */

import { t } from '@fem-ho/contracts';
import type { InboxMail } from '../app/types.js';
import { SourceIcon } from './SourceIcon.js';

export interface InboxMailCardProps {
  mail: InboxMail;
  /** El color de l'àmbit on aniria, per lligar-lo amb la resta de la columna. */
  color?: string | undefined;
  /** Fer-ne una tasca. Sense la funció, el botó no surt. */
  onToTask?: (() => void) | undefined;
  /** Descartar-lo. El mateix. */
  onDismiss?: (() => void) | undefined;
}

export function InboxMailCard({ mail, color, onToTask, onDismiss }: InboxMailCardProps) {
  const qui = mail.from_name ?? mail.from_address ?? t('inbox.mail.unknownSender');

  return (
    <div
      data-kind="mail"
      data-testid={`inbox-mail-${mail.id}`}
      style={{
        background: 'var(--tag-bg)',
        border: '1px solid var(--card-border)',
        // El regle: sòlid, del color de l'àmbit si n'hi ha.
        borderLeft: `3px solid ${color === undefined ? 'var(--card-border)' : `var(${color})`}`,
        borderRadius: 12,
        padding: '9px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Primera línia: **el remitent**. És el que et fa decidir. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', flexShrink: 0 }}>
          {qui}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', minWidth: 0 }}>
          {mail.subject ?? t('inbox.mail.noSubject')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* La mateixa icona i el mateix component que a les cites i a les tasques. */}
        <SourceIcon kind={mail.source_kind} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--ink-soft)',
            minWidth: 0,
            flex: 1,
          }}
        >
          {mail.account_name ?? mail.folder ?? ''}
        </span>
        {onToTask === undefined ? null : (
          <button
            type="button"
            className="plou-btn plou-btn-ghost"
            data-testid={`inbox-mail-totask-${mail.id}`}
            onClick={onToTask}
            style={{ fontSize: 10.5, padding: '3px 9px' }}
          >
            {t('inbox.event.toTask')}
          </button>
        )}
        {onDismiss === undefined ? null : (
          <button
            type="button"
            className="plou-btn plou-btn-ghost"
            data-testid={`inbox-mail-dismiss-${mail.id}`}
            onClick={onDismiss}
            style={{ fontSize: 10.5, padding: '3px 9px' }}
          >
            {t('inbox.event.remove')}
          </button>
        )}
      </div>
    </div>
  );
}
