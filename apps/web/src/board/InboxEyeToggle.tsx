/**
 * L'ull: si això és a la teva llista de feina o només al calendari.
 *
 * **UN SOL CONTROL PER A LES QUATRE MENES**
 * -----------------------------------------
 * Cites, titulars d'RSS i correus fan tots la mateixa pregunta —«vull veure això a l'inbox
 * de Tasques?»— i fins ara la responien de maneres diferents: un botó que deia «Treure» a
 * les cites i un altre que deia dues coses segons l'estat als correus. El de les cites, a
 * més, **sortia igual quan l'esdeveniment ja estava amagat**, i llavors no feia res de
 * visible: era una porta que ja era tancada i que et deixava tornar-la a tancar.
 *
 * **L'ICONA DIU ON ETS, NO ON ANIRÀS**
 * ------------------------------------
 * Ull obert = això es veu a l'inbox. Ull tatxat = no s'hi veu. És l'estat, no l'acció, i és
 * la convenció que la gent ja porta apresa de mig món. L'acció la diu el nom accessible i
 * el títol —«Treure de l'inbox» / «Portar a l'inbox»—, i `aria-pressed` la fa llegible per
 * a qui no veu la icona: un interruptor premut és una cosa encesa.
 *
 * Dibuixar l'acció en comptes de l'estat també és defensable i és pitjor aquí: en una
 * llista de deu targetes vols saber **quines hi són** d'una passada d'ulls, no què faria
 * cada botó si el premessis.
 *
 * **`currentColor` i `--ink-soft`**, com `SourceIcon` i per les mateixes dues raons: el que
 * no hereta el color no segueix el tema, i `docs/04` §8 reserva `--ink-faint` per al que no
 * cal llegir. Això sí que cal.
 */

import { t } from '@fem-ho/contracts';

export interface InboxEyeToggleProps {
  /** Si l'ítem és a l'inbox de Tasques ara mateix. */
  visible: boolean;
  onToggle: () => void;
  testId: string;
}

export function InboxEyeToggle({ visible, onToggle, testId }: InboxEyeToggleProps) {
  const label = visible ? t('inbox.eye.hide') : t('inbox.eye.show');

  return (
    <button
      type="button"
      className="plou-btn plou-btn-ghost"
      data-testid={testId}
      onClick={onToggle}
      aria-pressed={visible}
      aria-label={label}
      title={label}
      style={{
        padding: '3px 7px',
        lineHeight: 0,
        color: 'var(--ink-soft)',
        flexShrink: 0,
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {visible ? (
          <>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </>
        ) : (
          <>
            {/*
              L'ull tatxat, i **tatxat de debò**: la barra el travessa de banda a banda. Un
              ull amb una ratlleta curta a sobre es confon amb un ull normal a 15 píxels,
              que és la mida a què es veurà sempre.
            */}
            <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 10 7 10 7a15.9 15.9 0 0 1-2.9 3.7" />
            <path d="M6.6 6.9A16.2 16.2 0 0 0 2 13s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1" />
            <path d="m2 3 20 20" />
          </>
        )}
      </svg>
    </button>
  );
}
