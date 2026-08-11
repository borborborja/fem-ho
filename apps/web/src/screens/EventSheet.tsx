/**
 * La fitxa d'un esdeveniment.
 *
 * **És la primera vista de detall d'un esdeveniment que té aquest repositori.** Fins ara,
 * al calendari, el text i el punt de color eren purament informatius: clicar-hi no feia
 * res, i `docs/ESTAT.md` marcava aquesta absència com el que bloquejava els adjunts
 * d'esdeveniments. Això n'obre la porta, encara que els adjunts quedin per a una altra
 * fita.
 *
 * QUÈ HI HA I QUÈ NO
 * ------------------
 * Una sola acció: **portar-lo a la bústia o treure'n-el**. No hi ha "esborrar", i no és
 * un oblit: el que ve d'una font subscrita no és nostre —`assertWritable` ho nega amb un
 * 403 a la capa de servei— i el que és d'aquesta casa s'edita des d'on es va crear. La
 * fitxa és per decidir **si això et reclama el dia**, que és l'única pregunta que la
 * bústia fa.
 *
 * L'estat es diu amb paraules i no només amb la vora: "no és a la teva bústia" escrit hi
 * és perquè algú que arriba a la fitxa des d'una cita difuminada entengui què vol dir
 * aquella vora, en comptes d'haver-ho de deduir.
 */

import { getLocale, longDay, shortTime, t } from '@fem-ho/contracts';
import type { EventOccurrence } from '../app/types.js';

export interface EventSheetProps {
  occurrence: EventOccurrence;
  onClose: () => void;
  onToggleInbox: () => void;
}

export function EventSheet({ occurrence, onClose, onToggleInbox }: EventSheetProps) {
  const locale = getLocale();
  const inici = new Date(occurrence.starts_at);
  const quan = occurrence.all_day
    ? longDay(locale, inici)
    : `${longDay(locale, inici)} · ${shortTime(locale, inici)}`;

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

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
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
