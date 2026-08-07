/**
 * Rebre un convit a un àmbit.
 *
 * **No és el mateix que `/invite/:token`**, que és un convit a la instància i et crea un
 * compte. Aquí ja en tens un: el que passa és que entres a l'àmbit d'algú altre.
 *
 * Es mira abans d'acceptar —qui convida i a què— perquè acceptar a cegues una cosa que
 * et dona accés a les dades d'una altra persona és exactament el gest que la gent es
 * penedeix d'haver fet.
 */

import { useEffect, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { api, ApiError } from '../app/api.js';
import { useSession } from '../app/session.js';

interface Preview {
  scope_name: string;
  role: string;
  invited_by: string;
}

export function JoinScopeScreen({ token }: { token: string }) {
  const { reload } = useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<Preview>(`/api/v1/join/${token}`)
      .then((data) => {
        if (alive) setPreview(data);
      })
      .catch(() => {
        if (alive) setError(t('join.invalid'));
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const accept = (): void => {
    setBusy(true);
    api
      .post(`/api/v1/join/${token}`)
      .then(async () => {
        // La sessió es recarrega perquè l'àmbit nou surti als xips de dalt sense que
        // calgui refrescar a mà.
        await reload();
        window.location.assign('/');
      })
      .catch((problem: unknown) => {
        setBusy(false);
        setError(problem instanceof ApiError ? problem.message : t('join.invalid'));
      });
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div
        data-testid="join-scope"
        style={{
          width: 'min(420px, 100%)',
          display: 'grid',
          gap: 12,
          padding: 24,
          borderRadius: 20,
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t('join.title')}</h1>

        {error === null ? null : (
          <p
            data-testid="join-error"
            style={{ margin: 0, fontSize: 13, color: 'var(--danger-text)' }}
          >
            {error}
          </p>
        )}

        {preview === null || error !== null ? null : (
          <>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)' }}>
              {t('join.subtitle', { who: preview.invited_by, scope: preview.scope_name })}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-faint)' }}>
              {t(`settings.role.${preview.role}`)}
            </p>
            <button
              type="button"
              className="plou-btn plou-btn-primary"
              data-testid="join-accept"
              disabled={busy}
              onClick={accept}
            >
              {t('join.accept')}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
