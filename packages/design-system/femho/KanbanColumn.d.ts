import type * as React from 'react';

export interface KanbanColumnProps extends React.HTMLAttributes<HTMLElement> {
  label: string;
  count: number;
  /**
   * `inbox`   panell amb `--gradient-wash-warm`, com fa el prototip.
   * `grouped` dins d'un `KanbanGroup`: sense fons ni vora, només separador esquerre.
   *           El fons el posa la targeta que les envolta.
   * `default` contenidor propi amb `--column-bg`. Per a usos fora del tauler.
   */
  variant?: 'grouped' | 'inbox' | 'default' | undefined;
  /** Separador esquerre. Es posa a totes les columnes agrupades menys la primera. */
  divider?: boolean | undefined;
  /** Files extra sota la capçalera. La columna Fet hi posa els seus botons. */
  headerExtra?: React.ReactNode | undefined;
  /** A la dreta de la capçalera, després d'un espaiador flexible. */
  headerActions?: React.ReactNode | undefined;
  /** El camp d'afegida ràpida. */
  footer?: React.ReactNode | undefined;
  /** Marca la columna com a destí mentre s'hi arrossega. */
  dropIndicator?: boolean | undefined;
  children?: React.ReactNode | undefined;
}

export interface ScopeGroupHeaderProps {
  label: string;
  /** El color de l'àmbit: un punt de 7px, mai una superfície gran (docs/04 §4). */
  color: string;
  open: boolean;
  onToggle?: (() => void) | undefined;
  extra?: React.ReactNode | undefined;
}

export interface KanbanGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode | undefined;
  /** La vora del grup. Al kanban de la IA, `var(--plou-blue-ink)`. */
  borderColor?: string | undefined;
}

export declare function KanbanColumn(props: KanbanColumnProps): React.JSX.Element;
export declare function ScopeGroupHeader(props: ScopeGroupHeaderProps): React.JSX.Element;
export declare function KanbanGroup(props: KanbanGroupProps): React.JSX.Element;
