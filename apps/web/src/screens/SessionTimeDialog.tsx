import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { v7 as uuidv7 } from 'uuid';
import { t, type components } from '@fem-ho/contracts';
import { api, ApiError, failureText } from '../app/api.js';
import { useToasts } from '../app/toasts.js';
import { useApi } from '../app/useApi.js';
import { useSessionData } from '../app/session.js';
import { inputInstant, localInput, STEP } from './chrono-time.js';
import type { SessionEntry } from './RegistreScreen.js';
export interface TimeDraft {
  scopeId: string;
  projectId: string | null;
  start: number;
  end: number | null;
  entry?: SessionEntry;
}
export function SessionTimeDialog({
  draft,
  onClose,
  onSaved,
  onOpenTask,
}: {
  draft: TimeDraft;
  onClose: () => void;
  onSaved: () => void;
  onOpenTask: (id: string) => void;
}) {
  const { notify } = useToasts();
  const { profile, projects } = useSessionData();
  const dialog = useRef<HTMLDialogElement>(null);
  const [start, setStart] = useState(localInput(draft.start, profile.timezone));
  const [end, setEnd] = useState(draft.end === null ? '' : localInput(draft.end, profile.timezone));
  const [project, setProject] = useState(draft.projectId ?? 'none');
  const [kind, setKind] = useState<'new' | 'existing'>('new');
  const [search, setSearch] = useState('');
  const [task, setTask] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [ids] = useState(() => ({ session: uuidv7(), task: uuidv7() }));
  const query = new URLSearchParams({
    scope_ids: draft.scopeId,
    project_ids: project,
    metric: 'created',
    search,
    limit: '100',
  });
  const tasks = useApi<components['schemas']['TaskReport']>(
    !draft.entry && kind === 'existing' ? `/api/v1/reports/tasks?${query}` : null,
  );
  const types = useApi<{ data: components['schemas']['TaskType'][] }>(
    `/api/v1/task-types?scope_id=${draft.scopeId}`,
  );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const projectChanged = !!draft.entry && project !== (draft.entry.project_id ?? 'none');
  async function save() {
    const from =
      start === localInput(draft.start, profile.timezone)
        ? draft.start
        : inputInstant(start, profile.timezone, draft.start);
    const to =
      draft.end === null
        ? null
        : end === localInput(draft.end, profile.timezone)
          ? draft.end
          : inputInstant(end, profile.timezone, draft.end);
    if (
      !Number.isFinite(from) ||
      (to !== null && (!Number.isFinite(to) || to - from < STEP)) ||
      (to === null && from >= Date.now())
    ) {
      setError(t('error.invalid-session'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (draft.entry) {
        await api.patch(`/api/v1/sessions/${draft.entry.id}`, {
          started_at: new Date(from).toISOString(),
          ...(to === null ? {} : { ended_at: new Date(to).toISOString() }),
          ...(projectChanged ? { project_id: project === 'none' ? null : project } : {}),
          expected_version: draft.entry.version,
        });
      } else {
        await api.post('/api/v1/sessions', {
          id: ids.session,
          started_at: new Date(from).toISOString(),
          ended_at: new Date(to!).toISOString(),
          ...(kind === 'existing'
            ? { task_id: task }
            : {
                new_task: {
                  id: ids.task,
                  scope_id: draft.scopeId,
                  ...(project === 'none' ? {} : { project_id: project }),
                  title,
                  ...(type ? { task_type_id: type } : {}),
                  assignee_ids: [profile.id],
                },
              }),
        });
      }
      onSaved();
      onClose();
    } catch (cause) {
      onSaved();
      if (cause instanceof ApiError && cause.status === 409) {
        notify(failureText(cause), { tone: 'error' });
        onClose();
      } else {
        setError(failureText(cause));
      }
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      className="chrono-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="chrono-dialog-title"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="chrono-dialog-title">{t(draft.entry ? 'chrono.edit' : 'chrono.add')}</h2>
        {draft.entry ? (
          <p>{draft.entry.task_title}</p>
        ) : (
          <>
            <label>
              {t('chrono.taskChoice')}
              <select value={kind} onChange={(e) => setKind(e.target.value as 'new' | 'existing')}>
                <option value="new">{t('chrono.newTask')}</option>
                <option value="existing">{t('chrono.existingTask')}</option>
              </select>
            </label>
            {kind === 'new' ? (
              <>
                <label>
                  {t('chrono.title')}
                  <input
                    autoFocus
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <p>{t('chrono.createdDone')}</p>
                <label>
                  {t('task.taskType')}
                  <select value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">{t('stats.noType')}</option>
                    {types.data?.data.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  {t('nav.search')}
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setTask('');
                    }}
                  />
                </label>
                <label>
                  {t('chrono.existingTask')}
                  <select required value={task} onChange={(e) => setTask(e.target.value)}>
                    <option value="">{t('chrono.selectTask')}</option>
                    {tasks.data?.data.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {tasks.data?.next_cursor && <p>{t('chrono.refineSearch')}</p>}
              </>
            )}
          </>
        )}
        <label>
          {t('registre.col.project')}
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setTask('');
              setConfirmed(false);
            }}
          >
            <option value="none">{t('registre.noProject')}</option>
            {projects
              .filter((p) => p.scope_id === draft.scopeId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t('chrono.start')}
          <input
            required
            type="datetime-local"
            step="60"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        {draft.end === null ? (
          <p>{t('chrono.running')}</p>
        ) : (
          <label>
            {t('chrono.end')}
            <input
              required
              type="datetime-local"
              step="60"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        )}
        <p>{profile.timezone}</p>
        {projectChanged && (
          <label>
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t('chrono.moveWarning')}
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="chrono-actions">
          <button type="button" className="plou-btn" disabled={busy} onClick={onClose}>
            {t('nav.cancel')}
          </button>
          <button
            type="submit"
            className="plou-btn"
            disabled={busy || (projectChanged && !confirmed)}
          >
            {t('nav.save')}
          </button>
          {draft.entry && (
            <button
              type="button"
              className="plou-btn"
              disabled={busy}
              onClick={() => {
                onClose();
                onOpenTask(draft.entry!.task_id);
              }}
            >
              {t('chrono.openTask')}
            </button>
          )}
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
