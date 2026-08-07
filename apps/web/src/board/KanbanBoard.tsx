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
  useIsMobile,
} from '@fem-ho/design-system/femho';
import { BoardCard } from './BoardCard.js';
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
  /** Subtasques i ítems de llista, comptats junts. Ve de `/board` com a agregat. */
  progress?: { done: number; total: number; lists: number } | undefined;
  /**
   * Assignada a una **altra** persona.
   *
   * Fora de la bústia, el tauler és el que has de fer tu: les d'algú altre queden
   * amagades darrere del commutador de l'epígraf i, quan es veuen, atenuades. A la
   * bústia no s'amaga res, perquè és justament on es reparteix.
   */
  assignedToOther?: boolean | undefined;
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
  /** Alguna cosa ha canviat dins d'una targeta: cal refrescar el recompte del tauler. */
  onChanged?: () => void;
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

/** Les dues siluetes del commutador de "tasques d'altres", del disseny validat. */
function PeopleIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
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
  onChanged,
  aiBoard = false,
  flip,
}: KanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /**
   * Quins epígrafs ensenyen les tasques d'altres.
   *
   * No persisteix a les preferències, a diferència del plegat: és una mirada de moment
   * —"a veure què fan els altres"— i no una manera de tenir el tauler.
   */
  const [showOthers, setShowOthers] = useState<Record<string, boolean>>({});
  // L'agrupació per àmbit surt quan hi ha més d'un àmbit actiu (docs/02 §4).
  const grouped = scopes.length > 1;
  /**
   * Per sota de 860px, **la web ha de ser gairebé idèntica a l'app** (docs/02 §10): les
   * quatre columnes es desplacen horitzontalment, cadascuna al 78% de l'amplada i amb
   * ajust. La graella de dues columnes d'escriptori no cap en un telèfon: hi entraven
   * les quatre a la força i tres quedaven fora de pantalla, sense manera d'arribar-hi.
   */
  const mobile = useIsMobile();

  const renderColumn = (column: (typeof COLUMNS)[number]) => {
    const ofColumn = tasks.filter((task) => task.status === column.status);

    const cardFor = (task: BoardTask) => (
      <DraggableCard key={task.id} id={task.id} testId={`task-${task.id}`}>
        <BoardCard
          task={task}
          progress={task.progress ?? { done: 0, total: 0, lists: 0 }}
          dragging={draggingId === task.id}
          onOpen={() => onOpen?.(task.id)}
          onToggleDone={() => onToggleDone?.(task.id)}
          onChanged={() => onChanged?.()}
          /**
           * La fletxa **només a "Per fer"**: mou a "Fent".
           *
           * A "Fent" i a "Fet" la barra de la dreta és la casella d'estat, que és on
           * acaba el recorregut. L'Inbox el pinta InboxRail i té la seva.
           */
          onAdvance={task.status === 'todo' ? () => onMove?.(task.id, 'doing') : undefined}
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
          /**
           * **A la bústia no s'amaga res**: és on es reparteix la feina i cal veure-hi
           * tot el que hi ha. A les altres tres, el tauler és el que has de fer tu.
           */
          const others = column.status === 'inbox' || showOthers[key] === true;
          const ofGroup = ofColumn
            .filter((task) => task.scope_id === scope.id)
            .filter((task) => others || task.assignedToOther !== true);

          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <ScopeGroupHeader
                label={scope.name}
                color={scope.color}
                open={open}
                onToggle={() => onToggleGroup?.(column.status, scope.id)}
                extra={
                  column.status === 'inbox' ? undefined : (
                    <button
                      type="button"
                      data-testid={`others-${key}`}
                      title={t('board.others')}
                      aria-label={t('board.others')}
                      aria-pressed={showOthers[key] === true}
                      onClick={() =>
                        setShowOthers((current) => ({ ...current, [key]: current[key] !== true }))
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: 2,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color:
                          showOthers[key] === true ? 'var(--plou-blue-ink)' : 'var(--ink-faint)',
                      }}
                    >
                      <PeopleIcon />
                    </button>
                  )
                }
              />
              {open ? ofGroup.map(cardFor) : null}
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
            // Al mòbil cada columna és una targeta pròpia: no hi ha cap contenidor que
            // les agrupi, i sense fons no es veurien.
            variant={mobile ? 'default' : 'grouped'}
            style={mobile ? { background: 'var(--card-bg)' } : undefined}
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
      /**
       * La targeta que segueix el cursor.
       *
       * És **la mateixa** que la del tauler, sense l'embolcall d'arrossegar i sense
       * marcar-la com a arrossegada: aquesta és la que es veu sencera, i la del seu
       * lloc és la que queda atenuada.
       */
      renderOverlay={(taskId) => {
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (task === undefined) return null;
        return (
          // L'ombra de diàleg: la targeta que es mou ha de llegir-se **per damunt** de
          // la que hi ha a sota, i el fons de targeta és translúcid en tema fosc.
          <div style={{ borderRadius: 16, boxShadow: 'var(--shadow-dialog)' }}>
            <BoardCard
              task={task}
              progress={task.progress ?? { done: 0, total: 0, lists: 0 }}
              onOpen={() => undefined}
              onToggleDone={() => undefined}
              onChanged={() => undefined}
            />
          </div>
        );
      }}
      onDragEnd={(taskId, status) => {
        setDraggingId(null);
        // `status` nul vol dir que s'ha deixat anar fora de qualsevol columna, o que
        // s'ha cancel·lat amb Escape. En cap dels dos casos es mou res.
        if (status !== null && taskId !== '') onDrop?.(taskId, status);
      }}
    >
      <div
        data-testid="kanban"
        data-layout={mobile ? 'scroll' : 'grid'}
        style={
          mobile
            ? {
                display: 'flex',
                gap: 10,
                overflowX: 'auto',
                // Ajust per columna: el gest deixa una columna centrada i no a mitges.
                scrollSnapType: 'x mandatory',
                flex: 1,
                minHeight: 0,
                // La barra no es pinta, com a la resta de contenidors desplaçables.
                scrollbarWidth: 'none',
              }
            : {
                display: 'grid',
                // L'Inbox se separa de les altres tres amb 24px en comptes de 16 (docs/02 §4),
                // i les tres van dins d'una sola targeta perquè "es sentin un sol element"
                // (brief línia 39), que és el que fa el prototip.
                gridTemplateColumns: '1fr 3fr',
                /**
                 * `minmax(0, 1fr)` a les files i `stretch`: les quatre columnes fan la mateixa
                 * alçada i es desplacen per dins. Amb `start` i files automàtiques, una
                 * columna amb quaranta targetes estirava la pàgina i les altres tres quedaven
                 * penjades a dalt.
                 */
                gridTemplateRows: 'minmax(0, 1fr)',
                gap: 24,
                alignItems: 'stretch',
                flex: 1,
                minHeight: 0,
              }
        }
      >
        {/*
          L'Inbox NO es pinta aquí: es delega a InboxRail, que és el MATEIX component
          que fa servir el calendari. P4: "és literalment la mateixa instància de
          component". Si el kanban en tingués una versió pròpia, divergirien i es
          notaria.
        */}
        <div
          style={
            mobile
              ? { flex: '0 0 78%', display: 'flex', minWidth: 0, scrollSnapAlign: 'start' }
              : { display: 'contents' }
          }
        >
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
                // L'Inbox també porta el seu peu d'afegida ràpida. Es passa des d'aquí i
                // no des de dins d'InboxRail perquè el rail també viu al calendari, on el
                // peu és un altre.
                footer={renderFooter?.('inbox')}
                wrapCard={(task, card) => (
                  <DraggableCard key={task.id} id={task.id} testId={`task-${task.id}`}>
                    {card}
                  </DraggableCard>
                )}
              />
            )}
          </DroppableColumn>
        </div>
        {/*
          El gir viu aquí i no a cada columna: el que gira és la targeta sencera, i
          animar-ne tres per separat les desincronitzaria a la primera pantalla lenta.
        */}
        <div
          style={{
            perspective: 1800,
            minHeight: 0,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            // Al mòbil no és una columna de la graella sinó tres elements més de la
            // tira: la targeta que les agrupa no hi és i cadascuna s'ajusta sola.
            ...(mobile ? { display: 'contents' } : {}),
          }}
        >
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
              ...(mobile ? { display: 'contents' } : {}),
              /**
               * En repòs, **cap transformada**: `rotateY(0deg)` és visualment el mateix
               * que no tenir-ne, però és una transformada 3D i promou la capa, i llavors
               * Chromium deixa de fer suavitzat de subpíxel i tot el text del tauler es
               * veu més prim. Es posa només mentre gira.
               */
              transform: flip?.transform ?? 'none',
              transition: flip?.transition,
              display: 'flex',
              flex: 1,
              minHeight: 0,
            }}
          >
            {mobile ? (
              rest.map((column) => (
                <div
                  key={column.status}
                  style={{
                    flex: '0 0 78%',
                    display: 'flex',
                    minWidth: 0,
                    scrollSnapAlign: 'start',
                  }}
                >
                  {renderColumn(column)}
                </div>
              ))
            ) : (
              <KanbanGroup borderColor={aiBoard ? 'var(--plou-blue-ink)' : undefined}>
                {rest.map(renderColumn)}
              </KanbanGroup>
            )}
          </div>
        </div>
      </div>
    </BoardDnd>
  );
}

export { COLUMNS };
