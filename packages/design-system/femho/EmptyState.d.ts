import type * as React from 'react';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Frase sencera, mai un guió (docs/00, docs/02 §12). Ve del catàleg. */
  children?: React.ReactNode | undefined;
}

export declare function EmptyState(props: EmptyStateProps): React.JSX.Element;
