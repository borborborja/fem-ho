/**
 * Prova visual del tauler, als dos temes.
 *
 * És l'equivalent de `TokenProof` per a M5: existeix perquè el port del prototip es
 * pugui **comparar amb la captura del prototip** en comptes de donar-lo per bo, que és
 * la comprovació que el pla afegeix a cada fita d'UI.
 */

import { t } from '@fem-ho/contracts';
import { KanbanBoard } from './board/KanbanBoard.js';
import { SAMPLE_SCOPES, SAMPLE_TASKS } from './board/fixtures.js';

function Surface({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div
      data-theme={theme}
      data-accent="default"
      data-testid={`board-${theme}`}
      style={{
        background: 'var(--page-bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
        padding: 28,
        borderRadius: 24,
        marginBottom: 24,
      }}
    >
      {/* Amplada màxima 1360px, centrada, amb 28px de padding lateral (docs/02 §1). */}
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>
        <KanbanBoard
          tasks={SAMPLE_TASKS}
          scopes={SAMPLE_SCOPES}
          doneHeaderActions={
            <span style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 100,
                  background: 'var(--ghost-bg)',
                  color: 'var(--ink-soft)',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {t('board.done.showAllToday')}
              </button>
              <button
                type="button"
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 100,
                  background: 'var(--ghost-bg)',
                  color: 'var(--danger-text)',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {t('board.done.clear')}
              </button>
            </span>
          }
        />
      </div>
    </div>
  );
}

export function BoardProof() {
  return (
    <div
      data-theme="light"
      data-accent="default"
      style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
        fontFamily: 'var(--font-sans)',
        padding: 20,
      }}
    >
      <Surface theme="light" />
      <Surface theme="dark" />
    </div>
  );
}
