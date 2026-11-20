import type { TaskStatus } from './index.js';
import { localDateOf, type PlainDate } from './timezone.js';

interface DoneDayOptions {
  timezone: string;
  today: PlainDate;
  day: PlainDate;
  clearedAt?: string | null | undefined;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

function parseInstant(value: string | null | undefined): number | null {
  if (value == null || !INSTANT.test(value)) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;

  // Date.parse pot convertir el 31 de febrer en una data de març.
  const date = value.slice(0, 10);
  return new Date(date).toISOString().slice(0, 10) === date ? time : null;
}

/**
 * La capçalera i les targetes de Fet consulten el mateix dia local del perfil.
 * El llindar de neteja només s'aplica si es va guardar aquell mateix dia.
 */
export function createDoneDayFilter({ timezone, today, day, clearedAt }: DoneDayOptions) {
  const cleared = day === today ? parseInstant(clearedAt) : null;
  const cutoff =
    cleared !== null && localDateOf(timezone, new Date(cleared)) === today ? cleared : null;

  return {
    hasActiveClear: cutoff !== null,
    isVisible(status: TaskStatus, completedAt: string | null | undefined): boolean {
      if (status !== 'done') return true;
      const completed = parseInstant(completedAt);
      return (
        completed !== null &&
        (cutoff === null || completed > cutoff) &&
        localDateOf(timezone, new Date(completed)) === day
      );
    },
  };
}
