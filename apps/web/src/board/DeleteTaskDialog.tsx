import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@fem-ho/contracts';
import { api, failureText } from '../app/api.js';
import { useMutation } from '../app/useApi.js';

export function DeleteTaskDialog({
  task,
  onClose,
  onChanged,
}: {
  task: { id: string; title: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const remove = useMutation(async () => {
    await api.delete(`/api/v1/tasks/${task.id}`);
    onChanged();
    onClose();
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => dialog?.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="femho-delete-dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid="card-confirm-delete"
      onCancel={(event) => {
        event.preventDefault();
        if (!remove.busy) onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <h2 id={titleId}>{t('nav.delete')}</h2>
      <p id={descriptionId}>{t('task.deleteConfirm', { title: task.title })}</p>
      {remove.error !== undefined && <p role="alert">{failureText(remove.error)}</p>}
      <div className="femho-delete-dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          data-testid="card-delete-cancel"
          disabled={remove.busy}
          onClick={onClose}
        >
          {t('nav.cancel')}
        </button>
        <button
          type="button"
          data-testid="card-delete-confirm"
          disabled={remove.busy}
          onClick={() => void remove.run()}
        >
          {t('nav.delete')}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
