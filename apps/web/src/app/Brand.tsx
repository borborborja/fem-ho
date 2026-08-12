/**
 * La marca de la instància: el logo si n'hi ha, i el nom si no.
 *
 * `Fem-ho` estava escrit a mà a tres pantalles —la barra, el registre i la capçalera
 * d'Ajustos— mentre `FEMHO_INSTANCE_NAME` existia des del primer dia i es publicava a
 * `/info`. Una instància que es diu «Acme Tasques» es deia «Fem-ho» a tot arreu menys en
 * un lloc.
 *
 * **El nom porta el gradient i el logo no.** El gradient de marca és de Fem-ho; aplicar-lo
 * a la imatge d'algú altre seria tenyir-li el logo. Amb imatge, es respecta tal com és.
 *
 * L'`alt` és el nom de la instància i no «logo»: qui no veu la imatge vol saber **on és**,
 * no que allò era una imatge.
 */

import { useSessionData } from './session.js';

export interface BrandProps {
  /** Alçada del logo i mida del text. La barra en fa 24; el login, més. */
  size?: number;
}

export function Brand({ size = 24 }: BrandProps) {
  const { instance } = useSessionData();
  return <BrandMark name={instance.name} logoUrl={instance.logo_url ?? null} size={size} />;
}

/**
 * La versió sense sessió, per al login i el registre.
 *
 * Allà `/info` es demana a part —encara no hi ha sessió que el porti— i per això rep les
 * dades en comptes d'anar-les a buscar.
 */
export function BrandMark({
  name,
  logoUrl,
  size = 24,
}: {
  name: string;
  logoUrl: string | null;
  size?: number;
}) {
  if (logoUrl !== null && logoUrl !== '') {
    return (
      <img
        src={logoUrl}
        alt={name}
        data-testid="brand-logo"
        style={{ height: size, width: 'auto', maxWidth: 220, display: 'block' }}
      />
    );
  }

  return (
    <span
      data-testid="brand-name"
      style={{
        fontSize: size,
        fontWeight: 900,
        fontFamily: 'var(--font-sans)',
        whiteSpace: 'nowrap',
        backgroundImage: 'var(--gradient-brand-text)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }}
    >
      {name}
    </span>
  );
}
