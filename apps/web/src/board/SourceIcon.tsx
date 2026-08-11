/**
 * D'on ve una cosa: una icona petita a les targetes de la bústia i al calendari.
 *
 * Amb una sola font externa n'hi havia prou amb el context —tot el que no era teu venia
 * d'un calendari—, però amb calendaris, `.ics`, canals RSS i, aviat, correu, «d'on ha
 * sortit això?» passa a ser una pregunta que la pantalla ha de respondre sense obrir res.
 *
 * TRES REGLES QUE NO SÓN DECORACIÓ
 * --------------------------------
 * **Mai una icona sola.** Porta `title` i `aria-label` del catàleg. Una icona sense nom és
 * informació que només tenen els qui ja la coneixen, i aquí la icona ÉS la informació.
 *
 * **`currentColor`.** És la lliçó de l'emoji `📅` que hi havia a la columna Fet: el que no
 * hereta el color no segueix el tema, i acaba sent l'única cosa de la fila que es veu
 * diferent a cada plataforma.
 *
 * **`--ink-soft` i no `--ink-faint`.** `docs/04` §8 reserva el segon per a text decoratiu i
 * marcadors de posició, i diu que Fem-ho no l'ha de fer servir per a res que calgui
 * llegir. Això cal llegir-ho.
 *
 * I una mena desconeguda —un servidor més nou que aquest client— **no pinta res i no
 * peta**: val més una targeta sense icona que una pantalla en blanc.
 */

import { t, type SourceKind } from '@fem-ho/contracts';

/** Un `.ics` publicat o un CalDAV: un calendari, en tots dos casos. */
function CalendarGlyph() {
  return (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  );
}

/** Les ones de sempre. És el dibuix que la gent ja associa a un canal. */
function RssGlyph() {
  return (
    <>
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1.5" />
    </>
  );
}

/** El sobre. La forma que ningú ha de desxifrar. */
function MailGlyph() {
  return (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  );
}

/**
 * Que sigui un `Record` sobre `SourceKind` i no un objecte solt és el que fa que **afegir
 * una mena al vocabulari no compili fins que té dibuix**. Quan `mail` va entrar a
 * `SOURCE_KINDS`, aquesta línia és la que ho va dir.
 */
const GLYPHS: Record<SourceKind, () => React.JSX.Element> = {
  caldav: CalendarGlyph,
  ical: CalendarGlyph,
  rss: RssGlyph,
  mail: MailGlyph,
};

export interface SourceIconProps {
  kind: SourceKind | null | undefined;
  size?: number;
}

export function SourceIcon({ kind, size = 12 }: SourceIconProps) {
  // Sense provinença no hi ha icona: la tasca l'has escrita tu, i dir-ho seria soroll a
  // totes les targetes del tauler.
  if (kind == null) return null;

  const Glyph = GLYPHS[kind] as (() => React.JSX.Element) | undefined;
  if (Glyph === undefined) return null;

  const label = t(`source.${kind}`);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      data-testid={`source-icon-${kind}`}
      style={{ color: 'var(--ink-soft)', flexShrink: 0 }}
    >
      <title>{label}</title>
      <Glyph />
    </svg>
  );
}
