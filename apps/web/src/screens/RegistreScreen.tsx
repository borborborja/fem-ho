/**
 * El Registre: tot el que s'ha fet, quan, per a quin projecte, qui i quanta dedicació.
 *
 * Dues vistes de les mateixes dades, i la diferència no és estètica:
 *
 *   - **Taula** — per llegir i corregir. Agrupada per dia amb el total del dia, i amb els
 *     totals per persona i per projecte a dalt: és la vista de «quantes hores porto» i la
 *     que s'exporta.
 *   - **Cronograma** — per **veure els forats**. Una fila per projecte i els blocs a l'hora
 *     que van passar: és l'única manera de descobrir que dimarts hi ha dues hores que no són
 *     enlloc, o que un bloc es va quedar obert tota la nit.
 *
 * **Els números els fa el servidor.** L'eina que això substitueix es baixa la taula sencera
 * al navegador i hi fa els totals; aquí arriben fets, i el que es pinta és el que s'ha
 * demanat.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { dateTime, getLocale, longDay, shortTime, t } from '@fem-ho/contracts';
import { EmptyState } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { Chips } from '../app/Chips.js';
import { useSessionData } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import { ErrorBanner } from './BoardScreen.js';
import { Cronograma } from './Cronograma.js';

export interface SessionEntry {
  id: string;
  task_id: string;
  task_title: string;
  scope_id: string;
  project_id: string | null;
  project_name: string | null;
  task_type_id: string | null;
  task_type_name: string | null;
  task_type_color: string | null;
  user_id: string;
  user_name: string | null;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  overtime_minutes: number;
  needs_review: boolean;
  open: boolean;
  source: string;
}

export interface Bucket {
  key: string;
  label: string;
  minutes: number;
  overtime_minutes: number;
}

export interface SessionReport {
  data: SessionEntry[];
  totals: {
    minutes: number;
    overtime_minutes: number;
    tasks: number;
    by_user: Bucket[];
    by_project: Bucket[];
    by_day: Bucket[];
  };
}

/** «1h 25m», i «25m» quan no arriba a l'hora: llegir «0h 25m» costa més que llegir «25m». */
export function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)}m`;
  if (m === 0) return `${String(h)}h`;
  return `${String(h)}h ${String(m)}m`;
}

/** La data local d'avui, `YYYY-MM-DD`. No es fa amb `toISOString`: aquell és UTC. */
export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const PERIODES = ['today', 'week', 'month', 'days30', 'days90', 'all'] as const;
type Periode = (typeof PERIODES)[number];

/** Un període dona un rang; tocar les dates a mà el deixa en «personalitzat». */
export function rangeOf(periode: Periode): { from: string; to: string } {
  const avui = todayISO();
  switch (periode) {
    case 'today':
      return { from: avui, to: avui };
    case 'week': {
      // La setmana comença dilluns, com a tot arreu de Fem-ho (docs/01 §8).
      const d = new Date();
      const dilluns = (d.getDay() + 6) % 7;
      return { from: todayISO(-dilluns), to: avui };
    }
    case 'month':
      return { from: `${avui.slice(0, 7)}-01`, to: avui };
    case 'days30':
      return { from: todayISO(-29), to: avui };
    case 'days90':
      return { from: todayISO(-89), to: avui };
    default:
      return { from: '', to: '' };
  }
}

export interface RegistreScreenProps {
  activeScopeIds: string[];
  onOpenTask: (id: string) => void;
  /** Com se'n diu, d'un projecte, en aquests àmbits. Només canvia la paraula. */
  projectNoun?: 'project' | 'client';
}

export function RegistreScreen({
  activeScopeIds,
  onOpenTask,
  projectNoun = 'project',
}: RegistreScreenProps) {
  /** La clau del catàleg per a tot el que parla de projectes en aquesta pantalla. */
  const nom = (base: string): string => t(projectNoun === 'client' ? `${base}.client` : base);

  const { scopes, projects, people, profile } = useSessionData();

  const [vista, setVista] = useState<'table' | 'chrono'>('table');
  const [periode, setPeriode] = useState<Periode>('days30');
  const [rang, setRang] = useState(() => rangeOf('days30'));
  const [dia, setDia] = useState(todayISO());
  const [projecte, setProjecte] = useState('');
  const [persona, setPersona] = useState('');
  const [cerca, setCerca] = useState('');

  /**
   * Al cronograma, el rang és **un dia**: es pinten hores, i un mes d'hores no cap enlloc.
   * Els altres filtres es comparteixen entre les dues vistes perquè canviar de vista no ha
   * de fer perdre el que estaves mirant.
   */
  const finestra = vista === 'chrono' ? { from: dia, to: dia } : rang;

  const query = new URLSearchParams();
  if (finestra.from !== '') query.set('from', finestra.from);
  if (finestra.to !== '') query.set('to', finestra.to);
  if (activeScopeIds.length > 0) query.set('scope_ids', activeScopeIds.join(','));
  if (projecte !== '') query.set('project_id', projecte);
  if (persona !== '') query.set('user_id', persona);
  if (cerca.trim() !== '') query.set('search', cerca.trim());

  const report = useApi<SessionReport>(`/api/v1/sessions?${query.toString()}`);
  const entries = report.data?.data ?? [];
  const totals = report.data?.totals;

  /** Els projectes triables són els dels àmbits actius, i «Intern» hi és sempre. */
  const projectesActius = useMemo(
    () => projects.filter((project) => activeScopeIds.includes(project.scope_id)),
    [projects, activeScopeIds],
  );

  const nomPersona = (id: string): string => people.find((person) => person.id === id)?.name ?? id;

  return (
    <div data-testid="registre-screen" style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--text-section)', fontWeight: 900 }}>
          {t('registre.title')}
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>
          {t('registre.subtitle')}
        </p>
      </header>

      {report.error === undefined ? null : <ErrorBanner onRetry={report.reload} />}

      <div className="plou-card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chips
            testId="registre-view"
            value={vista}
            options={[
              { key: 'table' as const, label: t('registre.view.table') },
              { key: 'chrono' as const, label: t('registre.view.chrono') },
            ]}
            onChange={setVista}
          />

          {vista === 'chrono' ? (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
              {t('registre.day')}
              <input
                type="date"
                className="plou-input"
                data-testid="registre-day"
                value={dia}
                onChange={(event) => setDia(event.target.value)}
                style={{ width: 'auto' }}
              />
            </label>
          ) : (
            <>
              <select
                className="plou-input"
                data-testid="registre-period"
                value={periode}
                onChange={(event) => {
                  const next = event.target.value as Periode;
                  setPeriode(next);
                  setRang(rangeOf(next));
                }}
                style={{ width: 'auto' }}
              >
                {PERIODES.map((key) => (
                  <option key={key} value={key}>
                    {t(`registre.period.${key}`)}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="plou-input"
                data-testid="registre-from"
                value={rang.from}
                onChange={(event) => setRang({ ...rang, from: event.target.value })}
                style={{ width: 'auto' }}
              />
              <input
                type="date"
                className="plou-input"
                data-testid="registre-to"
                value={rang.to}
                onChange={(event) => setRang({ ...rang, to: event.target.value })}
                style={{ width: 'auto' }}
              />
            </>
          )}

          <select
            className="plou-input"
            data-testid="registre-project"
            value={projecte}
            onChange={(event) => setProjecte(event.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">{nom('registre.allProjects')}</option>
            <option value="none">{t('registre.noProject')}</option>
            {projectesActius.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <select
            className="plou-input"
            data-testid="registre-person"
            value={persona}
            onChange={(event) => setPersona(event.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">{t('registre.everyone')}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>

          <input
            className="plou-input"
            data-testid="registre-search"
            value={cerca}
            placeholder={t('registre.search')}
            onChange={(event) => setCerca(event.target.value)}
            style={{ width: 180 }}
          />

          {/*
            **L'exportació se serveix pel mateix filtre.** Va per `fetch` i no per un `href`:
            la sessió viatja a la capçalera i una navegació del navegador no en porta res.
          */}
          <button
            type="button"
            className="plou-btn plou-btn-ghost"
            data-testid="registre-export"
            style={{ fontSize: 12, marginLeft: 'auto' }}
            onClick={() => {
              void api.text(`/api/v1/sessions/export.csv?${query.toString()}`).then((csv) => {
                const url = URL.createObjectURL(
                  new Blob([csv], { type: 'text/csv;charset=utf-8' }),
                );
                const link = document.createElement('a');
                link.href = url;
                link.download = 'registre.csv';
                link.click();
                URL.revokeObjectURL(url);
              });
            }}
          >
            {t('registre.export')}
          </button>
        </div>

        {totals === undefined ? null : (
          <>
            <p
              data-testid="registre-summary"
              style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)' }}
            >
              {t('registre.summary', {
                tasks: totals.tasks,
                time: fmtMinutes(totals.minutes),
              })}
              {totals.overtime_minutes > 0
                ? ` · ${t('registre.overtimeTotal', {
                    time: fmtMinutes(totals.overtime_minutes),
                  })}`
                : ''}
            </p>

            {/*
              Les pastilles: primer les persones i després els projectes, separats. Són els
              mateixos minuts de la taula agrupats de dues maneres, i per això van junts:
              qui mira «quantes hores porto» i «per a qui» ho pregunta alhora.
            */}
            <div
              data-testid="registre-pills"
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              {totals.by_user.map((bucket) => (
                <span key={bucket.key} className="plou-tag plou-tag-accent">
                  {nomPersona(bucket.key)}: {fmtMinutes(bucket.minutes)}
                </span>
              ))}
              {totals.by_user.length > 0 && totals.by_project.length > 0 ? (
                <span
                  aria-hidden="true"
                  style={{ width: 1, height: 18, background: 'var(--divider)' }}
                />
              ) : null}
              {totals.by_project.map((bucket) => (
                <span key={bucket.key} className="plou-tag">
                  {bucket.key === 'none' ? t('registre.noProject') : bucket.label}:{' '}
                  {fmtMinutes(bucket.minutes)}
                </span>
              ))}
            </div>
          </>
        )}

        {vista === 'chrono' ? (
          <Cronograma
            entries={entries}
            day={dia}
            projects={projectesActius}
            onChanged={report.reload}
            onOpenTask={onOpenTask}
          />
        ) : (
          <Taula
            entries={entries}
            byDay={totals?.by_day ?? []}
            onOpenTask={onOpenTask}
            nomPersona={nomPersona}
            projectLabel={nom('registre.col.project')}
          />
        )}
      </div>

      {/* Un àmbit sense registre no en té, de blocs: val més dir-ho que ensenyar un buit. */}
      {entries.length === 0 && report.loading === false ? (
        <EmptyState>
          {scopes.some((scope) => activeScopeIds.includes(scope.id))
            ? t('registre.empty')
            : t('registre.noScopes')}
        </EmptyState>
      ) : null}

      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-faint)' }}>
        {t('registre.timezone', { zone: profile.timezone })}
      </p>
    </div>
  );
}

/**
 * La taula, agrupada per dia amb el total del dia.
 *
 * L'agrupació es fa en una passada sobre la llista ja ordenada: quan canvia el dia, s'hi
 * posa el separador. El total no es torna a sumar aquí —ve del servidor— perquè la
 * capçalera i les files no puguin dir coses diferents.
 */
function Taula({
  entries,
  byDay,
  onOpenTask,
  nomPersona,
  projectLabel,
}: {
  entries: SessionEntry[];
  byDay: Bucket[];
  onOpenTask: (id: string) => void;
  nomPersona: (id: string) => string;
  projectLabel: string;
}) {
  const totalDia = new Map(byDay.map((bucket) => [bucket.key, bucket.minutes]));
  const locale = getLocale();
  let diaActual = '';

  const files: ReactNode[] = [];
  for (const entry of entries) {
    const dia = localDay(entry.started_at);
    if (dia !== diaActual) {
      diaActual = dia;
      files.push(
        <tr
          key={`dia-${dia}`}
          data-testid={`registre-day-${dia}`}
          style={{ background: 'var(--gradient-wash-warm)' }}
        >
          <th
            colSpan={5}
            style={{ textAlign: 'left', padding: '7px 10px', fontSize: 12, fontWeight: 700 }}
          >
            {longDay(locale, new Date(`${dia}T12:00:00`))}
          </th>
          <th style={{ textAlign: 'right', padding: '7px 10px', fontSize: 12, fontWeight: 700 }}>
            {fmtMinutes(totalDia.get(dia) ?? 0)}
          </th>
        </tr>,
      );
    }

    files.push(
      <tr
        key={entry.id}
        data-testid={`registre-row-${entry.id}`}
        style={{ borderTop: '1px solid var(--divider-soft)' }}
      >
        <td style={{ padding: '8px 10px', fontSize: 12.5, whiteSpace: 'nowrap' }}>
          {dateTime(locale, new Date(entry.started_at))}
        </td>
        <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
          {entry.project_name ?? t('registre.noProject')}
        </td>
        <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
          <button
            type="button"
            onClick={() => onOpenTask(entry.task_id)}
            style={{
              border: 'none',
              background: 'transparent',
              font: 'inherit',
              cursor: 'pointer',
              color: 'var(--ink)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              padding: 0,
              textAlign: 'left',
            }}
          >
            {entry.task_title}
          </button>
        </td>
        <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
          {entry.task_type_name === null ? (
            <span style={{ color: 'var(--ink-faint)' }}>—</span>
          ) : (
            <span
              className="plou-tag"
              style={{
                background: entry.task_type_color ?? 'var(--tag-bg)',
                color: 'var(--on-brand)',
              }}
            >
              {entry.task_type_name}
            </span>
          )}
        </td>
        <td style={{ padding: '8px 10px', fontSize: 12.5 }}>
          {entry.user_name ?? nomPersona(entry.user_id)}
        </td>
        <td
          style={{
            padding: '8px 10px',
            fontSize: 12.5,
            textAlign: 'right',
            whiteSpace: 'nowrap',
            fontWeight: entry.overtime_minutes > 0 ? 700 : 400,
            color: entry.overtime_minutes > 0 ? 'var(--kicker)' : 'var(--ink)',
          }}
          title={
            entry.overtime_minutes > 0
              ? t('registre.overtimeCell', { time: fmtMinutes(entry.overtime_minutes) })
              : undefined
          }
        >
          {entry.open ? `${fmtMinutes(entry.minutes)} ·` : fmtMinutes(entry.minutes)}
          {/* Icona i text, mai el color sol (docs/04 §8). */}
          {entry.needs_review ? <span title={t('registre.review')}> ⚠</span> : null}
          {entry.open ? <span title={t('registre.open')}> ▶</span> : null}
        </td>
      </tr>,
    );
  }

  if (entries.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        data-testid="registre-table"
        style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}
      >
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--ink-soft)' }}>
            <th style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>
              {t('registre.col.when')}
            </th>
            <th style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>{projectLabel}</th>
            <th style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>
              {t('registre.col.task')}
            </th>
            <th style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>
              {t('registre.col.type')}
            </th>
            <th style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700 }}>
              {t('registre.col.person')}
            </th>
            <th style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, textAlign: 'right' }}>
              {t('registre.col.time')}
            </th>
          </tr>
        </thead>
        <tbody>{files}</tbody>
      </table>
    </div>
  );
}

/** El dia local d'un instant, `YYYY-MM-DD`. */
export function localDay(instant: string): string {
  const d = new Date(instant);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** L'hora local d'un instant, per al cronograma i la taula. */
export function localTime(instant: string): string {
  return shortTime(getLocale(), new Date(instant));
}
