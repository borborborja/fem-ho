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
import { ColumnQuickAdd, PlusIcon } from '../board/ColumnQuickAdd.js';
import { DoneHeader } from '../board/DoneColumnView.js';

export interface BoardScreenProps {
  activeScopeIds: string[];
  projectId: string | null;
  onOpenTask: (id: string) => void;
  /** Obre l'edició completa per a una tasca NOVA en aquesta columna. */
  onNewTask: (status: TaskStatus, forAi: boolean) => void;
  /** El kanban de la IA. Les columnes són les mateixes; el que canvia és què hi surt. */
  aiBoard?: boolean;
  flip?: { transform: string; transition: string } | undefined;
}

/** La targeta tal com la vol el component, des de la tasca tal com la dona l'API. */
function toBoardTask(
  task: Task,
  projectName: string | undefined,
  initials: string | undefined,
  assignedToOther: boolean,
): BoardTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    scope_id: task.scope_id,
    project: projectName,
    /**
     * A la bústia, sempre qui la té; fora, **només si és d'algú altre**.
     *
     * A "Per fer" gairebé totes són teves, i pintar la teva inicial a cadascuna és una
     * columna de la mateixa lletra que no distingeix res.
     */
    assigneeInitials: task.status === 'inbox' || assignedToOther ? initials : undefined,
    assignedToOther,
    time: task.due_time ?? undefined,
    aiMode: task.ai_mode,
    progress: task.progress,
  };
}

export function BoardScreen({
  activeScopeIds,
  projectId,
  onOpenTask,
  onNewTask,
  aiBoard = false,
  flip,
}: BoardScreenProps) {
  const { scopes, projects, people, settings, profile } = useSessionData();
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
    return (
      columns
        .flatMap((column) => column.groups.flatMap((group) => group.tasks))
        /**
         * **La bústia surt sencera als dos taulers; les altres tres es reparteixen.**
         *
         * Una tasca amb mode d'IA no és feina teva encara, i barrejar-la amb la resta a
         * "Per fer" fa que la columna deixi de dir què has de fer tu. La bústia és
         * l'excepció perquè és on tot arriba abans de decidir-ho.
         */
        .filter((task) => {
          if (task.status === 'inbox') return true;
          const delegated = task.ai_mode !== 'manual';
          return aiBoard ? delegated : !delegated;
        })
        .map((task) => {
          const assignees = task.assignee_ids ?? [];
          const card = toBoardTask(
            task,
            projectName(task.project_id ?? null),
            initialsOf(assignees),
            assignees.length > 0 && !assignees.includes(profile.id),
          );
          const moved = optimistic[task.id];
          return moved === undefined ? card : { ...card, status: moved };
        })
    );
  }, [board.data, optimistic, projectName, initialsOf, aiBoard, profile.id]);

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
       * **Al kanban de la IA, treure una targeta de la bústia la delega.**
       *
       * És el gest que el disseny validat fa servir per posar-hi feina: arrossegar-la a
       * "Per fer" del tauler de la IA vol dir "encarrega-t'ho". I a l'inrevés, tornar-la
       * a la bústia des d'allà l'hi treu — sense això seria una porta d'un sol sentit i
       * una tasca delegada per error no es podria recuperar.
       */
      if (aiBoard) {
        const current = board.data?.columns
          .flatMap((column) => column.groups.flatMap((group) => group.tasks))
          .find((task) => task.id === taskId);

        if (status !== 'inbox' && current?.ai_mode === 'manual') {
          await api.post(`/api/v1/tasks/${taskId}/ai-mode`, { ai_mode: 'assisted' });
        } else if (status === 'inbox' && current !== undefined && current.ai_mode !== 'manual') {
          await api.post(`/api/v1/tasks/${taskId}/ai-mode`, { ai_mode: 'manual' });
        }
      }

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

  const create = async (
    input: {
      title: string;
      scopeId: string;
      projectId: string | null;
      assigneeIds: string[];
      aiMode: 'manual' | 'assisted' | 'delegated';
    },
    status: TaskStatus = 'inbox',
  ): Promise<void> => {
    // L'identificador el genera el client (D4): així la creació és idempotent i la cua
    // de sortida pot reintentar-la sense duplicar res.
    await api.post('/api/v1/tasks', {
      id: uuidv7(),
      scope_id: input.scopeId,
      project_id: input.projectId ?? undefined,
      title: input.title,
      status,
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
        aiBoard={aiBoard}
        flip={flip}
        renderFooter={(status) =>
          // L'Inbox conserva l'afegida ràpida als dos taulers: és l'entrada de tot, i al
          // tauler de la IA no hi ha cap columna d'inbox pròpia — és la mateixa.
          aiBoard && status !== 'inbox' ? (
            <button
              type="button"
              data-testid={`ai-new-task-${status}`}
              onClick={() => onNewTask(status, true)}
              style={{
                marginTop: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 0',
                borderRadius: 100,
                // Discontínua: no és un camp on escriure, és una porta cap al formulari.
                border: '1px dashed var(--plou-blue-ink)',
                background: 'transparent',
                color: 'var(--plou-blue-ink)',
                font: 'inherit',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <PlusIcon size={14} />
              {t('board.ia.newTask')}
            </button>
          ) : (
            <ColumnQuickAdd
              status={status}
              context={context}
              scopes={scopes}
              onCreate={(task) => void create(task, status)}
              // Des del tauler de la IA, el formulari s'obre ja amb els camps d'IA
              // desplegats: és l'únic peu que hi queda i seria absurd que no ho fes.
              onFullEdit={() => onNewTask(status, aiBoard)}
            />
          )
        }
        tasks={tasks}
        scopes={activeScopes.map((scope) => ({
          id: scope.id,
          name: scope.name,
          color: `var(${scope.color})`,
        }))}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        onOpen={onOpenTask}
        onChanged={board.reload}
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
