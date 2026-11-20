import type { ReactElement } from 'react';

export interface SourceBadgeProps {
  label: string;
  detailsLabel: string;
  rows: ReadonlyArray<{ label: string; value: string }>;
}

export function SourceBadge(props: SourceBadgeProps): ReactElement;
