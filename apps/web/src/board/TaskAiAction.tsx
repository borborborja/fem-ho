import { useEffect, useRef, type PointerEvent } from 'react';
import { dateTime, getLocale, t } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api, ApiError } from '../app/api.js';
import {
  copyTaskAiContext,
  taskAiStatusLabel,
  useTaskAiSettings,
  type TaskAiExecution,
} from '../app/task-ai.js';
import { useToasts } from '../app/toasts.js';

export function TaskAiAction({
  taskId,
  scopeId,
  onDispatched,
  compact = false,
  disabled = false,
}: {
  taskId: string;
  scopeId: string;
  onDispatched?: (() => void) | undefined;
  compact?: boolean;
  disabled?: boolean;
}) {
  const settings = useTaskAiSettings();
  const { notify } = useToasts();
  const setting = settings?.data?.data.find((row) => row.scope_id === scopeId);
  const copying = useRef(false);
  const sending = useRef(false);
  const executionId = useRef<string | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);
  const clearPress = (): void => {
    if (press.current === null) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };

  useEffect(() => clearPress, []);

  if (setting?.enabled !== true) return null;

  const copy = async (): Promise<void> => {
    if (copying.current) return;
    copying.current = true;
    try {
      const fallback = await copyTaskAiContext(taskId);
      if (fallback === undefined) notify(t('ai.tasks.copyDone'));
      else settings?.showCopyFallback(fallback);
    } catch {
      notify(t('ai.tasks.copyError'), { tone: 'error' });
    } finally {
      copying.current = false;
    }
  };

  const start = async (): Promise<void> => {
    if (setting.method === 'copy') return copy();
    if (!setting.can_dispatch || !setting.ready) {
      notify(t(setting.can_dispatch ? 'ai.tasks.notReady' : 'ai.tasks.noDispatchPermission'), {
        tone: 'warning',
      });
      return;
    }
    if (sending.current) return;
    if (!navigator.onLine) {
      notify(t('error.unreachable'), { tone: 'error' });
      return;
    }

    sending.current = true;
    const id = (executionId.current ??= uuidv7());
    try {
      const result = await api.post<TaskAiExecution>(`/api/v1/tasks/${taskId}/ai-executions`, {
        id,
      });
      executionId.current = null;
      notify(taskAiStatusLabel(result.status, result.method) ?? t('ai.tasks.status.queued'));
      onDispatched?.();
    } catch (error) {
      // Si la resposta es perd, el següent clic recupera l'intent original amb el mateix ID.
      if (error instanceof ApiError && error.status < 500) executionId.current = null;
      settings?.reload();
      onDispatched?.();
      const retryAt =
        error instanceof ApiError && error.status === 429 ? error.problem?.params?.retry_at : null;
      if (typeof retryAt === 'string' && Number.isFinite(Date.parse(retryAt))) {
        notify(t('ai.tasks.retryAt', { when: dateTime(getLocale(), new Date(retryAt)) }), {
          tone: 'warning',
        });
      } else notify(t('ai.tasks.sendError'), { tone: 'error' });
    } finally {
      sending.current = false;
    }
  };

  const startPress = (event: PointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    clearPress();
    held.current = false;
    if (event.pointerType !== 'touch') return;
    const timer = window.setTimeout(() => {
      held.current = true;
      press.current = null;
      void copy();
    }, 550);
    press.current = { timer, x: event.clientX, y: event.clientY };
  };

  const actionLabel = t(setting.method === 'copy' ? 'ai.tasks.copy' : 'ai.tasks.send');
  const action = (
    <button
      ref={button}
      type="button"
      disabled={disabled}
      className={compact ? 'task-ai-rail-action' : 'plou-btn plou-btn-ghost'}
      data-testid="task-ai-action"
      title={actionLabel}
      aria-label={compact ? actionLabel : undefined}
      aria-keyshortcuts={compact ? 'Shift+F10 ContextMenu' : undefined}
      onKeyDown={(event) => {
        if (compact && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
          event.preventDefault();
          event.stopPropagation();
          clearPress();
          void copy();
        }
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail === 0 || !held.current) void start();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        clearPress();
        if (!held.current) void copy();
        held.current = true;
      }}
      onPointerDown={startPress}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      onPointerMove={(event) => {
        if (
          press.current !== null &&
          Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8
        )
          clearPress();
      }}
      style={compact ? undefined : { padding: '3px 8px', minHeight: 30 }}
    >
      {t('ai.tasks.button')}
    </button>
  );
  if (compact) return action;

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
      }}
      style={{ display: 'inline-flex', gap: 4, alignItems: 'flex-start', flexWrap: 'wrap' }}
    >
      {action}
      <details ref={menu} onPointerDown={(event) => event.stopPropagation()}>
        <summary
          aria-label={t('task.actions')}
          title={t('task.actions')}
          style={{
            cursor: 'pointer',
            listStyle: 'none',
            minHeight: 30,
            display: 'grid',
            placeItems: 'center',
            paddingInline: 7,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <circle cx="3" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="13" cy="8" r="1.25" />
          </svg>
        </summary>
        <button
          type="button"
          className="plou-btn plou-btn-ghost"
          data-testid="task-ai-copy"
          onClick={() => {
            if (menu.current) menu.current.open = false;
            button.current?.focus();
            void copy();
          }}
        >
          {t('ai.tasks.copy')}
        </button>
      </details>
    </div>
  );
}
