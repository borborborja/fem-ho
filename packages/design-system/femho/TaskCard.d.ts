import type * as React from 'react';

export interface QuickAction {
  /** El text ja traduït. Els components no porten català a dins (regla 3). */
  label: string;
  onClick: () => void;
}

export interface CardListItem {
  id: string;
  text: string;
  done: boolean;
  /** Etiqueta accessible de la casella. Ve del catàleg (regla 3). */
  toggleLabel: string;
  onToggle: () => void;
}

export interface CardList {
  id: string;
  /** `null` o buit = són les subtasques de la tasca, i es pinta l'epígraf. */
  name?: string | null | undefined;
  /** El text de l'epígraf quan no hi ha nom. Del catàleg. */
  subtasksLabel?: string | undefined;
  /** Sense etiqueta, no es pinta el botó: les subtasques no es pinegen. */
  pinLabel?: string | undefined;
  onPinToggle?: (() => void) | undefined;
  items: CardListItem[];
}

export interface CardAddForm {
  open: boolean;
  onToggle: () => void;
  toggleLabel: string;
  listNamePlaceholder: string;
  listName: string;
  onListName: (event: { target: { value: string } }) => void;
  itemPlaceholder: string;
  itemText: string;
  onItemText: (event: { target: { value: string } }) => void;
  onItemKeyDown?: ((event: { key: string; preventDefault: () => void }) => void) | undefined;
  onSubmit: () => void;
  submitLabel: string;
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
  /**
   * Subtasques i llistes, per desplegar dins de la targeta.
   *
   * Van juntes sota un sol commutador: per a qui mira el tauler són el mateix, coses
   * que falten dins d'aquesta tasca.
   */
  lists?: CardList[] | undefined;
  listsExpanded?: boolean | undefined;
  /**
   * "▸ Llistes (2)". Del catàleg.
   *
   * **És el que decideix si el commutador surt**, i no `lists`: quan la targeta encara
   * està plegada no ha demanat cap ítem, o sigui que `lists` és buit i el commutador
   * hauria de sortir igualment. El número ve de l'agregat del tauler.
   */
  listsToggleLabel?: string | undefined;
  onToggleLists?: (() => void) | undefined;
  addForm?: CardAddForm | undefined;
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
