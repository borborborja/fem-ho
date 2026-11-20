import type { ReactElement, ReactNode } from 'react';

export interface SourceBadgeProps {
  label: string;
  detailsLabel: string;
  rows: ReadonlyArray<{ label: string; value: string }>;
  icon?: ReactNode;
}

export function SourceBadge(props: SourceBadgeProps): ReactElement;
