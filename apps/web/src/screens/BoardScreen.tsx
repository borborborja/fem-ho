/**
 * El tauler. docs/02 §4.
 *
 * Uneix `KanbanBoard` —que no sap res de xarxa— amb `/board`, i hi posa el que sí que
 * és d'aquesta pantalla: l'afegida ràpida, l'actualització optimista dels moviments i
 * el plegat de grups, que persisteix a les preferències de l'usuari.
 *
 * **L'actualització és optimista amb reversió** (docs/02 §4): la targeta es mou a la
 * pantalla abans que el servidor respongui, i torna al seu lloc si el rebutja. Esperar
 * la resposta faria que arrossegar fes un salt de mig segon, que és el que fa que la
 * gent deixi d'arrossegar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { generatePosition, t, type QuickAddContext, type TaskStatus } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api } from '../app/api.js';
import { useSessionData, useSession } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import type { Board, Task } from '../app/types.js';
import { KanbanBoard, type BoardTask } from '../board/KanbanBoard.js';
import { QuickAdd } from '../board/QuickAdd.js';
import { DoneHeader } from '../board/DoneColumnView.js';

export interface BoardScreenProps {
  activeScopeIds: string[];
  projectId: string | null;
  onOpenTask: (id: string) => void;
}

/** La targeta tal com la vol el component, des de la tasca tal com la dona l'API. */
function toBoardTask(task: Task, projectName: string | undefined, initials: string | undefined): BoardTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    scope_id: task.scope_id,
    project: projectName,
    assigneeInitials: initials,
    time: task.due_time ?? undefined,
    aiMode: task.ai_mode,
  };
}

export function BoardScreen({ activeScopeIds, projectId, onOpenTask }: BoardScreenProps) {
  const { scopes, projects, people, settings } = useSessionData();
  const { updateSettings } = useSession();

  const path = useMemo(() => {
    const query = new URLSearchParams();
    if (activeScopeIds.length > 0) query.set('scope_ids', activeScopeIds.join(','));
    if (projectId !== null) query.set('project_id', projectId);
    return `/api/v1/board?${query.toString()}`;
  }, [activeScopeIds, projectId]);

  const board = useApi<Board>(path);
  const [optimistic, setOptimistic] = useState<Record<string, TaskStatus>>({});

  // Quan arriben dades noves, les suposicions optimistes ja no calen: la resposta del
  // servidor mana i mantenir-les taparia un rebuig.
  useEffect(() => {
    if (board.data !== undefined) setOptimistic({});
  }, [board.data]);

  const projectName = useCallback(
    (id: string | null): string | undefined =>
      id === null ? undefined : projects.find((project) => project.id === id)?.name,
    [projects],
  );

  const initialsOf = useCallback(
    (ids: string[]): string | undefined => {
      const first = ids[0];
      if (first === undefined) return undefined;
      const person = people.find((candidate) => candidate.id === first);
      return person?.name.charAt(0).toUpperCase();
    },
    [people],
  );

  const tasks = useMemo<BoardTask[]>(() => {
    const columns = board.data?.columns ?? [];
    return columns
      .flatMap((column) => column.groups.flatMap((group) => group.tasks))
      .map((task) => {
        const card = toBoardTask(
          task,
          projectName(task.project_id ?? null),
          initialsOf(task.assignee_ids ?? []),
        );
        const moved = optimistic[task.id];
        return moved === undefined ? card : { ...card, status: moved };
      });
  }, [board.data, optimistic, projectName, initialsOf]);

  const activeScopes = scopes.filter((scope) => activeScopeIds.includes(scope.id));

  const context = useMemo<QuickAddContext>(
    () => ({
      scopes: activeScopes.map((scope) => ({
        id: scope.id,
        name: scope.name,
        projects: projects
          .filter((project) => project.scope_id === scope.id)
          .map((project) => ({ id: project.id, name: project.name })),
      })),
      people,
      activeScopeIds,
    }),
    [activeScopes, projects, people, activeScopeIds],
  );

  const move = async (taskId: string, status: TaskStatus): Promise<void> => {
    const before = tasks.find((task) => task.id === taskId)?.status;
    setOptimistic((current) => ({ ...current, [taskId]: status }));

    try {
      /**
       * La posició la calcula el client (D3). Es posa al final de la columna de destí
       * perquè és on el gest deixa la targeta quan no s'ha afinat entre dues.
       */
      const column = tasks.filter((task) => task.status === status && task.id !== taskId);
      const last = column[column.length - 1];
      const lastPosition =
        last === undefined
          ? null
          : ((board.data?.columns
              .flatMap((c) => c.groups.flatMap((g) => g.tasks))
              .find((task) => task.id === last.id)?.position ?? null));

      await api.post(`/api/v1/tasks/${taskId}/move`, {
        status,
        position: generatePosition(lastPosition, null),
      });
      board.reload();
    } catch {
      // Reversió: la targeta torna al seu lloc i l'usuari veu que no s'ha mogut.
      setOptimistic((current) => {
        const next = { ...current };
        if (before === undefined) delete next[taskId];
        else next[taskId] = before;
        return next;
      });
    }
  };

  const create = async (input: {
    title: string;
    scopeId: string;
    projectId: string | null;
    assigneeIds: string[];
    aiMode: 'manual' | 'assisted' | 'delegated';
  }): Promise<void> => {
    // L'identificador el genera el client (D4): així la creació és idempotent i la cua
    // de sortida pot reintentar-la sense duplicar res.
    await api.post('/api/v1/tasks', {
      id: uuidv7(),
      scope_id: input.scopeId,
      project_id: input.projectId ?? undefined,
      title: input.title,
      assignee_ids: input.assigneeIds.length > 0 ? input.assigneeIds : undefined,
    });
    board.reload();
  };

  const toggleGroup = (status: TaskStatus, scopeId: string): void => {
    const key = `${status}:${scopeId}`;
    const current = settings.collapsed_groups ?? [];
    const next = current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key];
    void updateSettings({ collapsed_groups: next });
  };

  const collapsed = Object.fromEntries((settings.collapsed_groups ?? []).map((key) => [key, true]));

  return (
    <div
      data-testid="board-screen"
      style={{
        display: 'grid',
        gap: 16,
        // Contingut anterior amb opacitat mentre es revalida: res d'esquelets brillants,
        // que el design system prohibeix (docs/02 §12).
        opacity: board.revalidating ? 0.6 : 1,
      }}
    >
      {board.error !== undefined ? (
        <ErrorBanner onRetry={board.reload} />
      ) : null}

      <KanbanBoard
        tasks={tasks}
        scopes={activeScopes.map((scope) => ({
          id: scope.id,
          name: scope.name,
          color: `var(${scope.color})`,
        }))}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        onOpen={onOpenTask}
        onDrop={(taskId, status) => void move(taskId, status)}
        onMove={(taskId, status) => void move(taskId, status)}
        onToggleDone={(taskId) => {
          const task = tasks.find((candidate) => candidate.id === taskId);
          void move(taskId, task?.status === 'done' ? 'todo' : 'done');
        }}
        doneHeaderActions={
          <DoneHeader
            clearedAt={settings.done_cleared_at ?? null}
            onClear={() => void updateSettings({ done_cleared_at: new Date().toISOString() })}
            onShowAll={() => void updateSettings({ done_cleared_at: null })}
          />
        }
      />

      <div style={{ maxWidth: 420 }}>
        <QuickAdd
          context={context}
          columnLabel={t('board.column.inbox')}
          scopeColors={Object.fromEntries(scopes.map((scope) => [scope.id, `var(${scope.color})`]))}
          onCreate={(task) => void create(task)}
        />
      </div>
    </div>
  );
}

/** La banda d'error de docs/02 §12: discreta, a dalt, amb botó de reintentar. */
export function ErrorBanner({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div
      role="alert"
      data-testid="error-banner"
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
      <span>{message ?? t('error.generic')}</span>
      <button
        type="button"
        onClick={onRetry}
        data-testid="error-retry"
        style={{
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {t('error.retry')}
      </button>
    </div>
  );
}
