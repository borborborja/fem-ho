import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getLocale, shortTime, t } from '@fem-ho/contracts';
import { failureText } from '../app/api.js';
import type { CalendarTaskSuggestion } from '../app/types.js';
import { CalendarOriginBadge } from './SourceIcon.js';

export type CalendarStart = 'now' | 'planned';

export function CalendarSuggestionCard({
  item,
  active,
  timezone,
  onStart,
  onDecline,
}: {
  item: CalendarTaskSuggestion;
  active: boolean;
  timezone?: string | undefined;
  onStart: (start: CalendarStart) => void;
  onDecline: () => void;
}) {
  const locale = getLocale();
  const start = shortTime(locale, new Date(item.starts_at), timezone);
  const end = shortTime(locale, new Date(item.ends_at), timezone);
  const when = item.all_day
    ? t('calendarSuggestions.allDay')
    : start === end
      ? start
      : `${start}–${end}`;

  return (
    <article
      aria-label={item.title}
      className="calendar-suggestion-card"
      data-testid="calendar-suggestion"
      data-calendar-active={active}
    >
      <div className="calendar-suggestion-meta">
        <CalendarOriginBadge />
        <span>{active ? t('calendarSuggestions.suggested') : item.calendar_name}</span>
        <span>{when}</span>
      </div>
      <h3>{item.title}</h3>
      {(item.can_start || active) && (
        <div className="calendar-suggestion-actions">
          {item.can_start && (
            <>
              <button
                type="button"
                className="plou-btn plou-btn-ghost"
                onClick={() => onStart('now')}
              >
                {t('calendarSuggestions.startNow')}
              </button>
              {active && (
                <button
                  type="button"
                  className="plou-btn plou-btn-ghost"
                  onClick={() => onStart('planned')}
                >
                  {t('calendarSuggestions.startPlanned', { time: start })}
                </button>
              )}
            </>
          )}
          {active && (
            <button type="button" className="plou-btn plou-btn-ghost" onClick={onDecline}>
              {t('calendarSuggestions.decline')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function CalendarSuggestionStartDialog({
  item,
  start,
  timezone,
  taskTypes,
  onClose,
  onStart,
}: {
  item: CalendarTaskSuggestion;
  start: CalendarStart;
  timezone?: string | undefined;
  taskTypes: { id: string; name: string }[];
  onClose: () => void;
  onStart: (typeId?: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [taskType, setTaskType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => ref.current?.showModal(), []);

  const confirm = async () => {
    setBusy(true);
    try {
      await onStart(taskType || undefined);
      onClose();
    } catch (cause) {
      setError(failureText(cause));
      setBusy(false);
    }
  };

  return createPortal(
    <dialog
      ref={ref}
      className="chrono-dialog"
      aria-labelledby="calendar-suggestion-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void confirm();
        }}
      >
        <h2 id="calendar-suggestion-confirm-title">
          {item.requires_share_confirmation
            ? t('calendarSuggestions.shareTitle')
            : t('board.column.doing')}
        </h2>
        <p>{item.title}</p>
        {item.requires_share_confirmation && <p>{t('calendarSuggestions.shareHint')}</p>}
        {item.requires_task_type && (
          <label>
            {t('calendarSuggestions.taskType')}
            <select required value={taskType} onChange={(event) => setTaskType(event.target.value)}>
              <option value="" />
              {taskTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="chrono-actions">
          <button type="button" className="plou-btn" disabled={busy} onClick={onClose}>
            {t('nav.cancel')}
          </button>
          <button
            type="submit"
            className="plou-btn"
            disabled={busy || (item.requires_task_type && !taskType)}
          >
            {start === 'now'
              ? t('calendarSuggestions.startNow')
              : t('calendarSuggestions.startPlanned', {
                  time: shortTime(getLocale(), new Date(item.starts_at), timezone),
                })}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
