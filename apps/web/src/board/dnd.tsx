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

import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
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
import { useAppearance } from '../app/theme.js';

export interface DropPlacement {
  targetId: string;
  after: boolean;
}

type ColumnData = { node: RefObject<HTMLDivElement | null> };

function cardsIn(column: ColumnData | undefined, scope: string): HTMLElement[] {
  const cards = column?.node.current?.querySelectorAll<HTMLElement>('[data-draggable-id]');
  return Array.from(cards ?? []).filter((card) => card.dataset.scopeId === scope);
}

function placementAt(
  event: Pick<DragEndEvent, 'active' | 'over' | 'activatorEvent' | 'delta'>,
): DropPlacement | undefined {
  if (event.over === null) return undefined;
  const { active, activatorEvent, delta, over } = event;
  if (active.data.current?.targetStatus !== undefined) return undefined;
  const translated = active.rect.current.translated;
  const y =
    'clientY' in activatorEvent
      ? Number(activatorEvent.clientY) + delta.y
      : translated === null
        ? undefined
        : translated.top + translated.height / 2;
  if (y === undefined) return undefined;
  const cards = cardsIn(
    over.data.current as ColumnData | undefined,
    String(active.data.current?.scopeId),
  ).filter((card) => card.dataset.draggableId !== String(active.id));
  const next = cards.find((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  const targetId = (next ?? cards.at(-1))?.dataset.draggableId;
  return targetId === undefined ? undefined : { targetId, after: next === undefined };
}

export interface BoardDndProps {
  children: ReactNode;
  onDragStart?: (taskId: string) => void;
  onDragEnd?: (taskId: string, status: TaskStatus | null, placement?: DropPlacement) => void;
  onPlacement?: (placement?: DropPlacement) => void;
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
  const { active, over, droppableContainers, droppableRects, collisionRect } = context;
  if (collisionRect === null) return undefined;

  const vertical = event.code === 'ArrowDown' ? 1 : event.code === 'ArrowUp' ? -1 : 0;
  if (vertical !== 0 && active !== null) {
    if (active.data.current?.targetStatus !== undefined) return undefined;
    const columnId = over?.id ?? active.data.current?.status;
    const column = columnId === undefined ? undefined : droppableContainers.get(columnId);
    const cards = cardsIn(
      column?.data.current as ColumnData | undefined,
      String(active.data.current?.scopeId),
    );
    const centre = collisionRect.top + collisionRect.height / 2;
    const rects = cards
      .filter((card) => card.dataset.draggableId !== String(active.id))
      .map((card) => card.getBoundingClientRect());
    const next =
      vertical > 0
        ? rects.find((rect) => centre < rect.top + rect.height / 2)
        : rects.findLast((rect) => centre > rect.top + rect.height / 2);
    if (next === undefined) return undefined;
    event.preventDefault();
    return {
      x: collisionRect.left,
      y: next.top + next.height * (vertical > 0 ? 0.75 : 0.25) - collisionRect.height / 2,
    };
  }

  const horizontal = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (horizontal === 0) return undefined;
  event.preventDefault();

  // Les columnes, ordenades per posició real a la pantalla i no per ordre de registre:
  // amb l'Inbox en una graella a part, l'ordre del DOM i el visual no coincideixen.
  const target = active?.data.current?.targetStatus;
  const origin = active?.data.current?.status;
  const columns = droppableContainers
    .toArray()
    .filter((column) => target === undefined || column.id === target || column.id === origin)
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
  onPlacement,
  titleOf,
  labelOf,
  renderOverlay,
}: BoardDndProps) {
  const [active, setActive] = useState<{ id: string; pointer: boolean } | null>(null);
  const appearance = useAppearance();
  const sensors = useSensors(
    // Amb 6px de marge, clicar una targeta no compta com a arrossegar-la: sense això,
    // obrir el modal amb el ratolí es converteix en una loteria.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: jumpBetweenColumns,
      ...(appearance === 'eink' ? { scrollBehavior: 'auto' as const } : {}),
    }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const detect = active?.pointer === true ? pointerWithin : rectIntersection;
        const target = args.active.data.current?.targetStatus;
        return target === undefined
          ? detect(args)
          : detect({
              ...args,
              droppableContainers: args.droppableContainers.filter(({ id }) => id === target),
            });
      }}
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
        const id = String(event.active.id);
        setActive({ id, pointer: 'clientY' in event.activatorEvent });
        onDragStart?.(id);
      }}
      onDragMove={(event) => onPlacement?.(placementAt(event))}
      onDragOver={(event) => onPlacement?.(placementAt(event))}
      onDragEnd={(event: DragEndEvent) => {
        setActive(null);
        onPlacement?.(undefined);
        const status = event.over === null ? null : (String(event.over.id) as TaskStatus);
        onDragEnd?.(String(event.active.id), status, placementAt(event));
      }}
      onDragCancel={() => {
        setActive(null);
        onPlacement?.(undefined);
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
                  {renderOverlay(active.id)}
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
  scopeId,
  status,
  targetStatus,
  insertEdge,
  children,
}: {
  id: string;
  testId?: string | undefined;
  scopeId: string;
  status: TaskStatus;
  /** Les propostes poden activar una acció de calendari en una sola columna. */
  targetStatus?: TaskStatus;
  insertEdge?: 'top' | 'bottom' | undefined;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { scopeId, status, targetStatus },
  });

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      // Les propostes no són veïnes vàlides per calcular la posició d'una tasca.
      data-draggable-id={targetStatus === undefined ? id : undefined}
      data-scope-id={scopeId}
      data-insert-edge={insertEdge}
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
      {insertEdge === undefined ? null : (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            insetInline: 0,
            [insertEdge]: -4,
            height: 3,
            background: 'var(--drop-indicator)',
            pointerEvents: 'none',
          }}
        />
      )}
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
  const node = useRef<HTMLDivElement | null>(null);
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { node } });
  const setColumnNode = useCallback(
    (element: HTMLDivElement | null) => {
      node.current = element;
      setNodeRef(element);
    },
    [setNodeRef],
  );
  return (
    <div ref={setColumnNode} style={{ display: 'flex', flex: 1, minWidth: 0 }}>
      {children(isOver)}
    </div>
  );
}
