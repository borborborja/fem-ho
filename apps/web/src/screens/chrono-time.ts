import { localTimeToInstant } from '@fem-ho/contracts';
export const STEP = 5 * 60000;
export const snapTime = (ms: number) => Math.round(ms / STEP) * STEP;
export function localInput(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ms);
  const p = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
/** Conserva l'ocurrència original de l'hora repetida; no normalitza una hora inexistent. */
export function inputInstant(value: string, timezone: string, reference?: number): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const guess = Date.parse(localTimeToInstant(timezone, value.slice(0, 10), value.slice(11)));
  const choices: number[] = [];
  for (let offset = -180; offset <= 180; offset += 15) {
    const at = guess + offset * 60000;
    if (localInput(at, timezone) === value) choices.push(at);
  }
  choices.sort((a, b) =>
    reference === undefined ? a - b : Math.abs(a - reference) - Math.abs(b - reference),
  );
  return choices[0] ?? NaN;
}
export function adjustInterval(
  start: number,
  end: number | null,
  delta: number,
  mode: 'move' | 'left' | 'right',
  now: number,
) {
  delta = Math.round(delta / STEP) * STEP;
  if (end === null) return { start: Math.min(start + delta, snapTime(now) - STEP), end: null };
  if (mode === 'move') return { start: start + delta, end: end + delta };
  if (mode === 'left') return { start: Math.min(start + delta, end - STEP), end };
  return { start, end: Math.max(end + delta, start + STEP) };
}
export function stackIntervals<T extends { start: number; end: number }>(entries: T[]) {
  const ends: number[] = [];
  return [...entries]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((entry) => {
      let row = ends.findIndex((end) => end <= entry.start);
      if (row < 0) row = ends.length;
      ends[row] = entry.end;
      return { ...entry, row };
    });
}
