import type { components } from './generated/api.js';

export type PomodoroTiming = components['schemas']['PomodoroTiming'];
export type PomodoroSettings = components['schemas']['PomodoroSettings'];
export type PomodoroSnapshot = components['schemas']['PomodoroSnapshot'];
export type PomodoroTimer = components['schemas']['PomodoroTimer'];
export type PomodoroCommand = components['schemas']['PomodoroCommand'];

export const POMODORO_DEFAULTS: Readonly<PomodoroSettings> = Object.freeze({
  enabled: false,
  mode: 'playful',
  focus_minutes: 25,
  short_break_minutes: 5,
  long_break_minutes: 15,
  long_break_every: 4,
  auto_start_focus: false,
  auto_start_break: false,
  sound: true,
});

const MINUTE_MS = 60_000;

export function emptyPomodoroSnapshot(nowMs = 0): PomodoroSnapshot {
  return {
    settings: { ...POMODORO_DEFAULTS },
    queue: [],
    queue_version: 0,
    timer: null,
    server_time_ms: nowMs,
  };
}

function durationMs(phase: PomodoroTimer['phase'], timing: PomodoroTiming): number {
  switch (phase) {
    case 'focus':
      return timing.focus_minutes * MINUTE_MS;
    case 'short_break':
      return timing.short_break_minutes * MINUTE_MS;
    case 'long_break':
      return timing.long_break_minutes * MINUTE_MS;
  }
}

function nextPhase(timer: PomodoroTimer, boundary: number, earned: boolean): PomodoroTimer {
  const { timing } = timer;
  const focused = timer.phase === 'focus' && earned;
  const completed = timer.completed_focus + Number(focused);
  const phase =
    timer.phase !== 'focus'
      ? 'focus'
      : focused && completed % timing.long_break_every === 0
        ? 'long_break'
        : 'short_break';
  const remaining = durationMs(phase, timing);
  const autoStart = phase === 'focus' ? timing.auto_start_focus : timing.auto_start_break;

  return {
    ...timer,
    phase,
    phase_number: timer.phase_number + 1,
    status: autoStart ? 'running' : 'ready',
    remaining_ms: remaining,
    end_at_ms: autoStart ? boundary + remaining : null,
    completed_focus: completed,
  };
}

/** Projecta les fases des dels terminis. El resultat no és una escriptura ni canvia la versió. */
export function projectPomodoroTimer(
  timer: PomodoroTimer | null,
  nowMs: number,
): PomodoroTimer | null {
  let current = timer;
  while (
    current?.status === 'running' &&
    current.end_at_ms !== null &&
    current.end_at_ms <= nowMs
  ) {
    const end = current.end_at_ms;
    const { timing } = current;
    const focusMs = durationMs('focus', timing);
    const perCycle = timing.long_break_every;
    if (
      timing.auto_start_focus &&
      timing.auto_start_break &&
      current.phase === 'focus' &&
      current.remaining_ms === focusMs &&
      current.completed_focus % perCycle === 0
    ) {
      // Un dispositiu pot tornar dies després. Es poden saltar rondes completes sense
      // recórrer totes les fases intermèdies, que no tenen cap efecte fora del rellotge.
      const cycleMs =
        perCycle * focusMs +
        (perCycle - 1) * durationMs('short_break', timing) +
        durationMs('long_break', timing);
      const rounds = Math.floor((nowMs - end + focusMs) / cycleMs);
      if (rounds > 0) {
        current = {
          ...current,
          end_at_ms: end + rounds * cycleMs,
          completed_focus: current.completed_focus + rounds * perCycle,
          phase_number: current.phase_number + 2 * rounds * perCycle,
        };
        continue;
      }
    }
    current = nextPhase(current, end, true);
  }
  return current;
}

export function pomodoroRemainingMs(timer: PomodoroTimer, nowMs: number): number {
  if (timer.end_at_ms === null) return timer.remaining_ms;
  return Math.max(0, Math.min(timer.remaining_ms, timer.end_at_ms - nowMs));
}

/** Les ordres es reprodueixen amb l'instant del gest, incloses les que arriben sense xarxa. */
export function applyPomodoroCommand(
  snapshot: PomodoroSnapshot,
  command: PomodoroCommand,
): PomodoroSnapshot | null {
  switch (command.kind) {
    case 'settings': {
      const settings = { ...snapshot.settings, ...command.patch };
      return { ...snapshot, settings, timer: settings.enabled ? snapshot.timer : null };
    }
    case 'queue':
      if (command.expected_version !== snapshot.queue_version) return null;
      return { ...snapshot, queue: command.task_ids, queue_version: snapshot.queue_version + 1 };
    case 'start': {
      if (!snapshot.settings.enabled || snapshot.timer !== null) return null;
      const { enabled: _enabled, mode: _mode, sound: _sound, ...timing } = snapshot.settings;
      const duration = durationMs('focus', timing);
      return {
        ...snapshot,
        timer: {
          id: command.timer_id,
          version: 1,
          phase: 'focus',
          phase_number: 1,
          status: 'running',
          end_at_ms: command.at_ms + duration,
          remaining_ms: duration,
          completed_focus: 0,
          task_id: command.task_id,
          device_id: command.device_id,
          timing,
        },
      };
    }
    case 'control': {
      const timer = projectPomodoroTimer(snapshot.timer, command.at_ms);
      if (
        timer === null ||
        timer.id !== command.timer_id ||
        timer.version !== command.expected_version ||
        timer.phase_number !== command.phase_number
      ) {
        return null;
      }
      const updated = controlPomodoroTimer(timer, command);
      if (updated === undefined) return null;
      return {
        ...snapshot,
        timer: updated === null ? null : { ...updated, version: timer.version + 1 },
      };
    }
  }
}

function controlPomodoroTimer(
  timer: PomodoroTimer,
  command: Extract<PomodoroCommand, { kind: 'control' }>,
): PomodoroTimer | null | undefined {
  const { action, at_ms: at, task_id: taskId } = command;
  const canChooseTask = action === 'resume' && timer.status === 'ready' && timer.phase === 'focus';
  if (taskId !== undefined && !canChooseTask) return undefined;

  switch (action) {
    case 'resume':
      if (timer.status === 'running') return undefined;
      return {
        ...timer,
        status: 'running',
        end_at_ms: at + timer.remaining_ms,
        device_id: command.device_id,
        task_id: taskId === undefined ? timer.task_id : taskId,
      };
    case 'pause':
      if (timer.status !== 'running') return undefined;
      return {
        ...timer,
        status: 'paused',
        end_at_ms: null,
        remaining_ms: pomodoroRemainingMs(timer, at),
      };
    case 'reset':
      return {
        ...timer,
        status: 'ready',
        end_at_ms: null,
        remaining_ms: durationMs(timer.phase, timer.timing),
      };
    case 'skip':
      return nextPhase(timer, at, false);
    case 'stop':
      return null;
  }
}
