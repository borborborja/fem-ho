/**
 * Prova de l'afegida ràpida.
 *
 * Munta el camp amb el mateix context que els fixtures compartits, perquè el que es
 * comprova al navegador i el que es comprova a `quickadd.test.ts` siguin la mateixa
 * cosa vista des de dos costats.
 */

import { useState } from 'react';
import type { QuickAddContext } from '@fem-ho/contracts';
import { QuickAdd } from './board/QuickAdd.js';

const CONTEXT: QuickAddContext = {
  scopes: [
    { id: 'scope-personal', name: 'Personal', projects: [{ id: 'proj-casa', name: 'Casa' }] },
    {
      id: 'scope-feina',
      name: 'Feina',
      projects: [
        { id: 'proj-client', name: 'Client' },
        { id: 'proj-client-salt', name: 'Client Salt' },
      ],
    },
    { id: 'scope-familia', name: 'Família', projects: [] },
  ],
  people: [
    { id: 'user-alba', name: 'Alba' },
    { id: 'user-borja', name: 'Borja' },
  ],
  activeScopeIds: ['scope-personal', 'scope-feina', 'scope-familia'],
};

const COLORS: Record<string, string> = {
  'scope-personal': 'var(--plou-blue)',
  'scope-feina': 'var(--plou-orange)',
  'scope-familia': 'var(--plou-pink)',
};

interface Created {
  title: string;
  scopeId: string;
  projectId: string | null;
  assigneeIds: string[];
  aiMode: string;
}

export function QuickAddProof() {
  const [created, setCreated] = useState<Created[]>([]);

  return (
    <div
      data-theme="light"
      data-accent="default"
      style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-sans)',
        padding: 28,
      }}
    >
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <QuickAdd
          context={CONTEXT}
          columnLabel="Inbox"
          scopeColors={COLORS}
          onCreate={(task) => setCreated((current) => [...current, task])}
        />

        <ul data-testid="created" style={{ marginTop: 24, padding: 0, listStyle: 'none' }}>
          {created.map((task, index) => (
            <li
              key={index}
              data-testid={`created-${index}`}
              data-title={task.title}
              data-scope={task.scopeId}
              data-project={task.projectId ?? ''}
              data-assignees={task.assigneeIds.join(',')}
              data-ai-mode={task.aiMode}
              style={{ fontSize: 13, padding: '4px 0', color: 'var(--ink-soft)' }}
            >
              {task.title}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
