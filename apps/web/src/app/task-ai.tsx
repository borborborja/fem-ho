import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t, type components, type operations } from '@fem-ho/contracts';
import { api, currentSessionEpoch } from './api.js';
import { useRouter } from './router.js';
import { useSessionData } from './session.js';
import { useApi } from './useApi.js';

export type TaskAiMethod = components['schemas']['TaskAiMethod'];
export type TaskAiSetting = components['schemas']['TaskAiSettings'];
export type TaskAiSettingsInput = components['schemas']['TaskAiSettingsInput'];
export type TaskAiExecution = components['schemas']['TaskAiExecution'];
export type TaskAiConnections =
  operations['listTaskAiConnections']['responses'][200]['content']['application/json'];
type TaskAiContextText =
  operations['getTaskAiContext']['responses'][200]['content']['application/json'];

const taskAiMethodKeys = {
  copy: 'ai.tasks.method.copy',
  mcp_events: 'ai.tasks.method.mcpEvents',
  claude_routine: 'ai.tasks.method.claudeRoutine',
} as const;

export function taskAiMethodLabel(method: TaskAiMethod): string {
  return t(taskAiMethodKeys[method]);
}

export function taskAiStatusLabel(status: string, method: string): string | undefined {
  switch (status) {
    case 'delivered':
      return t(
        method === 'claude_routine'
          ? 'ai.tasks.status.claudeDelivered'
          : 'ai.tasks.status.mcpDelivered',
      );
    case 'queued':
      return t('ai.tasks.status.queued');
    case 'sending':
      return t('ai.tasks.status.sending');
    case 'failed':
      return t('ai.tasks.status.failed');
    case 'cancelled':
      return t('ai.tasks.status.cancelled');
    case 'uncertain':
      return t('ai.tasks.status.uncertain');
    default:
      return undefined;
  }
}

function useSettingsQuery() {
  const { scopes } = useSessionData();
  const { route } = useRouter();
  return useApi<operations['listTaskAiSettings']['responses'][200]['content']['application/json']>(
    '/api/v1/ai/task-settings',
    [
      scopes.map((scope) => scope.id).join(','),
      route.query.get('scopes'),
      route.path === '/settings',
    ],
  );
}

const TaskAiContext = createContext<
  | (ReturnType<typeof useSettingsQuery> & {
      showCopyFallback: (text: string) => void;
    })
  | null
>(null);

export function useTaskAiSettings() {
  return useContext(TaskAiContext);
}

export function TaskAiProvider({ children }: { children: ReactNode }) {
  const query = useSettingsQuery();
  const { reload } = query;
  const [fallback, setFallback] = useState<string | null>(null);

  useEffect(() => {
    window.addEventListener('focus', reload);
    window.addEventListener('online', reload);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('online', reload);
    };
  }, [reload]);

  return (
    <TaskAiContext.Provider value={{ ...query, showCopyFallback: setFallback }}>
      {children}
      {fallback !== null ? (
        <CopyFallback text={fallback} onClose={() => setFallback(null)} />
      ) : null}
    </TaskAiContext.Provider>
  );
}

function CopyFallback({ text, onClose }: { text: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const selection = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Un diàleg natiu va per sobre de la fitxa i torna el focus al botó que l'ha obert.
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    selection.current?.select();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="task-ai-context-title"
      data-testid="ai-context-fallback"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        width: 'min(36rem, calc(100% - 2rem))',
        color: 'var(--ink)',
        background: 'var(--panel-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--radius-card)',
        padding: 18,
      }}
    >
      <h2 id="task-ai-context-title" style={{ margin: 0 }}>
        {t('ai.tasks.copyFallbackTitle')}
      </h2>
      <p>{t('ai.tasks.copyFallback')}</p>
      <textarea
        className="plou-input"
        ref={selection}
        aria-label={t('ai.tasks.copyFallbackTitle')}
        value={text}
        rows={10}
        readOnly
        style={{ display: 'block', width: '100%', marginBottom: 14 }}
      />
      <button type="button" className="plou-btn" onClick={() => dialog.current?.close()}>
        {t('nav.close')}
      </button>
    </dialog>
  );
}

export async function copyTaskAiContext(taskId: string): Promise<string | undefined> {
  const epoch = currentSessionEpoch();
  const context = api
    .get<TaskAiContextText>(`/api/v1/tasks/${taskId}/ai-context`)
    .then((result) => {
      if (currentSessionEpoch() !== epoch) throw new DOMException('Session changed.', 'AbortError');
      return result;
    });
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      // WebKit vol començar l'escriptura dins del gest, encara que el text trigui a arribar.
      const content = context.then(({ text }) => new Blob([text], { type: 'text/plain' }));
      void content.catch(() => undefined);
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': content })]);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText((await context).text);
    } else {
      return (await context).text;
    }
    return undefined;
  } catch {
    return (await context).text;
  }
}
