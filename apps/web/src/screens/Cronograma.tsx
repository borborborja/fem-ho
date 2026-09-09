import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t, getLocale, localDateOf } from '@fem-ho/contracts';
import { api } from '../app/api.js';
import { useSessionData } from '../app/session.js';
import { useToasts } from '../app/toasts.js';
import { fmtMinutes, type SessionEntry } from './RegistreScreen.js';
import { adjustInterval, inputInstant, snapTime, stackIntervals, STEP } from './chrono-time.js';
import { SessionTimeDialog, type TimeDraft } from './SessionTimeDialog.js';
interface Project {
  id: string;
  name: string;
  scope_id: string;
}
export interface CronogramaProps {
  entries: SessionEntry[];
  day: string;
  projects: Project[];
  writableScopeIds?: string[];
  onChanged: () => void;
  onOpenTask: (id: string) => void;
}
interface Lane {
  key: string;
  scopeId: string;
  projectId: string | null;
  label: string;
}
interface Preview {
  id: string;
  start: number;
  end: number | null;
  lane: string;
}
const GUTTER = 140;
const laneKey = (scope: string, project: string | null) => `${scope}/${project ?? 'none'}`;
export function Cronograma({
  entries,
  day,
  projects,
  writableScopeIds = [],
  onChanged,
  onOpenTask,
}: CronogramaProps) {
  const { profile, scopes } = useSessionData();
  const { notify } = useToasts();
  const viewport = useRef<HTMLDivElement>(null);
  const cleanup = useRef<() => void>(() => undefined);
  const [width, setWidth] = useState(900),
    [zoom, setZoom] = useState(1),
    [now, setNow] = useState(Date.now());
  const [extra, setExtra] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [draft, setDraft] = useState<TimeDraft | null>(null),
    [busy, setBusy] = useState<string | null>(null);
  const timezone = profile.timezone;
  const writable = writableScopeIds.length
    ? writableScopeIds
    : [...new Set(entries.filter((e) => e.can_edit).map((e) => e.scope_id))];
  const scopeIds = [...new Set([...writable, ...entries.map((e) => e.scope_id)])];
  const allLanes: Lane[] = scopeIds
    .flatMap((scopeId) => [
      { key: laneKey(scopeId, null), scopeId, projectId: null, label: t('registre.noProject') },
      ...projects
        .filter((p) => p.scope_id === scopeId)
        .map((p) => ({ key: laneKey(scopeId, p.id), scopeId, projectId: p.id, label: p.name })),
    ])
    .map((lane) => ({
      ...lane,
      label:
        scopeIds.length > 1
          ? `${scopes.find((s) => s.id === lane.scopeId)?.name ?? ''} · ${lane.label}`
          : lane.label,
    }));
  const items = entries
    .filter((entry) => localDateOf(timezone, new Date(entry.started_at)) === day)
    .map((entry) => ({
      entry,
      start: Date.parse(entry.started_at),
      end: entry.ended_at === null ? now : Date.parse(entry.ended_at),
    }));
  const visibleKeys = new Set([
    ...items.map((item) => laneKey(item.entry.scope_id, item.entry.project_id)),
    ...extra,
  ]);
  if (!visibleKeys.size) writable.forEach((scope) => visibleKeys.add(laneKey(scope, null)));
  const lanes = allLanes.filter((lane) => visibleKeys.has(lane.key));
  const axisStart = Math.min(
    inputInstant(day + 'T08:00', timezone),
    ...items.map((item) => item.start),
  );
  const axisEnd = Math.max(
    inputInstant(day + 'T18:00', timezone),
    ...items.map((item) => item.end),
  );
  const scale = Math.max(0.45, (width - GUTTER - 16) / ((axisEnd - axisStart) / 60000)) * zoom;
  const trackWidth = ((axisEnd - axisStart) / 60000) * scale;
  const timeLabel = (at: number) =>
    new Intl.DateTimeFormat(getLocale(), {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'shortOffset',
      ...(localDateOf(timezone, new Date(at)) !== day
        ? { month: '2-digit' as const, day: '2-digit' as const }
        : {}),
    }).format(at);
  const intervalLabel = (start: number, end: number | null) =>
    `${timeLabel(start)} — ${end === null ? t('chrono.running') : timeLabel(end)} · ${fmtMinutes(Math.max(0, Math.round(((end ?? now) - start) / 60000)))}`;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => () => cleanup.current(), []);
  useEffect(() => {
    cleanup.current();
    setPreview(null);
    setExtra([]);
    setDraft(null);
  }, [day, timezone, projects.map((p) => p.id).join(',')]);
  async function save(entry: SessionEntry, start: number, end: number | null) {
    setBusy(entry.id);
    setPreview({ id: entry.id, start, end, lane: laneKey(entry.scope_id, entry.project_id) });
    try {
      await api.patch(`/api/v1/sessions/${entry.id}`, {
        started_at: new Date(start).toISOString(),
        ...(end === null ? {} : { ended_at: new Date(end).toISOString() }),
        expected_version: entry.version,
      });
      onChanged();
    } catch {
      notify(t('chrono.saveError'), { tone: 'error' });
      onChanged();
    } finally {
      setBusy(null);
      setPreview(null);
    }
  }
  function gesture(
    event: ReactPointerEvent<HTMLElement>,
    lane: Lane,
    entry?: SessionEntry,
    mode: 'move' | 'left' | 'right' = 'move',
  ) {
    if (
      event.button !== 0 ||
      busy ||
      (entry ? !entry.can_edit : !writable.includes(lane.scopeId)) ||
      (entry?.open && mode === 'right')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const x0 = event.clientX,
      y0 = event.clientY,
      scroll0 = viewport.current?.scrollLeft ?? 0;
    const rect = entry ? null : target.getBoundingClientRect();
    const start = entry
      ? Date.parse(entry.started_at)
      : snapTime(axisStart + ((x0 - rect!.left) / scale) * 60000);
    const end = entry
      ? entry.ended_at === null
        ? null
        : Date.parse(entry.ended_at)
      : start + 30 * 60000;
    let latest: Preview = { id: entry?.id ?? 'new', start, end, lane: lane.key };
    let moved = false;
    const deltaX = (e: PointerEvent) =>
      e.clientX - x0 + (viewport.current?.scrollLeft ?? 0) - scroll0;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = deltaX(e);
      moved ||= Math.abs(dx) > 3 || Math.abs(e.clientY - y0) > 3;
      if (!moved) return;
      let interval;
      if (entry) interval = adjustInterval(start, end, (dx / scale) * 60000, mode, now);
      else {
        const other = snapTime(start + (dx / scale) * 60000);
        interval = {
          start: Math.min(start, other),
          end: Math.max(start + STEP, other, start === other ? start + STEP : start),
        };
        if (other < start) interval.end = start;
      }
      const hit = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((el) => el instanceof HTMLElement && el.dataset.chronoLane)
        ?.getAttribute('data-chrono-lane');
      const destination =
        entry && mode === 'move'
          ? allLanes.find((l) => l.key === hit && l.scopeId === entry.scope_id)
          : lane;
      latest = { id: entry?.id ?? 'new', ...interval, lane: destination?.key ?? lane.key };
      setPreview(latest);
    };
    const cancel = () => {
      cleanup.current();
      setPreview(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      move(e);
      cleanup.current();
      setPreview(null);
      if (!entry) {
        setDraft({
          scopeId: lane.scopeId,
          projectId: lane.projectId,
          start: latest.start,
          end: latest.end,
        });
        return;
      }
      if (!moved) {
        if (mode === 'move')
          setDraft({ scopeId: entry.scope_id, projectId: entry.project_id, start, end, entry });
        return;
      }
      const hit = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((el) => el instanceof HTMLElement && el.dataset.chronoLane)
        ?.getAttribute('data-chrono-lane');
      const destination = allLanes.find((l) => l.key === hit);
      if (mode === 'move' && (!destination || destination.scopeId !== entry.scope_id)) {
        notify(t('chrono.sameScope'));
        return;
      }
      if (latest.lane !== lane.key) {
        setDraft({
          scopeId: entry.scope_id,
          projectId: destination!.projectId,
          start: latest.start,
          end: latest.end,
          entry,
        });
        return;
      }
      if (latest.start !== start || latest.end !== end) void save(entry, latest.start, latest.end);
    };
    const lost = () => cancel();
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      target.removeEventListener('lostpointercapture', lost);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      cleanup.current = () => undefined;
    };
    cleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    target.addEventListener('lostpointercapture', lost);
  }
  const ticks = [];
  const tickStep = Math.max(60, Math.ceil(80 / (scale * 60)) * 60) * 60000;
  for (let at = axisStart; at <= axisEnd; at += tickStep) ticks.push(at);
  return (
    <div className="chrono-shell">
      <div className="chrono-actions">
        <span>{t('registre.chrono.zoom')}</span>
        <button
          type="button"
          className="plou-btn"
          data-testid="chrono-zoom-out"
          aria-label={t('chrono.zoomOut')}
          onClick={() => setZoom((z) => Math.max(1, z / 1.4))}
        >
          −
        </button>
        <button
          type="button"
          className="plou-btn"
          data-testid="chrono-zoom-fit"
          onClick={() => setZoom(1)}
        >
          {t('registre.chrono.fit')}
        </button>
        <button
          type="button"
          className="plou-btn"
          data-testid="chrono-zoom-in"
          aria-label={t('chrono.zoomIn')}
          onClick={() => setZoom((z) => Math.min(6, z * 1.4))}
        >
          +
        </button>
      </div>
      <p>{t('chrono.hint')}</p>
      <div className="chrono-viewport" ref={viewport} data-testid="chrono">
        <div style={{ width: GUTTER + trackWidth + 16 }}>
          <div className="chrono-row">
            <div className="chrono-gutter" style={{ width: GUTTER }} />
            <div className="chrono-axis" style={{ width: trackWidth }}>
              {ticks.map((at) => (
                <span
                  key={at}
                  style={{
                    left: ((at - axisStart) / 60000) * scale,
                    transform: at === axisEnd ? 'translateX(-100%)' : undefined,
                  }}
                >
                  {timeLabel(at)}
                </span>
              ))}
            </div>
          </div>
          {lanes.map((lane) => {
            const stacked = stackIntervals(
              items.filter(
                (item) => laneKey(item.entry.scope_id, item.entry.project_id) === lane.key,
              ),
            );
            const height = Math.max(1, ...stacked.map((item) => item.row + 1)) * 44 + 10;
            return (
              <div
                key={lane.key}
                className="chrono-row"
                data-testid={`chrono-lane-${lane.projectId ?? 'none'}`}
              >
                <div className="chrono-gutter" style={{ width: GUTTER }}>
                  <span>{lane.label}</span>
                  {writable.includes(lane.scopeId) && (
                    <button
                      type="button"
                      className="chrono-add"
                      disabled={!!busy}
                      aria-label={`${t('chrono.add')} · ${lane.label}`}
                      onClick={() =>
                        setDraft({
                          scopeId: lane.scopeId,
                          projectId: lane.projectId,
                          start: inputInstant(day + 'T09:00', timezone),
                          end: inputInstant(day + 'T09:30', timezone),
                        })
                      }
                    >
                      +
                    </button>
                  )}
                </div>
                <div
                  className="chrono-track"
                  data-chrono-lane={lane.key}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) gesture(e, lane);
                  }}
                  style={{
                    width: trackWidth,
                    height,
                    backgroundSize: `${scale * 60}px 100%`,
                    outline: preview?.lane === lane.key ? '2px dashed var(--kicker)' : undefined,
                  }}
                >
                  {stacked.map(({ entry, start, end, row }) => {
                    const shown =
                      preview?.id === entry.id
                        ? preview
                        : { start, end: entry.ended_at === null ? null : end };
                    return (
                      <div
                        key={entry.id}
                        className="chrono-block"
                        data-testid={`chrono-block-${entry.id}`}
                        data-editable={entry.can_edit ? 'true' : 'false'}
                        aria-busy={busy === entry.id}
                        title={`${entry.task_title} · ${intervalLabel(shown.start, shown.end)}`}
                        style={{
                          left: ((shown.start - axisStart) / 60000) * scale,
                          width: Math.max(18, (((shown.end ?? now) - shown.start) / 60000) * scale),
                          top: 6 + row * 44,
                          borderColor: entry.task_type_color
                            ? `var(${entry.task_type_color})`
                            : undefined,
                          opacity: busy === entry.id ? 0.6 : 1,
                        }}
                        onPointerDown={(e) => gesture(e, lane, entry)}
                      >
                        <span
                          className="chrono-handle chrono-handle-left"
                          data-testid={`chrono-resize-left-${entry.id}`}
                          onPointerDown={(e) => gesture(e, lane, entry, 'left')}
                        />
                        <button
                          type="button"
                          className="chrono-title"
                          aria-label={`${t('chrono.edit')} · ${entry.task_title}`}
                          onClick={(e) => {
                            if (!entry.can_edit) {
                              onOpenTask(entry.task_id);
                              return;
                            }
                            if (e.detail === 0)
                              setDraft({
                                scopeId: entry.scope_id,
                                projectId: entry.project_id,
                                start,
                                end: entry.ended_at === null ? null : end,
                                entry,
                              });
                          }}
                        >
                          {entry.task_title} ·{' '}
                          {fmtMinutes(
                            Math.max(0, Math.round(((shown.end ?? now) - shown.start) / 60000)),
                          )}
                          {entry.open ? ' · ' + t('chrono.running') : ''}
                        </button>
                        {!entry.open && (
                          <span
                            className="chrono-handle chrono-handle-right"
                            data-testid={`chrono-resize-right-${entry.id}`}
                            onPointerDown={(e) => gesture(e, lane, entry, 'right')}
                          />
                        )}
                      </div>
                    );
                  })}
                  {preview?.id === 'new' && preview.lane === lane.key && (
                    <div
                      className="chrono-ghost"
                      style={{
                        left: ((preview.start - axisStart) / 60000) * scale,
                        width: Math.max(
                          18,
                          (((preview.end ?? now) - preview.start) / 60000) * scale,
                        ),
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {preview && <p role="status">{intervalLabel(preview.start, preview.end)}</p>}
      {writable.length > 0 && (
        <label>
          {t('registre.chrono.addLane')}
          <select
            className="plou-input"
            data-testid="chrono-add-lane"
            value=""
            onChange={(e) => {
              if (e.target.value) setExtra((list) => [...list, e.target.value]);
            }}
          >
            <option value="">{t('registre.chrono.addLane')}</option>
            {allLanes
              .filter((lane) => writable.includes(lane.scopeId) && !visibleKeys.has(lane.key))
              .map((lane) => (
                <option key={lane.key} value={lane.key}>
                  {lane.label}
                </option>
              ))}
          </select>
        </label>
      )}
      {draft && (
        <SessionTimeDialog
          key={draft.entry?.id ?? draft.start}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={onChanged}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  );
}
