import { useEffect, useState, type ReactNode } from 'react';
import { t, getLocale, resolveWeekStart, type components } from '@fem-ho/contracts';
import { EmptyState } from '@fem-ho/design-system/femho';
import { useSessionData } from '../app/session.js';
import { useRouter } from '../app/router.js';
import { useApi } from '../app/useApi.js';
import { api } from '../app/api.js';
import { Chips } from '../app/Chips.js';
import { ErrorBanner } from './BoardScreen.js';
import { Barres, Linia } from './EstadistiquesScreen.js';
import { Taula, fmtMinutes } from './RegistreScreen.js';
import { Cronograma } from './Cronograma.js';
import { REPORT_PERIODS, reportRange } from './report-range.js';

type S = components['schemas'];
type Metric = 'created' | 'completed' | 'pending' | 'overdue';
const METRICS: Metric[] = ['pending', 'overdue', 'created', 'completed'];
const TABS = ['summary', 'register'] as const;

export function ReportsScreen({
  activeScopeIds,
  projectIds,
  trackingScopeIds,
  projectNoun,
  onOpenTask,
  reloadKey,
}: {
  activeScopeIds: string[];
  projectIds: string[];
  trackingScopeIds: string[];
  projectNoun: 'project' | 'client';
  onOpenTask: (id: string) => void;
  reloadKey: number;
}) {
  const { route, navigate } = useRouter();
  const { profile, scopes, projects, people, settings } = useSessionData();
  const q = route.query;
  const rawTab = q.get('tab');
  const tab = TABS.find((value) => value === rawTab) ?? 'summary';
  const metric = METRICS.find((value) => value === q.get('metric')) ?? 'completed';
  const period = q.get('period') ?? 'days30';
  const defaults = reportRange(
    period,
    profile.timezone,
    new Date(),
    resolveWeekStart(settings.week_start, getLocale()),
  );
  const from = q.get('from') ?? (period === 'custom' ? '' : defaults.from),
    to = q.get('to') ?? (period === 'custom' ? '' : defaults.to);
  const chrono = tab === 'register' && q.get('view') === 'chrono';
  const day = q.get('day') ?? reportRange('today', profile.timezone).from;
  const timezone = profile.timezone;
  const valid = chrono ? !!day : !(from && to && from > to);
  const activeProjects = projects.filter((project) => activeScopeIds.includes(project.scope_id));
  const validProjects = projectIds.filter(
    (id) => id === 'none' || activeProjects.some((project) => project.id === id),
  );
  const tracking = trackingScopeIds.some((id) => activeScopeIds.includes(id));
  const typeRows = useApi<{ data: S['TaskType'][] }>('/api/v1/task-types');
  const types = (typeRows.data?.data ?? []).filter((type) =>
    activeScopeIds.includes(type.scope_id),
  );
  const [exportError, setExportError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportKind, setExportKind] = useState('tasks');
  const [canConfigure, setCanConfigure] = useState(false);

  function change(patch: Record<string, string | null>) {
    const next = new URLSearchParams(q);
    next.delete('task_cursor');
    next.delete('session_cursor');
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    navigate(`/informes?${next.toString()}`);
  }
  // Les dates concretes fan que un enllaç compartit no es mogui amb el rellotge.
  useEffect(() => {
    const next = new URLSearchParams(q);
    let changed = false;
    if (!q.has('period')) {
      next.set('period', period);
      changed = true;
    }
    if (!q.has('tab') || rawTab === 'time') {
      next.set('tab', tab);
      changed = true;
    }
    if (period !== 'all' && period !== 'custom' && !q.has('from')) {
      next.set('from', from);
      changed = true;
    }
    if (period !== 'all' && period !== 'custom' && !q.has('to')) {
      next.set('to', to);
      changed = true;
    }
    if (validProjects.join(',') !== projectIds.join(',')) {
      next.set('projects', validProjects.join(','));
      changed = true;
    }
    if (
      q.has('type') &&
      typeRows.data &&
      q.get('type') !== 'none' &&
      !types.some((type) => type.id === q.get('type'))
    ) {
      next.delete('type');
      changed = true;
    }
    if (changed) navigate(`/informes?${next.toString()}`, { replace: true });
  }, [q.toString(), from, to, validProjects.join(','), typeRows.data]);

  useEffect(() => {
    let cancelled = false;
    setCanConfigure(
      scopes.some((scope) => activeScopeIds.includes(scope.id) && scope.owner_id === profile.id),
    );
    void Promise.allSettled(
      activeScopeIds.map(async (id) => {
        const members = await api.get<{ user_id: string; role: string }[]>(
          `/api/v1/scopes/${id}/members`,
        );
        return members.some(
          (member) =>
            member.user_id === profile.id && (member.role === 'admin' || member.role === 'owner'),
        );
      }),
    )
      .then((values) => {
        if (!cancelled && values.some((value) => value.status === 'fulfilled' && value.value))
          setCanConfigure(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeScopeIds.join(','), profile.id]);

  const query = new URLSearchParams();
  if (chrono ? day : from) query.set('from', chrono ? day : from);
  if (chrono ? day : to) query.set('to', chrono ? day : to);
  query.set('scope_ids', activeScopeIds.join(','));
  if (validProjects.length) query.set('project_ids', validProjects.join(','));
  if (q.get('type')) query.set('task_type_id', q.get('type')!);
  if (q.get('search')) query.set('search', q.get('search')!);
  if (tab === 'summary') {
    query.set('metric', metric);
    if (q.get('assignee')) query.set('assignee_id', q.get('assignee')!);
  } else if (q.get('person')) query.set('user_id', q.get('person')!);
  const timeQuery = new URLSearchParams(query);
  timeQuery.delete('metric');
  timeQuery.delete('assignee_id');
  if (q.get('person')) timeQuery.set('user_id', q.get('person')!);
  const baseQuery = query.toString();
  if (!chrono) query.set('limit', '100');
  const cursorKey = tab === 'summary' ? 'task_cursor' : 'session_cursor';
  if (q.get(cursorKey)) query.set('cursor', q.get(cursorKey)!);
  const ready = valid && activeScopeIds.length > 0;
  const tasks = useApi<S['TaskReport']>(
    ready && tab === 'summary' ? `/api/v1/reports/tasks?${query.toString()}` : null,
    [reloadKey],
  );
  const stats = useApi<S['SessionStats']>(
    ready && tracking && tab === 'summary' ? `/api/v1/sessions/stats?${timeQuery}` : null,
    [reloadKey],
  );
  const sessions = useApi<S['SessionReport']>(
    ready && tracking && tab === 'register' ? `/api/v1/sessions?${query.toString()}` : null,
    [reloadKey],
  );
  const result = tab === 'summary' ? tasks : sessions;
  const taskData = tasks.data,
    timeData = stats.data,
    registerData = sessions.data;
  const generated = result.data?.generated_at;
  const busy = result.loading || result.revalidating;
  const filterCount =
    validProjects.length +
    ['assignee', 'person', 'type', 'search'].filter((key) => q.get(key)).length;
  const title = (key: string) => t(projectNoun === 'client' ? `${key}.client` : key);
  const projectLabel = (key: string, label: string) =>
    key === 'none' ? t('registre.noProject') : label;
  const names = validProjects.map((id) =>
    projectLabel(id, projects.find((project) => project.id === id)?.name ?? id),
  );
  const nextCursor = tab === 'summary' ? taskData?.next_cursor : registerData?.next_cursor;

  async function download() {
    setExporting(true);
    setExportError(false);
    try {
      const taskExport = tab === 'summary' && exportKind === 'tasks';
      const path = taskExport ? '/api/v1/reports/tasks/export.csv' : '/api/v1/sessions/export.csv';
      const csv = await api.text(
        `${path}?${taskExport || tab === 'register' ? baseQuery : timeQuery}`,
      );
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = taskExport ? 'tasques.csv' : 'registre.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }
  const select = (key: string, value: string) =>
    change({ tab: 'register', [key]: value, view: 'table' });
  const dateInput = (label: string, value: string, key: string) => (
    <label>
      {t(label)}
      <input
        className="plou-input"
        type="date"
        value={value}
        onChange={(e) => change({ [key]: e.target.value, period: 'custom' })}
      />
    </label>
  );

  return (
    <section className="reports" data-testid="reports-screen">
      <header className="reports-heading">
        <div>
          <h1>{t('reports.title')}</h1>
          <p>{t('reports.subtitle')}</p>
        </div>
        <details className="reports-no-print reports-tools" data-testid="reports-tools">
          <summary>{t('reports.tools')}</summary>
          <div className="reports-actions">
            {tab === 'summary' && (
              <label>
                {t('reports.exportContent')}
                <select value={exportKind} onChange={(e) => setExportKind(e.target.value)}>
                  <option value="tasks">
                    {t('reports.exportTasks', { metric: t(`reports.metric.${metric}`) })}
                  </option>
                  {tracking && <option value="time">{t('reports.registerTitle')}</option>}
                </select>
              </label>
            )}
            <button
              type="button"
              data-testid="reports-export"
              className="plou-btn"
              disabled={!ready || busy || exporting || (tab !== 'summary' && !tracking)}
              onClick={() => void download()}
            >
              {t('registre.export')}
            </button>
            {tab !== 'register' && (
              <button
                type="button"
                className="plou-btn"
                disabled={!ready || busy || !!result.error || !result.data}
                onClick={() => window.print()}
              >
                {t('reports.print')}
              </button>
            )}
          </div>
        </details>
      </header>
      <nav className="reports-no-print" aria-label={t('reports.title')}>
        <Chips
          testId="reports-tabs"
          value={tab}
          options={TABS.map((key) => ({ key, label: t(`reports.tab.${key}`) }))}
          onChange={(value) => change({ tab: value })}
        />
      </nav>
      <h2 className="reports-print-only">{t(`reports.tab.${tab}`)}</h2>
      <div className="reports-filters reports-no-print">
        {!chrono && (
          <>
            <label>
              {t('reports.period')}
              <select
                className="plou-input"
                data-testid="reports-period"
                value={period}
                onChange={(e) => {
                  const range = reportRange(
                    e.target.value,
                    timezone,
                    new Date(),
                    resolveWeekStart(settings.week_start, getLocale()),
                  );
                  change({ period: e.target.value, from: range.from, to: range.to });
                }}
              >
                {REPORT_PERIODS.map((key) => (
                  <option key={key} value={key}>
                    {t(`reports.period.${key}`)}
                  </option>
                ))}
              </select>
            </label>
            {period === 'custom' && (
              <>
                {dateInput('reports.from', from, 'from')}
                {dateInput('reports.to', to, 'to')}
              </>
            )}
          </>
        )}
        {chrono && (
          <label>
            {t('registre.day')}
            <input
              className="plou-input"
              type="date"
              value={day}
              onChange={(e) => change({ day: e.target.value })}
            />
          </label>
        )}
      </div>
      <details className="reports-no-print reports-filter-panel" data-testid="reports-filters">
        <summary>
          {t('reports.filters')}
          {filterCount ? ` · ${filterCount}` : ''}
        </summary>
        <div className="reports-filters">
          <label>
            {tab === 'summary' ? t('reports.assignee') : t('reports.person')}
            <select
              className="plou-input"
              data-testid="reports-person"
              value={q.get(tab === 'summary' ? 'assignee' : 'person') ?? ''}
              onChange={(e) =>
                change({ [tab === 'summary' ? 'assignee' : 'person']: e.target.value })
              }
            >
              <option value="">{t('registre.everyone')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          {tab === 'summary' && tracking && (
            <label>
              {t('reports.person')}
              <select
                className="plou-input"
                value={q.get('person') ?? ''}
                onChange={(e) => change({ person: e.target.value })}
              >
                <option value="">{t('registre.everyone')}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t('task.taskType')}
            <select
              className="plou-input"
              data-testid="reports-type"
              value={q.get('type') ?? ''}
              onChange={(e) => change({ type: e.target.value })}
            >
              <option value="">{t('reports.allTypes')}</option>
              <option value="none">{t('stats.noType')}</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('nav.search')}
            <input
              className="plou-input"
              value={q.get('search') ?? ''}
              onChange={(e) => change({ search: e.target.value })}
            />
          </label>
        </div>
        <details className="reports-no-print reports-project-filter" data-testid="reports-projects">
          <summary>
            {title('reports.projects')} · {validProjects.length || t('reports.allProjects')}
          </summary>
          <button
            type="button"
            className="plou-btn plou-btn-ghost"
            onClick={() => change({ projects: null })}
          >
            {t('reports.allProjects')}
          </button>
          {[{ id: 'none', name: t('registre.noProject') }, ...activeProjects].map((project) => (
            <label key={project.id}>
              <input
                type="checkbox"
                checked={validProjects.includes(project.id)}
                onChange={() =>
                  change({
                    projects: (validProjects.includes(project.id)
                      ? validProjects.filter((id) => id !== project.id)
                      : [...validProjects, project.id]
                    ).join(','),
                  })
                }
              />
              {project.name}
            </label>
          ))}
        </details>
        {filterCount > 0 && (
          <button
            type="button"
            className="plou-btn"
            onClick={() =>
              change({ projects: null, type: null, search: null, person: null, assignee: null })
            }
          >
            {t('reports.clearFilters')}
          </button>
        )}
      </details>
      <p className="reports-context">
        {scopes
          .filter((scope) => activeScopeIds.includes(scope.id))
          .map((scope) => scope.name)
          .join(' · ')}
        {names.length ? ` · ${names.join(', ')}` : ''}
        {!chrono &&
          ` · ${from || to ? (from === to ? from : `${from || '…'} — ${to || '…'}`) : t('reports.period.all')}`}
        {q.get(tab === 'summary' ? 'assignee' : 'person')
          ? ` · ${tab === 'summary' ? t('reports.assignee') : t('reports.person')}: ${people.find((person) => person.id === q.get(tab === 'summary' ? 'assignee' : 'person'))?.name ?? ''}`
          : ''}
        {q.get('type')
          ? ` · ${types.find((type) => type.id === q.get('type'))?.name ?? t('stats.noType')}`
          : ''}
        {q.get('search') ? ` · ${t('nav.search')}: ${q.get('search')}` : ''}
      </p>
      {!valid && <p role="alert">{t('reports.invalidRange')}</p>}
      {exportError && <p role="alert">{t('reports.exportError')}</p>}
      {result.error && <ErrorBanner onRetry={result.reload} />}
      {busy && <p role="status">{t('reports.loading')}</p>}
      {tab !== 'summary' && !tracking ? (
        <EmptyState>
          <p>{t('reports.trackingDisabled')}</p>
          {canConfigure && <a href="/settings?tab=scopes">{t('reports.configure')}</a>}
        </EmptyState>
      ) : (
        ready && (
          <div aria-busy={busy} style={{ opacity: busy ? 0.6 : 1 }}>
            {tab === 'summary' && taskData && (
              <>
                <div className="reports-cards">
                  {METRICS.map((key) => (
                    <MetricCard
                      key={key}
                      label={t(`reports.metric.${key}`)}
                      value={taskData.counts[key]}
                      selected={q.has('metric') && metric === key}
                      onClick={() => change({ metric: key })}
                    />
                  ))}
                </div>
                <div className="reports-overview-grid">
                  <section className="plou-card reports-panel">
                    <h2>{t('reports.evolution')}</h2>
                    <p>{t('reports.completedHint')}</p>
                    <TaskEvolution points={taskData.evolution} />
                    <details>
                      <summary>{t('reports.values')}</summary>
                      <div className="reports-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('reports.period')}</th>
                              <th>{t('reports.metric.created')}</th>
                              <th>{t('reports.metric.completed')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {taskData.evolution.map((point) => (
                              <tr key={point.key}>
                                <th>
                                  {point.key}
                                  {taskData.weekly ? ' · ' + t('reports.week') : ''}
                                </th>
                                <td>{point.created}</td>
                                <td>{point.completed}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </section>
                  <section className="plou-card reports-panel" data-testid="estadistiques-screen">
                    <h2>{t('reports.registerTitle')}</h2>
                    <p>{t('reports.registerHint')}</p>
                    {!tracking ? (
                      <>
                        <p>{t('reports.trackingDisabled')}</p>
                        {canConfigure && (
                          <a href="/settings?tab=scopes">{t('reports.configure')}</a>
                        )}
                      </>
                    ) : stats.error ? (
                      <ErrorBanner onRetry={stats.reload} />
                    ) : stats.loading ? (
                      <p role="status">{t('reports.loading')}</p>
                    ) : (
                      timeData && (
                        <div aria-busy={stats.revalidating}>
                          <div className="reports-cards">
                            <MetricCard
                              label={t('stats.total')}
                              value={fmtMinutes(timeData.minutes)}
                            />
                            <MetricCard label={t('reports.trackedTasks')} value={timeData.tasks} />
                          </div>
                          {timeData.evolution.length > 1 && <Linia points={timeData.evolution} />}
                          <button
                            type="button"
                            className="plou-btn"
                            onClick={() => change({ tab: 'register' })}
                          >
                            {t('reports.openRegister')}
                          </button>
                          <details>
                            <summary>{t('reports.timeDetails')}</summary>
                            <MetricCard
                              label={t('stats.average')}
                              value={timeData.tasks ? fmtMinutes(timeData.average_minutes) : '—'}
                            />
                            <p>{t('reports.visibility')}</p>
                            <div className="reports-charts">
                              <Barres
                                testId="stats-by-project"
                                title={title('stats.byProject')}
                                buckets={timeData.by_project}
                                label={(b) => projectLabel(b.key, b.label)}
                                onSelect={(b) => select('projects', b.key)}
                              />
                              <Barres
                                testId="stats-by-type"
                                title={t('stats.byType')}
                                buckets={timeData.by_type}
                                label={(b) => (b.key === 'none' ? t('stats.noType') : b.label)}
                                onSelect={(b) => select('type', b.key)}
                              />
                              <Barres
                                testId="stats-by-person"
                                title={t('stats.byPerson')}
                                buckets={timeData.by_user}
                                label={(b) =>
                                  people.find((person) => person.id === b.key)?.name ?? b.label
                                }
                                onSelect={(b) => select('person', b.key)}
                              />
                              {timeData.overtime_by_project.length > 0 && (
                                <Barres
                                  testId="stats-overtime"
                                  title={title('stats.overtime')}
                                  buckets={timeData.overtime_by_project}
                                  label={(b) => projectLabel(b.key, b.label)}
                                  value={(b) => b.overtime_minutes}
                                  onSelect={(b) => select('projects', b.key)}
                                />
                              )}
                            </div>
                          </details>
                        </div>
                      )
                    )}
                  </section>
                </div>
                {q.has('metric') && (
                  <section className="reports-task-details" data-testid="reports-task-details">
                    <button
                      type="button"
                      className="plou-btn reports-no-print"
                      onClick={() => change({ metric: null })}
                    >
                      {t('reports.closeDetails')}
                    </button>
                    <h2>{title('reports.projects')}</h2>
                    <p>{t(`reports.metric.${metric}`)}</p>
                    <div className="reports-table-scroll">
                      <table>
                        <tbody>
                          {taskData.by_project.map((bucket) => (
                            <tr key={bucket.key}>
                              <th>
                                <button
                                  type="button"
                                  className="plou-btn plou-btn-ghost"
                                  onClick={() => change({ projects: bucket.key })}
                                >
                                  {projectLabel(bucket.key, bucket.label)}
                                </button>
                              </th>
                              <td>{bucket[metric]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="reports-no-print">
                      <h2>{t(`reports.metric.${metric}`)}</h2>
                      {taskData.data.length === 0 ? (
                        <EmptyState>{t('reports.empty')}</EmptyState>
                      ) : (
                        <div className="reports-table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{t('registre.col.task')}</th>
                                <th>{title('registre.col.project')}</th>
                                <th>{t('reports.assignee')}</th>
                                <th>{t('reports.status')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {taskData.data.map((task) => (
                                <tr key={task.id}>
                                  <td>
                                    <button
                                      type="button"
                                      className="plou-btn plou-btn-ghost"
                                      onClick={() => onOpenTask(task.id)}
                                    >
                                      {task.title}
                                    </button>
                                  </td>
                                  <td>
                                    {projectLabel(
                                      task.project_id ?? 'none',
                                      task.project_name ?? '',
                                    )}
                                  </td>
                                  <td>{task.assignees.map((person) => person.name).join(', ')}</td>
                                  <td>{t(`board.column.${task.status}`)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
            {tab === 'register' && registerData && (
              <div data-testid="registre-screen">
                <div className="reports-register-summary" data-testid="registre-summary">
                  <strong>{fmtMinutes(registerData.totals.minutes)}</strong>
                  <span>{t('reports.recordedTasks', { count: registerData.totals.tasks })}</span>
                </div>
                <p className="reports-register-hint">
                  {t('reports.registerHint')}{' '}
                  <button
                    type="button"
                    className="plou-btn plou-btn-ghost"
                    onClick={() =>
                      change({
                        tab: 'summary',
                        metric: 'completed',
                        ...(chrono ? { from: day, to: day, period: 'custom' } : {}),
                      })
                    }
                  >
                    {t('reports.seeCompleted')}
                  </button>
                </p>
                <Chips
                  testId="registre-view"
                  value={chrono ? 'chrono' : 'table'}
                  options={[
                    { key: 'table', label: t('registre.view.table') },
                    { key: 'chrono', label: t('registre.view.chrono') },
                  ]}
                  onChange={(value) => change({ view: value })}
                />
                {chrono ? (
                  <>
                    <Cronograma
                      entries={registerData.data}
                      day={day}
                      projects={activeProjects}
                      writableScopeIds={registerData.writable_scope_ids ?? []}
                      onChanged={sessions.reload}
                      onOpenTask={onOpenTask}
                    />
                  </>
                ) : (
                  <Taula
                    entries={registerData.data}
                    byDay={registerData.totals.by_day}
                    onOpenTask={onOpenTask}
                    nomPersona={(id) => people.find((person) => person.id === id)?.name ?? id}
                    projectLabel={title('registre.col.project')}
                    timezone={timezone}
                  />
                )}
                {registerData.data.length === 0 && <EmptyState>{t('reports.empty')}</EmptyState>}
              </div>
            )}
            {!chrono && (q.get(cursorKey) || nextCursor) && (
              <div className="reports-actions reports-no-print">
                <p>{t('reports.paginationHint')}</p>
                {q.get(cursorKey) && (
                  <button
                    type="button"
                    className="plou-btn"
                    onClick={() => change({ [cursorKey]: null })}
                  >
                    {t('reports.firstPage')}
                  </button>
                )}
                {nextCursor && (
                  <button
                    type="button"
                    className="plou-btn"
                    disabled={busy}
                    onClick={() => change({ [cursorKey]: nextCursor })}
                  >
                    {t('reports.nextPage')}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      )}
      {generated && (
        <details className="reports-metadata">
          <summary>{t('reports.aboutData')}</summary>
          <p className="reports-context">
            {t('reports.visibility')}{' '}
            {t('reports.generated', {
              at: new Intl.DateTimeFormat(getLocale(), {
                timeZone: timezone,
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(new Date(generated)),
            })}
            {tab !== 'summary' && (
              <>
                <br />
                {t('reports.openSessions', {
                  count: registerData?.open_sessions ?? 0,
                })}
              </>
            )}
          </p>
        </details>
      )}
    </section>
  );
}
function MetricCard({
  label,
  value,
  onClick,
  selected = false,
}: {
  label: string;
  value: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <div className="plou-card reports-metric">
      {onClick ? (
        <button type="button" aria-pressed={selected} onClick={onClick}>
          <span>{label}</span>
          <strong>{value}</strong>
        </button>
      ) : (
        <>
          <span>{label}</span>
          <strong>{value}</strong>
        </>
      )}
    </div>
  );
}

function TaskEvolution({ points }: { points: S['TaskReport']['evolution'] }) {
  const max = Math.max(1, ...points.flatMap((point) => [point.created, point.completed]));
  return (
    <div className="reports-evolution">
      <p>
        <span className="reports-created-key">{t('reports.metric.created')}</span> ·{' '}
        <span className="reports-completed-key">{t('reports.metric.completed')}</span>
      </p>
      <svg role="img" aria-label={t('reports.evolution')} viewBox="0 0 720 180">
        {[0, Math.ceil(max / 2), max]
          .filter((value, index, all) => all.indexOf(value) === index)
          .map((value) => (
            <g key={value}>
              <line
                x1={32}
                x2={710}
                y1={160 - (value / max) * 140}
                y2={160 - (value / max) * 140}
                stroke="var(--divider-soft)"
              />
              <text
                x={25}
                y={164 - (value / max) * 140}
                textAnchor="end"
                fill="var(--ink-soft)"
                fontSize={11}
              >
                {value}
              </text>
            </g>
          ))}
        {points.map((point, index) => {
          const slot = 670 / Math.max(1, points.length);
          const bar = Math.min(36, slot * 0.34);
          const center = 36 + slot * (index + 0.5);
          return (
            <g key={point.key}>
              {(['created', 'completed'] as const).map((key, i) => (
                <rect
                  key={key}
                  x={center + (i === 0 ? -bar - 1 : 1)}
                  y={160 - (point[key] / max) * 140}
                  width={bar}
                  height={(point[key] / max) * 140}
                  rx={Math.min(3, bar / 3)}
                  fill={key === 'created' ? 'var(--kicker)' : 'var(--ink)'}
                >
                  <title>
                    {point.key} · {t(`reports.metric.${key}`)}: {point[key]}
                  </title>
                </rect>
              ))}
            </g>
          );
        })}
      </svg>
      <p>
        {points[0]?.key} — {points.at(-1)?.key}
      </p>
    </div>
  );
}
