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

import { useEffect, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { ActivityTimeline, ChecklistRow, EmptyState } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useSessionData } from '../app/session.js';
import { useApi, useMutation } from '../app/useApi.js';
import type { ActivityEntry, Checklist, Comment, Label, Subtask, Task } from '../app/types.js';

/**
 * Els verbs que l'historial sap traduir.
 *
 * La llista viu aquí i no al component perquè el component no sap català (regla 3): rep
 * el diccionari ja resolt. Un verb que no hi sigui es veurà cru, que és el mateix criteri
 * que `t()` amb una clau que falta — visible i corregible, no un forat.
 */
const VERBS = [
  'created',
  'updated',
  'moved',
  'completed',
  'reopened',
  'cascade_complete',
  'commented',
  'refreshed',
  'deleted',
  'claimed',
  'released',
  'token_created',
  'token_revoked',
] as const;

export interface TaskModalProps {
  taskId: string;
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
};

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

export function TaskModal({ taskId, onClose, onChanged, onShare, onOpenList }: TaskModalProps) {
  const { scopes, projects, people } = useSessionData();
  const task = useApi<Task>(`/api/v1/tasks/${taskId}`);
  const subtasks = useApi<Subtask[]>(`/api/v1/tasks/${taskId}/subtasks`);
  const checklists = useApi<Checklist[]>(`/api/v1/tasks/${taskId}/checklists`);
  const comments = useApi<Comment[]>(`/api/v1/tasks/${taskId}/comments`);
  const activity = useApi<{ data: ActivityEntry[] }>(`/api/v1/tasks/${taskId}/activity`);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'ai' | 'human'>('all');
  const labels = useApi<Label[]>('/api/v1/labels');

  useEffect(() => {
    if (task.data === undefined || draft !== null) return;
    setDraft({
      title: task.data.title,
      description: task.data.description ?? '',
      due_date: task.data.due_date ?? '',
      due_time: task.data.due_time ?? '',
      deadline: (task.data.deadline ?? '').slice(0, 10),
      rrule: task.data.rrule ?? '',
      recurrence_mode: task.data.recurrence_mode === 'completion' ? 'completion' : 'schedule',
      ai_mode: task.data.ai_mode,
      ai_instructions: '',
    });
  }, [task.data, draft]);

  const save = useMutation(async () => {
    if (draft === null) return;
    await api.patch(`/api/v1/tasks/${taskId}`, {
      title: draft.title,
      description: draft.description === '' ? null : draft.description,
      due_date: draft.due_date === '' ? null : draft.due_date,
      due_time: draft.due_time === '' ? null : draft.due_time,
      // Una data límit sense hora és tot el dia: es tanca al final, no al principi.
      deadline: draft.deadline === '' ? null : `${draft.deadline}T23:59:59.000Z`,
      rrule: draft.rrule === '' ? null : draft.rrule,
      recurrence_mode: draft.recurrence_mode,
      ai_mode: draft.ai_mode,
      ai_instructions: draft.ai_instructions === '' ? null : draft.ai_instructions,
    });
    setDirty(false);
    onChanged();
    onClose();
  });

  const tryClose = (): void => {
    if (dirty) setConfirming(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        tryClose();
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save.run();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const patch = (values: Partial<Draft>): void => {
    setDraft((current) => (current === null ? current : { ...current, ...values }));
    setDirty(true);
  };

  const data = task.data;
  const scope = scopes.find((candidate) => candidate.id === data?.scope_id);

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
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--card-shadow)',
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
                <span style={{ fontSize: 13, color: 'var(--ink)' }}>{scope?.name ?? ''}</span>
              </label>
              <label style={{ display: 'grid', gap: 5 }}>
                {label(t('task.project'))}
                <select
                  className="plou-input"
                  data-testid="task-project"
                  value={data?.project_id ?? ''}
                  onChange={(event) => {
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
                  {projects
                    .filter((project) => project.scope_id === data?.scope_id)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

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

            <div style={{ display: 'grid', gap: 5 }}>
              {label(t('task.aiMode'))}
              <div style={{ display: 'flex', gap: 6 }}>
                {(['manual', 'assisted', 'delegated'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`task-ai-${mode}`}
                    aria-pressed={draft.ai_mode === mode}
                    onClick={() => patch({ ai_mode: mode })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 100,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 12,
                      fontWeight: draft.ai_mode === mode ? 700 : 500,
                      border: '1px solid var(--card-border)',
                      background: draft.ai_mode === mode ? 'var(--ghost-bg)' : 'transparent',
                      color: 'var(--ink)',
                    }}
                  >
                    {t(`ai.mode.${mode}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Les instruccions només tenen sentit si la IA hi ha de fer alguna cosa. */}
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

            <section style={{ display: 'grid', gap: 6 }}>
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

            <section style={{ display: 'grid', gap: 6 }}>
              {label(t('task.labels'))}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {/*
                  Només les etiquetes de l'àmbit de la tasca: una d'un altre àmbit el
                  servidor la rebutja amb un 422, i oferir-la seria oferir un error.
                */}
                {(labels.data ?? [])
                  .filter((entry) => entry.scope_id === data?.scope_id)
                  .map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-testid={`task-label-${entry.id}`}
                      onClick={() => {
                        void api
                          .post(`/api/v1/tasks/${taskId}/labels/${entry.id}`)
                          .catch(() => api.delete(`/api/v1/tasks/${taskId}/labels/${entry.id}`))
                          .then(() => {
                            onChanged();
                          });
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 100,
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 11,
                        border: 'none',
                        background: 'var(--tag-bg)',
                        color: 'var(--tag-text)',
                        borderLeft: `3px solid var(${entry.color})`,
                      }}
                    >
                      {entry.name}
                    </button>
                  ))}
              </div>
            </section>

            <section style={{ display: 'grid', gap: 4 }}>
              {label(t('task.subtasks'))}
              {(subtasks.data ?? []).length === 0 ? (
                <EmptyState>{t('task.empty.subtasks')}</EmptyState>
              ) : (
                (subtasks.data ?? []).map((subtask) => (
                  <ChecklistRow
                    key={subtask.id}
                    text={subtask.title}
                    done={subtask.done}
                    toggleLabel={t('checklist.toggleItem', { text: subtask.title })}
                    onToggle={() => {
                      void api
                        .patch(`/api/v1/subtasks/${subtask.id}`, { done: !subtask.done })
                        .then(() => {
                          subtasks.reload();
                          onChanged();
                        });
                    }}
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
                  if (event.key !== 'Enter' || newSubtask.trim() === '') return;
                  event.preventDefault();
                  void api
                    .post(`/api/v1/tasks/${taskId}/subtasks`, {
                      id: uuidv7(),
                      title: newSubtask.trim(),
                    })
                    .then(() => {
                      setNewSubtask('');
                      subtasks.reload();
                    });
                }}
              />
            </section>

            <section style={{ display: 'grid', gap: 6 }}>
              {label(t('task.checklists'))}
              {(checklists.data ?? []).map((checklist) => (
                <button
                  key={checklist.id}
                  type="button"
                  data-testid={`task-checklist-${checklist.id}`}
                  onClick={() => onOpenList(checklist.id)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 11px',
                    borderRadius: 10,
                    border: '1px solid var(--card-border)',
                    background: 'transparent',
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

            <section style={{ display: 'grid', gap: 6 }}>
              {label(t('task.comments'))}
              {(comments.data ?? []).length === 0 ? (
                <EmptyState>{t('task.empty.comments')}</EmptyState>
              ) : (
                (comments.data ?? []).map((comment) => (
                  <div key={comment.id} style={{ fontSize: 12.5, color: 'var(--ink)' }}>
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
                  placeholder={t('task.newComment')}
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
                      });
                  }}
                >
                  {t('task.send')}
                </button>
              </div>
            </section>

            <section style={{ display: 'grid', gap: 6 }}>
              {label(t('task.activity'))}
              {(activity.data?.data ?? []).length === 0 ? (
                <EmptyState>{t('task.empty.activity')}</EmptyState>
              ) : (
                <ActivityTimeline
                  entries={(activity.data?.data ?? []).map((entry) => ({
                    ...entry,
                    // El contracte els marca opcionals perquè poden ser nuls; el
                    // component els vol sempre presents. Normalitzar-ho aquí és més
                    // honest que fer-los obligatoris a l'API, on de veritat poden faltar.
                    actor_label: entry.actor_label ?? null,
                    changes: entry.changes ?? null,
                  }))}
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
                  formatTime={(iso) =>
                    new Intl.DateTimeFormat('ca', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(iso))
                  }
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
              <button
                type="button"
                data-testid="task-share"
                onClick={() => onShare(taskId)}
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
                  disabled={save.busy}
                  onClick={() => void save.run()}
                >
                  {t('nav.save')}
                </button>
              </span>
            </div>
          </>
        )}

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
