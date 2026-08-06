import type { CSSProperties, HTMLAttributes } from 'react';
import type { QuickAddSuggestion } from './QuickAddInput.js';

export interface MentionPopoverProps
  extends Omit<HTMLAttributes<HTMLUListElement>, 'onSelect' | 'id'> {
  /** Identificador del `listbox`. Ha de coincidir amb l'`aria-controls` de l'input. */
  id: string;
  suggestions?: QuickAddSuggestion[] | undefined;
  activeIndex?: number | undefined;
  onPick?: ((suggestion: QuickAddSuggestion) => void) | undefined;
  /** Text quan no hi ha res. Ve del catàleg (regla 3). Sense ell, no es pinta res. */
  emptyLabel?: string | undefined;
  style?: CSSProperties | undefined;
}

/** Cert per sota de 860px, l'amplada a partir de la qual la web és com Android. */
export declare function useIsMobile(): boolean;
export declare function MentionPopover(props: MentionPopoverProps): JSX.Element | null;
