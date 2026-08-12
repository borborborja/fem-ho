/**
 * Les Estadístiques: la dedicació mirada de lluny.
 *
 * Les mateixes dades del Registre amb els mateixos filtres —hi passen per la mateixa
 * consulta—, i quatre preguntes que la taula no respon d'un cop d'ull: **quant**, **com ha
 * anat evolucionant**, **en què** i **per a qui**.
 *
 * Els gràfics es dibuixen aquí, amb SVG i els tokens del design system. Res de llibreries de
 * charting: el que cal són una línia amb la seva àrea i unes barres horitzontals, i una
 * dependència de tres-cents kB per fer-ho seria pagar molt per uns quants `path`.
 */

import { useMemo, useState } from 'react';
import { longDay, getLocale, t } from '@fem-ho/contracts';
import { EmptyState } from '@fem-ho/design-system/femho';
import { useSessionData } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import { ErrorBanner } from './BoardScreen.js';
import { fmtMinutes, todayISO, type Bucket } from './RegistreScreen.js';

interface Stats {
  tasks: number;
  minutes: number;
  overtime_minutes: number;
  projects: number;
  average_minutes: number;
  evolution: { key: string; minutes: number }[];
  weekly: boolean;
  by_type: Bucket[];
  by_project: Bucket[];
  by_user: Bucket[];
  overtime_by_project: Bucket[];
}

const PERIODES = ['days7', 'days30', 'days90', 'days365', 'all'] as const;
type Periode = (typeof PERIODES)[number];

function rangOf(periode: Periode): { from: string; to: string } {
  const dies = { days7: 7, days30: 30, days90: 90, days365: 365 } as const;
  if (periode === 'all') return { from: '', to: '' };
  return { from: todayISO(-(dies[periode] - 1)), to: todayISO() };
}

export interface EstadistiquesScreenProps {
  activeScopeIds: string[];
}

export function EstadistiquesScreen({ activeScopeIds }: EstadistiquesScreenProps) {
  const { people } = useSessionData();
  const [periode, setPeriode] = useState<Periode>('days30');
  const [rang, setRang] = useState(() => rangOf('days30'));
  const [persona, setPersona] = useState('');

  const query = new URLSearchParams();
  if (rang.from !== '') query.set('from', rang.from);
  if (rang.to !== '') query.set('to', rang.to);
  if (activeScopeIds.length > 0) query.set('scope_ids', activeScopeIds.join(','));
  if (persona !== '') query.set('user_id', persona);

  const stats = useApi<Stats>(`/api/v1/sessions/stats?${query.toString()}`);
  const data = stats.data;

  const nomPersona = (bucket: Bucket): string =>
    people.find((person) => person.id === bucket.key)?.name ?? bucket.label;

  const buit = data !== undefined && data.minutes === 0;

  return (
    <div data-testid="estadistiques-screen" style={{ display: 'grid', gap: 16 }}>
      <header style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--text-section)', fontWeight: 900 }}>
          {t('stats.title')}
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-soft)' }}>{t('stats.subtitle')}</p>
      </header>

      {stats.error === undefined ? null : <ErrorBanner onRetry={stats.reload} />}

      <div className="plou-card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select
          className="plou-input"
          data-testid="stats-period"
          value={periode}
          onChange={(event) => {
            const next = event.target.value as Periode;
            setPeriode(next);
            setRang(rangOf(next));
          }}
          style={{ width: 'auto' }}
        >
          {PERIODES.map((key) => (
            <option key={key} value={key}>
              {t(`stats.period.${key}`)}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="plou-input"
          data-testid="stats-from"
          value={rang.from}
          onChange={(event) => setRang({ ...rang, from: event.target.value })}
          style={{ width: 'auto' }}
        />
        <input
          type="date"
          className="plou-input"
          data-testid="stats-to"
          value={rang.to}
          onChange={(event) => setRang({ ...rang, to: event.target.value })}
          style={{ width: 'auto' }}
        />
        <select
          className="plou-input"
          data-testid="stats-person"
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
      </div>

      {data === undefined ? null : (
        <>
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            }}
          >
            <Targeta testId="stats-tasks" value={String(data.tasks)} label={t('stats.tasks')} />
            <Targeta
              testId="stats-total"
              value={`${(data.minutes / 60).toFixed(1)} h`}
              label={t('stats.total')}
            />
            <Targeta
              testId="stats-projects"
              value={String(data.projects)}
              label={t('stats.projects')}
            />
            <Targeta
              testId="stats-average"
              value={data.tasks === 0 ? '—' : fmtMinutes(data.average_minutes)}
              label={t('stats.average')}
            />
          </div>

          {buit ? (
            <EmptyState>{t('registre.empty')}</EmptyState>
          ) : (
            <>
              <div className="plou-card" style={{ display: 'grid', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                  {data.weekly ? t('stats.evolutionWeekly') : t('stats.evolution')}
                </h2>
                <Linia points={data.evolution} />
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                }}
              >
                <Barres
                  testId="stats-by-type"
                  title={t('stats.byType')}
                  buckets={data.by_type}
                  label={(bucket) => (bucket.key === 'none' ? t('stats.noType') : bucket.label)}
                />
                <Barres
                  testId="stats-by-project"
                  title={t('stats.byProject')}
                  buckets={data.by_project}
                  label={(bucket) =>
                    bucket.key === 'none' ? t('registre.noProject') : bucket.label
                  }
                />
                <Barres
                  testId="stats-by-person"
                  title={t('stats.byPerson')}
                  buckets={data.by_user}
                  label={nomPersona}
                />
                {/*
                  **Les hores extres, per projecte.** No és el mateix «he fet quaranta hores
                  extres» que «les he fetes totes per a un client»: el segon és el que et fa
                  canviar alguna cosa, i per això té gràfic propi i només surt si n'hi ha.
                */}
                {data.overtime_by_project.length === 0 ? null : (
                  <Barres
                    testId="stats-overtime"
                    title={t('stats.overtime')}
                    buckets={data.overtime_by_project}
                    label={(bucket) =>
                      bucket.key === 'none' ? t('registre.noProject') : bucket.label
                    }
                    value={(bucket) => bucket.overtime_minutes}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Targeta({ testId, value, label }: { testId: string; value: string; label: string }) {
  return (
    <div className="plou-card" data-testid={testId} style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{label}</span>
    </div>
  );
}

/**
 * La línia de l'evolució, amb la seva àrea.
 *
 * Sense eix vertical: el que es llegeix d'aquest gràfic és **la forma** —quins dies hi va
 * haver feina i quins no—, i el número que importa és el màxim, que va escrit a dalt. Un eix
 * complet ompliria d'etiquetes un gràfic de 190 píxels d'alt.
 */
function Linia({ points }: { points: { key: string; minutes: number }[] }) {
  const locale = getLocale();
  const w = 720;
  const h = 190;
  const max = Math.max(1, ...points.map((punt) => punt.minutes));

  const coords = useMemo(
    () =>
      points.map((punt, i) => {
        const x = points.length === 1 ? w / 2 : (i / (points.length - 1)) * w;
        const y = h - (punt.minutes / max) * (h - 24) - 8;
        return { x, y, punt };
      }),
    [points, max],
  );

  if (points.length === 0) return null;

  const linia = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${String(c.x)},${String(c.y)}`)
    .join(' ');
  const area = `${linia} L${String(coords[coords.length - 1]?.x ?? 0)},${String(h)} L${String(
    coords[0]?.x ?? 0,
  )},${String(h)} Z`;

  // Unes vuit etiquetes: més se solapen i menys no situen.
  const cada = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div data-testid="stats-evolution" style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{fmtMinutes(max)}</span>
      <svg viewBox={`0 0 ${String(w)} ${String(h)}`} style={{ width: '100%', height: 190 }}>
        <path d={area} fill="var(--gradient-wash-warm)" opacity={0.5} />
        <path d={linia} fill="none" stroke="var(--kicker)" strokeWidth={2} />
        {coords.map((c) => (
          <circle key={c.punt.key} cx={c.x} cy={c.y} r={3} fill="var(--kicker)" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
        {points
          .filter((_, i) => i % cada === 0)
          .map((punt) => (
            <span key={punt.key} style={{ color: 'var(--ink-faint)' }}>
              {longDay(locale, new Date(`${punt.key}T12:00:00`))}
            </span>
          ))}
      </div>
    </div>
  );
}

/** Barres horitzontals, escalades al màxim de la sèrie. */
function Barres({
  testId,
  title,
  buckets,
  label,
  value = (bucket) => bucket.minutes,
}: {
  testId: string;
  title: string;
  buckets: Bucket[];
  label: (bucket: Bucket) => string;
  value?: (bucket: Bucket) => number;
}) {
  const max = Math.max(1, ...buckets.map(value));

  return (
    <div className="plou-card" data-testid={testId} style={{ display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2>
      {buckets.length === 0 ? (
        <EmptyState>{t('registre.empty')}</EmptyState>
      ) : (
        buckets.map((bucket) => (
          <div
            key={bucket.key}
            style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, fontSize: 12 }}
          >
            <span
              style={{ color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {label(bucket)}
            </span>
            <span
              style={{
                background: 'var(--ghost-bg)',
                borderRadius: 100,
                height: 12,
                alignSelf: 'center',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${String((value(bucket) / max) * 100)}%`,
                  height: '100%',
                  borderRadius: 100,
                  background: 'var(--gradient-brand-2stop)',
                }}
              />
            </span>
            <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {fmtMinutes(value(bucket))}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
