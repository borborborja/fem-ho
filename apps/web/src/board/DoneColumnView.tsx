/**
 * La capçalera de la columna Fet. docs/02 §4, P2.
 *
 * Tres controls: el mini-calendari per navegar a un dia passat, el botó de netejar —que
 * **mou `done_cleared_at` i no esborra res**— i "Tot avui", que apareix **només quan hi
 * ha una neteja d'avui** i l'ignora.
 *
 * Que "Tot avui" surti sempre seria pitjor que no tenir-lo: un botó permanent que la
 * majoria de vegades no fa res ensenya a ignorar-lo.
 */

import { useState } from 'react';
import { getLocale, monthName, resolveWeekStart, t, weekdayNames } from '@fem-ho/contracts';
import { useSessionData } from '../app/session.js';
import { MonthView } from '@fem-ho/design-system/femho';

export interface DoneHeaderProps {
  clearedAt: string | null;
  onClear: () => void;
  onShowAll: () => void;
  /** Dia seleccionat al mini-calendari, si se n'ha triat cap. */
  onPickDay?: (date: string) => void;
}

function isToday(iso: string | null): boolean {
  if (iso === null) return false;
  const today = new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10) === today;
}

export function DoneHeader({ clearedAt, onClear, onShowAll, onPickDay }: DoneHeaderProps) {
  // El mini-calendari segueix la mateixa regla que el gran: idioma i preferència.
  const weekStart = resolveWeekStart(useSessionData().settings.week_start, getLocale());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());

  const button = (label: string, onClick: () => void, testId: string) => (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'var(--ink-soft)',
        font: 'inherit',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        padding: '2px 6px',
        borderRadius: 8,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
      {button('📅', () => setCalendarOpen(!calendarOpen), 'done-calendar')}
      {button(t('board.done.clear'), onClear, 'done-clear')}
      {isToday(clearedAt) ? button(t('board.done.showAllToday'), onShowAll, 'done-show-all') : null}

      {calendarOpen ? (
        <div
          style={{
            position: 'absolute',
            top: 26,
            right: 0,
            zIndex: 40,
            width: 260,
            padding: 12,
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: 14,
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <MonthView
            year={month.getFullYear()}
            month={month.getMonth()}
            monthLabel={monthName(getLocale(), month.getMonth())}
            weekStart={weekStart}
            weekdayLabels={{
              days: weekdayNames(getLocale(), weekStart),
              prevLabel: t('calendar.prevMonth'),
              nextLabel: t('calendar.nextMonth'),
            }}
            today={new Date().toISOString().slice(0, 10)}
            onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            onSelect={(date) => {
              setCalendarOpen(false);
              onPickDay?.(date);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
