import { useEffect, useRef, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { ChecklistRow, useTitleHold } from '@fem-ho/design-system/femho';
import { failureText } from '../app/api.js';
import { useToasts } from '../app/toasts.js';
import type { Subtask } from '../app/types.js';
import { ConfirmDeleteDialog } from './DeleteTaskDialog.js';

export function SubtaskRow({
  subtask,
  onUpdate,
  onDelete,
  compact = false,
}: {
  subtask: Subtask;
  onUpdate: (base: Subtask, change: { title?: string; done?: boolean }) => Promise<void>;
  onDelete: () => Promise<void>;
  compact?: boolean;
}) {
  const { notify } = useToasts();
  const [draft, setDraft] = useState<{ base: Subtask; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const editing = draft !== null;
  const wasEditing = useRef(false);
  const title = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);

  function edit() {
    setInvalid(false);
    setDraft({ base: subtask, title: subtask.title });
  }
  const { titleProps } = useTitleHold(edit);

  useEffect(() => {
    if (wasEditing.current && !editing) title.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function showError(error: unknown) {
    notify(failureText(error), { tone: 'error' });
  }

  async function save() {
    if (draft === null || busy) return;
    const value = draft.title.trim();
    if (!value) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      if (value !== draft.base.title) await onUpdate(draft.base, { title: value });
      setDraft(null);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ChecklistRow
      className="subtask-row"
      data-testid="subtask-row"
      text={subtask.title}
      done={subtask.done}
      style={compact ? { padding: 0 } : undefined}
      toggleLabel={t('checklist.toggleItem', { text: subtask.title })}
      onToggle={() => void onUpdate(subtask, { done: !subtask.done }).catch(showError)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      titleContent={
        draft === null ? (
          <span
            {...titleProps}
            ref={title}
            className="subtask-title"
            data-testid="subtask-title"
            tabIndex={0}
            title={t('task.titleEditHint')}
            onKeyDown={(event) => {
              if (event.key === 'F2') {
                event.preventDefault();
                edit();
              }
            }}
          >
            {subtask.title}
          </span>
        ) : (
          <div className="subtask-editor">
            <textarea
              autoFocus
              rows={2}
              className="plou-input"
              data-testid="subtask-title-input"
              aria-label={t('task.title')}
              aria-invalid={invalid}
              value={draft.title}
              readOnly={busy}
              onFocus={(event) => event.target.select()}
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
                setInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Escape' && !busy) {
                  event.preventDefault();
                  setDraft(null);
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            {invalid && <span role="alert">{t('task.titleRequired')}</span>}
            <div className="subtask-editor-actions">
              <button type="button" disabled={busy} onClick={() => setDraft(null)}>
                {t('nav.cancel')}
              </button>
              <button type="button" disabled={busy} onClick={() => void save()}>
                {t('nav.save')}
              </button>
            </div>
          </div>
        )
      }
      actions={
        <>
          {!editing && (
            <>
              <div className="subtask-hover-actions">
                <button
                  type="button"
                  aria-label={t('subtask.edit')}
                  title={t('subtask.edit')}
                  onClick={edit}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={t('subtask.delete')}
                  title={t('subtask.delete')}
                  onClick={() => setDeleting(true)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                  </svg>
                </button>
              </div>
              <details ref={menu} className="subtask-menu">
                <summary aria-label={t('subtask.actions')} title={t('subtask.actions')}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="3" cy="8" r="1.25" />
                    <circle cx="8" cy="8" r="1.25" />
                    <circle cx="13" cy="8" r="1.25" />
                  </svg>
                </summary>
                <button type="button" onClick={edit}>
                  {t('subtask.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    menu.current?.querySelector('summary')?.focus();
                    if (menu.current) menu.current.open = false;
                    setDeleting(true);
                  }}
                >
                  {t('subtask.delete')}
                </button>
              </details>
            </>
          )}
          {deleting && (
            <ConfirmDeleteDialog
              prompt={t('subtask.deleteConfirm', { title: subtask.title })}
              onClose={() => {
                setDeleting(false);
                requestAnimationFrame(() => title.current?.focus());
              }}
              onDelete={onDelete}
            />
          )}
        </>
      }
    />
  );
}
