/**
 * Components propis de Fem-ho (docs/04 §6).
 *
 * Es construeixen **només amb tokens de Plou** i mai importen res de `weather/`.
 * Cap d'ells porta text en català a dins: els textos arriben com a props des del
 * catàleg (regla 3), perquè el mateix component l'ha de poder fer servir Android amb
 * el seu propi `strings.xml`.
 *
 * Els tretze de docs/04 §6 hi són. `InboxRail` viu a l'app i no aquí: és l'únic que
 * necessita l'estat de l'aplicació (P4), i portar-lo al paquet obligaria el paquet a
 * conèixer el model de dades.
 */

export { TaskCard } from './TaskCard.jsx';
export { KanbanColumn, KanbanGroup, ScopeGroupHeader } from './KanbanColumn.jsx';
export { EmptyState } from './EmptyState.jsx';
export { ScopeChip } from './ScopeChip.jsx';
export { QuickAddInput } from './QuickAddInput.jsx';
export { MonthView, WeekView, DayView, monthCells, mondayIndex } from './CalendarGrid.jsx';
export { AiModeBadge, UnseenAiDot } from './AiModeBadge.jsx';
export { ActivityTimeline } from './ActivityTimeline.jsx';
export { ChecklistRow } from './ChecklistRow.jsx';
export { SyncPill } from './SyncPill.jsx';
export { MentionPopover, useIsMobile } from './MentionPopover.jsx';
export { ShareDialog } from './ShareDialog.jsx';
