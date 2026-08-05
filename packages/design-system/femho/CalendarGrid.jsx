import React from 'react';

/**
 * CalendarGrid — mes, setmana i dia.
 *
 * PORTAT del prototip, amb les seves mesures: cel·les quadrades de radi 14 i 6px de
 * separació al mes, columnes de 160px mínim i radi 16 a la setmana, files amb punt de
 * 9px al dia.
 *
 * LA SETMANA COMENÇA EN DILLUNS. SEMPRE.
 * --------------------------------------
 * docs/00 ho diu sense matisos, i el prototip ho implementa amb `(getDay() + 6) % 7`:
 * `getDay()` torna 0 per a diumenge, i aquesta rotació el mou al final. És una línia
 * que si es perd, el calendari es desplaça un dia i **no dona cap error**.
 *
 * Els noms dels dies i dels mesos arriben com a props des del catàleg (regla 3). Un
 * component del design system no pot portar català a dins.
 */

/** L'índex del dia dins d'una setmana que comença en dilluns. */
export function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/**
 * Les cel·les d'una graella mensual, sempre setmanes senceres.
 *
 * Els dies dels mesos veïns hi són però amb `inMonth: false`: el prototip els pinta amb
 * `opacity: 0`, o sigui que ocupen lloc i no es veuen. Treure'ls trencaria l'alineació
 * de les columnes.
 */
export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const offset = mondayIndex(first);
  const cells = [];

  for (let i = 0; i < offset; i += 1) {
    cells.push({ date: null, inMonth: false });
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(year, month, day), inMonth: true });
  }

  // Es completa fins a setmanes senceres perquè la graella no quedi coixa.
  while (cells.length % 7 !== 0) cells.push({ date: null, inMonth: false });
  return cells;
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function MonthView({
  year,
  month,
  monthLabel,
  weekdayLabels,
  selectedDate,
  today,
  dotsByDate = {},
  onSelect,
  onPrev,
  onNext,
}) {
  const cells = monthCells(year, month);

  return (
    <div
      data-testid="calendar-month"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--card-shadow)',
        padding: 22,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 16,
        }}
      >
        <button
          type="button"
          onClick={onPrev}
          aria-label={weekdayLabels.prevLabel}
          style={{
            fontSize: 18,
            color: 'var(--ink-soft)',
            padding: '0 8px',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
          }}
        >
          ‹
        </button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{monthLabel}</div>
        <button
          type="button"
          onClick={onNext}
          aria-label={weekdayLabels.nextLabel}
          style={{
            fontSize: 18,
            color: 'var(--ink-soft)',
            padding: '0 8px',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
          }}
        >
          ›
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 6,
          fontSize: 11.5,
          color: 'var(--ink-faint)',
          textAlign: 'center',
          paddingBottom: 6,
        }}
      >
        {weekdayLabels.days.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {cells.map((cell, index) => {
          const iso = cell.date === null ? null : isoDate(cell.date);
          const selected = iso !== null && iso === selectedDate;
          const isToday = iso !== null && iso === today;
          const dots = iso === null ? [] : (dotsByDate[iso] ?? []);

          return (
            <button
              key={index}
              type="button"
              data-testid={iso === null ? undefined : `day-${iso}`}
              data-selected={selected ? 'true' : 'false'}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => (iso === null ? undefined : onSelect?.(iso))}
              disabled={iso === null}
              style={{
                aspectRatio: '1',
                borderRadius: 14,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                border: 'none',
                cursor: iso === null ? 'default' : 'pointer',
                fontFamily: 'var(--font-sans)',
                // Dia seleccionat amb el gradient; avui amb el fons fantasma.
                background: selected
                  ? 'var(--gradient-brand-2stop)'
                  : isToday
                    ? 'var(--ghost-bg)'
                    : 'transparent',
                // Els dies d'altres mesos ocupen lloc i no es veuen: treure'ls
                // desalinearia les columnes.
                opacity: cell.inMonth ? 1 : 0,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: selected ? 800 : 500,
                  color: selected ? 'var(--on-brand)' : 'var(--ink)',
                }}
              >
                {cell.date === null ? '' : cell.date.getDate()}
              </span>
              <span style={{ display: 'flex', gap: 3, height: 5 }}>
                {/* Fins a 3 punts de 5px amb els colors dels àmbits que hi tenen res. */}
                {dots.slice(0, 3).map((color, dotIndex) => (
                  <span
                    key={dotIndex}
                    aria-hidden="true"
                    style={{ width: 5, height: 5, borderRadius: '50%', background: color }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WeekView({ days, selectedDate, onSelect, emptyLabel }) {
  return (
    <div
      data-testid="calendar-week"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}
    >
      {days.map((day) => (
        <button
          key={day.iso}
          type="button"
          data-testid={`week-day-${day.iso}`}
          onClick={() => onSelect?.(day.iso)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 10px',
            borderRadius: 16,
            background: day.iso === selectedDate ? 'var(--ghost-bg)' : 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            minHeight: 160,
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <span style={{ textAlign: 'center' }}>
            <span
              style={{
                display: 'block',
                fontSize: 10.5,
                color: 'var(--ink-faint)',
                textTransform: 'uppercase',
              }}
            >
              {day.weekday}
            </span>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
              {day.number}
            </span>
          </span>

          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {day.items.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'center' }}>
                {emptyLabel}
              </span>
            ) : (
              day.items.slice(0, 3).map((item) => (
                <span
                  key={item.id}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 100,
                    background: 'var(--tag-bg)',
                    color: 'var(--tag-text)',
                    textAlign: 'center',
                  }}
                >
                  {item.title}
                </span>
              ))
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

export function DayView({ label, items, emptyLabel }) {
  return (
    <div
      data-testid="calendar-day"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--card-shadow)',
        padding: 22,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700 }}>{label}</div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-faint)', padding: '14px 2px' }}>
          {emptyLabel}
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            data-testid={`day-item-${item.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--tag-bg)',
              borderRadius: 14,
              padding: '12px 14px',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: item.color,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{item.title}</span>
            {item.time ? (
              <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{item.time}</span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
