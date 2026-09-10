/** Completar directament i anotar temps és una sola acció, compartida pel tauler i la fitxa. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { v7 as uuidv7 } from 'uuid';
import { t, type components, type TaskStatus } from '@fem-ho/contracts';
import { api, failureText } from '../app/api.js';
import { useToasts } from '../app/toasts.js';
import type { Task, ScopeSettings } from '../app/types.js';
export type MoveExtra = Pick<components['schemas']['MoveInput'], 'time_entry' | 'expected_version'>;
type Perform = (extra: MoveExtra) => Promise<unknown>;
export function useTimeCompletion() {
  const [draft, setDraft] = useState<{ task: Task; perform: Perform } | null>(null);
  const checking = useRef(false);
  const mounted = useRef(true);
  const { notify } = useToasts();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function request(id: string, status: TaskStatus, perform: Perform) {
    if (checking.current || draft) return;
    checking.current = true;
    try {
      if (status === 'done') {
        const task = await api.get<Task>(`/api/v1/tasks/${id}`);
        if (task.status === 'todo' || task.status === 'inbox') {
          const config = await api.get<ScopeSettings>(`/api/v1/scopes/${task.scope_id}/settings`);
          if (!mounted.current) return;
          if (config.time_tracking) {
            setDraft({ task, perform });
            return;
          }
        }
      }
      if (mounted.current) await perform({});
    } catch (cause) {
      if (mounted.current) notify(failureText(cause), { tone: 'error' });
    } finally {
      checking.current = false;
    }
  }
  return {
    request,
    dialog: draft ? (
      <CompletionTimeDialog
        task={draft.task}
        perform={draft.perform}
        onClose={() => setDraft(null)}
      />
    ) : null,
  };
}
function CompletionTimeDialog({
  task,
  perform,
  onClose,
}: {
  task: Task;
  perform: Perform;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session] = useState(() => ({ id: uuidv7(), ended_at: new Date().toISOString() }));
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function save() {
    const amount = Number(minutes);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10080) {
      setError(t('tracking.invalidDuration'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await perform({
        time_entry: { ...session, minutes: amount },
        expected_version: task.version,
      });
      onClose();
    } catch (cause) {
      setError(failureText(cause));
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={ref}
      className="chrono-dialog"
      data-testid="completion-time-dialog"
      aria-labelledby="completion-time-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        <h2 id="completion-time-title">{t('tracking.askDuration')}</h2>
        <p>{task.title}</p>
        <p>{t('tracking.completionHint')}</p>
        <label>
          {t('tracking.minutes')}
          <input
            autoFocus
            required
            type="number"
            min="1"
            max="10080"
            step="1"
            value={minutes}
            disabled={busy}
            onChange={(event) => setMinutes(event.target.value)}
            data-testid="completion-minutes"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="chrono-actions">
          <button type="button" className="plou-btn" disabled={busy} onClick={onClose}>
            {t('nav.cancel')}
          </button>
          <button type="submit" className="plou-btn" disabled={busy}>
            {t('tracking.saveComplete')}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
