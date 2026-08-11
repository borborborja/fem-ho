/**
 * La icona de calendari, **una i compartida**.
 *
 * La fan servir la capçalera de la columna Fet i la de la bústia. Duplicar-la voldria dir
 * que el dia que se'n canviï el traç, una de les dues es quedi enrere — i ningú ho notaria
 * fins a posar les dues columnes de costat.
 *
 * Era un emoji `📅`. Un emoji no és una icona: el dibuixa la font del sistema, canvia de
 * forma i de color a cada plataforma, **no hereta `currentColor`** i per tant no segueix
 * el tema.
 */
export function CalendarIcon({ size = 14 }: { size?: number }) {
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
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}
