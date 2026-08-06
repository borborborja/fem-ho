import type { CSSProperties, HTMLAttributes } from 'react';

export interface ChecklistRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onToggle'> {
  text: string;
  done?: boolean | undefined;
  onToggle?: (() => void) | undefined;
  /** Si es dona, el text és editable en línia. */
  onTextChange?: ((value: string) => void) | undefined;
  /** Ratllat quan està fet. Fals a la secció "Completats", on ja se sap. */
  strikeWhenDone?: boolean | undefined;
  /** Etiqueta accessible de la casella. Ve del catàleg (regla 3). */
  toggleLabel?: string | undefined;
  style?: CSSProperties;
}

export declare function ChecklistRow(props: ChecklistRowProps): JSX.Element;
