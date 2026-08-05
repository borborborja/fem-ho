/**
 * El tauler de quatre columnes. docs/02 §4, portat del prototip.
 *
 * Rep les dades per props i no les demana ell: així es pot pintar amb fixtures per a
 * les proves de navegador i amb dades reals a l'app, sense dues implementacions.
 *
 * Els textos surten TOTS del catàleg (regla 3). Cap literal català en aquest fitxer.
 */

import type { ReactNode } from 'react';
import { t } from '@fem-ho/contracts';
import type { TaskStatus } from '@fem-ho/contracts';
import {
  EmptyState,
  KanbanColumn,
  KanbanGroup,
  ScopeGroupHeader,
  TaskCard,
} from '@fem-ho/design-system/femho';

export interface BoardTask {
  id: string;
  title: string;
  status: TaskStatus;
  scope_id: string;
  project?: string | undefined;
  assigneeInitials?: string | undefined;
  time?: string | undefined;
  aiMode?: 'manual' | 'assisted' | 'delegated' | undefined;
  hasUnseenAiChange?: boolean | undefined;
  checklistProgress?: string | undefined;
}

export interface BoardScope {
  id: string;
  name: string;
  color: string;
}

export interface KanbanBoardProps {
  tasks: BoardTask[];
  scopes: BoardScope[];
  /** Àmbits plegats, per columna. Persisteix a les preferències de l'usuari. */
  collapsed?: Record<string, boolean>;
  onToggleGroup?: (status: TaskStatus, scopeId: string) => void;
  onMove?: (taskId: string, status: TaskStatus) => void;
  onOpen?: (taskId: string) => void;
  onToggleDone?: (taskId: string) => void;
  doneHeaderActions?: ReactNode;
  draggingId?: string | null;
}

/** L'ordre de les columnes és el del producte i no es reordena. */
const COLUMNS: { status: TaskStatus; labelKey: string; emptyKey: string }[] = [
  { status: 'inbox', labelKey: 'board.column.inbox', emptyKey: 'board.empty.inbox' },
  { status: 'todo', labelKey: 'board.column.todo', emptyKey: 'board.empty.todo' },
  { status: 'doing', labelKey: 'board.column.doing', emptyKey: 'board.empty.doing' },
  { status: 'done', labelKey: 'board.column.done', emptyKey: 'board.empty.done' },
];

export function KanbanBoard({
  tasks,
  scopes,
  collapsed = {},
  onToggleGroup,
  onMove,
  onOpen,
  onToggleDone,
  doneHeaderActions,
  draggingId = null,
}: KanbanBoardProps) {
  // L'agrupació per àmbit surt quan hi ha més d'un àmbit actiu (docs/02 §4).
  const grouped = scopes.length > 1;

  const renderColumn = (column: (typeof COLUMNS)[number]) => {
    const ofColumn = tasks.filter((task) => task.status === column.status);
    const isInbox = column.status === 'inbox';

    const cardFor = (task: BoardTask) => (
      <TaskCard
        key={task.id}
        data-testid={`task-${task.id}`}
        data-status={task.status}
        title={task.title}
        project={task.project}
        assigneeInitials={task.assigneeInitials}
        time={task.time}
        aiMode={task.aiMode ?? 'manual'}
        aiModeLabel={
          task.aiMode === 'delegated'
            ? t('ai.mode.delegated')
            : task.aiMode === 'assisted'
              ? t('ai.mode.assisted')
              : undefined
        }
        hasUnseenAiChange={task.hasUnseenAiChange ?? false}
        checklistProgress={task.checklistProgress}
        dragging={draggingId === task.id}
        done={task.status === 'done'}
        onOpen={() => onOpen?.(task.id)}
        onToggleDone={() => onToggleDone?.(task.id)}
        quickActions={
          // Accions ràpides NOMÉS a l'Inbox (docs/02 §4).
          isInbox
            ? [
                { label: t('board.card.toTodo'), onClick: () => onMove?.(task.id, 'todo') },
                { label: t('board.card.toDoing'), onClick: () => onMove?.(task.id, 'doing') },
              ]
            : []
        }
      />
    );

    let body: ReactNode;
    if (ofColumn.length === 0) {
      body = <EmptyState>{t(column.emptyKey)}</EmptyState>;
    } else if (!grouped) {
      body = ofColumn.map(cardFor);
    } else {
      body = scopes
        .filter((scope) => ofColumn.some((task) => task.scope_id === scope.id))
        .map((scope) => {
          const key = `${column.status}:${scope.id}`;
          const open = collapsed[key] !== true;
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <ScopeGroupHeader
                label={scope.name}
                color={scope.color}
                open={open}
                onToggle={() => onToggleGroup?.(column.status, scope.id)}
              />
              {open ? ofColumn.filter((task) => task.scope_id === scope.id).map(cardFor) : null}
            </div>
          );
        });
    }

    return (
      <KanbanColumn
        key={column.status}
        data-testid={`column-${column.status}`}
        data-column-status={column.status}
        label={t(column.labelKey)}
        count={ofColumn.length}
        variant={isInbox ? 'inbox' : 'grouped'}
        divider={column.status !== 'inbox' && column.status !== 'todo'}
        headerActions={column.status === 'done' ? doneHeaderActions : undefined}
      >
        {body}
      </KanbanColumn>
    );
  };

  const [inbox, ...rest] = COLUMNS;

  return (
    <div
      data-testid="kanban"
      style={{
        display: 'grid',
        // L'Inbox se separa de les altres tres amb 24px en comptes de 16 (docs/02 §4),
        // i les tres van dins d'una sola targeta perquè "es sentin un sol element"
        // (brief línia 39), que és el que fa el prototip.
        gridTemplateColumns: '1fr 3fr',
        gap: 24,
        alignItems: 'start',
      }}
    >
      {inbox === undefined ? null : renderColumn(inbox)}
      <KanbanGroup>{rest.map(renderColumn)}</KanbanGroup>
    </div>
  );
}

export { COLUMNS };
