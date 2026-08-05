/**
 * InboxRail — l'Inbox.
 *
 * P4 de docs/14: **"és literalment la mateixa instància de component"**.
 *
 * "La columna Inbox del kanban i el rail de l'Inbox al costat del calendari són el
 * mateix component amb la mateixa font de dades. Si divergeixen, es notarà."
 *
 * No és una decisió d'arquitectura, és de UI, i la resposta correcta és la trivial. Per
 * això aquest fitxer existeix: el kanban i el calendari **l'importen tots dos** i cap
 * dels dos té una versió pròpia. Si algú fes una còpia per al calendari, la prova de
 * `calendar.spec` que compara els dos arbres ho veuria.
 *
 * És també el punt d'unió entre els dos móns que el brief demana a la línia 23: al
 * kanban és la primera columna, al calendari és el dipòsit del dia seleccionat.
 */

import type { ReactNode } from 'react';
import { t } from '@fem-ho/contracts';
import { EmptyState, KanbanColumn, ScopeGroupHeader, TaskCard } from '@fem-ho/design-system/femho';
import type { BoardScope, BoardTask } from './KanbanBoard.js';

export interface InboxRailProps {
  tasks: BoardTask[];
  scopes: BoardScope[];
  /** `column` al kanban, `rail` al calendari. Només canvia la disposició, no el contingut. */
  placement?: 'column' | 'rail' | undefined;
  /** El navegador de dia `‹ 5 d'agost ›`, que la columna del kanban també té. */
  header?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  collapsed?: Record<string, boolean> | undefined;
  onToggleGroup?: ((scopeId: string) => void) | undefined;
  onMove?: ((taskId: string, status: 'todo' | 'doing') => void) | undefined;
  onOpen?: ((taskId: string) => void) | undefined;
  onToggleDone?: ((taskId: string) => void) | undefined;
  /** Embolcall de cada targeta. El kanban hi posa l'arrossegable; el rail, no. */
  wrapCard?: ((task: BoardTask, card: ReactNode) => ReactNode) | undefined;
}

export function InboxRail({
  tasks,
  scopes,
  placement = 'column',
  header,
  footer,
  collapsed = {},
  onToggleGroup,
  onMove,
  onOpen,
  onToggleDone,
  wrapCard,
}: InboxRailProps) {
  const grouped = scopes.length > 1;

  const cardFor = (task: BoardTask): ReactNode => {
    const card = (
      <TaskCard
        key={task.id}
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
        done={task.status === 'done'}
        onOpen={() => onOpen?.(task.id)}
        onToggleDone={() => onToggleDone?.(task.id)}
        quickActions={[
          { label: t('board.card.toTodo'), onClick: () => onMove?.(task.id, 'todo') },
          { label: t('board.card.toDoing'), onClick: () => onMove?.(task.id, 'doing') },
        ]}
      />
    );
    return wrapCard === undefined ? card : wrapCard(task, card);
  };

  let body: ReactNode;
  if (tasks.length === 0) {
    body = <EmptyState>{t('board.empty.inbox')}</EmptyState>;
  } else if (!grouped) {
    body = tasks.map(cardFor);
  } else {
    body = scopes
      .filter((scope) => tasks.some((task) => task.scope_id === scope.id))
      .map((scope) => {
        const open = collapsed[scope.id] !== true;
        return (
          <div key={scope.id} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <ScopeGroupHeader
              label={scope.name}
              color={scope.color}
              open={open}
              onToggle={() => onToggleGroup?.(scope.id)}
            />
            {open ? tasks.filter((task) => task.scope_id === scope.id).map(cardFor) : null}
          </div>
        );
      });
  }

  return (
    <KanbanColumn
      data-testid="inbox-rail"
      data-column-status="inbox"
      data-placement={placement}
      label={t('board.column.inbox')}
      count={tasks.length}
      variant="inbox"
      headerExtra={header}
      footer={footer}
    >
      {body}
    </KanbanColumn>
  );
}
