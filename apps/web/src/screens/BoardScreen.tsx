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

import { useTimeCompletion, type MoveExtra } from '../board/useTimeCompletion.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  comparePositions,
  eventDateOf,
  generatePosition,
  localDateOf,
  t,
  type QuickAddContext,
  type TaskStatus,
} from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api, currentSessionEpoch, failureText } from '../app/api.js';
import { useToasts } from '../app/toasts.js';
import { Chips } from '../app/Chips.js';
import { useRouter } from '../app/router.js';
import { useSessionData, useSession } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import type { Board, Inbox, Task } from '../app/types.js';
import { KanbanBoard, type BoardTask } from '../board/KanbanBoard.js';
import type { DropPlacement } from '../board/dnd.js';
import { ColumnQuickAdd, PlusIcon } from '../board/ColumnQuickAdd.js';
import { DayNavigator } from '../board/DayNavigator.js';
import { DoneHeader } from '../board/DoneColumnView.js';
import { useBoardQuery, useBoardSync } from '../sync/board-sync.js';
import { projectBoardTasks } from '../sync/board-projection.js';

export interface BoardScreenProps {
  activeScopeIds: string[];
  /** Els projectes que es veuen. **Buit vol dir tots** (docs/02 §2). */
  projectIds: string[];
  onOpenTask: (id: string) => void;
  /** Obre l'edició completa per a una tasca NOVA en aquesta columna. */
  onNewTask: (status: TaskStatus, forAi: boolean) => void;
  /** El kanban de la IA. Les columnes són les mateixes; el que canvia és què hi surt. */
  aiBoard?: boolean;
  flip?: { transform: string; transition: string } | undefined;
}

/**
 * «Netejar» només amaga el que ja havies acabat avui. No és una acció sobre les tasques:
 * les que s'acabin després del clic han de continuar entrant a la columna.
 */
function isDoneHiddenByClear(
  task: Task,
  doneDay: string,
  today: string,
  timezone: string,
  clearedAt: string | null | undefined,
): boolean {
  if (task.status !== 'done' || task.completed_at == null || clearedAt == null) return false;
  const cleared = Date.parse(clearedAt);
  const completed = Date.parse(task.completed_at);
  if (Number.isNaN(cleared) || Number.isNaN(completed)) return false;
  return (
    doneDay === today &&
    localDateOf(timezone, new Date(cleared)) === doneDay &&
    completed <= cleared
  );
}

/** La targeta tal com la vol el component, des de la tasca tal com la dona l'API. */
function toBoardTask(
  task: Task,
  projectName: string | undefined,
  initials: string | undefined,
  assignedToOther: boolean,
  collective: boolean,
  /**
   * Si s'hi ha de veure quan va passar l'última cosa.
   *
   * **Només al tauler d'IA.** Allà el silenci és informació —«fa tres dies» vol dir que
   * l'agent no hi ha tornat—; al tauler humà seria una data més a cada targeta sense res a
   * dir, perquè de les teves ja saps quan les vas tocar.
   */
  showActivity: boolean,
): BoardTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    scope_id: task.scope_id,
    sourceKind: task.source_kind,
    mcpActivity: task.mcp_activity,
    project: projectName,
    /**
     * A la bústia d'un àmbit **col·lectiu**, sempre qui la té; fora, només si és d'algú
     * altre.
     *
     * A un àmbit individual la tasca s'autoassigna al propietari (docs/02 §4), o sigui
     * que la inicial seria la teva a totes les targetes: una columna de la mateixa
     * lletra que no distingeix res. I a "Per fer", el mateix.
     */
    assigneeInitials:
      (collective && task.status === 'inbox') || assignedToOther ? initials : undefined,
    assignedToOther,
    time: task.due_time ?? undefined,
    aiMode: task.ai_mode,
    needsAttention: task.needs_attention,
    lockedUntil: task.locked_until,
    lastActivityAt: showActivity ? task.last_activity_at : null,
    progress: task.progress,
  };
}

/**
 * El commutador de calaix de la bústia.
 *
 * **Només surt si entre els àmbits actius n'hi ha algun de compartit.** Amb tots
 * individuals no hi ha res per distingir, i un commutador que sempre diu "tot" és soroll
 * que ensenya a ignorar la capçalera.
 *
 * La tria es desa al perfil, com `inbox_show_overdue`: és una preferència personal i ha
 * de sobreviure a una recàrrega i valdre a tots els dispositius.
 */
function MailboxSwitch({
  activeScopes,
  tasks,
}: {
  activeScopes: { id: string; kind?: string }[];
  tasks: { status: string; scope_id: string }[];
}) {
  const { settings } = useSessionData();
  const { reload } = useSession();
  const value = settings.inbox_origin ?? 'all';

  /**
   * **Es mira la selecció activa, no tots els àmbits.**
   *
   * Abans n'hi havia prou de tenir un àmbit compartit en algun lloc. Però si aquell àmbit
   * no és a la selecció del moment, les tres posicions ensenyen exactament el mateix: el
   * commutador hi és, es clica, i no passa res. Qui decideix si surt és `potFiltrar`, a
   * `BoardScreen`, que és el mateix que decideix si el filtre s'aplica.
   */
  const individuals = activeScopes.filter((scope) => scope.kind !== 'collective');

  /**
   * Els recomptes.
   *
   * **Veure el número és el que fa entendre el botó abans de clicar-lo.** Amb tres
   * adjectius sols, l'única manera de saber què fan és provar-los d'un en un i comparar
   * de memòria el que hi havia abans.
   */
  const inbox = tasks.filter((task) => task.status === 'inbox');
  const esIndividual = (task: { scope_id: string }): boolean =>
    individuals.some((scope) => scope.id === task.scope_id);

  return (
    <Chips
      testId="inbox-mailbox"
      value={value}
      groupLabel={t('inbox.mailbox')}
      options={[
        {
          key: 'all' as const,
          label: t('inbox.mailbox.all'),
          count: inbox.length,
          hint: t('inbox.mailbox.allHint'),
        },
        {
          key: 'own' as const,
          label: t('inbox.mailbox.own'),
          count: inbox.filter(esIndividual).length,
          hint: t('inbox.mailbox.ownHint'),
        },
        {
          key: 'shared' as const,
          label: t('inbox.mailbox.shared'),
          count: inbox.filter((task) => !esIndividual(task)).length,
          hint: t('inbox.mailbox.sharedHint'),
        },
      ]}
      onChange={(next) => {
        /**
         * **`/api/v1/auth/settings`, que és on viuen les preferències.**
         *
         * Aquí hi deia `/api/v1/me/settings`, que no existeix: cada clic responia 404 i
         * el `.then()` no s'executava mai. Els tres botons es pintaven, es podien clicar,
         * i no feien absolutament res —ni desaven, ni filtraven, ni es quedaven marcats—.
         * Cap prova ho va veure perquè cap prova els clicava.
         */
        void api.patch('/api/v1/auth/settings', { inbox_origin: next }).then(() => reload());
      }}
    />
  );
}

export function BoardScreen({
  activeScopeIds,
  projectIds,
  onOpenTask,
  onNewTask,
  aiBoard = false,
  flip,
}: BoardScreenProps) {
  const { scopes, projects, people, settings, profile } = useSessionData();
  const { navigate } = useRouter();
  const { updateSettings } = useSession();
  const { pending, submit } = useBoardSync();
  const today = localDateOf(profile.timezone, new Date());

  const path = useMemo(() => {
    const query = new URLSearchParams();
    if (activeScopeIds.length > 0) query.set('scope_ids', activeScopeIds.join(','));
    /**
     * **El projecte no viatja a la consulta.**
     *
     * Se'n poden triar diversos alhora i el servidor n'accepta un de sol; però a més, el
     * tauler ja té totes les tasques dels àmbits actius, i tornar-les a demanar a cada
     * clic d'una casella seria una petició per canviar un filtre que ja es pot aplicar
     * aquí. És el mateix criteri que el calaix de la bústia.
     */
    return `/api/v1/board?${query.toString()}`;
  }, [activeScopeIds]);

  const board = useBoardQuery<Board>(path);

  const activeScopes = scopes.filter((scope) => activeScopeIds.includes(scope.id));

  /**
   * El calaix que s'aplica de debò.
   *
   * **Una preferència desada no ha de filtrar quan no hi ha commutador per desfer-ho.**
   * Qui deixés la bústia a "compartits" i després es quedés només amb àmbits individuals
   * es trobava la columna buida, sense cap botó a la vista, i sense manera d'endevinar per
   * què: el filtre seguia actiu i el control que el governa havia desaparegut.
   *
   * El criteri és el mateix que decideix si el commutador surt, i per això viu aquí i no
   * dins seu: si es calculessin per separat, un dia divergirien i tornaríem a tenir una
   * columna que amaga coses sense dir-ho.
   */
  const potFiltrar =
    activeScopes.some((scope) => scope.kind === 'collective') &&
    activeScopes.some((scope) => scope.kind !== 'collective');
  const mailbox = potFiltrar ? (settings.inbox_origin ?? 'all') : 'all';

  /**
   * El dia de la bústia.
   *
   * Viu aquí i no a la URL a posta: canviar de dia és un gest de treball —"què tinc
   * demà"— i no un lloc on es vulgui tornar. Els xips d'àmbit i el filtre de projecte sí
   * que hi viuen, perquè aquells sí que descriuen què estàs mirant.
   */
  const [day, setDay] = useState(today);

  /**
   * Quin dia ensenya la columna Fet.
   *
   * **La columna ensenyava tot l'històric**, pla i sense agrupar: `groupDone` existia amb
   * les seves proves i no el cridava ningú, `done_cleared_at` s'escrivia i no el llegia
   * ningú, i l'estat buit no s'arribava a veure mai perquè amb una sola tasca feta el mes
   * passat la columna ja no era buida.
   */
  const [doneDay, setDoneDay] = useState(today);

  /**
   * I la bústia surt de `/inbox`, no de `/board`.
   *
   * Les altres tres columnes segueixen amb `/board`, que no sap de dies i que Android
   * replica sencer precisament perquè no depèn de res. La bústia sí que en sap: és qui
   * resol el dia, el fus de qui mira, i **què hi entra de les fonts**.
   *
   * Les endarrerides només es demanen quan es mira avui: respecte d'un dijous que encara
   * no ha arribat, "endarrerit" no vol dir res.
   */
  const inboxPath = useMemo(() => {
    const query = new URLSearchParams({ date: day });
    query.set('include_overdue', String(day === today));
    if (activeScopeIds.length > 0) query.set('scope_ids', activeScopeIds.join(','));
    /**
     * **El calaix viatja a la consulta encara que el servidor ja el sàpiga.**
     *
     * Sense el paràmetre, `/inbox` mana per `user_settings.inbox_origin`, i el
     * commutador el desa allà. Però llavors canviar de calaix no canviava aquesta URL, o
     * sigui que no es tornava a demanar res i la columna es quedava igual: els tres
     * botons es marcaven i no filtraven. Posant-lo aquí, la preferència forma part de la
     * clau de la consulta i el canvi la refà sol.
     */
    query.set('mailbox', mailbox);
    return `/api/v1/inbox?${query.toString()}`;
  }, [day, today, activeScopeIds, mailbox]);

  const inbox = useBoardQuery<Inbox>(inboxPath);
  const allTasks = useMemo(() => {
    const base = board.data?.columns.flatMap((column) =>
      column.groups.flatMap((group) => group.tasks),
    );
    const rail = inbox.data;
    return projectBoardTasks(
      [
        ...(rail === undefined ? [] : [...rail.dated, ...rail.overdue, ...rail.undated]),
        ...(base ?? []),
      ],
      pending,
    ).filter((task) => activeScopeIds.includes(task.scope_id));
  }, [board.data, inbox.data, pending, activeScopeIds]);

  /**
   * **Refrescar és refrescar els dos.**
   *
   * El tauler beu de dos llocs —`/board` per a les tres columnes de treball i `/inbox`
   * per a la bústia— i qualsevol gest en pot tocar els dos alhora: crear una tasca la
   * posa a la bústia, arrossegar-la l'en treu. Refrescant-ne només un, la mateixa tasca
   * hi surt dues vegades o desapareix de les dues.
   *
   * Va passar de debò en escriure això: cinc proves de navegador que no tenien res a
   * veure entre elles van caure alhora perquè la tasca acabada de crear no arribava mai
   * a la columna.
   */
  const refresh = useCallback(() => {
    board.reload();
    inbox.reload();
  }, [board.reload, inbox.reload]);
  const completion = useTimeCompletion();
  const [optimistic, setOptimistic] = useState<Record<string, TaskStatus>>({});
  const { notify } = useToasts();

  /**
   * Quins àmbits tenen agent.
   *
   * Es demana **sempre i no només al tauler d'IA**: el gest que delega una tasca surt
   * d'allà, però la banda que diu «aquests àmbits no tenen ningú» s'ha de poder pintar tan
   * aviat com s'hi entra, sense un salt de contingut.
   */
  /**
   * Les tipologies dels àmbits actius, per al sigil `$`.
   *
   * Van al context del parser i no a una crida de l'afegida ràpida: el parser és pur i
   * compartit amb Android, i el que ha de rebre són els noms que pot reconèixer.
   */
  const taskTypes = useBoardQuery<{ data: { id: string; name: string; scope_id: string }[] }>(
    '/api/v1/task-types',
  );

  const coverage = useApi<{
    data: { scope_id: string; agent: { id: string; name: string; enabled: boolean } | null }[];
  }>('/api/v1/ai/coverage');

  /** Els àmbits actius que ara mateix no tenen qui els faci, amb el perquè. */
  const orfes = (coverage.data?.data ?? [])
    .filter((row) => activeScopeIds.includes(row.scope_id))
    .filter((row) => row.agent === null || !row.agent.enabled)
    .map((row) => ({
      name: scopes.find((scope) => scope.id === row.scope_id)?.name ?? '',
      agent: row.agent,
    }));

  /**
   * **L'avís va al moment de delegar-la, no al de mirar-la.**
   *
   * Qui acaba de deixar una targeta al tauler de la IA és qui espera que passi una cosa; si
   * no ha de passar, aquest és el moment de dir-ho i el lloc on hi ha el remei a un clic.
   */
  const avisaSiNoTeAgent = (scopeId: string): void => {
    const row = (coverage.data?.data ?? []).find((entry) => entry.scope_id === scopeId);
    const name = scopes.find((scope) => scope.id === scopeId)?.name ?? '';
    if (row === undefined || (row.agent !== null && row.agent.enabled)) return;
    notify(
      row.agent === null
        ? t('ai.coverage.none', { scope: name })
        : t('ai.coverage.disabled', { scope: name, agent: row.agent.name }),
      { tone: 'warning', id: `agent-coverage:${scopeId}` },
    );
  };

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
    return (
      allTasks
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
        /**
         * El filtre de projectes, **per àmbit i no global**.
         *
         * La tria es guarda com una llista plana d'identificadors, i un àmbit del qual no
         * s'ha triat res vol dir "tots els seus". Per això no n'hi ha prou de mirar si
         * l'identificador de la tasca és a la llista: una tasca d'un àmbit sense tria hi
         * ha de ser encara que el seu projecte no estigui marcat —i una tasca **sense
         * projecte** d'un àmbit amb tria, no.
         */
        .filter((task) => {
          if (projectIds.length === 0) return true;
          const triatsDelSeu = projects.some(
            (project) => project.scope_id === task.scope_id && projectIds.includes(project.id),
          );
          if (!triatsDelSeu) return true;
          return task.project_id != null && projectIds.includes(task.project_id);
        })
        /**
         * La columna Fet és **del dia que es mira**, i per defecte avui.
         *
         * `completed_at` es compara en data local i no restant mil·lisegons: els dies de
         * canvi d'hora en tenen 23 o 25, i una resta d'instants els compta malament dos
         * dies l'any sense donar cap error.
         */
        .filter((task) => {
          if (task.status !== 'done') return true;
          if (task.completed_at == null) return false;
          return (
            localDateOf(profile.timezone, new Date(task.completed_at)) === doneDay &&
            !isDoneHiddenByClear(task, doneDay, today, profile.timezone, settings.done_cleared_at)
          );
        })
        .map((task) => {
          const assignees = task.assignee_ids ?? [];
          const card = toBoardTask(
            task,
            projectName(task.project_id ?? null),
            initialsOf(assignees),
            assignees.length > 0 && !assignees.includes(profile.id),
            scopes.find((scope) => scope.id === task.scope_id)?.kind === 'collective',
            aiBoard,
          );
          card.timeSummary = settings.show_task_time !== false ? task.time_summary : undefined;
          const moved = optimistic[task.id];
          return moved === undefined ? card : { ...card, status: moved };
        })
    );
  }, [
    allTasks,
    settings.show_task_time,
    optimistic,
    projectName,
    initialsOf,
    aiBoard,
    profile.id,
    profile.timezone,
    scopes,
    projectIds,
    projects,
    doneDay,
    today,
    settings.done_cleared_at,
  ]);

  /**
   * Les targetes de la bústia, que vénen del seu propi lloc.
   *
   * **Les tres llistes es fonen en una de sola i sense epígrafs**, a diferència del rail
   * del calendari. `docs/02` §5 ho diu: al kanban la columna JA és "tot l'Inbox", i
   * partir-la en seccions hi afegiria capçaleres que allà no signifiquen res. El que fa
   * el navegador de dia és canviar **quines amb data** hi ha; les sense data hi són
   * sempre, perquè són el dipòsit del que has apuntat i encara no has situat.
   */
  const inboxCards = useMemo<BoardTask[]>(() => {
    return (
      allTasks
        .filter((task) => task.status === 'inbox')
        .filter(
          (task) =>
            task.due_date == null ||
            task.due_date === day ||
            (day === today && task.due_date < day),
        )
        .filter((task) => {
          if (mailbox === 'all') return true;
          const own = scopes.find((scope) => scope.id === task.scope_id)?.kind === 'individual';
          return mailbox === 'own' ? own : !own;
        })
        .sort(
          (a, b) =>
            Number(a.due_date == null) - Number(b.due_date == null) ||
            Number(a.due_date !== day) - Number(b.due_date !== day),
        )
        .filter((task) => {
          if (projectIds.length === 0) return true;
          const triatsDelSeu = projects.some(
            (project) => project.scope_id === task.scope_id && projectIds.includes(project.id),
          );
          if (!triatsDelSeu) return true;
          return task.project_id != null && projectIds.includes(task.project_id);
        })
        .map((task) => {
          const assignees = task.assignee_ids ?? [];
          const card = toBoardTask(
            task,
            projectName(task.project_id ?? null),
            initialsOf(assignees),
            assignees.length > 0 && !assignees.includes(profile.id),
            scopes.find((scope) => scope.id === task.scope_id)?.kind === 'collective',
            aiBoard,
          );
          card.timeSummary = settings.show_task_time !== false ? task.time_summary : undefined;
          const moved = optimistic[task.id];
          return moved === undefined ? card : { ...card, status: moved };
        })
        // Una que s'acaba de moure fora de la bústia ha de marxar de seguida, sense esperar
        // que el servidor torni a contestar.
        .filter((card) => card.status === 'inbox')
    );
  }, [
    settings.show_task_time,
    allTasks,
    day,
    today,
    mailbox,
    optimistic,
    projectName,
    initialsOf,
    profile.id,
    scopes,
    projectIds,
    projects,
  ]);

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
      taskTypes: (taskTypes.data?.data ?? [])
        .filter((type) => activeScopeIds.includes(type.scope_id))
        .map((type) => ({ id: type.id, name: type.name, scopeId: type.scope_id })),
    }),
    [activeScopes, projects, people, activeScopeIds, taskTypes.data],
  );

  const move = (taskId: string, status: TaskStatus, placement?: DropPlacement) => {
    if (!navigator.onLine || pending.some((row) => row.entity_id === taskId)) {
      return performMove(taskId, status, {}, placement).catch((cause: unknown) =>
        notify(failureText(cause), { tone: 'error' }),
      );
    }
    return completion.request(taskId, status, (extra) =>
      performMove(taskId, status, extra, placement),
    );
  };
  const performMove = async (
    taskId: string,
    status: TaskStatus,
    extra: MoveExtra,
    placement?: DropPlacement,
  ): Promise<void> => {
    const task = allTasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) return;
    const before = task.status;
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
      const aiMode =
        !aiBoard || extra.time_entry !== undefined
          ? undefined
          : status === 'inbox' && task.ai_mode !== 'manual'
            ? 'manual'
            : status !== 'inbox' && task.ai_mode === 'manual'
              ? 'delegated'
              : undefined;

      const column = allTasks
        .filter(
          (candidate) =>
            candidate.scope_id === task.scope_id &&
            candidate.status === status &&
            candidate.id !== taskId,
        )
        .sort((a, b) => comparePositions(a.position, b.position));
      const target = column.findIndex((task) => task.id === placement?.targetId);
      const insert = target === -1 ? column.length : target + (placement?.after ? 1 : 0);
      const lower = column[insert - 1]?.position ?? null;
      const upper = column.slice(insert).find((task) => task.position !== lower)?.position ?? null;
      const position = generatePosition(lower, upper);

      const send = async (): Promise<Task> => {
        const epoch = currentSessionEpoch();
        if (aiMode !== undefined)
          await api.post(`/api/v1/tasks/${taskId}/ai-mode`, { ai_mode: aiMode });
        if (epoch !== currentSessionEpoch()) throw new Error('The account changed.');
        return api.post<Task>(`/api/v1/tasks/${taskId}/move`, { status, position, ...extra });
      };
      if (extra.time_entry !== undefined) {
        await send();
        refresh();
      } else {
        await submit(
          {
            entity_id: taskId,
            task_title: task.title,
            op: 'move',
            base_version: task.version,
            payload: {
              status,
              position,
              from_status: before,
              ...(aiMode === undefined ? {} : { ai_mode: aiMode }),
            },
          },
          send,
        );
        if (aiMode === 'delegated') avisaSiNoTeAgent(task.scope_id);
      }
    } catch (cause: unknown) {
      // Reversió: la targeta torna al seu lloc i l'usuari veu que no s'ha mogut.
      setOptimistic((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
      /**
       * **I es diu per què.** Fins ara la targeta tornava sola al seu lloc sense cap
       * paraula, que amb el pany és el pitjor moment possible per callar: el gest no ha
       * fallat per atzar, l'ha frenat un agent que hi està treballant i el missatge diu
       * quanta estona queda.
       */
      throw cause;
    }
  };

  const create = async (
    input: {
      title: string;
      scopeId: string;
      projectId: string | null;
      assigneeIds: string[];
      aiMode: 'manual' | 'assisted' | 'delegated';
      taskTypeId: string | null;
    },
    status: TaskStatus = 'inbox',
  ): Promise<void> => {
    // L'identificador el genera el client (D4): així la creació és idempotent i la cua
    // de sortida pot reintentar-la sense duplicar res.
    const last = allTasks
      .filter((task) => task.scope_id === input.scopeId && task.status === status)
      .reduce<string | null>(
        (end, task) => (end === null || task.position > end ? task.position : end),
        null,
      );
    const payload = {
      id: uuidv7(),
      scope_id: input.scopeId,
      project_id: input.projectId ?? undefined,
      title: input.title,
      status,
      position: generatePosition(last, null),
      assignee_ids: input.assigneeIds.length > 0 ? input.assigneeIds : undefined,
      task_type_id: input.taskTypeId ?? undefined,
      ai_mode: input.aiMode,
    };
    await submit({ entity_id: payload.id, task_title: input.title, op: 'create', payload }, () =>
      api.post<Task>('/api/v1/tasks', payload),
    );
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
        display: 'flex',
        flexDirection: 'column',
        // Omple el que li dona el `main`, que al tauler té alçada fixa. Sense això, el
        // tauler quedaria arrapat a dalt amb el forat a sota.
        flex: 1,
        minHeight: 0,
        // I al seu eix: un ítem de flex no s'encongeix per sota del contingut si no s'hi
        // diu, i aquí el contingut és una fila de columnes.
        minWidth: 0,
        gap: 16,
        // Contingut anterior amb opacitat mentre es revalida: res d'esquelets brillants,
        // que el design system prohibeix (docs/02 §12).
        opacity: board.revalidating || inbox.revalidating ? 0.6 : 1,
      }}
    >
      {completion.dialog}
      {board.error !== undefined || inbox.error !== undefined ? (
        <ErrorBanner onRetry={refresh} />
      ) : null}

      {/*
        **L'avís passa; el problema es queda.** Un àmbit sense agent no és l'incident d'un
        gest: és un estat, i mentre duri, tot el que hi deixis es quedarà quiet. Per això la
        banda viu al tauler d'IA i no depèn d'haver-hi arrossegat res.
      */}
      {aiBoard && orfes.length > 0 ? (
        <div
          role="status"
          data-testid="ai-coverage-warning"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--gradient-wash-warm)',
            color: 'var(--ink)',
            fontSize: 12.5,
          }}
        >
          <span>
            <span aria-hidden="true">⚠ </span>
            {orfes[0]?.agent == null
              ? t('ai.coverage.none', { scope: orfes.map((row) => row.name).join(', ') })
              : t('ai.coverage.disabled', { scope: orfes[0].name, agent: orfes[0].agent.name })}
          </span>
          <button
            type="button"
            data-testid="ai-coverage-fix"
            onClick={() => navigate('/settings?tab=ai')}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--kicker)',
              font: 'inherit',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('ai.coverage.fix')}
          </button>
        </div>
      ) : null}

      <KanbanBoard
        aiBoard={aiBoard}
        flip={flip}
        doneEmptyLabel={
          doneDay === today
            ? t('board.empty.done')
            : t('board.done.emptyDay', {
                day: new Date(`${doneDay}T12:00:00`).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'long',
                }),
              })
        }
        inbox={inboxCards}
        inboxEvents={inbox.data?.events}
        inboxMail={inbox.data?.mail}
        onEventToTask={(event) => {
          /*
            **La tasca neix amb el títol de la cita i la seva data**, i no buida: qui fa
            això ja sap què és, i obligar-lo a reescriure-ho seria demanar-li que copiés
            una cosa que ja té al davant.

            La cita marxa de la bústia sola, perquè ara hi ha una tasca viva que hi
            apunta: no cal amagar res.
          */
          void api
            .post('/api/v1/tasks', {
              id: uuidv7(),
              scope_id: event.scope_id,
              title: event.summary,
              status: 'inbox',
              position: generatePosition(null, null),
              due_date: eventDateOf(profile.timezone, event.starts_at, event.all_day),
              source_event: {
                calendar_id: event.calendar_id,
                uid: event.uid,
                recurrence_id: event.recurrence_id,
              },
            })
            .then(() => refresh());
        }}
        onEventToggle={(event) => {
          /*
            **L'ull, i no un «Treure».** Amagar-lo no l'esborra: segueix al calendari, i des
            d'allà torna. El que ve d'una font no és nostre per esborrar-lo.

            S'envia el contrari del que hi ha ara, i no `null`: `null` diria «val el defecte
            de la font», i amb una que per defecte no entra —un RSS, una carpeta de correu—
            tornar-hi no faria res i el botó semblaria espatllat.
          */
          void api
            .post('/api/v1/inbox/events', {
              calendar_id: event.calendar_id,
              uid: event.uid,
              recurrence_id: event.recurrence_id,
              visible: !event.in_inbox,
            })
            .then(() => refresh());
        }}
        onMailToTask={(mail) => {
          /*
            **La destinació no la tria aquesta pantalla.** El servidor la treu de la regla
            que va fer entrar el correu, i per això aquí no s'envia ni àmbit ni títol: si
            es poguessin triar des del client, la barrera entre un text d'un desconegut i
            el tauler de la casa seria una decisió de la interfície.
          */
          void api.post(`/api/v1/mail/messages/${mail.id}/convert`).then(() => refresh());
        }}
        onMailToggle={(mail) => {
          /*
            Treure'l de l'inbox **no l'esborra**: el correu segueix sencer al servidor i a la
            vista de calendari, difuminat, i des d'allà el pots tornar a pujar. Per això el
            botó diu «Treure de l'inbox» i no «Esborrar».

            S'envia `false` explícit i no `null`: `null` diria «val el defecte de la
            carpeta», i com que el defecte del correu és «no visible», tornar-hi no faria
            res i el botó semblaria espatllat.
          */
          void api
            .post('/api/v1/inbox/mail', { message_id: mail.id, visible: !mail.in_inbox })
            .then(() => refresh());
        }}
        inboxHeader={<DayNavigator value={day} onChange={setDay} today={today} />}
        inboxHeaderExtra={
          potFiltrar ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 6 }}>
              <MailboxSwitch activeScopes={activeScopes} tasks={tasks} />
            </div>
          ) : undefined
        }
        mailbox={mailbox}
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
              draftStorageKey={`femho.quick-add:${profile.id}:${status}`}
              // Es torna la promesa: si peta, el camp recupera el que havies escrit.
              onCreate={(task) => create(task, status)}
              // Des del tauler de la IA, el formulari s'obre ja amb els camps d'IA
              // desplegats: és l'únic peu que hi queda i seria absurd que no ho fes.
              onFullEdit={() => onNewTask(status, aiBoard)}
            />
          )
        }
        tasks={tasks}
        timezone={profile.timezone}
        scopes={activeScopes.map((scope) => ({
          id: scope.id,
          name: scope.name,
          color: `var(${scope.color})`,
          kind: scope.kind,
        }))}
        collapsed={collapsed}
        onToggleGroup={toggleGroup}
        onOpen={onOpenTask}
        onChanged={refresh}
        onDrop={(taskId, status, placement) => void move(taskId, status, placement)}
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
            day={doneDay}
            onPickDay={setDoneDay}
            onBackToToday={() => setDoneDay(today)}
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
