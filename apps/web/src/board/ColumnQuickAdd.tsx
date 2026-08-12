/**
 * L'afegida ràpida al peu d'una columna, amb el botó d'edició completa.
 *
 * `docs/02` §4: "Camp de text al peu de cada columna". El botó rodó del costat és del
 * disseny validat i resol un buit real: l'afegida ràpida només posa títol, àmbit i
 * persona, i quan el que vols és posar-hi data, descripció o una llista, abans havies de
 * crear-la i tornar-la a obrir.
 */

import { t, type QuickAddContext, type TaskStatus } from '@fem-ho/contracts';
import { QuickAdd } from './QuickAdd.js';

export interface ColumnQuickAddProps {
  status: TaskStatus;
  context: QuickAddContext;
  scopes: { id: string; color: string }[];
  onCreate: (task: {
    title: string;
    scopeId: string;
    projectId: string | null;
    assigneeIds: string[];
    aiMode: 'manual' | 'assisted' | 'delegated';
    /** La tipologia escrita amb `$`, si l'àmbit en fa servir. */
    taskTypeId: string | null;
  }) => void;
  onFullEdit: () => void;
}

export function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function ColumnQuickAdd({
  status,
  context,
  scopes,
  onCreate,
  onFullEdit,
}: ColumnQuickAddProps) {
  return (
    <div
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10 }}
      data-testid={`quick-add-${status}`}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <QuickAdd
          context={context}
          columnLabel={t(`board.column.${status}`)}
          scopeColors={Object.fromEntries(scopes.map((scope) => [scope.id, `var(${scope.color})`]))}
          onCreate={onCreate}
        />
      </div>
      <button
        type="button"
        data-testid={`full-edit-${status}`}
        title={t('board.fullEdit')}
        aria-label={t('board.fullEdit')}
        onClick={onFullEdit}
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: 'none',
          background: 'var(--tag-bg)',
          color: 'var(--ink-soft)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
