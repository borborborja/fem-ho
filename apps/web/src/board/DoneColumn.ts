/**
 * L'agrupació de la columna Fet. docs/14 P2 i docs/01 §8.
 *
 * "La columna Fet es neteja cada dia o a demanda" del brief es resol **com a consulta,
 * no com a estat**: cap job nocturn, cap columna `cleared_at` a la tasca. Es calcula amb
 * `status='done'` i `completed_at` dins d'un rang, **en el fus de qui mira**.
 *
 * "La presentació és més suau que un tall sec": per defecte es veu el d'avui, i a sota
 * "Ahir" i "Aquesta setmana" plegats amb el recompte. **No s'amaga res, es plega.**
 *
 * `done_cleared_at` es guarda per usuari i **només mou el llindar de què es veu
 * desplegat**: no esborra res i no afecta ningú altre de la casa. El botó "Tot avui"
 * l'ignora, que és el que demana el brief a la línia 58.
 */

import type { BoardTask } from './KanbanBoard.js';

/** Una tasca feta porta l'instant en què es va marcar. */
export interface DoneTask extends BoardTask {
  completed_at: string;
}

export type DoneBucket = 'today' | 'yesterday' | 'thisWeek' | 'older';

export interface DoneGroup {
  bucket: DoneBucket;
  tasks: DoneTask[];
  /** Els de "Ahir" i "Aquesta setmana" surten plegats, amb el recompte. */
  collapsedByDefault: boolean;
}

export interface GroupDoneOptions {
  /** El fus de QUI MIRA. Ni el del servidor ni el de qui va crear la tasca. */
  timezone: string;
  /** L'instant de referència. S'injecta per poder-ho provar. */
  now: Date;
  /**
   * L'últim "netejar" d'aquest usuari. Amaga del grup d'avui el que ja s'havia vist,
   * sense esborrar-ho: continua comptant i "Tot avui" el recupera sencer.
   */
  doneClearedAt?: string | null | undefined;
  /** El botó "Tot avui": ignora `doneClearedAt` (brief línia 58). */
  showAllToday?: boolean | undefined;
}

/** La data local `YYYY-MM-DD` d'un instant, al fus donat. */
function localDate(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Quants dies locals separen dues dates `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Agrupa les tasques fetes en avui · ahir · aquesta setmana · més antigues.
 *
 * Els dies es compten **per data local**, no restant mil·lisegons: els dies de canvi
 * d'hora tenen 23 o 25 hores i una resta d'instants els compta malament. És el mateix
 * motiu pel qual `localDayBounds` del servidor no fa `inici + 24 h`.
 */
export function groupDone(tasks: DoneTask[], options: GroupDoneOptions): DoneGroup[] {
  const { timezone, now } = options;
  const today = localDate(timezone, now);

  const clearedAt =
    options.showAllToday === true || options.doneClearedAt == null
      ? null
      : Date.parse(options.doneClearedAt);

  const buckets: Record<DoneBucket, DoneTask[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    older: [],
  };

  for (const task of tasks) {
    const completed = new Date(task.completed_at);
    const day = localDate(timezone, completed);
    const distance = daysBetween(day, today);

    if (distance === 0) {
      // Netejar només mou el llindar del grup d'avui. La tasca no s'esborra ni canvia
      // de grup: simplement deixa de sortir desplegada fins que es demani "Tot avui".
      if (clearedAt !== null && completed.getTime() <= clearedAt) continue;
      buckets.today.push(task);
    } else if (distance === 1) {
      buckets.yesterday.push(task);
    } else if (distance > 1 && distance <= 7) {
      buckets.thisWeek.push(task);
    } else {
      buckets.older.push(task);
    }
  }

  const order: DoneBucket[] = ['today', 'yesterday', 'thisWeek', 'older'];
  return order
    .filter((bucket) => buckets[bucket].length > 0)
    .map((bucket) => ({
      bucket,
      tasks: buckets[bucket],
      // Avui desplegat; la resta plegada amb el recompte.
      collapsedByDefault: bucket !== 'today',
    }));
}

/**
 * Quantes tasques d'avui amaga el llindar de neteja.
 *
 * Serveix per decidir si es mostra el botó "Tot avui": docs/02 §4 diu que apareix
 * **només quan hi ha `done_cleared_at` d'avui**, no sempre.
 */
export function hiddenTodayCount(tasks: DoneTask[], options: GroupDoneOptions): number {
  if (options.doneClearedAt == null) return 0;
  const today = localDate(options.timezone, options.now);
  const clearedAt = Date.parse(options.doneClearedAt);

  return tasks.filter((task) => {
    const completed = new Date(task.completed_at);
    return localDate(options.timezone, completed) === today && completed.getTime() <= clearedAt;
  }).length;
}
