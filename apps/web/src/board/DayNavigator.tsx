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

import { getLocale, longDay, t } from '@fem-ho/contracts';

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
  // Migdia i no mitjanit: amb mitjanit, un canvi d'hora pot fer que el dia dibuixat sigui
  // el d'abans, i el títol contradiria el contingut dos dies l'any.
  const label = longDay(locale, new Date(`${value}T12:00:00`));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
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
    </div>
  );
}
