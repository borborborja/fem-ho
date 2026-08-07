/**
 * La cara d'una persona: la seva foto si en té, i les inicials si no.
 *
 * **Les inicials són el cas normal, no el pla B.** Fem-ho és autoallotjat i la majoria de
 * la gent d'una casa no té Gravatar; per això el component es dibuixa sencer amb inicials i
 * la foto només s'hi posa a sobre quan de debò existeix. Fer-ho al revés —un `<img>` amb
 * `onError`— ensenya un forat mentre carrega i un altre quan falla.
 *
 * La foto ve de `/api/v1/users/:id/avatar`, que és **el nostre servidor**: si l'instància
 * no té Gravatar encès, si la persona ha dit que no, o si no en té, respon 404 i aquí no
 * es nota res.
 */

import { useEffect, useState } from 'react';

export interface AvatarProps {
  userId: string;
  name: string;
  size?: number;
  /** Perquè el cercle de la barra superior segueixi tenint el seu contorn. */
  style?: React.CSSProperties;
}

/** Fins a dues inicials: més, i a 30px no es llegeix res. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/u)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * Les que ja sabem que no en tenen.
 *
 * Sense això, un tauler amb la mateixa persona a vint targetes demanaria vint vegades la
 * mateixa foto en carregar la pàgina. El servidor ja se les guarda al disc, però la
 * petició igualment es faria.
 */
const known = new Map<string, string | null>();

export function Avatar({ userId, name, size = 38, style }: AvatarProps): React.ReactElement {
  const [src, setSrc] = useState<string | null>(() => known.get(userId) ?? null);

  useEffect(() => {
    if (known.has(userId)) {
      setSrc(known.get(userId) ?? null);
      return;
    }

    let alive = true;
    const url = `/api/v1/users/${userId}/avatar`;
    // Es demana amb `HEAD`? No: el navegador ha de tenir la imatge a la seva memòria cau
    // igualment, i una petició que no la guarda seria fer-ne dues.
    fetch(url, { headers: authHeader() })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        const resolved = blob === null ? null : URL.createObjectURL(blob);
        known.set(userId, resolved);
        if (alive) setSrc(resolved);
      })
      .catch(() => {
        // Sense connexió, inicials. No és un error que hagi de veure ningú.
        known.set(userId, null);
      });

    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <span
      aria-hidden="true"
      data-testid={`avatar-${userId}`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-grid',
        placeItems: 'center',
        overflow: 'hidden',
        background: 'var(--tag-bg)',
        color: 'var(--ink)',
        fontSize: Math.round(size / 2.9),
        fontWeight: 700,
        ...style,
      }}
    >
      {src === null ? (
        initialsOf(name)
      ) : (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </span>
  );
}

/**
 * El token, per a un `fetch` que no passa pel client d'API.
 *
 * Va a part perquè aquest component es dibuixa **molt** —cada targeta, cada membre— i
 * arrossegar-hi el client sencer per una capçalera no val la pena. Si algun dia hi ha una
 * segona cosa així, es fusiona.
 */
function authHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem('femho.tokens');
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token === undefined
      ? {}
      : { authorization: `Bearer ${parsed.access_token}` };
  } catch {
    return {};
  }
}
