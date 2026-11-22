import { getLocale, longDay, shortTime, t } from '@fem-ho/contracts';
import type { EventOccurrence } from '../app/types.js';

export interface EventSheetProps {
  occurrence: EventOccurrence;
  timezone: string;
  onClose: () => void;
  onToggleInbox: () => void;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

export function EventSheet({
  occurrence,
  timezone,
  onClose,
  onToggleInbox,
  onEdit,
  onDelete,
}: EventSheetProps) {
  const locale = getLocale();
  const inici = new Date(occurrence.starts_at);
  const quan = occurrence.all_day
    ? longDay(locale, inici, 'UTC')
    : `${longDay(locale, inici, timezone)} · ${shortTime(locale, inici, timezone)}`;

  return (
    <div
      data-testid="event-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={occurrence.summary}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 60,
      }}
    >
      <div
        // El vel tanca; el panell no. Sense això, clicar dins el tancaria.
        onClick={(event) => event.stopPropagation()}
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--card-shadow)',
          padding: 22,
          width: 'min(420px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
          {occurrence.summary}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{quan}</div>
        {occurrence.location == null || occurrence.location === '' ? null : (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{occurrence.location}</div>
        )}
        {occurrence.description ? (
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {occurrence.description}
          </div>
        ) : null}

        {/*
          L'estat, amb paraules. La vora discontínua de la graella diu el mateix, però qui
          hi arriba per primera vegada no té per què saber-ho.
        */}
        <div
          data-testid="event-sheet-state"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--ink-soft)',
            background: 'var(--tag-bg)',
            borderRadius: 10,
            padding: '8px 10px',
          }}
        >
          {occurrence.in_inbox ? t('calendar.event.inInbox') : t('calendar.event.notInInbox')}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            paddingTop: 4,
          }}
        >
          {onEdit ? (
            <button type="button" className="plou-btn" onClick={onEdit}>
              {t('calendar.google.edit')}
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" className="plou-btn plou-btn-ghost" onClick={onDelete}>
              {t('nav.delete')}
            </button>
          ) : null}
          <button
            type="button"
            className="plou-btn plou-btn-ghost"
            data-testid="event-sheet-close"
            onClick={onClose}
          >
            {t('nav.cancel')}
          </button>
          <button
            type="button"
            className="plou-btn plou-btn-primary"
            data-testid="event-sheet-toggle"
            onClick={onToggleInbox}
          >
            {occurrence.in_inbox ? t('calendar.event.fromInbox') : t('calendar.event.toInbox')}
          </button>
        </div>
      </div>
    </div>
  );
}
