import type * as React from 'react';

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
  /** `null` per al bloc de subtasques: no en té, i per això va sense caixa ni epígraf. */
  name: string | null;
  /** Si està pinejada. La xinxeta plena es veu sempre; la buida, en passar-hi per sobre. */
  pinned?: boolean | undefined;
  /** Del catàleg. Si no hi és, la llista no es pot pinejar. */
  pinLabel?: string | undefined;
  onPinToggle?: (() => void) | undefined;
  items: CardListItem[];
}

export interface CardAddForm {
  open: boolean;
  onToggle: () => void;
  /** Text del botó de la cantonada. Del catàleg. */
  toggleLabel: string;
  /** "Nova subtasca… o #Llista element". Del catàleg. */
  placeholder: string;
  text: string;
  onText: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export interface TaskCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Pastilla de projecte. Absent si la tasca és a l'espai general de l'àmbit. */
  project?: string | undefined;
  /** La icona de provinença, ja feta. `undefined` si la tasca l'ha escrita una persona. */
  sourceIcon?: React.ReactNode;
  /** Inicial de la persona assignada, en un cercle de 18px. */
  assigneeInitials?: string | undefined;
  /** Hora, si la tasca en té. Normalment no en té (docs/01 §4). */
  time?: string | undefined;
  /** `manual` no pinta res: és el cas normal i no ha d'ocupar espai (docs/09 §3). */
  aiMode?: 'manual' | 'assisted' | 'delegated' | undefined;
  /** El text del distintiu, traduït. El color no és mai l'únic senyal. */
  aiModeLabel?: string | undefined;
  /**
   * «Espera resposta teva», traduït. Amb text, la targeta va destacada i el diu; sense
   * text no hi ha res a destacar, perquè un color sol no és cap avís (docs/04 §8).
   */
  attentionLabel?: string | undefined;
  /** Només a les targetes de l'Inbox (docs/02 §4). */
  /**
   * La fletxa de la barra dreta: mou la targeta una columna endavant.
   *
   * Si hi és, la barra és una fletxa; si no, és la casella d'estat. Substitueix els dos
   * botons "→ Per fer" i "→ Fent" que hi havia sota el títol.
   */
  onAdvance?: (() => void) | undefined;
  /** "Moure a Per fer". Del catàleg. */
  advanceLabel?: string | undefined;
  /** Etiqueta accessible de la casella d'estat. Del catàleg. */
  toggleLabel?: string | undefined;
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
  /** Obre l'edició completa. Surt com a llapis a la cantonada, en passar-hi per sobre. */
  onEdit?: (() => void) | undefined;
  /** L'etiqueta del llapis. Del catàleg. */
  editLabel?: string | undefined;
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
