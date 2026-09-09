export const REPORT_PERIODS = [
  'today',
  'week',
  'month',
  'days30',
  'days90',
  'all',
  'custom',
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export function reportRange(period: string, timezone: string, now = new Date(), weekStart = 1) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const date = new Date(today + 'T12:00:00Z');
  const shift = (days: number) =>
    new Date(date.getTime() + days * 86400000).toISOString().slice(0, 10);
  switch (period) {
    case 'all':
      return { from: '', to: '' };
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: shift(-((date.getUTCDay() - weekStart + 7) % 7)), to: today };
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today };
    case 'days90':
      return { from: shift(-89), to: today };
    default:
      return { from: shift(-29), to: today };
  }
}
