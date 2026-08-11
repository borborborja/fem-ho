/**
 * El navegador de dia de la bústia — `‹ 5 d'agost ›`.
 *
 * `docs/02` §4 el demana des del primer dia: *"L'Inbox també té controls propis a la
 * capçalera que les altres no tenen: navegador de dia (`‹ 5 d'agost ›`) i un commutador
 * per ensenyar les endarrerides"*. El forat on va —la prop `header` d'`InboxRail`— ja
 * existia amb aquest comentari escrit i mai s'hi va posar res.
 *
 * PER A QUÈ SERVEIX DE VERITAT
 * ----------------------------
 * No és per mirar el passat: és per **avançar feina**. Has acabat el que tocava avui i et
 * situes a demà per veure què ve, sense sortir del tauler i sense passar pel calendari.
 * Per això el moviment natural és endavant i el botó de tornada diu "avui" en comptes de
 * dibuixar un calendari petit.
 *
 * QUÈ NO CANVIA EN CANVIAR DE DIA
 * -------------------------------
 * **Les tasques sense data hi són tots els dies.** Són el dipòsit del que has apuntat i
 * encara no has situat, i desaparèixer-les en navegar convertiria el navegador en una
 * manera de perdre-les de vista. El que canvia són les que tenen data, i les endarrerides,
 * que només surten quan mires avui: "endarrerit respecte d'un dijous que encara no ha
 * arribat" no vol dir res.
 */

import { useState } from 'react';
import {
  getLocale,
  longDay,
  monthName,
  resolveWeekStart,
  t,
  weekdayNames,
} from '@fem-ho/contracts';
import { MonthView } from '@fem-ho/design-system/femho';
import { useSessionData } from '../app/session.js';
import { CalendarIcon } from './CalendarIcon.js';

export interface DayNavigatorProps {
  /** El dia que s'ensenya, `YYYY-MM-DD`. */
  value: string;
  onChange: (next: string) => void;
  /** Avui, per saber si cal oferir la tornada. Ve de fora perquè sigui provable. */
  today: string;
}

/** Sumar dies sense passar per UTC: `2026-03-29` + 1 ha de ser `2026-03-30` sempre. */
export function shiftDay(date: string, days: number): string {
  const parts = date.split('-').map(Number);
  const moved = new Date(parts[0]!, parts[1]! - 1, parts[2]! + days);
  return `${String(moved.getFullYear())}-${String(moved.getMonth() + 1).padStart(2, '0')}-${String(
    moved.getDate(),
  ).padStart(2, '0')}`;
}

const arrow = {
  border: 'none',
  background: 'transparent',
  color: 'var(--ink-soft)',
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  padding: '2px 6px',
  borderRadius: 8,
} as const;

export function DayNavigator({ value, onChange, today }: DayNavigatorProps) {
  const locale = getLocale();
  const weekStart = resolveWeekStart(useSessionData().settings.week_start, locale);
  const [obert, setObert] = useState(false);
  const [mes, setMes] = useState(() => new Date(`${value}T12:00:00`));
  // Migdia i no mitjanit: amb mitjanit, un canvi d'hora pot fer que el dia dibuixat sigui
  // el d'abans, i el títol contradiria el contingut dos dies l'any.
  const label = longDay(locale, new Date(`${value}T12:00:00`));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
      {/*
        **El calendari, i no només les fletxes.**

        Amb fletxes soles, anar a d'aquí a deu dies són deu clics i no saps on ets fins que
        llegeixes l'etiqueta. La mateixa icona que la columna Fet, perquè fa la mateixa
        cosa: triar quin dia mires.

        **I aquí no hi ha límit de futur**, a diferència de Fet. Allà mirar endavant no vol
        dir res —què vaig fer demà—; aquí és justament per a què serveix: acabes el d'avui
        i te'n vas a demà a avançar feina. Enrere també val: hi queden les cites que no vas
        amagar ni convertir en tasca.
      */}
      <button
        type="button"
        style={{ ...arrow, display: 'flex', alignItems: 'center' }}
        data-testid="inbox-day-pick"
        aria-label={t('inbox.day.pick')}
        title={t('inbox.day.pick')}
        onClick={() => setObert(!obert)}
      >
        <CalendarIcon />
      </button>
      <button
        type="button"
        style={arrow}
        data-testid="inbox-day-prev"
        aria-label={t('inbox.day.prev')}
        onClick={() => onChange(shiftDay(value, -1))}
      >
        ‹
      </button>
      <span
        data-testid="inbox-day-label"
        style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-soft)', minWidth: 0 }}
      >
        {value === today ? t('inbox.day.today') : label}
      </span>
      <button
        type="button"
        style={arrow}
        data-testid="inbox-day-next"
        aria-label={t('inbox.day.next')}
        onClick={() => onChange(shiftDay(value, 1))}
      >
        ›
      </button>
      {/*
        La tornada només surt quan hi ha on tornar. Un botó "avui" permanentment apagat
        ensenya a ignorar la capçalera, que és on viuen els controls que sí que importen.
      */}
      {value === today ? null : (
        <button
          type="button"
          className="plou-btn plou-btn-ghost"
          data-testid="inbox-day-today"
          onClick={() => onChange(today)}
          style={{ fontSize: 10.5, padding: '2px 8px', marginLeft: 2 }}
        >
          {t('inbox.day.today')}
        </button>
      )}

      {obert ? (
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
            year={mes.getFullYear()}
            month={mes.getMonth()}
            monthLabel={monthName(locale, mes.getMonth())}
            weekStart={weekStart}
            weekdayLabels={{
              days: weekdayNames(locale, weekStart),
              prevLabel: t('calendar.prevMonth'),
              nextLabel: t('calendar.nextMonth'),
            }}
            today={today}
            selectedDate={value}
            onPrev={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))}
            onNext={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))}
            onSelect={(date) => {
              setObert(false);
              onChange(date);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
