import type { CSSProperties, ReactElement } from 'react';

export type ActorFilter = 'all' | 'ai' | 'human';

export interface ActivityEntryView {
  id: string;
  verb: string;
  actor_type: string;
  actor_label: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
  undoable?: boolean;
}

export interface ActivityTimelineLabels {
  filters: Record<ActorFilter, string>;
  verbs: Record<string, string>;
  undo: string;
}

export interface ActivityTimelineProps {
  entries: ActivityEntryView[];
  labels: ActivityTimelineLabels;
  filter?: ActorFilter;
  onFilterChange?: (filter: ActorFilter) => void;
  onUndo?: (entryId: string) => void;
  formatTime: (iso: string) => string;
  style?: CSSProperties;
}

export function ActivityTimeline(props: ActivityTimelineProps): ReactElement;
