/**
 * Arrossegament del tauler, amb ratolí **i amb teclat**.
 *
 * docs/02 §4: "Amb teclat també. `Espai` agafa, fletxes mouen, `Espai` deixa anar,
 * `Escape` cancel·la. S'anuncia per regió `aria-live`. **Un tauler que només funciona
 * amb ratolí no és accessible.**"
 *
 * És criteri d'acceptació de la fita, no una millora: docs/13 M5 demana "drag & drop
 * amb ratolí i amb teclat" i la comprovació `e2e: kanban.spec` prova les dues.
 *
 * Els anuncis surten del catàleg (regla 3): un lector de pantalla en català ha de
 * sentir català.
 */

import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { t } from '@fem-ho/contracts';
import type { TaskStatus } from '@fem-ho/contracts';

export interface BoardDndProps {
  children: ReactNode;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: (taskId: string, status: TaskStatus | null) => void;
  /** Per als anuncis: cal poder dir el títol de la targeta i el nom de la columna. */
  titleOf: (taskId: string) => string;
  labelOf: (status: TaskStatus) => string;
}

/**
 * On va la targeta a cada fletxa.
 *
 * El sensor de teclat de dnd-kit mou **25 píxels per pulsació** per defecte. En un
 * kanban això és inservible: les columnes són a centenars de píxels i caldrien vint
 * pulsacions per canviar-ne una — i pel camí la targeta passa per damunt de columnes
 * que no són cap destí.
 *
 * Aquí les fletxes **salten de columna**, que és el que la gent espera d'un tauler i el
 * que docs/02 §4 vol dir amb "fletxes mouen". Es torna el centre de la columna veïna.
 */
const jumpBetweenColumns: KeyboardCoordinateGetter = (event, { context }) => {
  const { droppableContainers, droppableRects, collisionRect } = context;
  if (collisionRect === null) return undefined;

  const horizontal = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (horizontal === 0) return undefined;
  event.preventDefault();

  // Les columnes, ordenades per posició real a la pantalla i no per ordre de registre:
  // amb l'Inbox en una graella a part, l'ordre del DOM i el visual no coincideixen.
  const columns = droppableContainers
    .toArray()
    .map((container) => ({ id: container.id, rect: droppableRects.get(container.id) }))
    .filter((column): column is { id: string | number; rect: DOMRect } => column.rect != null)
    .sort((a, b) => a.rect.left - b.rect.left);

  if (columns.length === 0) return undefined;

  // La columna on som ara és la que conté el centre de la targeta.
  const centre = collisionRect.left + collisionRect.width / 2;
  let index = columns.findIndex((c) => centre >= c.rect.left && centre <= c.rect.right);
  if (index === -1) {
    // Fora de tota columna: s'agafa la més propera.
    index = columns.reduce(
      (best, column, i) =>
        Math.abs(column.rect.left - centre) < Math.abs((columns[best]?.rect.left ?? 0) - centre)
          ? i
          : best,
      0,
    );
  }

  const next = columns[Math.min(Math.max(index + horizontal, 0), columns.length - 1)];
  if (next === undefined) return undefined;

  return {
    x: next.rect.left + next.rect.width / 2 - collisionRect.width / 2,
    y: next.rect.top + 40,
  };
};

export function BoardDnd({ children, onDragStart, onDragEnd, titleOf, labelOf }: BoardDndProps) {
  const sensors = useSensors(
    // Amb 6px de marge, clicar una targeta no compta com a arrossegar-la: sense això,
    // obrir el modal amb el ratolí es converteix en una loteria.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: jumpBetweenColumns }),
  );

  return (
    <DndContext
      sensors={sensors}
      accessibility={{
        // Els anuncis van a la regió aria-live que munta dnd-kit. En català, del
        // catàleg, perquè és el que sentirà qui faci servir un lector de pantalla.
        announcements: {
          onDragStart: ({ active }) =>
            t('board.drag.grabbed', { title: titleOf(String(active.id)) }),
          onDragOver: ({ active, over }) =>
            over === null
              ? undefined
              : t('board.drag.moved', {
                  title: titleOf(String(active.id)),
                  column: labelOf(String(over.id) as TaskStatus),
                }),
          onDragEnd: ({ active, over }) =>
            over === null
              ? t('board.drag.cancelled')
              : t('board.drag.moved', {
                  title: titleOf(String(active.id)),
                  column: labelOf(String(over.id) as TaskStatus),
                }),
          onDragCancel: () => t('board.drag.cancelled'),
        },
      }}
      onDragStart={(event: DragStartEvent) => onDragStart?.(String(event.active.id))}
      onDragEnd={(event: DragEndEvent) => {
        const status = event.over === null ? null : (String(event.over.id) as TaskStatus);
        onDragEnd?.(String(event.active.id), status);
      }}
      onDragCancel={() => onDragEnd?.('', null)}
    >
      {children}
    </DndContext>
  );
}

/**
 * Embolcall arrossegable d'una targeta.
 *
 * **L'identificador de prova va aquí i no a la targeta de dins**: aquest és l'element
 * que porta els listeners i el `tabIndex` que el sensor de teclat necessita. Si les
 * proves enfoquen la targeta interior, `Space` no agafa res i el moviment amb teclat
 * sembla trencat quan en realitat s'està prement la tecla al lloc equivocat.
 */
export function DraggableCard({
  id,
  testId,
  children,
}: {
  id: string;
  testId?: string | undefined;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      data-draggable-id={id}
      style={{
        transform:
          transform === null ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        // La targeta arrossegada va per damunt de la resta mentre es mou.
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
        cursor: 'grab',
      }}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

/** La columna com a destí. L'identificador és el `status`, que és el que canvia. */
export function DroppableColumn({
  status,
  children,
}: {
  status: TaskStatus;
  children: (over: boolean) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} style={{ display: 'flex', flex: 1, minWidth: 0 }}>
      {children(isOver)}
    </div>
  );
}
