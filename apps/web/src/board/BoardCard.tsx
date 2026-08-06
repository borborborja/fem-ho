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
import { t } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { TaskCard, type CardList } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useApi } from '../app/useApi.js';
import type { Checklist, Subtask } from '../app/types.js';
import type { BoardTask } from './KanbanBoard.js';

export interface BoardCardProps {
  task: BoardTask;
  /** Agregat de `/board`: ítems fets, ítems totals, i quants blocs desplegables hi ha. */
  progress: { done: number; total: number; lists: number };
  onOpen: () => void;
  onToggleDone: () => void;
  quickActions: { label: string; onClick: () => void }[];
  dragging?: boolean;
  /** Cal per refrescar el recompte del tauler quan es marca alguna cosa aquí dins. */
  onChanged: () => void;
}

export function BoardCard({
  task,
  progress,
  onOpen,
  onToggleDone,
  quickActions,
  dragging = false,
  onChanged,
}: BoardCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [listName, setListName] = useState('');
  const [itemText, setItemText] = useState('');

  /**
   * `null` mentre no calgui: `useApi` no demana res amb un camí nul.
   *
   * També es demanen amb el formulari obert encara que estigui plegada: afegir a una
   * llista que ja existeix necessita saber quines hi ha, i sense això escriure dues
   * vegades el mateix nom donaria dues llistes iguals.
   */
  const needsItems = expanded || addOpen;
  const subtasks = useApi<Subtask[]>(needsItems ? `/api/v1/tasks/${task.id}/subtasks` : null);
  const checklists = useApi<Checklist[]>(needsItems ? `/api/v1/tasks/${task.id}/checklists` : null);

  const reload = (): void => {
    subtasks.reload();
    checklists.reload();
    onChanged();
  };

  /**
   * Les subtasques van primer i **sense nom**: la targeta les pinta amb l'epígraf
   * "Subtasques". Les llistes van després, cadascuna amb el seu.
   */
  const lists: CardList[] = [
    ...((subtasks.data ?? []).length === 0
      ? []
      : [
          {
            id: `subtasks-${task.id}`,
            name: null,
            subtasksLabel: t('task.subtasksEyebrow'),
            items: (subtasks.data ?? []).map((subtask) => ({
              id: subtask.id,
              text: subtask.title,
              done: subtask.done,
              toggleLabel: t('checklist.toggleItem', { text: subtask.title }),
              onToggle: () => {
                void api
                  .patch(`/api/v1/subtasks/${subtask.id}`, { done: !subtask.done })
                  .then(reload);
              },
            })),
          },
        ]),
    ...(checklists.data ?? []).map((checklist) => ({
      id: checklist.id,
      name: checklist.name,
      // Les subtasques no es pinegen; les llistes sí (P1).
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
   * Afegir: el nom buit vol dir subtasca.
   *
   * Amb nom, es busca la llista que ja el porti i s'hi afegeix l'ítem; si no n'hi ha
   * cap, se'n crea una. Crear-ne una de nova cada vegada faria que escriure el mateix
   * nom dues vegades donés dues llistes iguals, que és el que ningú espera.
   */
  const submitAdd = async (): Promise<void> => {
    const text = itemText.trim();
    if (text === '') return;
    const name = listName.trim();

    if (name === '') {
      await api.post(`/api/v1/tasks/${task.id}/subtasks`, { id: uuidv7(), title: text });
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
    }

    // El nom es queda per poder-hi encadenar ítems; el text es buida.
    setItemText('');
    reload();
  };

  return (
    <TaskCard
      data-status={task.status}
      // Les d'algú altre, atenuades: es veuen, però es veu que no són teves.
      style={task.assignedToOther === true ? { opacity: 0.55 } : undefined}
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
      checklistProgress={
        progress.total > 0
          ? t('checklist.count', { done: progress.done, total: progress.total })
          : undefined
      }
      dragging={dragging}
      done={task.status === 'done'}
      onOpen={onOpen}
      onToggleDone={onToggleDone}
      quickActions={quickActions}
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
      addForm={{
        open: addOpen,
        onToggle: () => setAddOpen(!addOpen),
        toggleLabel: t('task.addSubtaskOrList'),
        listNamePlaceholder: t('task.addListName'),
        listName,
        onListName: (event) => setListName(event.target.value),
        itemPlaceholder: t('task.addItemText'),
        itemText,
        onItemText: (event) => setItemText(event.target.value),
        onItemKeyDown: (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void submitAdd();
        },
        onSubmit: () => void submitAdd(),
        submitLabel: t('task.addSubmit'),
      }}
    />
  );
}
