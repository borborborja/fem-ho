import { useEffect, useRef, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { api, failureText } from '../app/api.js';
import { useToasts } from '../app/toasts.js';

/** Només envia el títol: editar-lo no ha de sobreescriure la resta de la fitxa. */
export function useInlineTaskTitle(id: string, title: string, onChanged: () => void) {
  const { notify } = useToasts();
  const [displayTitle, setDisplayTitle] = useState(title);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const saving = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => setDisplayTitle(title), [title]);

  async function save() {
    if (draft === null || saving.current || cancelled.current) return;
    const value = draft.trim();
    if (!value) {
      setInvalid(true);
      return;
    }
    if (value === displayTitle) {
      setDraft(null);
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      await api.patch(`/api/v1/tasks/${id}`, { title: value });
      setDisplayTitle(value);
      setDraft(null);
      onChanged();
    } catch (cause) {
      notify(failureText(cause), { tone: 'error' });
      // El text es conserva perquè es pugui reintentar quan torni la connexió.
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return {
    title: displayTitle,
    start: () => {
      cancelled.current = false;
      setInvalid(false);
      setDraft(displayTitle);
    },
    editor:
      draft === null ? undefined : (
        <div
          className="card-title-editor"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <textarea
            autoFocus
            rows={2}
            className="plou-input"
            data-testid="card-title-input"
            aria-label={t('task.title')}
            aria-invalid={invalid}
            title={t('task.titleEditKeys')}
            value={draft}
            readOnly={busy}
            aria-busy={busy}
            onFocus={(event) => event.target.select()}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
            onBlur={() => {
              void save();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape' && !saving.current) {
                event.preventDefault();
                cancelled.current = true;
                setDraft(null);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
          {invalid && <span role="alert">{t('task.titleRequired')}</span>}
        </div>
      ),
  };
}
