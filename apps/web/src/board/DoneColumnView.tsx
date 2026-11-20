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
import { CalendarIcon } from './CalendarIcon.js';

export interface DoneHeaderProps {
  today: string;
  day: string;
  hasActiveClear: boolean;
  onClear: () => void;
  onShowAll: () => void;
  onPickDay: (date: string) => void;
  onBackToToday: () => void;
}

export function DoneHeader({
  today,
  day,
  hasActiveClear,
  onClear,
  onShowAll,
  onPickDay,
  onBackToToday,
}: DoneHeaderProps) {
  // El mini-calendari segueix la mateixa regla que el gran: idioma i preferència.
  const weekStart = resolveWeekStart(useSessionData().settings.week_start, getLocale());
  const [month, setMonth] = useState<Date | null>(null);

  const button = (label: React.ReactNode, onClick: () => void, testId: string) => (
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
      {button(
        <CalendarIcon />,
        () => setMonth(month === null ? new Date(`${day}T12:00:00`) : null),
        'done-calendar',
      )}
      {/*
        Mirant un altre dia, «Netejar» i «Tot avui» no hi són: totes dues parlen d'avui, i
        un botó que no fa res on l'has clicat és pitjor que un que no hi és.
      */}
      {day !== today ? (
        button(t('board.done.backToToday'), onBackToToday, 'done-back-today')
      ) : (
        <>
          {button(t('board.done.clear'), onClear, 'done-clear')}
          {hasActiveClear ? button(t('board.done.showAllToday'), onShowAll, 'done-show-all') : null}
        </>
      )}

      {month !== null ? (
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
            today={today}
            selectedDate={day}
            // Què vas fer demà no vol dir res.
            maxDate={today}
            onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            onSelect={(date) => {
              setMonth(null);
              onPickDay(date);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
