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

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
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
  /**
   * La targeta que segueix el cursor mentre s'arrossega.
   *
   * Es pinta a part i **fora del tauler**; veure el comentari de `BoardDnd`.
   */
  renderOverlay?: ((taskId: string) => ReactNode) | undefined;
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

/**
 * @remarks
 * **La targeta arrossegada es pinta a `document.body`, no dins del tauler.**
 *
 * Abans es movia l'element original amb un `transform`, i per tant continuava vivint
 * dins de la columna: la columna té desplaçament propi (`overflow-y:auto`) i la targeta
 * que agrupa les tres, `overflow:hidden`. Treure la targeta de la seva columna volia
 * dir treure-la del rectangle visible, i **desapareixia a mig gest**. Arrossegar a
 * cegues no és arrossegar.
 *
 * `DragOverlay` la pinta com un element a part que segueix el cursor, i l'original es
 * queda al seu lloc a `opacity:0.4` (docs/02 §4). El portal a `document.body` no és
 * opcional: l'overlay va `position:fixed`, i un avantpassat amb `transform` o
 * `perspective` —el tauler en té un, per al gir del kanban de la IA— fa que `fixed`
 * deixi de ser respecte de la finestra i torni a quedar atrapat.
 */
export function BoardDnd({
  children,
  onDragStart,
  onDragEnd,
  titleOf,
  labelOf,
  renderOverlay,
}: BoardDndProps) {
  const [active, setActive] = useState<string | null>(null);
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
      onDragStart={(event: DragStartEvent) => {
        setActive(String(event.active.id));
        onDragStart?.(String(event.active.id));
      }}
      onDragEnd={(event: DragEndEvent) => {
        setActive(null);
        const status = event.over === null ? null : (String(event.over.id) as TaskStatus);
        onDragEnd?.(String(event.active.id), status);
      }}
      onDragCancel={() => {
        setActive(null);
        onDragEnd?.('', null);
      }}
    >
      {children}

      {renderOverlay === undefined || typeof document === 'undefined'
        ? null
        : createPortal(
            // Sense animació de tornada: la targeta ja s'ha mogut de columna quan
            // s'acaba el gest, i veure-la volar cap al lloc d'on venia és mentida.
            <DragOverlay dropAnimation={null} zIndex={60}>
              {active === null ? null : (
                <div data-testid="drag-overlay" style={{ cursor: 'grabbing' }}>
                  {renderOverlay(active)}
                </div>
              )}
            </DragOverlay>,
            document.body,
          )}
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      data-draggable-id={id}
      // Marca que aquest node l'injecta l'amfitrió pel punt d'extensió `wrapCard`, i
      // que per tant NO és part del que renderitza el component compartit. La prova de
      // P4 el salta per poder comparar només el que InboxRail pinta.
      data-host-wrapper="true"
      /**
       * **L'original NO es mou.** Qui segueix el cursor és l'overlay de `BoardDnd`;
       * aquí la targeta es queda al seu lloc i qui la pinta la deixa a `opacity:0.4`
       * (docs/02 §4), que és el forat que diu d'on ve.
       */
      style={{ position: 'relative', cursor: isDragging ? 'grabbing' : 'grab' }}
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
