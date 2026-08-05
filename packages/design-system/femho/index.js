/**
 * Components propis de Fem-ho (docs/04 §6).
 *
 * Es construeixen **només amb tokens de Plou** i mai importen res de `weather/`.
 * Cap d'ells porta text en català a dins: els textos arriben com a props des del
 * catàleg (regla 3), perquè el mateix component l'ha de poder fer servir Android amb
 * el seu propi `strings.xml`.
 *
 * Els que falten arriben a la seva fita: InboxRail i CalendarGrid a M7, QuickAddInput
 * i MentionPopover a M6, ChecklistRow a M8, AiModeBadge i ActivityTimeline a M11,
 * ShareDialog a M12, SyncPill a M9.
 */

export { TaskCard } from './TaskCard.jsx';
export { KanbanColumn, KanbanGroup, ScopeGroupHeader } from './KanbanColumn.jsx';
export { EmptyState } from './EmptyState.jsx';
export { ScopeChip } from './ScopeChip.jsx';
