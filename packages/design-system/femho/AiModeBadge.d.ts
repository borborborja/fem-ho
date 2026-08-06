import type { CSSProperties, ReactElement } from 'react';

export type AiMode = 'manual' | 'assisted' | 'delegated';

export interface AiModeBadgeProps {
  mode: AiMode;
  /** El text visible. Arriba del catàleg: el component no en porta cap (regla 3). */
  label: string;
  /** Reservada per un agent ara mateix: la pastilla pulsa lentament. */
  leased?: boolean;
  style?: CSSProperties;
}

/** `manual` no pinta res i torna `null`. */
export function AiModeBadge(props: AiModeBadgeProps): ReactElement | null;

export interface UnseenAiDotProps {
  label: string;
  style?: CSSProperties;
}

export function UnseenAiDot(props: UnseenAiDotProps): ReactElement;
