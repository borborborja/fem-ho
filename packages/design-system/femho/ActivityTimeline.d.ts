import type { CSSProperties, ReactElement } from 'react';

export type ActorFilter = 'all' | 'ai' | 'human';

export interface ActivityEntryView {
  id: string;
  entity_type?: string;
  verb: string;
  actor_type: string;
  actor_label: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
  channel?: { label: string; origin: string | null };
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
