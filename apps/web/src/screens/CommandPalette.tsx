/**
 * La paleta d'ordres. docs/02 §11 (`Cmd/Ctrl+K`).
 *
 * Fa dues coses i cap més: **anar a un lloc** i **obrir una tasca**. Una paleta que ho
 * fa tot —crear, esborrar, canviar preferències— acaba sent un menú amb cerca que ningú
 * recorda, i la gràcia és que amb tres tecles arribis on vas.
 *
 * Les destinacions surten sempre; les tasques, a partir de dos caràcters, i les demana
 * el servidor amb la mateixa normalització catalana que la cerca (docs/01 §11).
 */

import { useEffect, useRef, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { useApi } from '../app/useApi.js';
import type { TaskPage } from '../app/types.js';

export interface Destination {
  id: string;
  label: string;
  href: string;
}

export interface CommandPaletteProps {
  destinations: Destination[];
  onNavigate: (href: string) => void;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}

export function CommandPalette({
  destinations,
  onNavigate,
  onOpenTask,
  onClose,
}: CommandPaletteProps) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useApi<TaskPage>(
    query.length >= 2 ? `/api/v1/search?q=${encodeURIComponent(query)}&limit=8` : null,
  );

  const fold = (value: string): string =>
    value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/gu, '');

  const places = destinations.filter(
    (place) => text === '' || fold(place.label).includes(fold(text)),
  );
  const tasks = results.data?.data ?? [];
  const total = places.length + tasks.length;

  const run = (index: number): void => {
    const place = places[index];
    if (place !== undefined) {
      onNavigate(place.href);
      onClose();
      return;
    }
    const task = tasks[index - places.length];
    if (task !== undefined) {
      onOpenTask(task.id);
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="command-palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'grid',
        placeItems: 'start center',
        paddingTop: '12vh',
        background: 'var(--scrim)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          /**
           * `--panel-bg` i no `--card-bg`.
           *
           * En tema fosc, `--card-bg` és un vel blanc del 6%: està fet per posar-se
           * **damunt d'una superfície opaca**, no per ser-ne una. Com a fons d'un
           * diàleg deixava veure el tauler a través i l'editor no es podia fer servir.
           * `--panel-bg` és opac als dos temes, i és el que el disseny validat hi posa.
           */
          background: 'var(--panel-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-dialog)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={input}
          value={text}
          data-testid="palette-input"
          placeholder={t('palette.placeholder')}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => (total === 0 ? 0 : (current + 1) % total));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => (total === 0 ? 0 : (current - 1 + total) % total));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              run(active);
            }
            // `Escape` la tanca **aquí i no al gestor global**: el global no s'activa
            // mentre el focus és en un camp de text, que és exactament on és ara.
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: 'inherit',
            fontSize: 15,
            padding: '16px 18px',
            color: 'var(--ink)',
            boxSizing: 'border-box',
          }}
        />

        <div style={{ maxHeight: 340, overflowY: 'auto', borderTop: '1px solid var(--card-border)' }}>
          {total === 0 ? (
            <p style={{ margin: 0, padding: 16, fontSize: 12.5, color: 'var(--ink-faint)' }}>
              {t('palette.empty')}
            </p>
          ) : null}

          {[
            { title: t('palette.go'), rows: places.map((p) => ({ id: p.id, label: p.label })) },
            { title: t('palette.tasks'), rows: tasks.map((task) => ({ id: task.id, label: task.title })) },
          ].map((group, groupIndex) =>
            group.rows.length === 0 ? null : (
              <div key={group.title}>
                <p
                  style={{
                    margin: 0,
                    padding: '10px 16px 4px',
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-faint)',
                  }}
                >
                  {group.title}
                </p>
                {group.rows.map((row, rowIndex) => {
                  const index = groupIndex === 0 ? rowIndex : places.length + rowIndex;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      data-testid={`palette-item-${row.id}`}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        run(index);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 16px',
                        border: 'none',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 13,
                        color: 'var(--ink)',
                        background: index === active ? 'var(--ghost-bg)' : 'transparent',
                      }}
                    >
                      {row.label}
                    </button>
                  );
                })}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
