import type * as React from 'react';

export interface QuickAddChip {
  kind: 'scope' | 'project' | 'person' | 'aiMode' | 'taskType';
  start: number;
  end: number;
  /** El que es veu al xip. */
  label: string;
  /** Etiqueta accessible del botó: què passa si es clica. Ve del catàleg. */
  revertLabel?: string | undefined;
}

export interface QuickAddSuggestion {
  id: string;
  label: string;
  /** Punt de color, per als àmbits. Mai una superfície gran (docs/04 §4). */
  color?: string | undefined;
}

export interface QuickAddInputProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange' | 'onSubmit'
> {
  value: string;
  onChange?: ((value: string) => void) | undefined;
  /** `Enter` crea la tasca sense obrir cap modal (docs/02 §4). */
  onSubmit?: (() => void) | undefined;
  placeholder?: string | undefined;
  /** Els trossos reconeguts, pintats com a pastilles dins del camp. */
  tokens?: QuickAddChip[] | undefined;
  /** Clicar un xip el torna a text pla (D12). */
  onRevertToken?: ((token: QuickAddChip) => void) | undefined;
  /** Missatge d'error ja traduït. */
  error?: string | undefined;
  suggestions?: QuickAddSuggestion[] | undefined;
  activeSuggestion?: number | undefined;
  /** Torna `true` si ha consumit la tecla. */
  onSuggestionKeyDown?: ((event: React.KeyboardEvent<HTMLInputElement>) => boolean) | undefined;
  onSuggestionPick?: ((suggestion: QuickAddSuggestion) => void) | undefined;
  inputRef?: React.Ref<HTMLInputElement> | undefined;
}

export declare function QuickAddInput(props: QuickAddInputProps): React.JSX.Element;
