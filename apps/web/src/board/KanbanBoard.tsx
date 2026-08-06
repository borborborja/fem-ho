/**
 * El tauler de quatre columnes. docs/02 §4, portat del prototip.
 *
 * Rep les dades per props i no les demana ell: així es pot pintar amb fixtures per a
 * les proves de navegador i amb dades reals a l'app, sense dues implementacions.
 *
 * Els textos surten TOTS del catàleg (regla 3). Cap literal català en aquest fitxer.
 */

import { useState, type ReactNode } from 'react';
import { t } from '@fem-ho/contracts';
import type { TaskStatus } from '@fem-ho/contracts';
import {
  EmptyState,
  KanbanColumn,
  KanbanGroup,
  ScopeGroupHeader,
  TaskCard,
} from '@fem-ho/design-system/femho';
import { BoardDnd, DraggableCard, DroppableColumn } from './dnd.js';
import { InboxRail } from './InboxRail.js';

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
  /**
   * Arrossegar entre columnes canvia `status`. La crida ha de fer l'actualització
   * optimista i revertir si el servidor rebutja (docs/02 §4).
   */
  onDrop?: (taskId: string, status: TaskStatus) => void;
  /**
   * El peu de cada columna. docs/02 §4: "Camp de text al peu de cada columna".
   *
   * El decideix qui munta el tauler perquè al kanban de la IA no és un camp sinó un
   * botó: escriure "comprar pa" i que ho faci la IA no vol dir res sense dir-li què ha
   * de fer, i el disseny validat hi posa "Nova tasca per a la IA" cap a l'edició
   * completa.
   */
  renderFooter?: (status: TaskStatus) => ReactNode;
  /**
   * El kanban de la IA.
   *
   * No és una altra pantalla: és **el mateix tauler girat**. Les columnes són les
   * mateixes i el que canvia és quines targetes hi surten — les que tenen mode d'IA— i
   * que la vora i el distintiu ho diuen.
   */
  aiBoard?: boolean;
  /** L'estat del gir, mentre dura. Qui el munta el condueix. */
  flip?: { transform: string; transition: string } | undefined;
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
  onDrop,
  renderFooter,
  aiBoard = false,
  flip,
}: KanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // L'agrupació per àmbit surt quan hi ha més d'un àmbit actiu (docs/02 §4).
  const grouped = scopes.length > 1;

  const renderColumn = (column: (typeof COLUMNS)[number]) => {
    const ofColumn = tasks.filter((task) => task.status === column.status);

    const cardFor = (task: BoardTask) => (
      <DraggableCard key={task.id} id={task.id} testId={`task-${task.id}`}>
        <TaskCard
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
          // Accions ràpides NOMÉS a l'Inbox (docs/02 §4). L'Inbox el pinta InboxRail,
          // o sigui que aquí mai n'hi ha.
          quickActions={[]}
        />
      </DraggableCard>
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
      <DroppableColumn key={column.status} status={column.status}>
        {(over) => (
          <KanbanColumn
            data-testid={`column-${column.status}`}
            data-column-status={column.status}
            data-drop-target={over ? 'true' : 'false'}
            label={t(column.labelKey)}
            count={ofColumn.length}
            variant="grouped"
            divider={column.status !== 'todo'}
            dropIndicator={over}
            headerActions={column.status === 'done' ? doneHeaderActions : undefined}
            footer={renderFooter?.(column.status)}
          >
            {body}
          </KanbanColumn>
        )}
      </DroppableColumn>
    );
  };

  const [, ...rest] = COLUMNS;
  const inboxTasks = tasks.filter((task) => task.status === 'inbox');

  const titleOf = (taskId: string): string => tasks.find((task) => task.id === taskId)?.title ?? '';
  const labelOf = (status: TaskStatus): string =>
    t(COLUMNS.find((column) => column.status === status)?.labelKey ?? '');

  return (
    <BoardDnd
      titleOf={titleOf}
      labelOf={labelOf}
      onDragStart={setDraggingId}
      onDragEnd={(taskId, status) => {
        setDraggingId(null);
        // `status` nul vol dir que s'ha deixat anar fora de qualsevol columna, o que
        // s'ha cancel·lat amb Escape. En cap dels dos casos es mou res.
        if (status !== null && taskId !== '') onDrop?.(taskId, status);
      }}
    >
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
        {/*
          L'Inbox NO es pinta aquí: es delega a InboxRail, que és el MATEIX component
          que fa servir el calendari. P4: "és literalment la mateixa instància de
          component". Si el kanban en tingués una versió pròpia, divergirien i es
          notaria.
        */}
        <DroppableColumn status="inbox">
          {() => (
            <InboxRail
              tasks={inboxTasks}
              scopes={scopes}
              placement="column"
              collapsed={Object.fromEntries(
                scopes.map((scope) => [scope.id, collapsed[`inbox:${scope.id}`] === true]),
              )}
              onToggleGroup={(scopeId) => onToggleGroup?.('inbox', scopeId)}
              onMove={(taskId, status) => onMove?.(taskId, status)}
              onOpen={onOpen}
              onToggleDone={onToggleDone}
              wrapCard={(task, card) => (
                <DraggableCard key={task.id} id={task.id} testId={`task-${task.id}`}>
                  {card}
                </DraggableCard>
              )}
            />
          )}
        </DroppableColumn>
        {/*
          El gir viu aquí i no a cada columna: el que gira és la targeta sencera, i
          animar-ne tres per separat les desincronitzaria a la primera pantalla lenta.
        */}
        <div style={{ perspective: 1800, minHeight: 0, position: 'relative' }}>
          {aiBoard ? (
            <span
              data-testid="ai-board-badge"
              style={{
                position: 'absolute',
                top: -9,
                left: 20,
                zIndex: 2,
                fontSize: 9.5,
                fontWeight: 700,
                color: 'var(--on-brand)',
                background: 'var(--gradient-brand-2stop)',
                borderRadius: 100,
                padding: '3px 10px',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
              }}
            >
              {t('board.ia.badge')}
            </span>
          ) : null}
          <div
            data-ai-board={aiBoard ? 'true' : 'false'}
            style={{
              transform: flip?.transform ?? 'rotateY(0deg)',
              transition: flip?.transition ?? 'transform 260ms cubic-bezier(0.2,0,0,1)',
            }}
          >
            <KanbanGroup borderColor={aiBoard ? 'var(--plou-blue-ink)' : undefined}>
              {rest.map(renderColumn)}
            </KanbanGroup>
          </div>
        </div>
      </div>
    </BoardDnd>
  );
}

export { COLUMNS };
