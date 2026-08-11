/**
 * Prova de la vista de calendari.
 *
 * El que aquesta pàgina demostra que no demostra cap altra: **el rail de l'Inbox és el
 * mateix component que la columna del kanban** (P4). Les dues pantalles renderitzen
 * `InboxRail`; cap de les dues en té una versió pròpia.
 */

import { useState } from 'react';
import { monthName, t, weekdayNames } from '@fem-ho/contracts';
import { DayView, MonthView, WeekView } from '@fem-ho/design-system/femho';
import { InboxRail } from './board/InboxRail.js';
import { SAMPLE_DAY_ITEMS, SAMPLE_SCOPES, SAMPLE_TASKS } from './board/fixtures.js';

// La pàgina de prova fixa el català i dilluns: comprova la graella, no l'idioma.
const WEEK_START = 1;
const WEEKDAYS = weekdayNames('ca', WEEK_START);

const SCOPE_COLOR: Record<string, string> = {
  personal: 'var(--plou-blue)',
  feina: 'var(--plou-orange)',
  familia: 'var(--plou-pink)',
};

type View = 'month' | 'week' | 'day';

export function CalendarProof() {
  const [view, setView] = useState<View>('month');
  const [selected, setSelected] = useState('2026-08-05');
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(7); // agost, en base zero

  const inboxTasks = SAMPLE_TASKS.filter((task) => task.status === 'inbox');

  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2026, 7, 3 + index);
    const iso = `2026-08-${String(date.getDate()).padStart(2, '0')}`;
    return {
      iso,
      weekday: WEEKDAYS[index] ?? '',
      number: date.getDate(),
      items: iso === selected ? [{ id: 'a', title: 'Sopar amb els avis' }] : [],
    };
  });

  return (
    <div
      data-theme="light"
      data-accent="default"
      style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
        padding: 28,
      }}
    >
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 6, paddingBottom: 18 }}>
          {(['month', 'week', 'day'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`view-${option}`}
              onClick={() => setView(option)}
              aria-pressed={view === option}
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '7px 14px',
                borderRadius: 100,
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                background: view === option ? 'var(--ghost-bg)' : 'transparent',
                color: view === option ? 'var(--ink)' : 'var(--ink-faint)',
              }}
            >
              {t(`calendar.${option}`)}
            </button>
          ))}
        </div>

        {/*
          Graella de dues columnes: calendari flexible i rail de 340px. La posició del
          rail és configurable a Ajustos (docs/02 §5); per defecte, dreta.
        */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
          <div>
            {view === 'month' ? (
              <MonthView
                year={year}
                month={month}
                // Només el mes: `MonthView` ja hi posa l'any que rep a part.
                monthLabel={monthName('ca', month)}
                weekdayLabels={{
                  days: WEEKDAYS,
                  prevLabel: t('calendar.prevMonth'),
                  nextLabel: t('calendar.nextMonth'),
                }}
                selectedDate={selected}
                today="2026-08-05"
                itemsByDate={SAMPLE_DAY_ITEMS}
                onSelect={setSelected}
                onPrev={() => {
                  if (month === 0) {
                    setMonth(11);
                    setYear(year - 1);
                  } else setMonth(month - 1);
                }}
                onNext={() => {
                  if (month === 11) {
                    setMonth(0);
                    setYear(year + 1);
                  } else setMonth(month + 1);
                }}
              />
            ) : null}

            {view === 'week' ? (
              <WeekView
                days={weekDays}
                selectedDate={selected}
                onSelect={setSelected}
                emptyLabel={t('calendar.empty.week')}
              />
            ) : null}

            {view === 'day' ? (
              <DayView
                label={selected}
                items={[
                  {
                    id: 'sopar',
                    title: 'Sopar amb els avis',
                    color: SCOPE_COLOR.familia!,
                    time: '19:00',
                  },
                ]}
                emptyLabel={t('calendar.empty.day')}
              />
            ) : null}
          </div>

          {/*
            AQUEST és el punt de P4. El rail no és una versió del kanban: és el MATEIX
            component, amb la mateixa font de dades.
          */}
          <InboxRail tasks={inboxTasks} scopes={SAMPLE_SCOPES} placement="rail" />
        </div>
      </div>
    </div>
  );
}
