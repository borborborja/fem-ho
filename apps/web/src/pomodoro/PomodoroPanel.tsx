import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '@fem-ho/contracts';
import tomato from '../assets/pomodoro.svg';
import { durationClock } from '../board/TaskTimeBadge.js';
import { pomodoroPhaseLabel, usePomodoro } from './PomodoroProvider.js';
import './pomodoro.css';

function countdown(ms: number): string {
  return durationClock(Math.ceil(ms / 1000));
}

export function PomodoroTrigger() {
  const focus = usePomodoro();
  if (!focus?.settings.enabled) return null;
  return (
    <button
      type="button"
      className="pomodoro-trigger"
      data-testid="pomodoro-open"
      aria-haspopup="dialog"
      aria-label={t('pomodoro.title')}
      title={t('pomodoro.title')}
      onClick={() => focus.setOpen(true)}
    >
      <span
        className="pomodoro-trigger-icon"
        aria-hidden="true"
        style={{ maskImage: `url("${tomato}")` }}
      />
      {focus.timer !== null && <span aria-hidden="true">{countdown(focus.remainingMs)}</span>}
    </button>
  );
}

export function PomodoroPanel() {
  const focus = usePomodoro();
  return focus?.open ? <OpenPomodoro focus={focus} /> : null;
}

type Focus = NonNullable<ReturnType<typeof usePomodoro>>;

function OpenPomodoro({ focus }: { focus: Focus }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<{ phase: string; id: string }>();
  const { timer, queue, tasks, task } = focus;
  const phase = timer?.phase ?? 'focus';
  const running = timer?.status === 'running';
  const paused = timer?.status === 'paused';
  const phaseKey = timer === null ? '' : `${timer.id}:${timer.phase_number}`;
  const readyFocus = phase === 'focus' && !running && !paused;
  const queued = queue.map((id) => ({ id, task: tasks.find((row) => row.id === id) }));
  const options = queued.flatMap(({ task }) => (task === undefined ? [] : [task]));
  if (task !== undefined && !queue.includes(task.id)) options.push(task);
  const selectedTask =
    choice?.phase === phaseKey
      ? choice.id
      : timer === null
        ? (options[0]?.id ?? '')
        : (task?.id ?? '');
  const playful = focus.settings.mode === 'playful';
  const timing = timer?.timing ?? focus.settings;
  const phaseMinutes =
    phase === 'focus'
      ? timing.focus_minutes
      : phase === 'short_break'
        ? timing.short_break_minutes
        : timing.long_break_minutes;
  const progress = Math.min(
    100,
    Math.max(0, 100 * (1 - focus.remainingMs / (phaseMinutes * 60_000))),
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function moveQueue(index: number, offset: number): void {
    const next = [...queue];
    const source = next[index];
    const destination = next[index + offset];
    if (source === undefined || destination === undefined) return;
    next[index + offset] = source;
    next[index] = destination;
    void focus.changeQueue(next);
  }

  const available = tasks.filter((item) => item.status === 'todo' && !queue.includes(item.id));
  return (
    <dialog
      ref={dialog}
      className={playful ? 'pomodoro-dialog pomodoro-theme-fun' : 'pomodoro-dialog'}
      data-testid="pomodoro-panel"
      data-mode={focus.settings.mode}
      aria-labelledby="pomodoro-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        focus.setOpen(false);
      }}
    >
      <header className="pomodoro-header">
        <h2 id="pomodoro-title">{t('pomodoro.title')}</h2>
        <button
          type="button"
          className="plou-btn"
          data-testid="pomodoro-close-panel"
          onClick={() => focus.setOpen(false)}
        >
          {t('pomodoro.close')}
        </button>
      </header>
      {focus.issue !== undefined && (
        <p role="alert">
          {t(focus.issue === 'conflict' ? 'pomodoro.conflict' : 'pomodoro.saveError')}
        </p>
      )}
      <section className="pomodoro-timer" aria-label={pomodoroPhaseLabel(phase)}>
        <p className="pomodoro-phase" role="status" data-testid="pomodoro-phase">
          {pomodoroPhaseLabel(phase)}
          {paused ? ` · ${t('pomodoro.paused')}` : !running ? ` · ${t('pomodoro.ready')}` : ''}
        </p>
        <div
          className="pomodoro-ring"
          data-testid="pomodoro-ring"
          style={{ '--pomodoro-progress': `${progress}%` } as CSSProperties}
        >
          <div className="pomodoro-clock-face">
            {playful && (
              <span
                className="pomodoro-tomato"
                data-testid="pomodoro-tomato"
                aria-hidden="true"
                style={{ maskImage: `url("${tomato}")` }}
              />
            )}
            <output
              className="pomodoro-countdown"
              role="timer"
              aria-live="off"
              data-testid="pomodoro-countdown"
            >
              {countdown(focus.remainingMs)}
            </output>
          </div>
        </div>
        {timer !== null && (
          <p className="pomodoro-phase">
            {t('pomodoro.completed', { count: timer.completed_focus })}
          </p>
        )}
        {readyFocus ? (
          <select
            className="plou-input"
            aria-label={t('pomodoro.chooseTask')}
            data-testid="pomodoro-choose-task"
            value={selectedTask}
            onChange={(event) => setChoice({ phase: phaseKey, id: event.target.value })}
          >
            <option value="">{t('pomodoro.noTask')}</option>
            {options.map((option) => (
              <option value={option.id} key={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        ) : task !== undefined ? (
          <p className="pomodoro-task">{task.title}</p>
        ) : null}
        <div className="pomodoro-controls">
          {running ? (
            <button
              type="button"
              className="plou-btn plou-btn-primary"
              data-testid="pomodoro-pause"
              onClick={() => void focus.control('pause')}
            >
              {t('pomodoro.pause')}
            </button>
          ) : (
            <button
              type="button"
              className="plou-btn plou-btn-primary"
              data-testid="pomodoro-start"
              onClick={() => void focus.start(readyFocus ? selectedTask || null : undefined)}
            >
              {t(paused ? 'pomodoro.resume' : 'pomodoro.start')}
            </button>
          )}
          {timer !== null && (
            <>
              <button
                type="button"
                className="plou-btn"
                data-testid="pomodoro-reset"
                onClick={() => void focus.control('reset')}
              >
                {t('pomodoro.reset')}
              </button>
              <button
                type="button"
                className="plou-btn"
                data-testid="pomodoro-skip"
                onClick={() => void focus.control('skip')}
              >
                {t('pomodoro.skip')}
              </button>
              <button
                type="button"
                className="plou-btn"
                data-testid="pomodoro-stop"
                onClick={() => void focus.control('stop')}
              >
                {t('pomodoro.stop')}
              </button>
              {task !== undefined && (
                <button
                  type="button"
                  className="plou-btn"
                  data-testid="pomodoro-done"
                  onClick={() => void focus.markDone()}
                >
                  {t('pomodoro.done')}
                </button>
              )}
            </>
          )}
        </div>
      </section>
      <section className="pomodoro-queue" aria-labelledby="pomodoro-queue-title">
        <h3 id="pomodoro-queue-title">{t('pomodoro.queue')}</h3>
        {available.length > 0 ? (
          <select
            className="plou-input"
            aria-label={t('pomodoro.addTask')}
            data-testid="pomodoro-add-task"
            value=""
            onChange={(event) => {
              if (event.target.value !== '') void focus.changeQueue([...queue, event.target.value]);
            }}
          >
            <option value="">{t('pomodoro.addTask')}</option>
            {available.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        ) : (
          <p>{t('pomodoro.noCandidates')}</p>
        )}
        {queue.length === 0 ? (
          <p>{t('pomodoro.emptyQueue')}</p>
        ) : (
          <ol className="pomodoro-queue-list" data-testid="pomodoro-queue">
            {queued.map(({ id, task: item }, index) => (
              <li
                key={id}
                className="pomodoro-queue-item"
                aria-current={timer?.task_id === id}
                data-testid={`pomodoro-item-${id}`}
              >
                <span className="pomodoro-queue-title">
                  {item?.title ?? t('pomodoro.taskUnavailable')}
                </span>
                <div className="pomodoro-queue-actions">
                  <button
                    type="button"
                    className="plou-btn"
                    disabled={index === 0}
                    aria-label={t('pomodoro.moveUp')}
                    title={t('pomodoro.moveUp')}
                    onClick={() => moveQueue(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="plou-btn"
                    disabled={index + 1 === queue.length}
                    aria-label={t('pomodoro.moveDown')}
                    title={t('pomodoro.moveDown')}
                    onClick={() => moveQueue(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="plou-btn"
                    aria-label={t('pomodoro.removeTask')}
                    title={t('pomodoro.removeTask')}
                    onClick={() => void focus.changeQueue(queue.filter((itemId) => itemId !== id))}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </dialog>
  );
}
