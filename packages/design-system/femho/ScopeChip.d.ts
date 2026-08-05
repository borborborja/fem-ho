import type * as React from 'react';

export interface ScopeChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** El color de l'àmbit. Actiu el pinta de fons; inactiu fa servir `--ghost-bg`. */
  color: string;
  active?: boolean | undefined;
}

export declare function ScopeChip(props: ScopeChipProps): React.JSX.Element;
