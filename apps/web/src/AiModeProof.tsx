/**
 * Pàgina de prova del mode d'IA i l'historial (M11).
 *
 * Porta el que `docs/09` §3 i §7 demanen a una pantalla que es pot comparar amb el
 * prototip: el distintiu que **cicla amb un clic**, el punt de canvi autònom no vist, i
 * l'`ActivityTimeline` amb "Desfés".
 */

import { useMemo, useState } from 'react';
import { t } from '@fem-ho/contracts';
import {
  ActivityTimeline,
  AiModeBadge,
  UnseenAiDot,
  type ActivityEntryView,
  type ActorFilter,
  type AiMode,
} from '@fem-ho/design-system/femho';

/** L'ordre en què cicla el distintiu quan s'hi fa clic (docs/09 §2). */
const CICLE: AiMode[] = ['manual', 'assisted', 'delegated'];

const HISTORIAL_INICIAL: ActivityEntryView[] = [
  {
    id: 'e1',
    verb: 'created',
    actor_type: 'user',
    actor_label: 'Borja',
    changes: null,
    created_at: '2026-08-03T09:00:00.000Z',
  },
  {
    id: 'e2',
    verb: 'updated',
    actor_type: 'ai_agent',
    actor_label: 'IA · Claude',
    changes: { due_date: { from: '2026-08-15', to: '2026-08-22' } },
    created_at: '2026-08-06T08:00:00.000Z',
    undoable: true,
  },
  {
    id: 'e3',
    verb: 'commented',
    actor_type: 'guest',
    actor_label: 'Extern · Marta',
    changes: null,
    created_at: '2026-08-06T08:30:00.000Z',
  },
];

export function AiModeProof(): React.JSX.Element {
  const [mode, setMode] = useState<AiMode>('manual');
  const [unseen, setUnseen] = useState(true);
  const [leased, setLeased] = useState(false);
  const [filter, setFilter] = useState<ActorFilter>('all');
  const [entries, setEntries] = useState(HISTORIAL_INICIAL);

  const labels = useMemo(
    () => ({
      filters: {
        all: t('activity.filter.all'),
        ai: t('activity.filter.ai'),
        human: t('activity.filter.human'),
      },
      verbs: Object.fromEntries(
        ['created', 'updated', 'moved', 'completed', 'commented', 'claimed', 'released'].map(
          (verb) => [verb, t(`activity.verb.${verb}`)],
        ),
      ),
      undo: t('activity.undo'),
    }),
    [],
  );

  const visibles = entries.filter((entry) =>
    filter === 'all'
      ? true
      : filter === 'ai'
        ? entry.actor_type === 'ai_agent'
        : entry.actor_type === 'user',
  );

  /**
   * Desfer **no esborra res**: hi afegeix el canvi invers i treu el botó de l'original
   * (docs/09 §7). Aquí es fa en local perquè la pàgina de prova no té servidor, però la
   * forma és la mateixa que fa `POST /activity/{id}/undo`.
   */
  const desfes = (entryId: string): void => {
    setEntries((abans) => {
      const original = abans.find((entry) => entry.id === entryId);
      if (original?.changes == null) return abans;

      const invers: ActivityEntryView = {
        id: `${entryId}-undo`,
        verb: 'updated',
        actor_type: 'user',
        actor_label: 'Borja',
        changes: Object.fromEntries(
          Object.entries(original.changes).map(([field, change]) => [
            field,
            { from: change.to, to: change.from },
          ]),
        ),
        created_at: new Date().toISOString(),
      };

      return [
        ...abans.map((entry) => (entry.id === entryId ? { ...entry, undoable: false } : entry)),
        invers,
      ];
    });
  };

  return (
    <main style={{ padding: 24, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      <h1 style={{ font: 'var(--font-h1)' }}>{t('ai.mode.cycle')}</h1>

      <div
        data-testid="task-card"
        style={{
          position: 'relative',
          background: 'var(--card-bg)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 16,
          maxWidth: 360,
          marginBottom: 24,
        }}
      >
        {unseen && <UnseenAiDot label={t('ai.unseen')} />}
        <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{t('ai.proof.taskTitle')}</p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            data-testid="cycle-mode"
            aria-label={t('ai.mode.cycle')}
            data-mode={mode}
            onClick={() => setMode(CICLE[(CICLE.indexOf(mode) + 1) % CICLE.length]!)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
          >
            <AiModeBadge mode={mode} label={t(`ai.mode.${mode}`)} leased={leased} />
            {/* `manual` no pinta res: cal alguna cosa clicable perquè es pugui ciclar. */}
            {mode === 'manual' && (
              <span data-testid="mode-manual" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                {t('ai.mode.manual')}
              </span>
            )}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button type="button" data-testid="open-task" onClick={() => setUnseen(false)}>
          {t('ai.proof.openTask')}
        </button>
        <button type="button" data-testid="toggle-lease" onClick={() => setLeased(!leased)}>
          {t('ai.proof.toggleLease')}
        </button>
      </div>

      <ActivityTimeline
        entries={visibles}
        labels={labels}
        filter={filter}
        onFilterChange={setFilter}
        onUndo={desfes}
        formatTime={(iso) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ')}
      />
    </main>
  );
}
