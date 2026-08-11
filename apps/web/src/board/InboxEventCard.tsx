/**
 * Un esdeveniment d'una font, dins de la bústia.
 *
 * **Ha de semblar clarament una altra cosa que una tasca, i això és el que fa que la
 * regla 7 esmenada serveixi de res.** La regla passa de "els esdeveniments no surten mai
 * al kanban" a "no tenen mai estat de kanban ni s'arrosseguen entre columnes: a la bústia
 * hi poden sortir com a font, mai com a targeta de tasca". Si això es dibuixés com una
 * `BoardCard`, la distinció seria una nota al peu d'un document i no una cosa que es veu.
 *
 * Per això, i a diferència d'una targeta de tasca: **sense casella de fet, sense fletxa
 * de moure, i sense arrossegar**. Les tres coses que es poden fer amb una tasca no
 * existeixen aquí, perquè cap d'elles vol dir res sobre una cita.
 *
 * COM ES DIFERENCIA, I PER QUÈ NO AMB TRANSPARÈNCIA
 * -------------------------------------------------
 * La temptació era difuminar-la —opacitat baixa, text tènue— i és exactament el que **no**
 * s'ha de fer. `docs/04` §8 reserva `--ink-faint` per a text decoratiu i marcadors de
 * posició, i diu que Fem-ho no l'ha de fer servir per a res que calgui llegir. Una cita
 * de la bústia és informació que has de llegir: si no es llegeix bé, no serveix.
 *
 * O sigui que la diferència va a **la superfície i la forma**, no al contrast: fons de
 * `--tag-bg` en comptes de `--card-bg`, **vora discontínua** —que és el senyal universal
 * de "això encara no és teu"—, i l'hora primer de tot. El resum es queda a `--ink`, igual
 * de llegible que a qualsevol targeta.
 *
 * Un detall que ho remata: la vora discontínua sobreviu al tema fosc i al mode d'alt
 * contrast, mentre que una opacitat del 50% desapareix o es torna il·legible segons el
 * fons. La forma és més robusta que el color.
 */

import { getLocale, shortTime, t } from '@fem-ho/contracts';
import type { InboxEvent } from '../app/types.js';
import { SourceIcon } from './SourceIcon.js';

export interface InboxEventCardProps {
  event: InboxEvent;
  /** El color de l'àmbit d'on ve, per lligar-lo amb la resta de la columna. */
  color?: string | undefined;
  /** Fer-ne una tasca. Arriba a la fase que la implementa; sense ella, el botó no surt. */
  onToTask?: (() => void) | undefined;
  /** Treure'l de la bústia. El mateix. */
  onRemove?: (() => void) | undefined;
}

/** La clau que identifica un esdeveniment de manera estable entre refrescos. */
export function eventKey(event: InboxEvent): string {
  return `${event.calendar_id}:${event.uid}:${event.recurrence_id ?? ''}`;
}

export function InboxEventCard({ event, color, onToTask, onRemove }: InboxEventCardProps) {
  const locale = getLocale();
  const hora = event.all_day
    ? t('inbox.event.allDay')
    : shortTime(locale, new Date(event.starts_at));

  return (
    <div
      data-kind="event"
      data-testid={`inbox-event-${eventKey(event)}`}
      style={{
        background: 'var(--tag-bg)',
        // Discontínua: el senyal de "ve de fora i encara no és feina teva".
        border: '1px dashed var(--card-border)',
        borderRadius: 12,
        padding: '9px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        {color === undefined ? null : (
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: `var(${color})`,
              flexShrink: 0,
              alignSelf: 'center',
            }}
          />
        )}
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', flexShrink: 0 }}>
          {hora}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', minWidth: 0 }}>
          {event.summary}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/*
          D'on ve. Sense això, una cita d'un calendari de l'escola i una d'un titular
          d'RSS es veuen igual, i la primera pregunta de qualsevol és "d'on ha sortit
          això" — que és la que fa que la gent apagui les fonts en comptes d'ajustar-les.

          La icona va al costat del nom i no a la primera línia: aquí la pregunta és
          exactament aquesta, i posar-la amunt competiria amb l'hora.
        */}
        <SourceIcon kind={event.source_kind} />
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
          {event.calendar_name}
        </span>
        {onToTask === undefined ? null : (
          <button
            type="button"
            className="plou-btn plou-btn-ghost"
            data-testid={`inbox-event-totask-${eventKey(event)}`}
            onClick={onToTask}
            style={{ fontSize: 10.5, padding: '3px 9px' }}
          >
            {t('inbox.event.toTask')}
          </button>
        )}
        {onRemove === undefined ? null : (
          <button
            type="button"
            className="plou-btn plou-btn-ghost"
            data-testid={`inbox-event-remove-${eventKey(event)}`}
            onClick={onRemove}
            style={{ fontSize: 10.5, padding: '3px 9px' }}
          >
            {t('inbox.event.remove')}
          </button>
        )}
      </div>
    </div>
  );
}
