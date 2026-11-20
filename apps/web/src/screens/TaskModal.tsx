import { useTimeCompletion } from '../board/useTimeCompletion.js';
/**
 * El modal d'edició completa. docs/02 §7.
 *
 * `Escape` tanca **amb confirmació si hi ha canvis**, i `Cmd/Ctrl+Enter` desa. Sense la
 * confirmació, obrir una tasca per llegir-la i tocar Escape sense voler s'endú l'edició
 * que estaves fent, i no hi ha manera de recuperar-la.
 *
 * Els camps es desen **al desar**, no a cada tecla: un `PATCH` per pulsació ompliria
 * l'historial d'entrades que no són canvis de ningú i faria l'auditoria inservible.
 * L'excepció són les coses que ja són gestos discrets —marcar una subtasca, afegir un
 * comentari—, que es desen soles perquè no formen part del formulari.
 */

import { useEffect, useEffectEvent, useLayoutEffect, useState } from 'react';
import {
  dateTime,
  getLocale,
  relativeTime,
  shortTime,
  SOURCES,
  t,
  type operations,
  type TaskStatus,
} from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { ActivityTimeline, EmptyState } from '@fem-ho/design-system/femho';
import { api, failureText } from '../app/api.js';
import { Attachments } from '../app/Attachments.js';
import { taskAiMethodLabel, taskAiStatusLabel, type TaskAiExecution } from '../app/task-ai.js';
import { McpSourceBadge } from '../board/McpSourceBadge.js';
import { SubtaskRow } from '../board/SubtaskRow.js';
import { TaskAiAction } from '../board/TaskAiAction.js';
import { useSessionData } from '../app/session.js';
import { useToasts } from '../app/toasts.js';
import { useApi, useMutation } from '../app/useApi.js';
import { useBoardQuery } from '../sync/board-sync.js';
import { useSubtaskSync } from '../sync/subtask-sync.js';
import type { ActivityEntry, Comment, Label, Task, TaskType } from '../app/types.js';

/**
 * Els verbs que l'historial sap traduir.
 *
 * La llista viu aquí i no al component perquè el component no sap català (regla 3): rep
 * el diccionari ja resolt. Un verb que no hi sigui es veurà cru, que és el mateix criteri
 * que `t()` amb una clau que falta — visible i corregible, no un forat.
 */
const VERBS = [
  'attachment.created',
  'created',
  'updated',
  'subtask.completed',
  'subtask.created',
  'subtask.reopened',
  'subtask.updated',
  'checklist.created',
  'checklist_item.created',
  'checklist_item.completed',
  'checklist_item.reopened',
  'checklist_item.updated',
  'moved',
  'completed',
  'reopened',
  'cascade_complete',
  'commented',
  // La pregunta d'un agent i la resposta que el desencalla.
  'asked',
  'answered',
  'refreshed',
  'deleted',
  'claimed',
  'released',
  'token_created',
  'token_revoked',
  'ai_execution_requested',
  'ai_execution_updated',
  'ai_execution_result',
] as const;

function executionActivity(entry: ActivityEntry, owned: TaskAiExecution[]) {
  if (!entry.verb.startsWith('ai_execution_')) return {};
  const id = entry.changes?.execution_id?.to;
  const method = entry.changes?.method?.to;
  const status = entry.changes?.status?.to;
  if (typeof id !== 'string' || (method !== 'mcp_events' && method !== 'claude_routine')) return {};
  const execution = owned.find((item) => item.id === id);
  const sessionUrl = status === 'delivered' ? execution?.session_url : null;
  const retryAt = status === 'failed' ? execution?.retry_at : null;
  return {
    changes: null,
    message:
      entry.verb === 'ai_execution_result' || typeof status !== 'string'
        ? undefined
        : taskAiStatusLabel(status, method),
    details: (
      <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>
        {taskAiMethodLabel(method)}
        {' · '}
        <code title={id}>{id.slice(-8)}</code>
        {sessionUrl ? (
          <a href={sessionUrl} target="_blank" rel="noreferrer" style={{ marginInlineStart: 8 }}>
            {t('ai.tasks.openSession')}
          </a>
        ) : null}
        {retryAt ? (
          <div>{t('ai.tasks.retryAt', { when: dateTime(getLocale(), new Date(retryAt)) })}</div>
        ) : null}
      </div>
    ),
  };
}

export interface TaskModalProps {
  /** Editar una tasca que ja hi és. Excloent amb `create`. */
  taskId?: string;
  /**
   * Crear-ne una de nova en aquesta columna.
   *
   * `forAi` ve del botó "Nova tasca per a la IA" del kanban de la IA i neix delegada:
   * és l'única manera del disseny validat de crear feina per a la IA amb instruccions,
   * perquè un camp d'afegida ràpida no té on posar-les.
   */
  create?: {
    status: TaskStatus;
    forAi: boolean;
    scopeIds: string[];
    projectIds?: string[];
    /**
     * El dia que ha de portar posat.
     *
     * El calendari obre aquest modal des del peu d'un dia concret: obrir-lo buit obligaria
     * a tornar a triar el dia que acabes de mirar.
     */
    dueDate?: string | null;
  };
  onClose: () => void;
  onChanged: () => void;
  onShare: (taskId: string) => void;
  onOpenList: (checklistId: string) => void;
}

type Draft = {
  title: string;
  description: string;
  due_date: string;
  due_time: string;
  deadline: string;
  rrule: string;
  recurrence_mode: 'schedule' | 'completion';
  ai_mode: Task['ai_mode'];
  ai_instructions: string;
  scope_id: string;
  project_id: string;
  task_type_id: string;
};

function emptyToNull(value: string | undefined): string | null | undefined {
  return value === '' ? null : value;
}

function deadlineForDay(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === '' ? null : `${value}T23:59:59.000Z`;
}

/**
 * Les repeticions que una tasca domèstica fa servir.
 *
 * No hi ha constructor de regles arbitràries: una interfície per compondre `BYDAY`,
 * `BYSETPOS` i `WKST` és molta pantalla per a un cas que gairebé ningú té, i la que la
 * gent vol —"cada setmana", "cada mes"— cap en quatre botons. Una regla més complicada
 * que arribi per CalDAV es conserva i **no es toca**: es veu com a personalitzada.
 */
const RECURRENCES = [
  { rrule: '', key: 'none' },
  { rrule: 'FREQ=DAILY', key: 'daily' },
  { rrule: 'FREQ=WEEKLY', key: 'weekly' },
  { rrule: 'FREQ=MONTHLY', key: 'monthly' },
  { rrule: 'FREQ=YEARLY', key: 'yearly' },
] as const;

export function TaskModal({
  taskId,
  create,
  onClose,
  onChanged,
  onShare,
  onOpenList,
}: TaskModalProps) {
  const { scopes, projects, people } = useSessionData();
  const { notify } = useToasts();
  const creating = create !== undefined;
  const completion = useTimeCompletion();

  // Una tasca que encara no existeix no té res a demanar: cap crida fins que es desa.
  const task = useBoardQuery<Task>(creating ? null : `/api/v1/tasks/${taskId ?? ''}`);
  const subtaskSync = useSubtaskSync(creating ? undefined : taskId, !creating);
  const { subtasks, checklists } = subtaskSync;
  const comments = useApi<Comment[]>(creating ? null : `/api/v1/tasks/${taskId ?? ''}/comments`);
  const activity = useApi<{ data: ActivityEntry[] }>(
    creating ? null : `/api/v1/tasks/${taskId ?? ''}/activity`,
  );
  const executions = useApi<
    operations['listTaskAiExecutions']['responses'][200]['content']['application/json']
  >(taskId === undefined ? null : `/api/v1/tasks/${taskId}/ai-executions`);
  const refreshExecutions = useEffectEvent(() => {
    executions.reload();
    activity.reload();
    comments.reload();
  });
  const latestExecution = executions.data?.data[0];
  const latestId = latestExecution?.id;
  const latestRequestedAt = activity.data?.data.find(
    (entry) =>
      entry.verb === 'ai_execution_requested' && entry.changes?.execution_id?.to === latestId,
  )?.created_at;
  const waitingForAi =
    latestExecution?.status === 'queued' ||
    latestExecution?.status === 'sending' ||
    ((latestExecution?.status === 'delivered' || latestExecution?.status === 'uncertain') &&
      latestExecution.result_comment_id === null);
  useEffect(() => {
    if (!waitingForAi) return undefined;
    // Un connector que només llegeix pot lliurar l'avís i no tornar cap comentari.
    const followWindow = 10 * 60 * 1000;
    const requestedAt = Date.parse(latestRequestedAt ?? '');
    const remaining = Number.isFinite(requestedAt)
      ? Math.min(followWindow, requestedAt + followWindow - Date.now())
      : followWindow;
    if (remaining <= 0) return undefined;
    const interval = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) refreshExecutions();
    }, 5000);
    const stop = window.setTimeout(() => window.clearInterval(interval), remaining);
    return () => {
      window.clearTimeout(stop);
      window.clearInterval(interval);
    };
  }, [waitingForAi, latestId, latestRequestedAt]);

  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [newTaskId] = useState(() => uuidv7());
  const [confirming, setConfirming] = useState(false);
  /**
   * L'esborrat demana confirmació i **no és desfés-ho**.
   *
   * A la base tot és esborrat suau i la tombstone viatja als altres dispositius, però
   * `undo` només val per a un canvi autònom de la IA amb valors anteriors: no hi ha cap
   * camí perquè una persona recuperi una tasca des de la interfície. Mentre no n'hi hagi,
   * el que toca és preguntar-ho abans i dir **què més se n'anirà**.
   */
  const [deleting, setDeleting] = useState(false);

  const remove = useMutation(async () => {
    if (taskId === undefined) return;
    await api.delete(`/api/v1/tasks/${taskId}`);
    onChanged();
    onClose();
  });
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  /** Reclamar-la va en dos temps: el botó, i llavors a quina columna la vols. */
  const [takingOver, setTakingOver] = useState(false);
  const [takeOverError, setTakeOverError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<'all' | 'ai' | 'human'>('all');
  const labels = useApi<Label[]>('/api/v1/labels');
  const taskTypes = useApi<{ data: TaskType[] }>('/api/v1/task-types');
  /** El nom que s'està escrivint per a una etiqueta nova; `null` si no n'hi ha cap. */
  const [newLabel, setNewLabel] = useState<string | null>(null);

  const data = task.data;
  const createScopes = scopes.filter((scope) => create?.scopeIds.includes(scope.id));
  const defaultScopeId = createScopes.length === 1 ? (createScopes[0]?.id ?? '') : '';
  const selectedScopeId = edits.scope_id ?? defaultScopeId;
  const scopeProjects = projects.filter(
    (project) => project.scope_id === (creating ? selectedScopeId : data?.scope_id),
  );
  const selectedProjects = scopeProjects.filter((project) =>
    create?.projectIds?.includes(project.id),
  );
  const base: Draft | null = creating
    ? {
        title: '',
        description: '',
        due_date: create.dueDate ?? '',
        due_time: '',
        deadline: '',
        rrule: '',
        recurrence_mode: 'schedule',
        ai_mode: create.forAi ? 'delegated' : 'manual',
        ai_instructions: '',
        scope_id: defaultScopeId,
        project_id: selectedProjects.length === 1 ? (selectedProjects[0]?.id ?? '') : '',
        task_type_id: '',
      }
    : data === undefined
      ? null
      : {
          title: data.title,
          description: data.description ?? '',
          due_date: data.due_date ?? '',
          due_time: data.due_time ?? '',
          deadline: (data.deadline ?? '').slice(0, 10),
          rrule: data.rrule ?? '',
          recurrence_mode: data.recurrence_mode === 'completion' ? 'completion' : 'schedule',
          ai_mode: data.ai_mode,
          ai_instructions: data.ai_instructions ?? '',
          scope_id: data.scope_id,
          project_id: data.project_id ?? '',
          task_type_id: data.task_type_id ?? '',
        };
  const draft = base === null ? null : { ...base, ...edits };
  const scope = scopes.find((candidate) => candidate.id === draft?.scope_id);
  const changed = <K extends keyof Draft>(key: K): Draft[K] | undefined =>
    edits[key] === base?.[key] ? undefined : edits[key];
  const dirty = (Object.keys(edits) as (keyof Draft)[]).some((key) => changed(key) !== undefined);

  const save = useMutation(async () => {
    if (draft === null) return;

    if (creating) {
      if (scope === undefined) return;
      await api.post('/api/v1/tasks', {
        id: newTaskId,
        scope_id: scope.id,
        project_id: draft.project_id || undefined,
        task_type_id: draft.task_type_id || undefined,
        title: draft.title.trim() === '' ? t('task.new') : draft.title,
        status: create.status,
        description: draft.description === '' ? undefined : draft.description,
        due_date: draft.due_date === '' ? undefined : draft.due_date,
        due_time: draft.due_time || undefined,
        deadline: deadlineForDay(draft.deadline) ?? undefined,
        rrule: draft.rrule || undefined,
        recurrence_mode: draft.rrule === '' ? undefined : draft.recurrence_mode,
        ai_mode: draft.ai_mode,
        ai_instructions: draft.ai_instructions || undefined,
      });
      onChanged();
      onClose();
      return;
    }

    if (dirty) {
      // Un camp que no s'ha editat es deixa al servidor, amb tota la seva precisió.
      await api.patch(`/api/v1/tasks/${taskId ?? ''}`, {
        title: changed('title'),
        description: emptyToNull(changed('description')),
        due_date: emptyToNull(changed('due_date')),
        due_time: emptyToNull(changed('due_time')),
        deadline: deadlineForDay(changed('deadline')),
        rrule: emptyToNull(changed('rrule')),
        recurrence_mode: changed('recurrence_mode'),
        ai_instructions: emptyToNull(changed('ai_instructions')),
      });
      onChanged();
    }
    onClose();
  });

  const tryClose = (): void => {
    if (dirty) setConfirming(true);
    else onClose();
  };

  const handleModalKey = useEffectEvent((event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      tryClose();
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save.run();
    }
  });
  useLayoutEffect(() => {
    // El teclat ha de continuar actiu mentre arriben les dades i es redibuixa la fitxa.
    const listener = (event: KeyboardEvent): void => handleModalKey(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const patch = (values: Partial<Draft>): void => {
    setEdits((current) => ({ ...current, ...values }));
  };

  const scopeLabels = (labels.data ?? []).filter((entry) => entry.scope_id === data?.scope_id);
  const scopeTypes = (taskTypes.data?.data ?? []).filter(
    (type) => type.scope_id === draft?.scope_id,
  );

  /**
   * Quan s'ensenya la conversa amb la IA.
   *
   * **També després de reclamar-la.** Si només depengués del mode, agafar una tasca a mig
   * fer li esborraria de la vista tot el que l'agent hi va deixar dit —que és justament el
   * que la fa valdre la pena reclamar—: la conversa és de la tasca, no del mode.
   */
  const ia =
    (data !== undefined && data.ai_mode !== 'manual') ||
    (comments.data ?? []).some((comment) => comment.agent_id !== null);

  /** Qui la té ara mateix, si algun agent hi està treballant. */
  const bloquejada = data?.locked_until != null;

  const label = (text: string) => (
    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>{text}</span>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={data?.title ?? ''}
      data-testid="task-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) tryClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'var(--scrim)',
        overflowY: 'auto',
      }}
    >
      {completion.dialog}
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          /**
           * `--panel-bg` i no `--card-bg`.
           *
           * En tema fosc, `--card-bg` és un vel blanc del 6%: està fet per posar-se
           * **damunt d'una superfície opaca**, no per ser-ne una. Com a fons d'un
           * diàleg deixava veure el tauler a través i l'editor no es podia fer servir.
           * `--panel-bg` és opac als dos temes, i és el que el disseny validat hi posa.
           */
          background: 'var(--panel-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-dialog)',
          padding: '22px 22px 18px',
          display: 'grid',
          gap: 14,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {draft === null ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-faint)' }}>{t('state.loading')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                data-testid="task-modal-title"
                style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}
              >
                {creating ? t('task.new') : t('task.edit')}
              </div>
              <McpSourceBadge activity={data?.mcp_activity} />
              {data === undefined ? null : (
                <TaskAiAction
                  taskId={data.id}
                  scopeId={data.scope_id}
                  onDispatched={() => {
                    executions.reload();
                    activity.reload();
                  }}
                />
              )}
            </div>

            <input
              value={draft.title}
              data-testid="task-title"
              onChange={(event) => patch({ title: event.target.value })}
              style={{
                font: 'inherit',
                fontSize: 19,
                fontWeight: 700,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--ink)',
                padding: 0,
              }}
            />

            <label style={{ display: 'grid', gap: 5 }}>
              {label(t('task.description'))}
              <textarea
                className="plou-input"
                rows={3}
                value={draft.description}
                data-testid="task-description"
                onChange={(event) => patch({ description: event.target.value })}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ display: 'grid', gap: 5 }}>
                {label(t('task.scope'))}
                {/*
                  L'àmbit no s'edita aquí: canviar-lo mou la tasca a un altre espai amb
                  altres membres, altres etiquetes i altres calendaris, i fer-ho des d'un
                  desplegable enmig d'un formulari és massa fàcil de fer sense voler. El
                  servidor tampoc ho accepta a `PATCH /tasks/{id}`.
                */}
                {creating ? (
                  <select
                    className="plou-input"
                    data-testid="task-scope"
                    value={draft.scope_id}
                    onChange={(event) => {
                      const scopeId = event.target.value;
                      setEdits(({ project_id: _project, task_type_id: _type, ...current }) => ({
                        ...current,
                        scope_id: scopeId,
                      }));
                    }}
                  >
                    <option value="" disabled>
                      {t('task.chooseScope')}
                    </option>
                    {createScopes.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{scope?.name ?? ''}</span>
                )}
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                {label(t('task.project'))}
                <select
                  className="plou-input"
                  data-testid="task-project"
                  value={draft.project_id}
                  disabled={creating && scope === undefined}
                  onChange={(event) => {
                    if (creating) {
                      patch({ project_id: event.target.value });
                      return;
                    }
                    // Es desa de seguida: moure de projecte és un gest, com assignar.
                    void api
                      .patch(`/api/v1/tasks/${taskId}`, {
                        project_id: event.target.value === '' ? null : event.target.value,
                      })
                      .then(() => {
                        task.reload();
                        onChanged();
                      });
                  }}
                >
                  <option value="">{t('task.noProject')}</option>
                  {scopeProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/*
              **La columna, des de la fitxa.** `docs/02` §7 la demana i no hi era: obries
              «Edició completa» i l'única cosa que no s'hi podia editar era on és la tasca.
              Al tauler s'arrossega, però la fitxa és on s'acaba mirant una tasca al mòbil,
              i allà arrossegar és el gest incòmode.

              Va per `/move` i no per `PATCH`: el contracte ho diu explícitament —«Per
              moure-la, `/move`»— perquè moure implica una posició, i un `PATCH` que
              canviés `status` deixaria la tasca amb la posició d'una altra columna.
            */}
            {creating ? null : (
              <div style={{ display: 'grid', gap: 5 }}>
                {label(t('task.status'))}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['inbox', 'todo', 'doing', 'done'] as const).map((option) => {
                    const actual = data?.status === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        data-testid={`task-status-${option}`}
                        aria-pressed={actual}
                        onClick={() => {
                          if (actual) return;
                          void completion.request(taskId!, option, async (extra) => {
                            await api.post(`/api/v1/tasks/${taskId}/move`, {
                              status: option,
                              ...extra,
                            });
                            task.reload();
                            onChanged();
                          });
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 100,
                          cursor: actual ? 'default' : 'pointer',
                          font: 'inherit',
                          fontSize: 12,
                          fontWeight: actual ? 700 : 500,
                          border: '1px solid var(--card-border)',
                          background: actual ? 'var(--ghost-bg)' : 'transparent',
                          color: 'var(--ink)',
                        }}
                      >
                        {t(`board.column.${option}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ display: 'grid', gap: 5 }}>
                {label(t('task.dueDate'))}
                <input
                  className="plou-input"
                  type="date"
                  value={draft.due_date}
                  data-testid="task-due-date"
                  onChange={(event) => patch({ due_date: event.target.value })}
                />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                {label(t('task.dueTime'))}
                <input
                  className="plou-input"
                  type="time"
                  value={draft.due_time}
                  data-testid="task-due-time"
                  onChange={(event) => patch({ due_time: event.target.value })}
                />
              </label>
            </div>

            {/*
              El deadline és **separat** del venciment (docs/02 §7): "fes-ho aquest
              dijous" i "com a molt tard el dia 30" són dues coses, i posar-les al mateix
              camp obliga a triar-ne una.
            */}
            <label style={{ display: 'grid', gap: 5 }}>
              {label(t('task.deadline'))}
              <input
                className="plou-input"
                type="date"
                value={draft.deadline}
                data-testid="task-deadline"
                onChange={(event) => patch({ deadline: event.target.value })}
              />
            </label>

            <div style={{ display: 'grid', gap: 5 }}>
              {label(t('task.recurrence'))}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {RECURRENCES.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    data-testid={`task-recurrence-${option.key}`}
                    aria-pressed={draft.rrule === option.rrule}
                    onClick={() => patch({ rrule: option.rrule })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 100,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 12,
                      fontWeight: draft.rrule === option.rrule ? 700 : 500,
                      border: '1px solid var(--card-border)',
                      background: draft.rrule === option.rrule ? 'var(--ghost-bg)' : 'transparent',
                      color: 'var(--ink)',
                    }}
                  >
                    {t(`task.recurrence.${option.key}`)}
                  </button>
                ))}
                {/*
                  Una regla que no és cap de les quatre —normalment vinguda per CalDAV—
                  es conserva i s'ensenya tal com és. Sobreescriure-la seria perdre el
                  que algú va escriure en una altra app.
                */}
                {draft.rrule !== '' && !RECURRENCES.some((o) => o.rrule === draft.rrule) ? (
                  <span
                    data-testid="task-recurrence-custom"
                    style={{
                      padding: '6px 12px',
                      borderRadius: 100,
                      fontSize: 12,
                      fontFamily: 'var(--font-mono, monospace)',
                      background: 'var(--tag-bg)',
                      color: 'var(--tag-text)',
                    }}
                  >
                    {draft.rrule}
                  </span>
                ) : null}
              </div>

              {draft.rrule === '' ? null : (
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    data-testid="task-recurrence-completion"
                    checked={draft.recurrence_mode === 'completion'}
                    onChange={(event) =>
                      patch({ recurrence_mode: event.target.checked ? 'completion' : 'schedule' })
                    }
                  />
                  <span style={{ color: 'var(--ink-soft)' }}>
                    {t('task.recurrence.fromCompletion')}
                  </span>
                </label>
              )}
            </div>

            {/*
              **El mode d'IA no s'edita aquí.** El disseny validat el va treure del
              formulari: el decideix el tauler on és la tasca. Arrossegar-la al kanban de
              la IA la delega, tornar-la a la bústia des d'allà l'hi treu, i "Nova tasca
              per a la IA" la crea ja delegada.

              El motiu és que el mode no és una propietat que s'ompli com una data: és on
              vius la tasca, i tenir-lo als dos llocs feia que el tauler i el desplegable
              es contradiguessin.

              Les instruccions sí que es queden, perquè són el QUÈ ha de fer i sense
              elles delegar no vol dir res.
            */}
            {draft.ai_mode === 'manual' ? null : (
              <label style={{ display: 'grid', gap: 5 }}>
                {label(t('task.aiInstructions'))}
                <textarea
                  className="plou-input"
                  rows={2}
                  value={draft.ai_instructions}
                  data-testid="task-ai-instructions"
                  onChange={(event) => patch({ ai_instructions: event.target.value })}
                />
              </label>
            )}

            {/*
              **Assignar només té sentit a la bústia d'un àmbit col·lectiu.**

              A un àmbit individual no hi ha ningú més a qui assignar (docs/02 §4: totes
              les tasques van soles al propietari), i un cop la tasca surt de la bústia
              ja és de qui la fa: el disseny validat treu el camp perquè tenir-lo allà
              convidava a repartir feina que algú ja havia agafat.
            */}
            {scope?.kind !== 'collective' || data?.status !== 'inbox' ? null : (
              <section style={{ display: 'grid', gap: 6 }} data-testid="task-assignees">
                {label(t('task.assignees'))}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {people.map((person) => {
                    const assigned = (data?.assignee_ids ?? []).includes(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        data-testid={`task-assignee-${person.id}`}
                        aria-pressed={assigned}
                        onClick={() => {
                          // S'aplica de seguida i no al desar: assignar és un gest, no un
                          // camp del formulari, i el servidor ja el registra com a tal.
                          const call = assigned ? api.delete : api.post;
                          void call(`/api/v1/tasks/${taskId}/assignees/${person.id}`).then(() => {
                            task.reload();
                            onChanged();
                          });
                        }}
                        style={{
                          padding: '5px 11px',
                          borderRadius: 100,
                          cursor: 'pointer',
                          font: 'inherit',
                          fontSize: 12,
                          fontWeight: assigned ? 700 : 500,
                          border: '1px solid var(--card-border)',
                          background: assigned ? 'var(--ghost-bg)' : 'transparent',
                          color: 'var(--ink)',
                        }}
                      >
                        {person.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/*
              **Les etiquetes, que abans eren un epígraf i res més.**

              Hi havia tres coses trencades alhora, i cadascuna amagava la següent:

              1. Ningú pot crear una etiqueta enlloc de l'aplicació. Amb zero etiquetes a
                 l'àmbit, la secció pintava el títol i **cap contingut**: ni estat buit ni
                 camí. Totes les altres seccions de la fitxa en tenen un.
              2. Els xips es dibuixaven **iguals si l'etiqueta hi era i si no**, o sigui
                 que no es podia saber quines porta la tasca. Ara ho diu `label_ids`, que
                 hi és per això.
              3. Treure'n una era clicar-la i **esperar que el `POST` fallés** per caure al
                 `DELETE` del `catch`. Amb un tall de xarxa o un 403, l'etiqueta
                 desapareixia sense que ningú ho hagués demanat. Ara la decisió la pren
                 l'estat que ja se sap, i un error és un error.
            */}
            {/*
              **La tipologia: una i tancada.** Surt només si l'àmbit en fa servir, i és un
              desplegable i no uns xips com les etiquetes justament perquè es vegi que se
              n'hi posa **una**: uns xips convidarien a marcar-ne dues i llavors la
              pregunta «quantes n'hi pot haver» tornaria a estar oberta.
            */}
            {scopeTypes.length === 0 ? null : (
              <section style={{ display: 'grid', gap: 6 }} data-testid="task-type">
                {label(t('task.taskType'))}
                <select
                  className="plou-input"
                  data-testid="task-type-select"
                  value={draft.task_type_id}
                  onChange={(event) => {
                    if (creating) {
                      patch({ task_type_id: event.target.value });
                      return;
                    }
                    void api
                      .patch(`/api/v1/tasks/${taskId ?? ''}`, {
                        task_type_id: event.target.value === '' ? null : event.target.value,
                      })
                      .then(() => {
                        task.reload();
                        onChanged();
                      });
                  }}
                >
                  <option value="">{t('stats.noType')}</option>
                  {scopeTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </section>
            )}

            <section style={{ display: 'grid', gap: 6 }}>
              {label(t('task.labels'))}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {/*
                  Només les etiquetes de l'àmbit de la tasca: una d'un altre àmbit el
                  servidor la rebutja amb un 422, i oferir-la seria oferir un error.
                */}
                {scopeLabels.map((entry) => {
                  const posada = (data?.label_ids ?? []).includes(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      data-testid={`task-label-${entry.id}`}
                      aria-pressed={posada}
                      title={posada ? t('task.label.remove') : t('task.label.add')}
                      onClick={() => {
                        const url = `/api/v1/tasks/${taskId}/labels/${entry.id}`;
                        void (posada ? api.delete(url) : api.post(url)).then(() => {
                          // La fitxa també: `label_ids` viu a la tasca, i sense
                          // rellegir-la el xip es queda com estava.
                          task.reload();
                          onChanged();
                        });
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 100,
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 11,
                        // Posada: plena i amb el color de l'etiqueta a la vora esquerra.
                        // No posada: fantasma. Es distingeixen sense llegir-les.
                        border: posada ? 'none' : '1px dashed var(--card-border)',
                        background: posada ? 'var(--tag-bg)' : 'transparent',
                        color: posada ? 'var(--tag-text)' : 'var(--ink-soft)',
                        borderLeft: `3px solid var(${entry.color})`,
                      }}
                    >
                      {entry.name}
                    </button>
                  );
                })}

                {/*
                  I el camí per fer-ne una, que és el que faltava. Va aquí i no a Ajustos
                  perquè el moment en què vols una etiqueta és mentre mires la tasca que
                  la necessita; anar-la a crear a una altra pantalla i tornar és el
                  camí que fa que ningú n'usi.
                */}
                {newLabel === null ? (
                  <button
                    type="button"
                    className="plou-btn plou-btn-ghost"
                    data-testid="task-label-new"
                    onClick={() => setNewLabel('')}
                    style={{ fontSize: 11, padding: '4px 10px' }}
                  >
                    {t('task.newLabel')}
                  </button>
                ) : (
                  <input
                    className="plou-input"
                    autoFocus
                    data-testid="task-label-name"
                    placeholder={t('task.newLabel.placeholder')}
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    onBlur={() => setNewLabel(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setNewLabel(null);
                      if (event.key !== 'Enter') return;
                      const name = newLabel.trim();
                      if (name === '' || data?.scope_id === undefined) return;
                      setNewLabel(null);
                      void api
                        .post<Label>('/api/v1/labels', { scope_id: data.scope_id, name })
                        .then(async (creada) => {
                          // Neix posada: si l'has escrita mirant aquesta tasca, és
                          // d'aquesta tasca. Crear-la i haver-la de clicar seria un pas
                          // de més que no serveix per a res.
                          await api.post(`/api/v1/tasks/${taskId}/labels/${creada.id}`);
                          labels.reload();
                          task.reload();
                          onChanged();
                        });
                    }}
                    style={{ fontSize: 11, padding: '4px 10px', width: 150 }}
                  />
                )}
              </div>
              {scopeLabels.length === 0 && newLabel === null ? (
                <EmptyState>{t('task.empty.labels')}</EmptyState>
              ) : null}
            </section>

            <section style={{ display: 'grid', gap: 4 }}>
              {label(t('task.subtasks'))}
              {(subtasks.data ?? []).length === 0 ? (
                <EmptyState>{t('task.empty.subtasks')}</EmptyState>
              ) : (
                (subtasks.data ?? []).map((subtask) => (
                  <SubtaskRow
                    key={subtask.id}
                    subtask={subtask}
                    onUpdate={subtaskSync.updateSubtask}
                    onDelete={() => subtaskSync.deleteSubtask(subtask)}
                  />
                ))
              )}
              <input
                className="plou-input"
                data-testid="task-new-subtask"
                value={newSubtask}
                placeholder={t('task.newSubtask')}
                onChange={(event) => setNewSubtask(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.nativeEvent.isComposing ||
                    newSubtask.trim() === ''
                  )
                    return;
                  event.preventDefault();
                  void subtaskSync
                    .createSubtask(newSubtask.trim())
                    .then(() => setNewSubtask((current) => (current === newSubtask ? '' : current)))
                    .catch((error: unknown) => notify(failureText(error), { tone: 'error' }));
                }}
              />
            </section>

            <section style={{ display: 'grid', gap: 6 }}>
              {label(t('task.checklists'))}
              {(checklists.data ?? []).map((checklist) => (
                <div
                  key={checklist.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 11px',
                    borderRadius: 10,
                    border: '1px solid var(--card-border)',
                  }}
                >
                  <button
                    type="button"
                    data-testid={`task-checklist-${checklist.id}`}
                    onClick={() => onOpenList(checklist.id)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 12.5,
                      color: 'var(--ink)',
                    }}
                  >
                    {checklist.name} ·{' '}
                    {t('checklist.count', {
                      done: checklist.items.filter((item) => item.done).length,
                      total: checklist.items.length,
                    })}
                  </button>

                  {/*
                    **Pinejar també des d'aquí.**

                    Fins ara només es podia des de la targeta del tauler, desplegant-ne les
                    llistes: per pinejar-ne una calia **tancar el modal**, trobar la targeta
                    i desplegar-la. El modal és on es gestiona la tasca a fons, i les seves
                    llistes hi són llistades — deixar-hi l'acció fora obligava a sortir del
                    lloc on ja eres.
                  */}
                  <button
                    type="button"
                    data-testid={`task-checklist-pin-${checklist.id}`}
                    aria-pressed={checklist.pinned}
                    onClick={() => {
                      const call = checklist.pinned ? api.delete : api.post;
                      void call(`/api/v1/checklists/${checklist.id}/pin`).then(() => {
                        checklists.reload();
                      });
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 11,
                      fontWeight: 700,
                      color: checklist.pinned ? 'var(--brand-ink)' : 'var(--ink-faint)',
                    }}
                  >
                    {checklist.pinned ? t('checklist.unpinAction') : t('checklist.pin')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                data-testid="task-new-checklist"
                onClick={() => {
                  void api
                    .post(`/api/v1/tasks/${taskId}/checklists`, {
                      id: uuidv7(),
                      name: t('task.checklists'),
                    })
                    .then(() => {
                      checklists.reload();
                    });
                }}
                style={{
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                  color: 'var(--ink-faint)',
                }}
              >
                {t('task.newChecklist')}
              </button>
            </section>

            {/* Una tasca que encara no existeix no té on penjar res. */}
            {!creating && taskId !== undefined && (
              <Attachments parent="tasks" parentId={taskId} label={label} />
            )}

            {/*
              **La conversa amb l'agent és la mateixa que la de comentaris, no una de nova.**

              Amb una pestanya IA a part hi hauria dos llocs on mirar què s'ha dit d'aquesta
              tasca, i el dia que algú respongués al lloc equivocat l'agent es quedaria
              esperant. El que canvia quan la tasca no és `manual` és **el que s'hi veu**:
              qui parla, quina pregunta espera resposta, i que el que adjuntis aquí sota li
              arriba amb el traspàs.
            */}
            <section
              data-testid={ia ? 'task-ai-conversation' : 'task-comments'}
              style={{ display: 'grid', gap: 6 }}
            >
              {label(ia ? t('task.aiConversation') : t('task.comments'))}

              {/*
                **El pany i el camí de tornada, junts.** Van al mateix lloc perquè són la
                mateixa pregunta —«qui la té?»— i la resposta canvia el que pots fer: amb
                l'agent a dins no es toca, i quan surt te la pots endur amb tot el que hi ha
                escrit.
              */}
              {ia && !creating && data !== undefined ? (
                bloquejada ? (
                  <p
                    data-testid="task-locked-notice"
                    style={{
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 11px',
                      borderRadius: 12,
                      background: 'var(--ghost-bg)',
                      fontSize: 12,
                      color: 'var(--ink-soft)',
                    }}
                  >
                    <span aria-hidden="true">🔒</span>
                    {t('ai.lock.working', {
                      time: shortTime(getLocale(), new Date(data.locked_until ?? '')),
                    })}
                  </p>
                ) : data.ai_mode !== 'manual' ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {takingOver ? (
                      <>
                        {/* A quina columna. Endevinar-ho seria decidir-ho per tu. */}
                        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                          {t('ai.takeOver.where')}
                        </span>
                        {(['todo', 'doing'] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            className="plou-btn plou-btn-ghost"
                            data-testid={`task-take-over-${status}`}
                            style={{ fontSize: 12 }}
                            onClick={() => {
                              void api
                                .post(`/api/v1/tasks/${taskId ?? ''}/take-over`, { status })
                                .then(() => {
                                  setTakingOver(false);
                                  task.reload();
                                  activity.reload();
                                  onChanged();
                                })
                                .catch((cause: unknown) => setTakeOverError(failureText(cause)));
                            }}
                          >
                            {t(`board.column.${status}`)}
                          </button>
                        ))}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="plou-btn plou-btn-ghost"
                        data-testid="task-take-over"
                        style={{ fontSize: 12 }}
                        onClick={() => setTakingOver(true)}
                      >
                        {t('ai.takeOver.action')}
                      </button>
                    )}
                    {takeOverError === null ? null : (
                      <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>
                        {takeOverError}
                      </span>
                    )}
                  </div>
                ) : null
              ) : null}

              {/*
                L'avís, amb icona i text i no només color (docs/04 §8). Marxa quan respons:
                no hi ha cap botó de «vist», perquè el que desencalla l'agent és la
                resposta.
              */}
              {data?.needs_attention === true ? (
                <p
                  data-testid="task-attention-notice"
                  style={{
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 11px',
                    borderRadius: 12,
                    background: 'var(--gradient-wash-warm)',
                    border: '1px solid var(--plou-orange)',
                    fontSize: 12,
                    color: 'var(--ink)',
                  }}
                >
                  <span aria-hidden="true">⚠</span>
                  {t('ai.attention.waiting')}
                </p>
              ) : null}

              {(comments.data ?? []).length === 0 ? (
                <EmptyState>
                  {t(ia ? 'task.empty.aiConversation' : 'task.empty.comments')}
                </EmptyState>
              ) : (
                (comments.data ?? []).map((comment) => (
                  <div
                    key={comment.id}
                    data-testid={comment.agent_id === null ? undefined : 'task-ai-message'}
                    style={{
                      fontSize: 12.5,
                      color: 'var(--ink)',
                      ...(comment.agent_id === null
                        ? {}
                        : {
                            padding: '7px 11px',
                            borderRadius: 12,
                            background: 'var(--gradient-wash-cool)',
                          }),
                    }}
                  >
                    <strong style={{ fontWeight: 700 }}>
                      {comment.guest_name ??
                        people.find((person) => person.id === comment.author_id)?.name ??
                        ''}
                    </strong>{' '}
                    {comment.body}
                  </div>
                ))
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="plou-input"
                  data-testid="task-new-comment"
                  value={newComment}
                  placeholder={t(ia ? 'task.aiReply' : 'task.newComment')}
                  onChange={(event) => setNewComment(event.target.value)}
                />
                <button
                  type="button"
                  className="plou-btn plou-btn-primary"
                  onClick={() => {
                    if (newComment.trim() === '') return;
                    void api
                      .post(`/api/v1/tasks/${taskId}/comments`, { body: newComment.trim() })
                      .then(() => {
                        setNewComment('');
                        comments.reload();
                        activity.reload();
                        /**
                         * **I la tasca**, perquè respondre li baixa la marca d'atenció i
                         * l'avís es llegeix de la tasca. Sense això l'avís es quedava a la
                         * pantalla amb la marca ja baixada: qui respon veuria que segueix
                         * esperant-lo i tornaria a respondre.
                         */
                        task.reload();
                        /**
                         * I si el que s'acaba de respondre era una pregunta d'un agent,
                         * **també ho ha de saber la barra**: el punt del commutador d'IA i
                         * la targeta destacada són fora d'aquest modal, i deixar-los amb el
                         * comptador vell diria que encara t'esperen quan ja no.
                         */
                        if (data?.needs_attention === true) onChanged();
                      });
                  }}
                >
                  {t('task.send')}
                </button>
              </div>
              {/*
                **El que adjuntis li arriba.** L'adjunt ja hi era just a sobre i el traspàs
                el porta com a enllaç a recurs (docs/09 §4); el que faltava era dir-ho, que
                és el que fa que algú l'hi enviï en comptes d'enganxar-hi una URL.
              */}
              {ia ? (
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  {t('ai.attention.attachHint')}
                </p>
              ) : null}
            </section>

            <section style={{ display: 'grid', gap: 6 }}>
              {label(t('task.activity'))}

              {/*
                **Quan la va llegir l'agent**, que és la pregunta que l'historial no responia:
                els verbs diuen què ha fet, i el silenci no distingeix «encara no ha tornat»
                de «ho ha llegit i no hi ha res a fer». Les lectures no hi entren com a files
                —un agent que consulta cada minut n'hi deixaria mil al dia— i per això va
                aquí a sobre, com un fet de la tasca i no com un esdeveniment.
              */}
              {data?.ai_last_read_at == null ? null : (
                <p
                  data-testid="task-ai-read-at"
                  title={dateTime(getLocale(), new Date(data.ai_last_read_at))}
                  style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-faint)' }}
                >
                  {t('ai.readAt', {
                    when: relativeTime(getLocale(), new Date(data.ai_last_read_at), new Date()),
                  })}
                </p>
              )}
              {(activity.data?.data ?? []).length === 0 ? (
                <EmptyState>{t('task.empty.activity')}</EmptyState>
              ) : (
                <ActivityTimeline
                  entries={(activity.data?.data ?? []).map((entry) => {
                    const source =
                      entry.source === 'federation'
                        ? 'federation'
                        : SOURCES.find((value) => value === entry.source);
                    return {
                      ...entry,
                      actor_label: entry.actor_label ?? null,
                      changes: entry.changes ?? null,
                      channel: {
                        label: t(`activity.source.${source ?? 'unknown'}`),
                        origin: source === 'mcp' ? (entry.mcp_origin ?? null) : null,
                      },
                      ...executionActivity(entry, executions.data?.data ?? []),
                    };
                  })}
                  filter={activityFilter}
                  onFilterChange={setActivityFilter}
                  labels={{
                    filters: {
                      all: t('activity.filter.all'),
                      human: t('activity.filter.human'),
                      ai: t('activity.filter.ai'),
                    },
                    verbs: Object.fromEntries(
                      VERBS.map((verb) => [verb, t(`activity.verb.${verb}`)]),
                    ),
                    undo: t('activity.undo'),
                  }}
                  formatTime={(iso) => dateTime(getLocale(), new Date(iso))}
                  onUndo={(id: string) => {
                    void api.post(`/api/v1/activity/${id}/undo`).then(() => {
                      activity.reload();
                      task.reload();
                      onChanged();
                    });
                  }}
                />
              )}
            </section>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 9 }}>
              {/* Una tasca que encara no existeix no es pot compartir. */}
              <button
                type="button"
                data-testid="task-share"
                disabled={creating}
                onClick={() => {
                  if (taskId !== undefined) onShare(taskId);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  color: 'var(--ink-soft)',
                }}
              >
                {t('task.share')}
              </button>
              <span style={{ display: 'flex', gap: 9 }}>
                {/* Una tasca que encara no existeix no es pot esborrar. */}
                {!creating && taskId !== undefined ? (
                  <button
                    type="button"
                    data-testid="task-delete"
                    className="plou-btn plou-btn-ghost"
                    style={{ color: 'var(--danger-text)' }}
                    onClick={() => setDeleting(true)}
                  >
                    {t('nav.delete')}
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid="task-cancel"
                  className="plou-btn plou-btn-ghost"
                  onClick={tryClose}
                >
                  {t('nav.cancel')}
                </button>
                <button
                  type="button"
                  data-testid="task-save"
                  className="plou-btn plou-btn-primary"
                  disabled={save.busy || (creating && scope === undefined)}
                  onClick={() => void save.run()}
                >
                  {t('nav.save')}
                </button>
              </span>
            </div>
          </>
        )}

        {deleting ? (
          <div
            role="alertdialog"
            data-testid="task-confirm-delete"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 12,
              background: 'var(--danger-bg)',
              color: 'var(--danger-text)',
              fontSize: 12.5,
            }}
          >
            {/*
              **Es diu què més se n'anirà.** "Segur?" a seques obliga a recordar de memòria
              què penja d'aquesta tasca, i el que penja —subtasques i llistes— no es veu
              tot des d'aquí.
            */}
            <span>{t('task.deleteConfirm', { title: draft?.title ?? '' })}</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                data-testid="task-delete-confirm"
                disabled={remove.busy}
                onClick={() => void remove.run()}
                style={{
                  border: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {t('nav.delete')}
              </button>
              <button
                type="button"
                data-testid="task-delete-cancel"
                onClick={() => setDeleting(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {t('nav.cancel')}
              </button>
            </span>
          </div>
        ) : null}

        {confirming ? (
          <div
            role="alertdialog"
            data-testid="task-confirm-close"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 12,
              background: 'var(--danger-bg)',
              color: 'var(--danger-text)',
              fontSize: 12.5,
            }}
          >
            <span>{t('error.generic')}</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                data-testid="task-discard"
                onClick={onClose}
                style={{
                  border: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {t('nav.close')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  font: 'inherit',
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {t('nav.cancel')}
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
