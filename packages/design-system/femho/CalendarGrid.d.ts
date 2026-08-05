import type * as React from 'react';

/** L'índex del dia dins d'una setmana que comença en DILLUNS (docs/00). */
export declare function mondayIndex(date: Date): number;

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
  year: number;
  month: number;
  monthLabel: string;
  weekdayLabels: WeekdayLabels;
  selectedDate?: string | undefined;
  today?: string | undefined;
  /** Fins a 3 punts per dia, amb els colors dels àmbits que hi tenen res. */
  dotsByDate?: Record<string, string[]> | undefined;
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
}

export interface DayViewProps {
  label: string;
  items: DayItem[];
  emptyLabel: string;
}

export declare function MonthView(props: MonthViewProps): React.JSX.Element;
export declare function WeekView(props: WeekViewProps): React.JSX.Element;
export declare function DayView(props: DayViewProps): React.JSX.Element;
