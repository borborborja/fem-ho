import React from 'react';

/**
 * ActivityTimeline — l'historial amb els actors barrejats (docs/09 §7).
 *
 * ```
 * Borja           ha creat la tasca                      fa 3 dies
 * IA · Claude     ha canviat el deadline  15 ag → 22 ag  fa 1 h   [Desfés]
 * Extern · Marta  ha marcat "Cables"                     fa 30 min
 * ```
 *
 * Tres detalls que compten, i els tres són aquí:
 *
 * 1. **Els actors es distingeixen visualment**: humans amb avatar d'inicials, IA amb la
 *    icona `sparkles`, externs amb `link`.
 * 2. **Els canvis de camp ensenyen el valor anterior i el nou.** Per això
 *    `activity_log.changes` guarda `{camp: {from, to}}`.
 * 3. **Els canvis autònoms porten "Desfés"**, que crea un canvi invers. **No s'esborra
 *    res de l'historial.**
 *
 * Cap text en català viu aquí: tot arriba per props des del catàleg (regla 3), perquè
 * Android ha de poder fer servir el mateix component amb el seu `strings.xml`.
 */
export function ActivityTimeline({
  entries,
  labels,
  filter = 'all',
  onFilterChange,
  onUndo,
  formatTime,
  style,
  ...rest
}) {
  return (
    <section style={{ fontFamily: 'var(--font-sans)', ...style }} {...rest}>
      <header style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['all', 'ai', 'human'].map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`filter-${option}`}
            aria-pressed={filter === option}
            onClick={() => onFilterChange?.(option)}
            style={{
              border: 'none',
              cursor: 'pointer',
              borderRadius: 100,
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: filter === option ? 700 : 500,
              background: filter === option ? 'var(--ghost-bg-hover)' : 'transparent',
              color: filter === option ? 'var(--text-primary)' : 'var(--ink-soft)',
            }}
          >
            {labels.filters[option]}
          </button>
        ))}
      </header>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-testid={`activity-${entry.id}`}
            data-actor={entry.actor_type}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}
          >
            <ActorMark entry={entry} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{entry.actor_label}</span>{' '}
              <span style={{ color: 'var(--ink-soft)' }}>
                {labels.verbs[entry.verb] ?? entry.verb}
              </span>
              <Changes changes={entry.changes} />
            </div>

            <time
              dateTime={entry.created_at}
              style={{ color: 'var(--ink-soft)', fontSize: 12, whiteSpace: 'nowrap' }}
            >
              {formatTime(entry.created_at)}
            </time>

            {entry.undoable === true && (
              <button
                type="button"
                data-testid={`undo-${entry.id}`}
                onClick={() => onUndo?.(entry.id)}
                style={{
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  borderRadius: 6,
                  padding: '2px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {labels.undo}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * El valor anterior i el nou, camp a camp.
 *
 * `15 ag → 22 ag`. Sense el valor anterior, una línia d'historial diu que alguna cosa
 * va canviar però no de què a què, que és justament el que algú mira l'historial per
 * saber.
 */
function Changes({ changes }) {
  if (changes === null || changes === undefined) return null;

  const camps = Object.entries(changes).filter(([, change]) => change.from !== change.to);
  if (camps.length === 0) return null;

  return (
    <span style={{ marginLeft: 8, color: 'var(--ink-soft)', fontSize: 12 }}>
      {camps.map(([field, change]) => (
        <span key={field} data-field={field} style={{ marginRight: 8 }}>
          <s>{format(change.from)}</s> → <strong>{format(change.to)}</strong>
        </span>
      ))}
    </span>
  );
}

function format(value) {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Humans amb inicials, IA amb `sparkles`, externs amb `link`. */
function ActorMark({ entry }) {
  const base = {
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 700,
  };

  if (entry.actor_type === 'ai_agent') {
    return (
      <span
        data-testid="actor-ai"
        style={{ ...base, background: 'var(--gradient-wash-tag)', color: 'var(--text-primary)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        </svg>
      </span>
    );
  }

  if (entry.actor_type === 'guest' || entry.actor_type === 'caldav') {
    return (
      <span
        data-testid="actor-external"
        style={{ ...base, background: 'var(--ghost-bg)', color: 'var(--ink-soft)' }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5" />
          <path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.5-1.5" />
        </svg>
      </span>
    );
  }

  return (
    <span
      data-testid="actor-human"
      style={{ ...base, background: 'var(--ghost-bg-hover)', color: 'var(--text-primary)' }}
    >
      {initials(entry.actor_label)}
    </span>
  );
}

function initials(label) {
  if (typeof label !== 'string' || label.trim() === '') return '?';
  return label
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}
