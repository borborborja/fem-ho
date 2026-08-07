/**
 * Els adjunts d'una tasca o d'un esdeveniment.
 *
 * Un sol component per als dos casos perquè el servidor n'hi té un: el que canvia és la
 * ruta pare. Extret des del primer moment —i no dins del modal— perquè el detall d'un
 * esdeveniment compartit també els ha d'ensenyar, i era exactament el retall que
 * `docs/14` P4 diu que acaba en dues còpies que divergeixen.
 *
 * **El contingut no s'incrusta mai.** Es baixa per l'enllaç, que és el que fa el handler
 * amb `Content-Disposition: attachment` i `nosniff`; posar un `<img>` o un `<iframe>` amb
 * un fitxer de qualsevol seria desfer per la porta del davant el que `docs/10` §8 tanca.
 */

import { useRef, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { EmptyState } from '@fem-ho/design-system/femho';
import { api, ApiError } from './api.js';
import { useApi } from './useApi.js';

export interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  source: string;
  external_url: string | null;
}

/** `1,2 MB` en comptes de `1258291`, que no diu res a ningú. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'GB'}`;
}

export interface AttachmentsProps {
  /** `tasks` o `events`. */
  parent: 'tasks' | 'events';
  parentId: string;
  /** Un receptor que només mira no hi pot ni afegir ni treure res. */
  readOnly?: boolean;
  label: (text: string) => React.ReactNode;
}

export function Attachments({
  parent,
  parentId,
  readOnly = false,
  label,
}: AttachmentsProps): React.ReactElement {
  const list = useApi<Attachment[]>(`/api/v1/${parent}/${parentId}/attachments`);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = list.data ?? [];

  /**
   * Baixar-lo és **agafar-lo amb el token i clicar un `blob:`**, no navegar-hi.
   *
   * Un `<a href="/api/v1/attachments/…">` sembla la manera òbvia i no funciona: la sessió
   * és a `localStorage` i va a `Authorization`, i una navegació del navegador no en porta
   * res —el servidor respon 401 i l'usuari es queda mirant un fitxer que no baixa. Es va
   * veure a la prova de navegador, no a cap prova de servidor.
   */
  async function download(id: string, filename: string): Promise<void> {
    try {
      const blob = await api.download(`/api/v1/attachments/${id}/content`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      // Sense això, el blob es queda a memòria fins que es recarregui la pàgina.
      URL.revokeObjectURL(url);
    } catch (problem: unknown) {
      setError(problem instanceof ApiError ? problem.message : t('task.empty.attachments'));
    }
  }

  return (
    <section style={{ display: 'grid', gap: 6 }} data-testid="task-attachments">
      {label(t('task.attachments'))}

      {rows.length === 0 ? (
        <EmptyState>{t('task.empty.attachments')}</EmptyState>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}
          >
            {/*
              Un `ATTACH` que era una URI no té bytes aquí: se n'ensenya l'enllaç a
              l'origen i s'hi diu, perquè "baixar" i "anar a un web de tercers" no són
              el mateix i l'usuari ho ha de saber abans de clicar.
            */}
            {row.external_url !== null ? (
              <a
                href={row.external_url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: 'var(--brand-ink)', textDecoration: 'none', fontWeight: 600 }}
              >
                {row.filename}
              </a>
            ) : (
              <button
                type="button"
                data-testid={`attachment-${row.id}`}
                onClick={() => {
                  void download(row.id, row.filename);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--brand-ink)',
                  fontWeight: 600,
                  font: 'inherit',
                }}
              >
                {row.filename}
              </button>
            )}
            <span style={{ color: 'var(--ink-soft)' }}>
              {row.external_url === null ? humanSize(row.size_bytes) : t('task.attachmentLink')}
            </span>
            {!readOnly && (
              <button
                type="button"
                className="plou-btn plou-btn-ghost"
                aria-label={t('task.removeAttachment')}
                onClick={() => {
                  void api.delete(`/api/v1/attachments/${row.id}`).then(() => {
                    list.reload();
                  });
                }}
              >
                ×
              </button>
            )}
          </div>
        ))
      )}

      {error !== null && (
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger-text)' }}>
          {error}
        </div>
      )}

      {!readOnly && (
        <>
          <input
            ref={input}
            type="file"
            data-testid="attachment-input"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // El valor es buida sempre perquè triar dos cops el mateix fitxer —després
              // d'un error— torni a disparar l'esdeveniment.
              event.target.value = '';
              if (file === undefined) return;

              setBusy(true);
              setError(null);
              void api
                .upload<Attachment>(`/api/v1/${parent}/${parentId}/attachments`, file)
                .then(() => {
                  list.reload();
                })
                .catch((problem: unknown) => {
                  setError(
                    problem instanceof ApiError ? problem.message : t('task.empty.attachments'),
                  );
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          />
          <button
            type="button"
            className="plou-btn"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {t('task.addAttachment')}
          </button>
        </>
      )}
    </section>
  );
}
