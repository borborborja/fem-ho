/**
 * El cronograma del Registre: un dia, una fila per projecte, i els blocs a la seva hora.
 *
 * **Existeix per veure els forats.** La taula diu quantes hores hi ha; això diu **on són**, i
 * per tant on no n'hi ha: dimarts a la tarda, dues hores que no són enlloc; un bloc que es va
 * quedar obert tota la nit; dues coses apuntades a la mateixa franja.
 *
 * **S'edita arrossegant**, que és l'única manera raonable de corregir una hora: moure el bloc
 * el canvia d'hora, arrossegar-ne una vora l'allarga, i deixar-lo a una altra fila **canvia
 * el projecte de la tasca**. Tot s'ajusta a cinc minuts —el ratolí no té precisió de segons—
 * i el desat és una sola petició quan es deixa anar, no una a cada píxel.
 *
 * **Els solapaments es veuen, no s'impedeixen.** Dues persones poden treballar alhora a la
 * mateixa tasca, i una persona pot tenir raons per apuntar dues coses seguides. Prohibir-ho
 * seria decidir per algú que sap què fa; ensenyar-ho és el que li permet adonar-se'n.
 */

import { useEffect, useRef, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { api } from '../app/api.js';
import { fmtMinutes, localDay, localTime, type SessionEntry } from './RegistreScreen.js';

/** L'ajust, en minuts. El mateix que fa servir el servidor en desar. */
const SNAP = 5;
/** La jornada que es veu sempre, encara que no hi hagi res. */
const OBRE = 8 * 60;
const TANCA = 18 * 60;
/** L'amplada de la columna dels noms. */
const GUTTER = 130;

interface Project {
  id: string;
  name: string;
  scope_id: string;
}

export interface CronogramaProps {
  entries: SessionEntry[];
  day: string;
  projects: Project[];
  onChanged: () => void;
  onOpenTask: (id: string) => void;
}

/** Minuts des de mitjanit local d'un instant. */
function minutsDe(instant: string): number {
  const d = new Date(instant);
  return d.getHours() * 60 + d.getMinutes();
}

function snap(minuts: number): number {
  return Math.round(minuts / SNAP) * SNAP;
}

/** L'instant d'un minut del dia que es mira. */
function instantDe(day: string, minuts: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  at.setMinutes(minuts);
  return at.toISOString();
}

export function Cronograma({ entries, day, projects, onChanged, onOpenTask }: CronogramaProps) {
  const pista = useRef<HTMLDivElement>(null);
  const [ample, setAmple] = useState(900);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  /**
   * L'escala es recalcula amb l'amplada real perquè **el dia càpiga sense desplaçament
   * horitzontal**: un cronograma que s'ha de desplaçar per veure la tarda no serveix per
   * veure els forats, que és per al que existeix.
   */
  useEffect(() => {
    const node = pista.current;
    if (node === null) return undefined;
    const observer = new ResizeObserver(() => setAmple(node.clientWidth));
    observer.observe(node);
    setAmple(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  const delDia = entries.filter((entry) => localDay(entry.started_at) === day);

  // L'eix cobreix la jornada, i s'eixampla si hi ha feina a fora: el que va passar mana per
  // sobre de l'horari.
  let inici = OBRE;
  let fi = TANCA;
  for (const entry of delDia) {
    inici = Math.min(inici, Math.floor(minutsDe(entry.started_at) / 60) * 60);
    const acaba =
      entry.ended_at === null ? minutsDe(new Date().toISOString()) : minutsDe(entry.ended_at);
    fi = Math.max(fi, Math.ceil(acaba / 60) * 60);
  }
  const span = Math.max(60, fi - inici);
  const px = ((ample - GUTTER) * zoom) / span;

  /** Les files: els projectes amb feina aquell dia, i «Intern» per a les que no en tenen. */
  const claus = [...new Set(delDia.map((entry) => entry.project_id ?? 'none'))];
  const [extra, setExtra] = useState<string[]>([]);
  const files = [...new Set([...claus, ...extra])].sort((a, b) => {
    if (a === 'none') return 1;
    if (b === 'none') return -1;
    return nom(a).localeCompare(nom(b));
  });

  function nom(key: string): string {
    if (key === 'none') return t('registre.noProject');
    return projects.find((project) => project.id === key)?.name ?? key;
  }

  /** Desa el que s'ha arrossegat. Una petició, en deixar anar. */
  const desa = (id: string, body: Record<string, unknown>): void => {
    setError(null);
    void api
      .patch(`/api/v1/sessions/${id}`, body)
      .then(onChanged)
      .catch(() => setError(t('error.generic')));
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{t('registre.chrono.zoom')}</span>
        <button
          type="button"
          className="plou-btn plou-btn-ghost"
          data-testid="chrono-zoom-out"
          style={{ fontSize: 12 }}
          onClick={() => setZoom((value) => Math.max(1, value / 1.4))}
        >
          −
        </button>
        <button
          type="button"
          className="plou-btn plou-btn-ghost"
          data-testid="chrono-zoom-fit"
          style={{ fontSize: 12 }}
          onClick={() => setZoom(1)}
        >
          {t('registre.chrono.fit')}
        </button>
        <button
          type="button"
          className="plou-btn plou-btn-ghost"
          data-testid="chrono-zoom-in"
          style={{ fontSize: 12 }}
          onClick={() => setZoom((value) => Math.min(6, value * 1.4))}
        >
          +
        </button>
        {error === null ? null : (
          <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{error}</span>
        )}
      </div>

      <div ref={pista} data-testid="chrono" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: GUTTER + span * px }}>
          {/* L'eix d'hores. */}
          <div style={{ display: 'flex', paddingLeft: GUTTER }}>
            {Array.from({ length: Math.ceil(span / 60) + 1 }, (_, i) => (
              <span
                key={i}
                style={{
                  width: 60 * px,
                  fontSize: 11,
                  color: 'var(--ink-faint)',
                  flexShrink: 0,
                }}
              >
                {String(Math.floor((inici + i * 60) / 60)).padStart(2, '0')}h
              </span>
            ))}
          </div>

          {files.map((key) => (
            <div
              key={key}
              data-testid={`chrono-lane-${key}`}
              data-project={key}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                borderTop: '1px solid var(--divider-soft)',
              }}
            >
              <span
                style={{
                  width: GUTTER,
                  flexShrink: 0,
                  padding: '10px 8px',
                  fontSize: 12.5,
                  color: 'var(--ink-soft)',
                }}
              >
                {nom(key)}
              </span>
              <div
                style={{
                  position: 'relative',
                  height: 44,
                  flex: 1,
                  background:
                    'repeating-linear-gradient(90deg, var(--divider-soft) 0 1px, transparent 1px ' +
                    `${String(60 * px)}px)`,
                }}
              >
                {delDia
                  .filter((entry) => (entry.project_id ?? 'none') === key)
                  .map((entry) => (
                    <Bloc
                      key={entry.id}
                      entry={entry}
                      inici={inici}
                      px={px}
                      day={day}
                      onOpenTask={onOpenTask}
                      onDesa={desa}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
        Una fila buida on deixar-hi un bloc. Serveix per moure feina a un projecte que aquell
        dia no en té: sense la fila no hi ha on deixar-la anar.
      */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          className="plou-input"
          data-testid="chrono-add-lane"
          value=""
          onChange={(event) => {
            if (event.target.value !== '') setExtra((current) => [...current, event.target.value]);
          }}
          style={{ width: 'auto', fontSize: 12 }}
        >
          <option value="">{t('registre.chrono.addLane')}</option>
          {['none', ...projects.map((project) => project.id)]
            .filter((key) => !files.includes(key))
            .map((key) => (
              <option key={key} value={key}>
                {nom(key)}
              </option>
            ))}
        </select>
        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
          {t('registre.chrono.hint')}
        </span>
      </div>
    </div>
  );
}

/**
 * Un bloc. Es mou i s'allarga amb el punter.
 *
 * Mentre s'arrossega només es toca el CSS: desar a cada moviment serien desenes de peticions
 * per a un gest que encara no ha acabat. El desat és un de sol, en deixar anar.
 */
function Bloc({
  entry,
  inici,
  px,
  day,
  onOpenTask,
  onDesa,
}: {
  entry: SessionEntry;
  inici: number;
  px: number;
  day: string;
  onOpenTask: (id: string) => void;
  onDesa: (id: string, body: Record<string, unknown>) => void;
}) {
  const desde = minutsDe(entry.started_at);
  const fins = entry.ended_at === null ? desde + entry.minutes : minutsDe(entry.ended_at);
  const [drag, setDrag] = useState<{ dx: number; mode: 'move' | 'left' | 'right' } | null>(null);

  const left = (desde - inici) * px;
  const width = Math.max(6, (fins - desde) * px);

  const onPointerDown = (
    event: React.PointerEvent<Element>,
    mode: 'move' | 'left' | 'right',
  ): void => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    setDrag({ dx: 0, mode });
    const x0 = event.clientX;

    const move = (e: PointerEvent): void => setDrag({ dx: e.clientX - x0, mode });
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);

      const delta = snap((e.clientX - x0) / px);
      // Menys de tres píxels és un clic, no un arrossegament: obre la tasca.
      if (Math.abs(e.clientX - x0) < 3) {
        onOpenTask(entry.task_id);
        return;
      }
      if (delta === 0) return;

      if (mode === 'move') {
        onDesa(entry.id, {
          started_at: instantDe(day, desde + delta),
          ended_at: instantDe(day, fins + delta),
        });
      } else if (mode === 'left') {
        onDesa(entry.id, { started_at: instantDe(day, Math.min(desde + delta, fins - SNAP)) });
      } else {
        onDesa(entry.id, { ended_at: instantDe(day, Math.max(fins + delta, desde + SNAP)) });
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const desplaçat = drag === null ? 0 : drag.mode === 'move' ? drag.dx : 0;
  const ampleExtra =
    drag === null ? 0 : drag.mode === 'right' ? drag.dx : drag.mode === 'left' ? -drag.dx : 0;

  return (
    <div
      data-testid={`chrono-block-${entry.id}`}
      title={`${entry.task_title} · ${localTime(entry.started_at)} · ${fmtMinutes(entry.minutes)}`}
      onPointerDown={(event) => onPointerDown(event, 'move')}
      style={{
        position: 'absolute',
        top: 6,
        height: 32,
        left: left + desplaçat - (drag?.mode === 'left' ? -drag.dx : 0),
        width: width + ampleExtra,
        borderRadius: 8,
        // Les hores extres, destacades: és el que fa que es vegi que la tarda es va allargar.
        background: entry.overtime_minutes > 0 ? 'var(--gradient-wash-warm)' : 'var(--ghost-bg)',
        border:
          entry.overtime_minutes > 0
            ? '1px solid var(--plou-orange)'
            : '1px solid var(--card-border)',
        color: 'var(--ink)',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 6px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <span
        data-testid={`chrono-resize-left-${entry.id}`}
        onPointerDown={(event) => onPointerDown(event, 'left')}
        style={{ width: 6, height: '100%', cursor: 'ew-resize', flexShrink: 0 }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {entry.task_title} · {fmtMinutes(entry.minutes)}
      </span>
      <span
        data-testid={`chrono-resize-right-${entry.id}`}
        onPointerDown={(event) => onPointerDown(event, 'right')}
        style={{ width: 6, height: '100%', cursor: 'ew-resize', marginLeft: 'auto', flexShrink: 0 }}
      />
    </div>
  );
}
