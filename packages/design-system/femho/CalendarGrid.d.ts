import type * as React from 'react';

/** L'índex del dia dins d'una setmana que comença en DILLUNS (docs/00). */
/** L'índex del dia dins de la setmana, comptant des del primer dia que toqui. */
export declare function weekIndex(date: Date, weekStart?: 0 | 1): number;

export interface MonthCell {
  date: Date | null;
  inMonth: boolean;
}

/** Les cel·les d'un mes, sempre en setmanes senceres. */
export declare function monthCells(year: number, month: number): MonthCell[];

export interface WeekdayLabels {
  /** `dl dt dc dj dv ds dg`, del catàleg. */
  days: string[];
  prevLabel?: string | undefined;
  nextLabel?: string | undefined;
}

export interface MonthViewProps {
  /**
   * L'últim dia que es pot triar, `YYYY-MM-DD`. Els posteriors surten atenuats i
   * desactivats. Ho fa servir la columna Fet: no es pot mirar què vas fer demà.
   */
  maxDate?: string | undefined;
  /**
   * Afegir una tasca a la bústia d'aquell dia, des del `+` que surt en passar-hi per
   * sobre. Sense això no es pinta cap botó.
   */
  onAddOnDay?: ((iso: string) => void) | undefined;
  /** L'etiqueta del `+`. Un component del design system no sap de catàlegs. */
  addLabel?: string | undefined;

  year: number;
  month: number;
  monthLabel: string;
  weekdayLabels: WeekdayLabels;
  selectedDate?: string | undefined;
  today?: string | undefined;
  /** Fins a 3 punts per dia, amb els colors dels àmbits que hi tenen res. */
  dotsByDate?: Record<string, string[]> | undefined;
  /**
   * Amb quin dia comença la setmana: 0 diumenge, 1 dilluns.
   *
   * El resol `resolveWeekStart` de `@fem-ho/contracts` a partir de l'idioma i de la
   * preferència. Aquí arriba ja decidit: el component no sap d'idiomes.
   */
  weekStart?: 0 | 1 | undefined;
  onSelect?: ((iso: string) => void) | undefined;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}

export interface WeekDay {
  iso: string;
  weekday: string;
  number: number;
  items: { id: string; title: string }[];
}

export interface WeekViewProps {
  /**
   * Afegir una tasca a la bústia d'aquell dia, des del `+` que surt en passar-hi per
   * sobre. Sense això no es pinta cap botó.
   */
  onAddOnDay?: ((iso: string) => void) | undefined;
  /** L'etiqueta del `+`. Un component del design system no sap de catàlegs. */
  addLabel?: string | undefined;

  days: WeekDay[];
  selectedDate?: string | undefined;
  onSelect?: ((iso: string) => void) | undefined;
  /** Frase sencera, mai un guió (docs/00). */
  emptyLabel: string;
}

export interface DayItem {
  id: string;
  title: string;
  color: string;
  time?: string | undefined;
  /**
   * **"Això no és a la teva bústia."**
   *
   * Es dibuixa amb una vora discontínua i el text es queda igual de llegible: difuminar-lo
   * seria portar informació amb el contrast, que `docs/04` §8 prohibeix i que cap
   * comprovació permanent veuria.
   */
  muted?: boolean | undefined;
  /** La icona de provinença, ja feta. Res si l'esdeveniment és d'aquesta casa. */
  icon?: React.ReactNode;
}

export interface DayViewProps {
  label: string;
  items: DayItem[];
  emptyLabel: string;
  /**
   * Obrir un element del dia. **Sense això els elements no són clicables**, que és com
   * estaven fins ara: el text i el punt de color eren purament informatius i no hi havia
   * cap manera d'actuar sobre un esdeveniment des del calendari.
   */
  onSelectItem?: ((id: string) => void) | undefined;
  /**
   * Afegir una tasca a aquest dia.
   *
   * **Permanent i no en passar-hi per sobre**, a diferència del mes i la setmana: aquí hi
   * ha un sol dia, i amagar l'acció darrere del ratolí seria amagar-la per res — i en una
   * pantalla tàctil, amagar-la del tot.
   */
  onAdd?: (() => void) | undefined;
  addLabel?: string | undefined;
}

export declare function MonthView(props: MonthViewProps): React.JSX.Element;
export declare function WeekView(props: WeekViewProps): React.JSX.Element;
export declare function DayView(props: DayViewProps): React.JSX.Element;
