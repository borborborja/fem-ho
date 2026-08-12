/**
 * El que diu la instància, **abans que hi hagi sessió**.
 *
 * El login i el registre necessiten dues coses de `/info`: si la instància accepta altes i
 * com es diu (o quin logo té). Fins ara el login se'l demanava per llegir-ne només el
 * registre, i el nom estava escrit a mà a totes dues pantalles.
 *
 * Un `fetch` cru i no `useApi`: aquell posa la capçalera d'autenticació i renova el token
 * si cal, i aquí no n'hi ha cap. `/info` és públic per definició —Android també el fa
 * servir per validar la URL del servidor abans de demanar credencials (docs/03 §2).
 */

import { useEffect, useState } from 'react';
import type { Info } from './types.js';

export function usePublicInfo(): Info | null {
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/info')
      .then(async (res) => (res.ok ? ((await res.json()) as Info) : null))
      .then((data) => {
        if (alive) setInfo(data);
      })
      .catch(() => {
        // Sense `/info` no se sap res: es queda a `null` i qui el fa servir decideix què
        // ensenyar. El que no pot passar és que la pantalla d'entrar no es pinti.
      });
    return () => {
      alive = false;
    };
  }, []);

  return info;
}
