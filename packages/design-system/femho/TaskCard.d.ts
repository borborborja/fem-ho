import type * as React from 'react';

export interface QuickAction {
  /** El text ja traduït. Els components no porten català a dins (regla 3). */
  label: string;
  onClick: () => void;
}

export interface TaskCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Pastilla de projecte. Absent si la tasca és a l'espai general de l'àmbit. */
  project?: string | undefined;
  /** Inicial de la persona assignada, en un cercle de 18px. */
  assigneeInitials?: string | undefined;
  /** Hora, si la tasca en té. Normalment no en té (docs/01 §4). */
  time?: string | undefined;
  /** `manual` no pinta res: és el cas normal i no ha d'ocupar espai (docs/09 §3). */
  aiMode?: 'manual' | 'assisted' | 'delegated' | undefined;
  /** El text del distintiu, traduït. El color no és mai l'únic senyal. */
  aiModeLabel?: string | undefined;
  /** Només a les targetes de l'Inbox (docs/02 §4). */
  quickActions?: QuickAction[] | undefined;
  /** Per exemple `3/7`. */
  checklistProgress?: string | undefined;
  /** Punt taronja de 6px: la IA hi ha tocat i l'usuari encara no ho ha mirat. */
  hasUnseenAiChange?: boolean | undefined;
  /** Mentre s'arrossega, la targeta original queda a opacity 0.4. */
  dragging?: boolean | undefined;
  done?: boolean | undefined;
  /** Clicar el cos obre el modal d'edició completa. */
  onOpen?: (() => void) | undefined;
  /** Clicar el cercle NOMÉS commuta l'estat i no obre res. */
  onToggleDone?: (() => void) | undefined;
}

export declare function TaskCard(props: TaskCardProps): React.JSX.Element;
