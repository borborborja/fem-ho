/**
 * Lectura de dades amb estat de càrrega, error i revalidació.
 *
 * Mínim a posta, com el router i l'i18n. El que docs/02 §12 demana és concret i petit:
 * **es fa servir el contingut anterior amb `opacity:0.6` mentre es revalida**, res
 * d'esquelets brillants —el design system prohibeix el shimmer—, i una banda d'error
 * discreta amb botó de reintentar.
 *
 * El que NO fa, i és deliberat: memòria cau compartida entre components. Això ja ho fa
 * `sync/`, amb Dexie i la cua de sortida (docs/06). Dues memòries cau del mateix serien
 * dues fonts de veritat i el dia que discrepessin ningú sabria quina mana.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api.js';

export interface QueryResult<T> {
  data: T | undefined;
  error: Error | undefined;
  /** Cert la primera vegada; en les següents es manté `data` i es baixa l'opacitat. */
  loading: boolean;
  /** Cert mentre es revalida amb dades anteriors a la pantalla. */
  revalidating: boolean;
  reload: () => void;
}

export function useApi<T>(path: string | null, deps: unknown[] = []): QueryResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(path !== null);
  const [revalidating, setRevalidating] = useState(false);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    if (hasData.current) setRevalidating(true);
    else setLoading(true);

    api
      .get<T>(path, controller.signal)
      .then((result) => {
        hasData.current = true;
        setData(result);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        // Una petició cancel·lada per desmuntatge no és un error de l'usuari: no ha de
        // pintar cap banda vermella.
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setRevalidating(false);
      });

    return () => {
      controller.abort();
    };
  }, [path, tick, ...deps]);

  const reload = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  return { data, error, loading, revalidating, reload };
}

/**
 * Una mutació amb estat.
 *
 * Torna `run`, que engoleix l'error i el deixa a `error` en comptes de llançar-lo: una
 * promesa rebutjada dins d'un `onClick` acaba a la consola i enlloc més, i l'usuari es
 * queda mirant un botó que no ha fet res.
 */
export function useMutation<A extends unknown[], T>(
  action: (...args: A) => Promise<T>,
): {
  run: (...args: A) => Promise<T | undefined>;
  busy: boolean;
  error: ApiError | Error | undefined;
  reset: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | undefined>(undefined);

  const run = useCallback(
    async (...args: A): Promise<T | undefined> => {
      setBusy(true);
      setError(undefined);
      try {
        return await action(...args);
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [action],
  );

  return { run, busy, error, reset: () => setError(undefined) };
}
