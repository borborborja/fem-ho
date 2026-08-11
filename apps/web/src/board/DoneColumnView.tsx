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
  clearedAt: string | null;
  onClear: () => void;
  onShowAll: () => void;
  /**
   * Anar a un altre dia a veure què vas fer.
   *
   * **Existia i no es passava mai**: el mini-calendari s'obria, triaves un dia i no
   * passava res. La columna ensenyava tot l'històric de tasques fetes, planes, i per això
   * no s'arribava a veure mai ni l'estat buit ni l'efecte de "Netejar".
   */
  onPickDay?: (date: string) => void;
  /** El dia que s'està mirant. Amb `null`, avui. */
  day?: string | null | undefined;
  /** Tornar a avui. Només surt quan s'està mirant un altre dia. */
  onBackToToday?: (() => void) | undefined;
}

function isToday(iso: string | null): boolean {
  if (iso === null) return false;
  const today = new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10) === today;
}

export function DoneHeader({
  clearedAt,
  onClear,
  onShowAll,
  onPickDay,
  day,
  onBackToToday,
}: DoneHeaderProps) {
  const avui = new Date().toISOString().slice(0, 10);
  const mirantUnAltreDia = day != null && day !== avui;
  // El mini-calendari segueix la mateixa regla que el gran: idioma i preferència.
  const weekStart = resolveWeekStart(useSessionData().settings.week_start, getLocale());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());

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
      {button(<CalendarIcon />, () => setCalendarOpen(!calendarOpen), 'done-calendar')}
      {/*
        Mirant un altre dia, «Netejar» i «Tot avui» no hi són: totes dues parlen d'avui, i
        un botó que no fa res on l'has clicat és pitjor que un que no hi és.
      */}
      {mirantUnAltreDia ? (
        button(t('board.done.backToToday'), () => onBackToToday?.(), 'done-back-today')
      ) : (
        <>
          {button(t('board.done.clear'), onClear, 'done-clear')}
          {isToday(clearedAt)
            ? button(t('board.done.showAllToday'), onShowAll, 'done-show-all')
            : null}
        </>
      )}

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
            today={avui}
            selectedDate={day ?? avui}
            // Què vas fer demà no vol dir res.
            maxDate={avui}
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
