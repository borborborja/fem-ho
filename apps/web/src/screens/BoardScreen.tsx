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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { generatePosition, t, type QuickAddContext, type TaskStatus } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api } from '../app/api.js';
import { Chips } from '../app/Chips.js';
import { useSessionData, useSession } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import type { Board, Inbox, Task } from '../app/types.js';
import { KanbanBoard, type BoardTask } from '../board/KanbanBoard.js';
import { ColumnQuickAdd, PlusIcon } from '../board/ColumnQuickAdd.js';
import { DayNavigator } from '../board/DayNavigator.js';
import { DoneHeader } from '../board/DoneColumnView.js';

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
 * Avui, **en local**.
 *
 * No es fa amb `toISOString()`, que passa per UTC: a Madrid, a les onze de la nit, això
 * donaria el dia de demà i la bústia s'obriria al dia equivocat cada vespre.
 */
/** La data local `YYYY-MM-DD` d'un instant. Mai per UTC. */
function localDate(at: Date): string {
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
    at.getDate(),
  ).padStart(2, '0')}`;
}

function todayISO(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/** La targeta tal com la vol el component, des de la tasca tal com la dona l'API. */
function toBoardTask(
  task: Task,
  projectName: string | undefined,
  initials: string | undefined,
  assignedToOther: boolean,
  collective: boolean,
): BoardTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    scope_id: task.scope_id,
    sourceKind: task.source_kind,
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
  const { updateSettings } = useSession();

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

  const board = useApi<Board>(path);

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
  const [day, setDay] = useState(() => todayISO());

  /**
   * Quin dia ensenya la columna Fet.
   *
   * **La columna ensenyava tot l'històric**, pla i sense agrupar: `groupDone` existia amb
   * les seves proves i no el cridava ningú, `done_cleared_at` s'escrivia i no el llegia
   * ningú, i l'estat buit no s'arribava a veure mai perquè amb una sola tasca feta el mes
   * passat la columna ja no era buida.
   */
  const [doneDay, setDoneDay] = useState(() => todayISO());

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
    query.set('include_overdue', String(day === todayISO()));
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
  }, [day, activeScopeIds, mailbox]);

  const inbox = useApi<Inbox>(inboxPath);

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
  const [optimistic, setOptimistic] = useState<Record<string, TaskStatus>>({});

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
    const columns = board.data?.columns ?? [];
    return (
      columns
        .flatMap((column) => column.groups.flatMap((group) => group.tasks))
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
          return localDate(new Date(task.completed_at)) === doneDay;
        })
        .map((task) => {
          const assignees = task.assignee_ids ?? [];
          const card = toBoardTask(
            task,
            projectName(task.project_id ?? null),
            initialsOf(assignees),
            assignees.length > 0 && !assignees.includes(profile.id),
            scopes.find((scope) => scope.id === task.scope_id)?.kind === 'collective',
          );
          const moved = optimistic[task.id];
          return moved === undefined ? card : { ...card, status: moved };
        })
    );
  }, [
    board.data,
    optimistic,
    projectName,
    initialsOf,
    aiBoard,
    profile.id,
    scopes,
    projectIds,
    projects,
    doneDay,
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
    const view = inbox.data;
    if (view === undefined) return [];
    return (
      [...view.dated, ...view.overdue, ...view.undated]
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
          return localDate(new Date(task.completed_at)) === doneDay;
        })
        .map((task) => {
          const assignees = task.assignee_ids ?? [];
          const card = toBoardTask(
            task,
            projectName(task.project_id ?? null),
            initialsOf(assignees),
            assignees.length > 0 && !assignees.includes(profile.id),
            scopes.find((scope) => scope.id === task.scope_id)?.kind === 'collective',
          );
          const moved = optimistic[task.id];
          return moved === undefined ? card : { ...card, status: moved };
        })
        // Una que s'acaba de moure fora de la bústia ha de marxar de seguida, sense esperar
        // que el servidor torni a contestar.
        .filter((card) => card.status === 'inbox')
    );
  }, [inbox.data, optimistic, projectName, initialsOf, profile.id, scopes, projectIds, projects]);

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
    }),
    [activeScopes, projects, people, activeScopeIds],
  );

  const move = async (taskId: string, status: TaskStatus): Promise<void> => {
    const before = tasks.find((task) => task.id === taskId)?.status;
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
      if (aiBoard) {
        const current = board.data?.columns
          .flatMap((column) => column.groups.flatMap((group) => group.tasks))
          .find((task) => task.id === taskId);

        if (status !== 'inbox' && current?.ai_mode === 'manual') {
          await api.post(`/api/v1/tasks/${taskId}/ai-mode`, { ai_mode: 'assisted' });
        } else if (status === 'inbox' && current !== undefined && current.ai_mode !== 'manual') {
          await api.post(`/api/v1/tasks/${taskId}/ai-mode`, { ai_mode: 'manual' });
        }
      }

      /**
       * La posició la calcula el client (D3). Es posa al final de la columna de destí
       * perquè és on el gest deixa la targeta quan no s'ha afinat entre dues.
       */
      const column = tasks.filter((task) => task.status === status && task.id !== taskId);
      const last = column[column.length - 1];
      const lastPosition =
        last === undefined
          ? null
          : (board.data?.columns
              .flatMap((c) => c.groups.flatMap((g) => g.tasks))
              .find((task) => task.id === last.id)?.position ?? null);

      await api.post(`/api/v1/tasks/${taskId}/move`, {
        status,
        position: generatePosition(lastPosition, null),
      });
      refresh();
    } catch {
      // Reversió: la targeta torna al seu lloc i l'usuari veu que no s'ha mogut.
      setOptimistic((current) => {
        const next = { ...current };
        if (before === undefined) delete next[taskId];
        else next[taskId] = before;
        return next;
      });
    }
  };

  const create = async (
    input: {
      title: string;
      scopeId: string;
      projectId: string | null;
      assigneeIds: string[];
      aiMode: 'manual' | 'assisted' | 'delegated';
    },
    status: TaskStatus = 'inbox',
  ): Promise<void> => {
    // L'identificador el genera el client (D4): així la creació és idempotent i la cua
    // de sortida pot reintentar-la sense duplicar res.
    await api.post('/api/v1/tasks', {
      id: uuidv7(),
      scope_id: input.scopeId,
      project_id: input.projectId ?? undefined,
      title: input.title,
      status,
      assignee_ids: input.assigneeIds.length > 0 ? input.assigneeIds : undefined,
    });
    refresh();
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
      {board.error !== undefined || inbox.error !== undefined ? (
        <ErrorBanner onRetry={refresh} />
      ) : null}

      <KanbanBoard
        aiBoard={aiBoard}
        flip={flip}
        doneEmptyLabel={
          doneDay === todayISO()
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
              due_date: event.starts_at.slice(0, 10),
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
        inboxHeader={
          /*
            Dos controls a la mateixa capçalera, en dues files: el navegador de dia hi és
            sempre i el commutador de calaix només quan hi ha àmbits de les dues menes.
          */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <DayNavigator value={day} onChange={setDay} today={todayISO()} />
            {potFiltrar ? <MailboxSwitch activeScopes={activeScopes} tasks={tasks} /> : null}
          </div>
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
              // Es torna la promesa: si peta, el camp recupera el que havies escrit.
              onCreate={(task) => create(task, status)}
              // Des del tauler de la IA, el formulari s'obre ja amb els camps d'IA
              // desplegats: és l'únic peu que hi queda i seria absurd que no ho fes.
              onFullEdit={() => onNewTask(status, aiBoard)}
            />
          )
        }
        tasks={tasks}
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
        onDrop={(taskId, status) => void move(taskId, status)}
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
            onBackToToday={() => setDoneDay(todayISO())}
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
