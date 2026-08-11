import React from 'react';

/**
 * El `+` que apareix damunt d'un dia en passar-hi per sobre.
 *
 * **Un `span` amb `role="button"` i no un `<button>`**, i no per gust: la cel·la del dia
 * ja ÉS un botó, i el HTML no permet un botó dins d'un altre — el navegador desfà
 * l'imbricat i el resultat és impredictible. Amb `role` i `tabIndex` es comporta igual per
 * a teclat i lector de pantalla.
 */
function DayAdd({ label, onClick }) {
  const activa = (event) => {
    event.stopPropagation();
    onClick();
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      data-testid="day-add"
      onClick={activa}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activa(event);
      }}
      style={{
        position: 'absolute',
        top: 2,
        right: 2,
        width: 18,
        height: 18,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        lineHeight: 1,
        cursor: 'pointer',
        background: 'var(--card-bg)',
        color: 'var(--ink-soft)',
        border: '1px solid var(--card-border)',
      }}
    >
      +
    </span>
  );
}

/**
 * CalendarGrid — mes, setmana i dia.
 *
 * PORTAT del prototip, amb les seves mesures: cel·les quadrades de radi 14 i 6px de
 * separació al mes, columnes de 160px mínim i radi 16 a la setmana, files amb punt de
 * 9px al dia.
 *
 * AMB QUIN DIA COMENÇA LA SETMANA
 * -------------------------------
 * Ho decideix qui munta el calendari i arriba per `weekStart` (0 diumenge, 1 dilluns).
 * Fins a l'agost del 2026 era dilluns per constant, perquè hi havia un sol idioma;
 * ara depèn de la llengua i de la preferència de la persona, i el valor el resol
 * `resolveWeekStart` a `packages/contracts/src/dates.ts` —un sol lloc per a les dues
 * apps, perquè **si cadascú el calculés pel seu compte el calendari es desplaçaria un
 * dia i no donaria cap error**.
 *
 * Els noms dels dies i dels mesos arriben com a props. Un component del design system
 * no en sap ni d'idiomes ni de catàlegs.
 */

/** L'índex del dia dins de la setmana, comptant des del primer dia que toqui. */
export function weekIndex(date, weekStart = 1) {
  return (date.getDay() - weekStart + 7) % 7;
}

/**
 * Les cel·les d'una graella mensual, sempre setmanes senceres.
 *
 * Els dies dels mesos veïns hi són però amb `inMonth: false`: el prototip els pinta amb
 * `opacity: 0`, o sigui que ocupen lloc i no es veuen. Treure'ls trencaria l'alineació
 * de les columnes.
 */
export function monthCells(year, month, weekStart = 1) {
  const first = new Date(year, month, 1);
  const offset = weekIndex(first, weekStart);
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
  itemsByDate,
  weekStart = 1,
  onSelect,
  onPrev,
  onNext,
  onAddOnDay,
  addLabel,
  maxDate,
}) {
  const cells = monthCells(year, month, weekStart);
  const [hovered, setHovered] = React.useState(null);

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
        {/*
          El mes **i l'any** (docs/02 §5). Sense l'any, navegar tres mesos enrere et deixa
          mirant "desembre" sense saber de quin any, que és justament quan importa.
        */}
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {monthLabel} {year}
        </div>
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
          const items = iso === null || itemsByDate === undefined ? [] : (itemsByDate[iso] ?? []);
          /**
           * **Un dia més enllà del límit no es pot triar.**
           *
           * Ho fa servir la columna Fet: "què vaig fer dijous que ve" no vol dir res, i un
           * dia que es pot clicar i sempre surt buit és pitjor que un que no es pot clicar
           * — el primer et fa dubtar de si has perdut una tasca.
           */
          const beyond = maxDate !== undefined && iso !== null && iso > maxDate;

          return (
            <button
              key={index}
              type="button"
              data-testid={iso === null ? undefined : `day-${iso}`}
              data-selected={selected ? 'true' : 'false'}
              data-hovered={hovered !== null && hovered === iso ? 'true' : undefined}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => (iso === null ? undefined : onSelect?.(iso))}
              onMouseEnter={() => setHovered(iso)}
              onMouseLeave={() => setHovered(null)}
              // El teclat també: qui hi navega amb Tab ha de veure el mateix que qui hi
              // passa el ratolí, o el `+` seria una acció que només existeix amb ratolí.
              onFocus={() => setHovered(iso)}
              onBlur={() => setHovered(null)}
              disabled={iso === null || beyond}
              data-beyond={beyond ? 'true' : undefined}
              style={{
                position: 'relative',
                // El contorn diu "el pots agafar" sense competir amb el farciment del dia
                // seleccionat ni amb el d'avui.
                boxShadow:
                  hovered !== null && hovered === iso && !selected
                    ? 'inset 0 0 0 2px var(--day-hover-ring)'
                    : 'none',
                /**
                 * **Amb contingut, la cel·la deixa de ser quadrada.**
                 *
                 * `aspectRatio: 1` lliga l'alçada a l'amplada, i en una pantalla ampla això
                 * dona cel·les de 137 píxels —182 amb el rail a sota— per ensenyar-hi un
                 * punt de cinc. El mes ocupava 926 píxels d'alçada: a un portàtil les dues
                 * últimes setmanes queien sota la línia de flotació, i amb el rail a sota
                 * la bústia quedava a mil quatre-cents píxels de la vista.
                 *
                 * Es queda quadrada quan no hi ha ítems —els selectors de dia d'un desplegable
                 * la volen compacta— i passa a **alçada mínima** quan n'hi ha: 78 píxels són
                 * el número i tres línies, i fan que el mes sencer càpiga en una pantalla de
                 * portàtil sense haver de desplaçar-se.
                 */
                ...(itemsByDate === undefined
                  ? { aspectRatio: '1', alignItems: 'center', justifyContent: 'center' }
                  : { minHeight: 78, alignItems: 'stretch', justifyContent: 'flex-start' }),
                borderRadius: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: itemsByDate === undefined ? 0 : '6px 6px 5px',
                textAlign: itemsByDate === undefined ? 'center' : 'left',
                overflow: 'hidden',
                border: 'none',
                cursor: iso === null ? 'default' : 'pointer',
                fontFamily: 'var(--font-sans)',
                /**
                 * **Amb contingut, el gradient passa al número i la cel·la es queda amb un
                 * anell.** Omplir-la sencera obligaria cada títol a ser llegible sobre un
                 * degradat de marca —tres parades i vuit accents—, i `docs/04` §8 ja diu que
                 * el que cal llegir no s'hi juga. Sense contingut, el gradient és el de
                 * sempre: allà dins només hi ha un número.
                 */
                background:
                  selected && itemsByDate === undefined
                    ? 'var(--gradient-brand-2stop)'
                    : isToday || selected
                      ? 'var(--ghost-bg)'
                      : 'transparent',
                outline:
                  selected && itemsByDate !== undefined
                    ? '2px solid var(--day-hover-ring)'
                    : 'none',
                outlineOffset: -2,
                // Els dies d'altres mesos ocupen lloc i no es veuen: treure'ls
                // desalinearia les columnes. Els de més enllà del límit sí que es veuen,
                // atenuats: han de dir "existeix, però aquí no".
                opacity: cell.inMonth ? (beyond ? 0.35 : 1) : 0,
                cursor: beyond ? 'not-allowed' : iso === null ? 'default' : 'pointer',
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: selected ? 800 : 500,
                  color: selected && itemsByDate === undefined ? 'var(--on-brand)' : 'var(--ink)',
                  flexShrink: 0,
                }}
              >
                {cell.date === null ? '' : cell.date.getDate()}
              </span>
              {onAddOnDay && iso !== null && hovered === iso ? (
                <DayAdd label={addLabel} onClick={() => onAddOnDay(iso)} />
              ) : null}

              {itemsByDate === undefined ? (
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
              ) : (
                /**
                 * **El que hi ha, escrit.** Un punt de cinc píxels diu que el dia té alguna
                 * cosa i **no diu quina**, que és l'única pregunta que la vista de mes ha de
                 * respondre: si has de clicar cada dia per saber-ho, la vista no serveix.
                 *
                 * Tres com a màxim i un recompte per a la resta: amb quatre files de text la
                 * cel·la creix i el mes torna a no cabre-hi.
                 */
                <span
                  style={{ display: 'grid', gap: 2, minWidth: 0 }}
                  data-testid={iso === null ? undefined : `day-items-${iso}`}
                >
                  {items.slice(0, 3).map((item) => (
                    <span
                      key={item.id}
                      title={item.title}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        minWidth: 0,
                        fontSize: 10.5,
                        lineHeight: 1.25,
                        // La cita que no és a la teva bústia va difuminada aquí igual que a
                        // la llista: un sol significat per a un sol senyal.
                        opacity: item.muted === true ? 0.55 : 1,
                        color: 'var(--ink)',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          background: item.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                      >
                        {item.title}
                      </span>
                    </span>
                  ))}
                  {items.length > 3 ? (
                    <span style={{ fontSize: 10, color: 'var(--ink-soft)' }}>
                      +{items.length - 3}
                    </span>
                  ) : null}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WeekView({ days, selectedDate, onSelect, emptyLabel, onAddOnDay, addLabel }) {
  const [hovered, setHovered] = React.useState(null);
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
          data-hovered={hovered === day.iso ? 'true' : undefined}
          onClick={() => onSelect?.(day.iso)}
          onMouseEnter={() => setHovered(day.iso)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(day.iso)}
          onBlur={() => setHovered(null)}
          style={{
            position: 'relative',
            /*
              **A la setmana el contorn substitueix el farciment i no s'hi suma.** Una
              columna de 160px amb fons i contorn alhora es llegeix com dues capes; amb el
              contorn sol, el dia seleccionat —que sí que porta fons— segueix distingint-se
              d'un damunt del qual només hi ha el ratolí.
            */
            boxShadow:
              hovered === day.iso && day.iso !== selectedDate
                ? 'inset 0 0 0 2px var(--day-hover-ring)'
                : 'none',
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
          {onAddOnDay && hovered === day.iso ? (
            <DayAdd label={addLabel} onClick={() => onAddOnDay(day.iso)} />
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function DayView({ label, items, emptyLabel, onSelectItem, onAdd, addLabel }) {
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
          /**
           * **Un `button` de veritat, i no un `div` amb `onClick`.** És l'única manera
           * que això funcioni amb el teclat i amb un lector de pantalla sense reinventar
           * `role`, `tabIndex` i el maneig d'Enter i Espai a mà.
           *
           * `muted` vol dir **"això no és a la teva bústia"**, i es dibuixa amb una vora
           * discontínua i prou: el text es queda igual de llegible. Difuminar-lo seria
           * fer servir el contrast per portar informació, que és el que `docs/04` §8
           * prohibeix — i el que cap comprovació permanent veuria.
           */
          <button
            key={item.id}
            type="button"
            data-testid={`day-item-${item.id}`}
            data-muted={item.muted === true ? 'true' : undefined}
            disabled={!onSelectItem}
            onClick={
              onSelectItem
                ? (event) => {
                    // La targeta del dia també és clicable: aquesta acció no l'ha de disparar.
                    event.stopPropagation();
                    onSelectItem(item.id);
                  }
                : undefined
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              font: 'inherit',
              color: 'var(--ink)',
              background: 'var(--tag-bg)',
              border:
                item.muted === true ? '1px dashed var(--card-border)' : '1px solid transparent',
              borderRadius: 14,
              padding: '12px 14px',
              cursor: onSelectItem ? 'pointer' : 'default',
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
            {/* D'on ve, ja feta: el design system no sap de menes de font ni de catàlegs. */}
            {item.icon}
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{item.title}</span>
            {item.time ? (
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{item.time}</span>
            ) : null}
          </button>
        ))
      )}

      {/*
        **A la vista diària l'acció és permanent i no de passada.**

        Al mes i a la setmana el `+` surt en passar per sobre d'una cel·la, perquè hi ha
        trenta o set dies i un botó a cadascun seria soroll. Aquí n'hi ha un: amagar-lo
        darrere del ratolí seria amagar-lo per res —i a una pantalla tàctil, on no hi ha
        `hover`, seria amagar-lo del tot.
      */}
      {onAdd ? (
        <button
          type="button"
          data-testid="day-add"
          onClick={onAdd}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            padding: '10px 0',
            marginTop: 2,
            borderRadius: 14,
            border: '1px dashed var(--card-border)',
            background: 'transparent',
            color: 'var(--ink-soft)',
            font: 'inherit',
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          + {addLabel}
        </button>
      ) : null}
    </div>
  );
}
