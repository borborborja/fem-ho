/**
 * El calendari. docs/02 §5.
 *
 * Graella de dues columnes: calendari flexible i rail de 340px, **amb la posició del
 * rail configurable** a Ajustos (esquerra, dreta o a sota). Per sota de 860px el rail
 * passa a sota sempre, en scroll vertical (docs/02 §10).
 *
 * **El rail és el MATEIX component que la columna Inbox del kanban** (P4). No una còpia
 * amb els mateixos estils: la mateixa. Si divergissin es notaria, i el document ho diu
 * amb aquestes paraules.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  getLocale,
  longDay,
  monthName,
  resolveWeekStart,
  shortTime,
  t,
  weekdayNames,
} from '@fem-ho/contracts';
import { DayView, MonthView, WeekView, useIsMobile } from '@fem-ho/design-system/femho';
import { generatePosition, type QuickAddContext } from '@fem-ho/contracts';
import { api } from '../app/api.js';
import { v7 as uuidv7 } from 'uuid';
import { useSession, useSessionData } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import type { Calendar, EventOccurrence, Inbox } from '../app/types.js';
import { InboxRail } from '../board/InboxRail.js';
import { ColumnQuickAdd } from '../board/ColumnQuickAdd.js';
import { EventSheet } from './EventSheet.js';
import { SourceIcon } from '../board/SourceIcon.js';
import { ErrorBanner } from './BoardScreen.js';

type Mode = 'month' | 'week' | 'day';

/** `YYYY-MM-DD` d'una data local, sense passar per UTC. */
function iso(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * El primer dia de la setmana d'una data.
 *
 * Amb quin dia comença ho decideix l'idioma i la preferència de la persona: ho resol
 * `resolveWeekStart` a `@fem-ho/contracts`, que és **un sol lloc per a les dues apps**
 * perquè si cadascú el calculés pel seu compte el calendari es desplaçaria un dia i no
 * donaria cap error.
 */
function weekStartOf(date: Date, start: 0 | 1): Date {
  return addDays(date, -((date.getDay() - start + 7) % 7));
}

export interface CalendarScreenProps {
  activeScopeIds: string[];
  onOpenTask: (id: string) => void;
}

export function CalendarScreen({ activeScopeIds, onOpenTask }: CalendarScreenProps) {
  const { scopes, projects, people, settings } = useSessionData();
  const { updateSettings } = useSession();
  const mobile = useIsMobile();
  const [mode, setMode] = useState<Mode>('month');
  const [selected, setSelected] = useState<string>(() => iso(new Date()));
  const [cursor, setCursor] = useState<Date>(() => new Date());
  /**
   * Quin esdeveniment s'ha obert.
   *
   * **Fins ara no se'n podia obrir cap**: al calendari, el text i el punt de color eren
   * purament informatius i l'única cosa clicable era el dia. `docs/ESTAT.md` ho marcava
   * com el que bloquejava els adjunts d'esdeveniments; això n'obre la porta.
   */
  const [obert, setObert] = useState<string | null>(null);

  /**
   * Amb quin dia comença la setmana.
   *
   * `auto` el treu de l'idioma —dilluns en català i castellà, diumenge en anglès— i la
   * tria de la persona mana per damunt: el primer dia de la setmana no és només una
   * convenció lingüística.
   */
  const locale = getLocale();
  const start = resolveWeekStart(settings.week_start, locale);

  // La finestra que es demana depèn de la vista: el mes sencer per a la graella, la
  // setmana per a la setmanal, el dia per a la diària. Demanar sempre el mes seria
  // portar trenta dies de dades per pintar-ne un.
  const [from, to] = useMemo<[string, string]>(() => {
    /**
     * **El `to` és exclusiu i per això sempre porta un dia de més.**
     *
     * El servidor rep dues dates i les llegeix com a instants: `2026-08-11` és la
     * mitjanit d'aquell dia. Amb `from` i `to` iguals, la finestra era de mitjanit a
     * mitjanit —**buida**— i la vista diària no ensenyava mai cap esdeveniment; a la
     * setmanal i a la mensual, l'últim dia hi queia a fora. No es notava perquè el rail
     * del costat va per `/inbox`, que sí que resol el dia bé: la pantalla ensenyava les
     * cites en un panell i "sense esdeveniments" a l'altre.
     */
    const day = (date: string): string => iso(addDays(new Date(`${date}T12:00:00`), 1));
    if (mode === 'day') return [selected, day(selected)];
    if (mode === 'week') {
      const first = weekStartOf(new Date(`${selected}T12:00:00`), start);
      return [iso(first), iso(addDays(first, 7))];
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return [iso(addDays(first, -7)), iso(addDays(last, 8))];
  }, [mode, selected, cursor, start]);

  const scopeQuery = activeScopeIds.length > 0 ? `&scope_ids=${activeScopeIds.join(',')}` : '';
  const events = useApi<EventOccurrence[]>(`/api/v1/events?from=${from}&to=${to}${scopeQuery}`);
  const inbox = useApi<Inbox>(
    `/api/v1/inbox?date=${selected}&include_overdue=${String(settings.inbox_show_overdue ?? true)}${scopeQuery}`,
  );

  /** De quina mena és la font d'un calendari. `null` si és d'aquesta casa. */
  const menaDe = (calendarId: string | undefined): 'caldav' | 'ical' | 'rss' | null =>
    calendarId === undefined
      ? null
      : (calendars.data?.find((calendar) => calendar.id === calendarId)?.source_kind ?? null);

  const colorOf = (scopeId: string): string => {
    const scope = scopes.find((candidate) => candidate.id === scopeId);
    return scope === undefined ? 'var(--ink-faint)' : `var(${scope.color})`;
  };

  /**
   * Les fonts de dades dels àmbits actius, i quines es veuen.
   *
   * **S'amaga, no s'esborra**: la font és de l'àmbit i la comparteix tothom qui hi és.
   * Que algú deixi de mirar el calendari de festius no vol dir que ningú més el vulgui.
   * I es guarda el que s'amaga, no el que es veu: així una font nova surt sola, que és
   * el que ha de passar quan algú de la casa n'afegeix una.
   */
  const calendars = useApi<Calendar[]>('/api/v1/calendars');
  const hidden = settings.hidden_calendar_ids ?? [];
  const sources = (calendars.data ?? []).filter(
    (calendar) =>
      calendar.kind === 'events' &&
      (activeScopeIds.length === 0 || activeScopeIds.includes(calendar.scope_id)),
  );

  const occurrences = (events.data ?? []).filter(
    (occurrence) =>
      occurrence.calendar_id === undefined || !hidden.includes(occurrence.calendar_id),
  );

  const toggleSource = (id: string): void => {
    void updateSettings({
      hidden_calendar_ids: hidden.includes(id)
        ? hidden.filter((value) => value !== id)
        : [...hidden, id],
    });
  };

  const dotsByDate = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const occurrence of occurrences) {
      const day = occurrence.starts_at.slice(0, 10);
      const color = colorOf(occurrence.scope_id);
      const list = map[day] ?? [];
      // Fins a 3 punts per dia (docs/02 §5), i sense repetir el color d'un mateix àmbit.
      if (!list.includes(color) && list.length < 3) list.push(color);
      map[day] = list;
    }
    return map;
  }, [occurrences, scopes]);

  /**
   * Els noms surten d'`Intl`, no del catàleg.
   *
   * Eren dues claus amb els dotze mesos separats per comes i indexats per posició: es
   * trencaven amb qualsevol llengua que porti una coma dins d'un nom de mes, i ningú en
   * validava la llargada. `Intl` porta CLDR, igual que `java.time` d'Android, o sigui
   * que les dues apps diuen el mateix sense escriure-ho dues vegades.
   */
  const weekdays = weekdayNames(locale, start);

  const dayItems = occurrences
    .filter((occurrence) => occurrence.starts_at.slice(0, 10) === selected)
    .map((occurrence) => ({
      // Una ocurrència no té identitat pròpia: la clau és l'esdeveniment més l'instant,
      // perquè dues ocurrències del mateix mestre comparteixen `event_id` (D8).
      id: `${occurrence.event_id}@${occurrence.starts_at}`,
      title: occurrence.summary,
      color: colorOf(occurrence.scope_id),
      time: occurrence.all_day ? undefined : shortTime(locale, new Date(occurrence.starts_at)),
      /**
       * **Un sol significat per a la vora discontínua: "això no és a la teva bústia".**
       *
       * El valor ve del servidor (`in_inbox`) i no es recalcula aquí: si es fes, hi
       * hauria dues implementacions de la mateixa regla i un dia el que es difumina al
       * calendari i el que falta a la bústia deixarien de ser la mateixa cosa.
       */
      muted: !occurrence.in_inbox,
      /**
       * La mena surt de la llista de calendaris que aquesta pantalla ja té: no cal
       * ampliar el contracte de `/events` per a una cosa que el client ja sap.
       */
      icon: <SourceIcon kind={menaDe(occurrence.calendar_id)} />,
    }));

  /** L'ocurrència oberta a la fitxa, per la clau que fa servir la graella. */
  const openItem =
    obert === null ? undefined : occurrences.find((o) => `${o.event_id}@${o.starts_at}` === obert);

  const weekDays = useMemo(() => {
    const first = weekStartOf(new Date(`${selected}T12:00:00`), start);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(first, index);
      const key = iso(date);
      return {
        iso: key,
        weekday: weekdays[index] ?? '',
        number: date.getDate(),
        items: occurrences
          .filter((occurrence) => occurrence.starts_at.slice(0, 10) === key)
          .map((occurrence) => ({
            id: `${occurrence.event_id}@${occurrence.starts_at}`,
            title: occurrence.summary,
          })),
      };
    });
  }, [selected, occurrences]);

  const position = mobile ? 'below' : (settings.inbox_position ?? 'right');
  const railFirst = position === 'left';

  /**
   * Crear a la bústia **d'un dia concret**.
   *
   * `dueDate` nul vol dir "sense dia", que és el bloc de sota del rail. Amb data, la tasca
   * neix ja situada: és el que fa que el `+` d'una cel·la del calendari valgui la pena en
   * comptes de crear-la i haver-la d'arrossegar.
   */
  const crear = useCallback(
    (
      dueDate: string | null,
      input: { title: string; scopeId: string; projectId: string | null; assigneeIds: string[] },
    ) => {
      void api
        .post('/api/v1/tasks', {
          id: uuidv7(),
          scope_id: input.scopeId,
          project_id: input.projectId ?? undefined,
          title: input.title,
          status: 'inbox',
          position: generatePosition(null, null),
          ...(dueDate === null ? {} : { due_date: dueDate }),
          assignee_ids: input.assigneeIds.length > 0 ? input.assigneeIds : undefined,
        })
        .then(() => {
          inbox.reload();
          events.reload();
        });
    },
    [inbox, events],
  );

  /**
   * El context de l'afegida ràpida, **el mateix que al tauler**.
   *
   * Els projectes hi han de ser: `#Àmbit/Projecte` és una de les dues formes que el parser
   * entén, i un context sense projectes faria que al calendari la mateixa sintaxi que
   * funciona al tauler no encaminés enlloc.
   */
  const contextRapid = useMemo<QuickAddContext>(
    () => ({
      scopes: scopes
        .filter((scope) => activeScopeIds.includes(scope.id))
        .map((scope) => ({
          id: scope.id,
          name: scope.name,
          projects: projects
            .filter((project) => project.scope_id === scope.id)
            .map((project) => ({ id: project.id, name: project.name })),
        })),
      people,
      activeScopeIds,
    }),
    [scopes, projects, people, activeScopeIds],
  );

  const rail = (
    <InboxRail
      tasks={[...(inbox.data?.dated ?? []), ...(inbox.data?.overdue ?? [])].map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        scope_id: task.scope_id,
        time: task.due_time ?? undefined,
      }))}
      undated={(inbox.data?.undated ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        scope_id: task.scope_id,
      }))}
      scopes={scopes
        .filter((scope) => activeScopeIds.includes(scope.id))
        .map((scope) => ({
          id: scope.id,
          name: scope.name,
          color: `var(${scope.color})`,
          kind: scope.kind,
        }))}
      placement="rail"
      dayLabel={longDay(locale, new Date(`${selected}T12:00:00`))}
      dayFooter={
        <ColumnQuickAdd
          status="inbox"
          context={contextRapid}
          scopes={scopes.map((scope) => ({ id: scope.id, color: scope.color }))}
          onCreate={(task) => crear(selected, task)}
          onFullEdit={() => onOpenTask('')}
        />
      }
      undatedFooter={
        <ColumnQuickAdd
          status="inbox"
          context={contextRapid}
          scopes={scopes.map((scope) => ({ id: scope.id, color: scope.color }))}
          onCreate={(task) => crear(null, task)}
          onFullEdit={() => onOpenTask('')}
        />
      }
      onOpen={onOpenTask}
      events={inbox.data?.events}
      mail={inbox.data?.mail}
      onEventRemove={(event) => {
        void api
          .post('/api/v1/inbox/events', {
            calendar_id: event.calendar_id,
            uid: event.uid,
            recurrence_id: event.recurrence_id,
            visible: false,
          })
          .then(() => inbox.reload());
      }}
      onChanged={inbox.reload}
      onMove={(taskId, status) => {
        void api.post(`/api/v1/tasks/${taskId}/move`, { status }).then(() => {
          inbox.reload();
        });
      }}
    />
  );

  const calendar = (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        role="tablist"
        data-testid="calendar-modes"
        style={{
          display: 'inline-flex',
          padding: 3,
          borderRadius: 100,
          background: 'var(--ghost-bg)',
          width: 'fit-content',
        }}
      >
        {(
          [
            { key: 'month', label: t('calendar.month') },
            { key: 'week', label: t('calendar.week') },
            { key: 'day', label: t('calendar.day') },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={mode === tab.key}
            data-testid={`calendar-mode-${tab.key}`}
            onClick={() => setMode(tab.key)}
            style={{
              padding: '7px 18px',
              minHeight: mobile ? 44 : undefined,
              borderRadius: 100,
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12.5,
              fontWeight: mode === tab.key ? 700 : 500,
              background: mode === tab.key ? 'var(--card-bg)' : 'transparent',
              color: mode === tab.key ? 'var(--ink)' : 'var(--ink-soft)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/*
        Les fonts de l'àmbit actiu, per encendre i apagar.
        Amb una sola no hi ha res a triar, i una fila de commutadors d'un element és
        soroll: només surt quan n'hi ha més d'una.
      */}
      {sources.length < 2 ? null : (
        <div
          data-testid="calendar-sources"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
            {t('calendar.sources')}
          </span>
          {sources.map((source) => {
            const on = !hidden.includes(source.id);
            return (
              <button
                key={source.id}
                type="button"
                data-testid={`calendar-source-${source.id}`}
                aria-pressed={on}
                aria-label={t(on ? 'calendar.sources.hide' : 'calendar.sources.show', {
                  name: source.name,
                })}
                onClick={() => toggleSource(source.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 11px',
                  borderRadius: 100,
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 11.5,
                  fontWeight: on ? 700 : 500,
                  background: on ? 'var(--ghost-bg)' : 'transparent',
                  // El color no és mai l'únic senyal (docs/02 §12): el punt s'apaga i
                  // el text també.
                  color: on ? 'var(--ink)' : 'var(--ink-faint)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: on ? colorOf(source.scope_id) : 'var(--ink-faint)',
                    opacity: on ? 1 : 0.4,
                  }}
                />
                {source.name}
              </button>
            );
          })}
        </div>
      )}

      {events.error !== undefined ? <ErrorBanner onRetry={events.reload} /> : null}

      <div style={{ opacity: events.revalidating ? 0.6 : 1 }}>
        {mode === 'month' ? (
          <MonthView
            year={cursor.getFullYear()}
            month={cursor.getMonth()}
            monthLabel={`${monthName(locale, cursor.getMonth())} ${String(cursor.getFullYear())}`}
            weekStart={start}
            weekdayLabels={{
              days: weekdays,
              prevLabel: t('calendar.prevMonth'),
              nextLabel: t('calendar.nextMonth'),
            }}
            selectedDate={selected}
            today={iso(new Date())}
            dotsByDate={dotsByDate}
            onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            onSelect={setSelected}
            /*
              El `+` d'una cel·la **selecciona el dia i hi crea**: sense seleccionar-lo, la
              tasca apareixeria a un rail que ensenya un altre dia i semblaria que no s'ha
              creat res.
            */
            onAddOnDay={(iso) => setSelected(iso)}
            addLabel={t('calendar.addOnDay')}
          />
        ) : mode === 'week' ? (
          <WeekView
            days={weekDays}
            selectedDate={selected}
            onSelect={setSelected}
            emptyLabel={t('calendar.empty.week')}
            onAddOnDay={(iso) => setSelected(iso)}
            addLabel={t('calendar.addOnDay')}
          />
        ) : (
          <DayView
            /**
             * "6 d'agost", "6 de agosto", "August 6".
             *
             * Era una plantilla del catàleg, `"{day} de {month}"`, que no podia
             * expressar ni l'elisió catalana —"1 d'agost" i no "1 de agost"— ni l'ordre
             * anglès. `Intl` la resol i, de propina, hi posa l'apòstrof tipogràfic bo.
             */
            label={longDay(locale, new Date(`${selected}T12:00:00`))}
            items={dayItems}
            emptyLabel={t('calendar.empty.day')}
            onSelectItem={setObert}
            /*
              A la diària el dia ja és el seleccionat: el botó no ha de canviar de dia,
              només portar el focus al camp del rail, que és on s'escriu.
            */
            onAdd={() => {
              document
                .querySelector<HTMLInputElement>('[data-testid="quick-add-inbox"] input')
                ?.focus();
            }}
            addLabel={t('calendar.addOnDay')}
          />
        )}
      </div>

      {openItem === undefined ? null : (
        <EventSheet
          occurrence={openItem}
          onClose={() => setObert(null)}
          onToggleInbox={() => {
            void api
              .post('/api/v1/inbox/events', {
                calendar_id: openItem.calendar_id,
                uid: openItem.uid,
                recurrence_id: openItem.recurrence_id,
                /*
                  Si hi és, se'n treu; si no hi és, s'hi torna a posar. **Tornar-hi envia
                  `true` i no `null`**: `null` diria "val el defecte", i si el defecte
                  d'aquella font és "no", tornar-hi no faria res i el botó semblaria
                  espatllat.
                */
                visible: openItem.in_inbox ? false : true,
              })
              .then(() => {
                setObert(null);
                events.reload();
                inbox.reload();
              });
          }}
        />
      )}
    </div>
  );

  if (position === 'below') {
    return (
      <div data-testid="calendar-screen" style={{ display: 'grid', gap: 20 }}>
        {calendar}
        {rail}
      </div>
    );
  }

  return (
    <div
      data-testid="calendar-screen"
      style={{
        display: 'grid',
        gridTemplateColumns: railFirst ? '340px 1fr' : '1fr 340px',
        gap: 20,
        alignItems: 'start',
      }}
    >
      {railFirst ? rail : calendar}
      {railFirst ? calendar : rail}
    </div>
  );
}
