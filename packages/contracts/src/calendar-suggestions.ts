import type { components } from './generated/api.js';

type CalendarTimes = Pick<components['schemas']['CalendarTaskSuggestion'], 'starts_at' | 'ends_at'>;
type CalendarTiming = CalendarTimes &
  Pick<components['schemas']['CalendarTaskSuggestion'], 'all_day' | 'declined'>;

export function calendarSuggestionWindow(item: CalendarTimes): { start: number; end: number } {
  const start = Date.parse(item.starts_at);
  const end = Date.parse(item.ends_at);
  // Una cita sense durada necessita una finestra perquè es pugui arribar a confirmar.
  return { start, end: end > start ? end : start + 60_000 };
}

export function isCurrentCalendarSuggestion(item: CalendarTiming, now: number): boolean {
  if (item.all_day || item.declined) return false;
  const { start, end } = calendarSuggestionWindow(item);
  return start <= now && now < end;
}
