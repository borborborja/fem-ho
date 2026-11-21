import { liveQuery } from 'dexie';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyPomodoroCommand,
  comparePositions,
  emptyPomodoroSnapshot,
  generatePosition,
  pomodoroRemainingMs,
  projectPomodoroTimer,
  t,
  type PomodoroCommand,
  type PomodoroSettings,
  type PomodoroSnapshot,
  type PomodoroTimer,
} from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api, ApiError, failureText } from '../app/api.js';
import { browserDeviceId } from '../app/notification-device.js';
import { useSessionData } from '../app/session.js';
import { useToasts } from '../app/toasts.js';
import type { Board, Task } from '../app/types.js';
import { useTimeCompletion, type MoveExtra } from '../board/useTimeCompletion.js';
import { useBoardQuery, useBoardSync } from '../sync/board-sync.js';
import { projectBoardTasks } from '../sync/board-projection.js';
import { POMODORO_PATH, readSnapshot, type CachedPomodoro } from '../sync/cache.js';
import { readMeta, writeMeta, type OutboxRow } from '../sync/db.js';
import { compareOperations } from '../sync/outbox.js';
import { createPomodoroSound } from './sound.js';

type Control = Extract<PomodoroCommand, { kind: 'control' }>['action'];

interface PomodoroBoardProjection {
  moves: OutboxRow[];
  received?: Task | undefined;
}

const emptyProjection: PomodoroBoardProjection = { moves: [] };
const BoardProjection = createContext(emptyProjection);

export function usePomodoroBoardProjection(): PomodoroBoardProjection {
  return useContext(BoardProjection);
}

interface Pomodoro {
  settings: PomodoroSettings;
  timer: PomodoroTimer | null;
  remainingMs: number;
  queue: string[];
  task: Task | undefined;
  tasks: Task[];
  open: boolean;
  setOpen: (value: boolean) => void;
  unavailable: boolean;
  issue: 'conflict' | 'failed' | undefined;
  changeSettings: (patch: Partial<PomodoroSettings>) => Promise<void>;
  changeQueue: (taskIds: string[]) => Promise<void>;
  start: (taskId?: string | null) => Promise<void>;
  control: (action: Exclude<Control, 'resume'>) => Promise<void>;
  markDone: () => Promise<void>;
}

const PomodoroContext = createContext<Pomodoro | null>(null);

export function usePomodoro(): Pomodoro | null {
  return useContext(PomodoroContext);
}

const initial = emptyPomodoroSnapshot();

export function pomodoroPhaseLabel(phase: PomodoroTimer['phase']): string {
  if (phase === 'short_break') return t('pomodoro.shortBreak');
  if (phase === 'long_break') return t('pomodoro.longBreak');
  return t('pomodoro.focus');
}

function projectPending(confirmed: PomodoroSnapshot, pending: OutboxRow[]) {
  let snapshot = confirmed;
  const moves: OutboxRow[] = [];
  for (const row of pending
    .filter((item) => item.entity_type === 'pomodoro')
    .sort(compareOperations)) {
    if (row.status === 'failed' || row.status === 'conflict') break;
    const command = row.payload as unknown as PomodoroCommand;
    const projected = applyPomodoroCommand(snapshot, command);
    if (projected === null) break;
    snapshot = projected;
    if (
      (command.kind === 'start' || command.kind === 'control') &&
      typeof command.task_id === 'string' &&
      command.position !== undefined
    ) {
      moves.push({
        ...row,
        entity_type: 'task',
        entity_id: command.task_id,
        op: 'move',
        payload: { status: 'doing', from_status: 'todo', position: command.position },
      });
    }
  }
  return { snapshot, moves };
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { profile, scopes } = useSessionData();
  const { db, pending, submit } = useBoardSync();
  const { notify } = useToasts();
  const completion = useTimeCompletion();
  const deviceId = useMemo(() => browserDeviceId(profile.id), [profile.id]);
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(Date.now);
  const sound = useMemo(createPomodoroSound, []);
  const [stored, setStored] = useState<CachedPomodoro>();
  const { data, error, reload } = useBoardQuery<CachedPomodoro>(POMODORO_PATH);
  useEffect(() => {
    const subscription = liveQuery(() => readSnapshot<CachedPomodoro>(db, POMODORO_PATH)).subscribe(
      {
        next: setStored,
        error: () => undefined,
      },
    );
    return () => subscription.unsubscribe();
  }, [db]);
  const confirmed = stored ?? data;
  const offset =
    confirmed?.observed_at_ms === undefined
      ? 0
      : confirmed.server_time_ms - confirmed.observed_at_ms;
  const { snapshot, moves } = useMemo(
    () => projectPending(confirmed ?? initial, pending),
    [confirmed, pending],
  );
  const { settings, queue } = snapshot;
  const timer = projectPomodoroTimer(snapshot.timer, time + offset);
  const running = timer?.status === 'running';
  const previousTimer = useRef<PomodoroTimer | null>(null);

  // La fase es deriva del termini absolut. Un interval suspès no allarga el compte enrere.
  useEffect(() => {
    const wake = () => setTime(Date.now());
    wake();
    window.addEventListener('pageshow', wake);
    document.addEventListener('visibilitychange', wake);
    const tick = running ? window.setInterval(wake, 250) : undefined;
    return () => {
      window.removeEventListener('pageshow', wake);
      document.removeEventListener('visibilitychange', wake);
      if (tick !== undefined) window.clearInterval(tick);
    };
  }, [running]);

  useEffect(() => {
    const refresh = () => {
      if (navigator.onLine && !document.hidden) reload();
    };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, settings.enabled ? 5000 : 15_000);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(interval);
    };
  }, [reload, settings.enabled]);

  useEffect(() => () => sound.close(), [sound]);
  useEffect(() => {
    const before = previousTimer.current ?? snapshot.timer;
    previousTimer.current = timer;
    if (
      before?.status !== 'running' ||
      timer?.id !== before.id ||
      timer.phase_number <= before.phase_number ||
      before.end_at_ms === null ||
      before.end_at_ms > time + offset ||
      before.device_id !== deviceId
    )
      return;
    notify(t('pomodoro.phaseEnded', { phase: pomodoroPhaseLabel(before.phase) }), {
      id: 'pomodoro-phase',
    });
    if (!settings.sound || !sound.available) return;
    const key = 'pomodoro:last-sound';
    const phase = `${before.id}:${before.phase_number}`;
    // Dues pestanyes poden observar el mateix termini, però només una el fa sonar.
    void db
      .transaction('rw', db.meta, async () => {
        if ((await readMeta(db, key)) === phase) return false;
        await writeMeta(db, key, phase);
        return true;
      })
      .then((first) => {
        if (first) sound.play();
      })
      .catch(() => undefined);
  }, [db, deviceId, notify, offset, settings.sound, snapshot.timer, sound, time, timer]);

  const boardPath =
    settings.enabled && scopes.length > 0
      ? `/api/v1/board?${new URLSearchParams({ scope_ids: scopes.map((scope) => scope.id).join(',') })}`
      : null;
  const board = useBoardQuery<Board>(boardPath);
  const boardProjection = useMemo<PomodoroBoardProjection>(
    () => ({ moves, received: confirmed?.moved_task }),
    [moves, confirmed?.moved_task],
  );
  const boardTasks = useMemo(() => {
    const tasks =
      board.data?.columns.flatMap((column) => column.groups.flatMap((group) => group.tasks)) ?? [];
    return projectBoardTasks(
      tasks,
      [...pending, ...moves].sort(compareOperations),
      confirmed?.moved_task,
    );
  }, [board.data, pending, moves, confirmed?.moved_task]);
  const tasks = useMemo(
    () => boardTasks.filter((task) => task.status === 'todo' || task.status === 'doing'),
    [boardTasks],
  );
  const task = tasks.find(({ id }) => id === timer?.task_id);
  const issue = pending.find(
    (row) =>
      row.entity_type === 'pomodoro' && (row.status === 'conflict' || row.status === 'failed'),
  )?.status;

  const stage = async (command: PomodoroCommand): Promise<void> => {
    try {
      await submit({
        entity_type: 'pomodoro',
        entity_id: profile.id,
        op: 'update',
        payload: { ...command },
      });
    } catch {
      notify(t('pomodoro.saveError'), { tone: 'error', id: 'pomodoro-save-error' });
    }
  };

  function commandTime(): number {
    const now = Date.now();
    setTime(now);
    return now + offset;
  }

  function appendPosition(scopeId: string, status: 'doing' | 'done'): string {
    const last = boardTasks.reduce<string | null>(
      (position, task) =>
        task.status === status &&
        task.scope_id === scopeId &&
        (position === null || comparePositions(position, task.position) < 0)
          ? task.position
          : position,
      null,
    );
    return generatePosition(last, null);
  }

  function doingPosition(selected: string | null): string | undefined {
    const chosen = tasks.find((task) => task.id === selected);
    if (chosen?.status !== 'todo') return undefined;
    return appendPosition(chosen.scope_id, 'doing');
  }

  async function start(selected?: string | null): Promise<void> {
    if (!settings.enabled || timer?.status === 'running') return;
    if (settings.sound) sound.prepare();
    const at_ms = commandTime();
    if (timer === null) {
      const task_id =
        selected === undefined
          ? (queue.find((id) => tasks.some((task) => task.id === id)) ?? null)
          : selected;
      const position = doingPosition(task_id);
      await stage({
        kind: 'start',
        timer_id: uuidv7(),
        device_id: deviceId,
        at_ms,
        task_id,
        ...(position === undefined ? {} : { position }),
      });
      return;
    }
    const choice = timer.phase === 'focus' && timer.status === 'ready' ? selected : undefined;
    const position = choice === undefined ? undefined : doingPosition(choice);
    await stage({
      kind: 'control',
      action: 'resume',
      timer_id: timer.id,
      expected_version: timer.version,
      phase_number: timer.phase_number,
      at_ms,
      device_id: deviceId,
      ...(choice === undefined ? {} : { task_id: choice }),
      ...(position === undefined ? {} : { position }),
    });
  }

  async function control(action: Exclude<Control, 'resume'>): Promise<void> {
    if (timer === null) return;
    await stage({
      kind: 'control',
      action,
      timer_id: timer.id,
      expected_version: timer.version,
      phase_number: timer.phase_number,
      at_ms: commandTime(),
      device_id: deviceId,
    });
  }

  async function markDone(): Promise<void> {
    if (task === undefined) return;
    const position = appendPosition(task.scope_id, 'done');
    const send = (extra: MoveExtra) =>
      api.post<Task>(`/api/v1/tasks/${task.id}/move`, { status: 'done', position, ...extra });
    const move = async (extra: MoveExtra): Promise<void> => {
      if (extra.time_entry !== undefined) {
        await send(extra);
        board.reload();
        reload();
        return;
      }
      await submit(
        {
          entity_id: task.id,
          task_title: task.title,
          op: 'move',
          base_version: task.version,
          payload: { status: 'done', position, from_status: task.status },
        },
        () => send(extra),
      );
    };
    if (navigator.onLine && ![...pending, ...moves].some((row) => row.entity_id === task.id)) {
      await completion.request(task.id, 'done', move);
    } else {
      await move({}).catch((error: unknown) => notify(failureText(error), { tone: 'error' }));
    }
  }

  const value: Pomodoro = {
    settings,
    timer,
    remainingMs:
      timer === null ? settings.focus_minutes * 60_000 : pomodoroRemainingMs(timer, time + offset),
    queue,
    task,
    tasks,
    open: settings.enabled && open,
    setOpen,
    unavailable: confirmed === undefined && error instanceof ApiError && error.status === 404,
    issue: issue === 'conflict' || issue === 'failed' ? issue : undefined,
    changeSettings: async (patch) => {
      if (patch.enabled === false) setOpen(false);
      await stage({ kind: 'settings', patch });
    },
    changeQueue: (task_ids) =>
      stage({ kind: 'queue', expected_version: snapshot.queue_version, task_ids }),
    start,
    control,
    markDone,
  };
  return (
    <PomodoroContext.Provider value={value}>
      <BoardProjection.Provider value={boardProjection}>{children}</BoardProjection.Provider>
      {completion.dialog}
    </PomodoroContext.Provider>
  );
}
