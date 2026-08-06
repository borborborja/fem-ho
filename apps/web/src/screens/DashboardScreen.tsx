/**
 * El tauler general. docs/02 §8.
 *
 * **Ignora la selecció d'àmbits i de projecte: ho ensenya tot.** És el que el distingeix
 * del tauler, i per això aquesta pantalla no rep cap prop de filtre: si en rebés, algú
 * l'hi passaria i seria un segon tauler amb una altra cara.
 *
 * S'hi arriba clicant el wordmark. No és al prototip; el brief el demana a la línia 38.
 */

import { useMemo } from 'react';
import { t, type QuickAddContext } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { EmptyState, MonthView, TaskCard } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useSessionData } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import type { Dashboard, Task } from '../app/types.js';
import { QuickAdd } from '../board/QuickAdd.js';
import { PlusIcon } from '../board/ColumnQuickAdd.js';
import { ErrorBanner } from './BoardScreen.js';

export interface DashboardScreenProps {
  onOpenTask: (id: string) => void;
  onPickScope: (scopeId: string) => void;
  /** L'edició completa des de l'afegida ràpida, com a cada columna del tauler. */
  onNewTask: () => void;
}

export function DashboardScreen({ onOpenTask, onPickScope, onNewTask }: DashboardScreenProps) {
  const { scopes, projects, people, settings } = useSessionData();
  const dashboard = useApi<Dashboard>('/api/v1/dashboard');

  const colorOf = (scopeId: string): string => {
    const scope = scopes.find((candidate) => candidate.id === scopeId);
    return scope === undefined ? 'var(--ink-faint)' : `var(${scope.color})`;
  };

  /**
   * Al tauler general, `#Àmbit` és **obligatori sempre** (docs/02 §8), encara que
   * l'usuari només en tingui un: aquí no hi ha cap àmbit "actiu" del qual deduir-lo, i
   * endevinar-lo posaria les tasques en un lloc que ningú ha triat.
   */
  const context = useMemo<QuickAddContext>(
    () => ({
      scopes: scopes.map((scope) => ({
        id: scope.id,
        name: scope.name,
        projects: projects
          .filter((project) => project.scope_id === scope.id)
          .map((project) => ({ id: project.id, name: project.name })),
      })),
      people,
      activeScopeIds: scopes.length > 1 ? scopes.map((scope) => scope.id) : [],
    }),
    [scopes, projects, people],
  );

  const data = dashboard.data;

  const taskRow = (task: Task) => (
    <TaskCard
      key={task.id}
      title={task.title}
      // La pastilla d'àmbit a cada línia: aquí es barregen tots i sense ella no se sap
      // de quin és cadascuna (docs/02 §8).
      project={scopes.find((scope) => scope.id === task.scope_id)?.name}
      time={task.due_time ?? undefined}
      aiMode={task.ai_mode}
      done={task.status === 'done'}
      onOpen={() => onOpenTask(task.id)}
      quickActions={[]}
    />
  );

  const section = (
    title: string,
    tasks: Task[],
    emptyKey: string,
    testId: string,
  ) => (
    <section data-testid={testId} style={{ display: 'grid', gap: 9 }}>
      <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: 'var(--ink)' }}>{title}</h2>
      {tasks.length === 0 ? <EmptyState>{t(emptyKey)}</EmptyState> : tasks.map(taskRow)}
    </section>
  );

  const now = new Date();

  return (
    <div
      data-testid="dashboard-screen"
      style={{ display: 'grid', gap: 22, opacity: dashboard.revalidating ? 0.6 : 1 }}
    >
      {dashboard.error !== undefined ? <ErrorBanner onRetry={dashboard.reload} /> : null}

      <div style={{ maxWidth: 620, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        <QuickAdd
          context={context}
          columnLabel={t('dashboard.title')}
          scopeColors={Object.fromEntries(scopes.map((scope) => [scope.id, `var(${scope.color})`]))}
          onCreate={(task) => {
            void api
              .post('/api/v1/tasks', {
                id: uuidv7(),
                scope_id: task.scopeId,
                project_id: task.projectId ?? undefined,
                title: task.title,
              })
              .then(() => {
                dashboard.reload();
              });
          }}
        />
        </div>
        <button
          type="button"
          data-testid="full-edit-dashboard"
          title={t('board.fullEdit')}
          aria-label={t('board.fullEdit')}
          onClick={onNewTask}
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--tag-bg)',
            color: 'var(--ink-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          <PlusIcon />
        </button>
      </div>

      <div
        data-testid="dashboard-scopes"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        {(data?.scopes ?? []).map((scope) => (
          <button
            key={scope.scope_id}
            type="button"
            data-testid={`dashboard-scope-${scope.scope_id}`}
            onClick={() => onPickScope(scope.scope_id)}
            style={{
              textAlign: 'left',
              padding: '14px 16px',
              borderRadius: 16,
              cursor: 'pointer',
              background: 'var(--card-bg)',
              boxShadow: 'var(--card-shadow)',
              font: 'inherit',
              color: 'var(--ink)',
              // La vora del color de l'àmbit: és el que lliga la targeta amb el chip.
              border: '1px solid var(--card-border)',
              borderLeft: `3px solid ${colorOf(scope.scope_id)}`,
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{scope.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', paddingTop: 3 }}>
              {t('dashboard.pending', { count: scope.pending })}
              {scope.overdue > 0 ? ` · ${t('dashboard.overdueCount', { count: scope.overdue })}` : ''}
            </div>
          </button>
        ))}
      </div>

      {section(t('dashboard.today'), data?.today ?? [], 'dashboard.empty.today', 'dashboard-today')}

      {/* La secció d'endarrerides es pot amagar a Ajustos (docs/02 §8). */}
      {settings.show_overdue_section === false
        ? null
        : section(
            t('dashboard.overdue'),
            data?.overdue ?? [],
            'dashboard.empty.overdue',
            'dashboard-overdue',
          )}

      {settings.show_calendar_widget === false ? null : (
        <div data-testid="dashboard-calendar" style={{ maxWidth: 320 }}>
          <MonthView
            year={now.getFullYear()}
            month={now.getMonth()}
            monthLabel={t('calendar.months').split(',')[now.getMonth()] ?? ''}
            weekdayLabels={{ days: t('calendar.weekdays').split(',') }}
            today={now.toISOString().slice(0, 10)}
          />
        </div>
      )}

      {section(t('dashboard.doing'), data?.doing ?? [], 'dashboard.empty.doing', 'dashboard-doing')}
    </div>
  );
}
