/**
 * Cerca. docs/05 §4 (`GET /search`), docs/02 §11 (la drecera `/`).
 *
 * **La normalització la fa el servidor**, amb la mateixa funció que va generar
 * `search_text` (docs/01 §11). Aquí no es toca el text: normalitzar-lo al client seria
 * tenir-ne dues implementacions i divergirien justament en les paraules per a les quals
 * existeix — "col·legi", "Barça", "l'aigua".
 */

import { useEffect, useRef, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { EmptyState, TaskCard } from '@fem-ho/design-system/femho';
import { useSessionData } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import type { TaskPage } from '../app/types.js';
import { ErrorBanner } from './BoardScreen.js';

export interface SearchScreenProps {
  onOpenTask: (id: string) => void;
}

export function SearchScreen({ onOpenTask }: SearchScreenProps) {
  const { scopes } = useSessionData();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  /**
   * Es consulta 250 ms després de la darrera tecla.
   *
   * Sense l'espera, escriure "col·legi" són vuit peticions i set respostes que ningú
   * llegirà; i com que arriben desordenades, la penúltima pot pintar-se després de
   * l'última i ensenyar resultats d'una consulta que ja no hi és.
   */
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useApi<TaskPage>(
    query.length >= 2 ? `/api/v1/search?q=${encodeURIComponent(query)}` : null,
  );

  const tasks = results.data?.data ?? [];

  return (
    <div
      data-testid="search-screen"
      style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 14 }}
    >
      <input
        ref={input}
        className="plou-input"
        data-testid="search-input"
        value={text}
        placeholder={t('nav.search')}
        onChange={(event) => setText(event.target.value)}
      />

      {results.error !== undefined ? <ErrorBanner onRetry={results.reload} /> : null}

      <div style={{ display: 'grid', gap: 9, opacity: results.revalidating ? 0.6 : 1 }}>
        {query.length >= 2 && tasks.length === 0 && !results.loading ? (
          <EmptyState>{t('state.empty.search')}</EmptyState>
        ) : null}

        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            title={task.title}
            // La pastilla d'àmbit a cada resultat: aquí es barregen tots.
            project={scopes.find((scope) => scope.id === task.scope_id)?.name}
            time={task.due_time ?? undefined}
            aiMode={task.ai_mode}
            done={task.status === 'done'}
            onOpen={() => onOpenTask(task.id)}
                />
        ))}
      </div>
    </div>
  );
}
