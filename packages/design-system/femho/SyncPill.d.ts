import type { CSSProperties, HTMLAttributes } from 'react';

export type SyncState = 'idle' | 'offline' | 'pending' | 'synced';

export interface SyncPillProps extends HTMLAttributes<HTMLDivElement> {
  state: SyncState;
  /** El text. Ve del catàleg (regla 3). */
  label: string;
  /** Canvis pendents. Zero l'amaga. */
  count?: number | undefined;
  onClick?: (() => void) | undefined;
  style?: CSSProperties | undefined;
}

export declare function SyncPill(props: SyncPillProps): JSX.Element | null;
