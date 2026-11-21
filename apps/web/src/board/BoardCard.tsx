/**
 * La targeta del tauler, amb les seves subtasques i llistes.
 *
 * `TaskCard` no sap res de xarxa: rep les llistes ja fetes. Aquí es lliguen amb l'API, i
 * **la crida només es fa en desplegar**. El tauler porta el recompte com a agregat
 * (`task.progress`), que és tot el que la targeta plegada necessita; els ítems arriben
 * quan algú els demana.
 *
 * Si es carreguessin sempre, obrir el tauler d'una casa amb tres-centes tasques baixaria
 * uns quants milers de files per pintar unes quantes pastilles.
 */

import { useState } from 'react';
import { dateTime, getLocale, relativeTime, t } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { TaskCard, type CardList } from '@fem-ho/design-system/femho';
import { DeleteTaskDialog } from './DeleteTaskDialog.js';
import { McpSourceBadge } from './McpSourceBadge.js';
import { TaskTimeBadge } from './TaskTimeBadge.js';
import { TaskAiAction } from './TaskAiAction.js';
import { CalendarOriginBadge, SourceIcon } from './SourceIcon.js';
import { SubtaskRow } from './SubtaskRow.js';
import { useInlineTaskTitle } from './useInlineTaskTitle.js';
import { api, failureText } from '../app/api.js';
import { useTaskAiSettings } from '../app/task-ai.js';
import { useToasts } from '../app/toasts.js';
import type { Checklist } from '../app/types.js';
import { useSubtaskSync } from '../sync/subtask-sync.js';
import type { BoardTask } from './KanbanBoard.js';

export interface BoardCardProps {
  task: BoardTask;
  /** Agregat de `/board`: ítems fets, ítems totals, i quants blocs desplegables hi ha. */
  progress: { done: number; total: number; lists: number };
  onOpen: () => void;
  onToggleDone: () => void;
  /**
   * Mou la targeta una columna endavant. Només a la bústia i a "Per fer": a "Fent" i a
   * "Fet", la barra de la dreta és la casella d'estat.
   */
  onAdvance?: (() => void) | undefined;
  dragging?: boolean;
  /** Cal per refrescar el recompte del tauler quan es marca alguna cosa aquí dins. */
  onChanged: () => void;
}

export function BoardCard({
  task,
  progress: fallbackProgress,
  onOpen,
  onToggleDone,
  onAdvance,
  dragging = false,
  onChanged,
}: BoardCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { notify } = useToasts();
  const aiActionEnabled = useTaskAiSettings()?.data?.data.some(
    (setting) => setting.scope_id === task.scope_id && setting.enabled,
  );
  const inlineTitle = useInlineTaskTitle(task.id, task.title, onChanged);

  const subtaskSync = useSubtaskSync(task.id, expanded, fallbackProgress);
  const { subtasks, checklists, progress } = subtaskSync;

  const reload = (): void => {
    subtasks.reload();
    checklists.reload();
    onChanged();
  };

  /**
   * Les subtasques van primer i **sense nom**: la targeta les pinta nues, sense caixa.
   * Les llistes van després, cadascuna amb el seu nom i la seva xinxeta.
   */
  const lists: CardList[] = [
    ...((subtasks.data ?? []).length === 0
      ? []
      : [
          {
            id: `subtasks-${task.id}`,
            name: null,
            rows: (subtasks.data ?? []).map((subtask) => (
              <SubtaskRow
                key={subtask.id}
                subtask={subtask}
                onUpdate={subtaskSync.updateSubtask}
                onDelete={() => subtaskSync.deleteSubtask(subtask)}
                compact
              />
            )),
          },
        ]),
    ...(checklists.data ?? []).map((checklist) => ({
      id: checklist.id,
      name: checklist.name,
      // Les subtasques no es pinegen; les llistes sí (P1).
      pinned: checklist.pinned,
      pinLabel: checklist.pinned ? t('checklist.unpinAction') : t('checklist.pin'),
      onPinToggle: () => {
        const call = checklist.pinned ? api.delete : api.post;
        void call(`/api/v1/checklists/${checklist.id}/pin`).then(reload);
      },
      items: checklist.items.map((item) => ({
        id: item.id,
        text: item.text,
        done: item.done,
        toggleLabel: t('checklist.toggleItem', { text: item.text }),
        onToggle: () => {
          void api.patch(`/api/v1/checklist-items/${item.id}`, { done: !item.done }).then(reload);
        },
      })),
    })),
  ];

  /**
   * Afegir, amb **un sol camp**: `#Llista element` hi posa l'ítem, i sense sigil és una
   * subtasca.
   *
   * És el mateix gest que l'afegida ràpida del peu de columna, i el mateix sigil que
   * `#Àmbit` — d'aquí que el disseny validat es quedés amb un camp i no amb dos i un
   * botó. El regex és el del disseny: `#` enganxat al nom, un espai, i la resta és el
   * text.
   *
   * Amb nom, es busca la llista que ja el porti i s'hi afegeix l'ítem; si no n'hi ha
   * cap, se'n crea una. Crear-ne una de nova cada vegada faria que escriure el mateix
   * nom dues vegades donés dues llistes iguals, que és el que ningú espera.
   */
  const submitAdd = async (): Promise<void> => {
    const raw = draft.trim();
    if (raw === '') return;
    const sigil = /^#(\S+)\s+(.+)$/u.exec(raw);
    const name = sigil?.[1] ?? '';
    const text = (sigil?.[2] ?? raw).trim();
    if (text === '') return;

    if (name === '') {
      await subtaskSync.createSubtask(text);
    } else {
      const existing = (checklists.data ?? []).find(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
      );
      const target =
        existing ??
        (await api.post<Checklist>(`/api/v1/tasks/${task.id}/checklists`, {
          id: uuidv7(),
          name,
        }));
      await api.post(`/api/v1/checklists/${target.id}/items`, { id: uuidv7(), text });
      reload();
    }

    // El camp es buida sencer: el sigil es torna a escriure, com a l'afegida ràpida.
    setDraft((current) => (current === draft ? '' : current));
  };

  return (
    <>
      <TaskCard
        data-status={task.status}
        className={task.fromCalendar ? 'calendar-origin-task' : undefined}
        // Les d'algú altre, atenuades: es veuen, però es veu que no són teves.
        style={{
          ...(task.fromCalendar
            ? {
                background: 'var(--calendar-origin-bg, var(--card-bg))',
                borderInlineStart: 'var(--calendar-origin-rivet, 1px solid var(--card-border))',
              }
            : {}),
          ...(task.assignedToOther === true ? { opacity: 0.55 } : {}),
        }}
        title={inlineTitle.title}
        titleEditor={inlineTitle.editor}
        onTitleEdit={dragging ? undefined : inlineTitle.start}
        titleEditHint={t('task.titleEditHint')}
        sourceIcon={
          task.fromCalendar ? <CalendarOriginBadge /> : <SourceIcon kind={task.sourceKind} />
        }
        sourceBadge={
          task.mcpActivity === undefined ? undefined : (
            <McpSourceBadge activity={task.mcpActivity} compact />
          )
        }
        // Desactivar l'acció durant l'arrossegament conserva l'alçada de la barra.
        railAction={
          aiActionEnabled ? (
            <TaskAiAction taskId={task.id} scopeId={task.scope_id} compact disabled={dragging} />
          ) : undefined
        }
        project={task.project}
        assigneeInitials={task.assigneeInitials}
        time={task.time}
        timeSpent={
          task.timeSummary && (task.status === 'doing' || task.status === 'done') ? (
            <TaskTimeBadge summary={task.timeSummary} />
          ) : undefined
        }
        aiMode={task.aiMode ?? 'manual'}
        aiModeLabel={
          task.aiMode === 'delegated'
            ? t('ai.mode.delegated')
            : task.aiMode === 'assisted'
              ? t('ai.mode.assisted')
              : undefined
        }
        hasUnseenAiChange={task.hasUnseenAiChange ?? false}
        attentionLabel={task.needsAttention === true ? t('ai.attention.card') : undefined}
        lockLabel={task.lockedUntil == null ? undefined : t('ai.lock.card')}
        activityLabel={
          task.lastActivityAt == null
            ? undefined
            : relativeTime(getLocale(), new Date(task.lastActivityAt), new Date())
        }
        activityTitle={
          task.lastActivityAt == null
            ? undefined
            : dateTime(getLocale(), new Date(task.lastActivityAt))
        }
        checklistProgress={
          progress.total > 0
            ? t('checklist.count', { done: progress.done, total: progress.total })
            : undefined
        }
        dragging={dragging}
        done={task.status === 'done'}
        onOpen={onOpen}
        onToggleDone={onToggleDone}
        toggleLabel={t('sync.complete')}
        onAdvance={onAdvance}
        advanceLabel={
          onAdvance === undefined
            ? undefined
            : t('board.card.advance', {
                column: t(task.status === 'inbox' ? 'board.column.todo' : 'board.column.doing'),
              })
        }
        /**
         * El commutador compta **blocs**, no ítems: "Llistes (2)" vol dir les subtasques i
         * una llista. El número ve de l'agregat, perquè plegada la targeta encara no ha
         * demanat res. La pastilla `3/7` de la fila de metadades és una altra cosa i
         * docs/02 §4 la demana a part.
         */
        lists={lists}
        listsExpanded={expanded}
        listsToggleLabel={
          progress.lists === 0
            ? undefined
            : t(expanded ? 'card.lists.expanded' : 'card.lists.collapsed', {
                count: progress.lists,
              })
        }
        onToggleLists={() => setExpanded(!expanded)}
        // El llapis de la cantonada: obre el mateix modal que clicar la targeta, però
        // sense haver-hi de clicar a sobre —que és el que fa que arrossegar-la i obrir-la
        // es trepitgin.
        onEdit={onOpen}
        editLabel={t('task.edit')}
        onDelete={() => setDeleting(true)}
        deleteLabel={t('nav.delete')}
        addForm={{
          open: expanded && addOpen,
          onToggle: () => {
            setAddOpen(!expanded || !addOpen);
            setExpanded(true);
          },
          toggleLabel: t('card.add'),
          placeholder: t('card.addPlaceholder'),
          text: draft,
          onText: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void submitAdd().catch((error: unknown) =>
              notify(failureText(error), { tone: 'error' }),
            );
          },
        }}
      />
      {deleting && (
        <DeleteTaskDialog task={task} onClose={() => setDeleting(false)} onChanged={onChanged} />
      )}
    </>
  );
}
