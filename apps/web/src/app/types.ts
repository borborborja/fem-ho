/**
 * Els tipus del domini, **derivats del contracte** (regla 5).
 *
 * Cap d'aquests es declara a mà: tots surten d'`openapi.yaml` a través dels tipus
 * generats. Escriure'n un de propi seria tenir dues definicions de la mateixa cosa i
 * garantir que un dia divergeixin sense que res falli.
 */

import type { components } from '@fem-ho/contracts';

type S = components['schemas'];

export type Task = S['Task'];
export type Scope = S['Scope'];
export type Project = S['Project'];
export type Label = S['Label'];
export type Member = S['Member'];
export type Subtask = S['Subtask'];
export type Comment = S['Comment'];
export type Checklist = S['Checklist'];
export type ChecklistItem = S['ChecklistItem'];
export type Calendar = S['Calendar'];
export type EventOccurrence = S['EventOccurrence'];
export type Board = S['Board'];
export type TaskPage = S['TaskPage'];
export type Inbox = S['Inbox'];
/** El que arriba d'una font a la bústia. **No és un `Task`**: no té estat ni posició. */
export type InboxEvent = S['InboxEvent'];
export type Dashboard = S['Dashboard'];
export type ActivityEntry = S['ActivityEntry'];
export type ApiTokenSummary = S['ApiTokenSummary'];
export type ShareSummary = S['ShareSummary'];
export type ShareAccess = S['ShareAccess'];
export type Agent = S['Agent'];
export type AdminUser = S['AdminUser'];
export type UserProfile = S['UserProfile'];
export type UserSettings = S['UserSettings'];
export type Me = S['Me'];
export type Info = S['Info'];
export type UpdateStatus = S['UpdateStatus'];
export type QuickAddResult = S['QuickAddResult'];

export type Theme = UserProfile['theme'];
export type Accent = UserProfile['accent'];
export type InboxPosition = NonNullable<UserSettings['inbox_position']>;
