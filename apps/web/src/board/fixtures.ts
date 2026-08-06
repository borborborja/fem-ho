/**
 * Dades de mostra per a la prova visual del tauler.
 *
 * NO són dades de demostració del producte: docs/12 §7 diu que les dades de
 * demostració van darrere d'una variable i mai per defecte. Aquestes només existeixen
 * per poder captar el tauler al navegador i comparar-lo amb el prototip sense haver
 * d'aixecar el servidor.
 */

import type { BoardScope, BoardTask } from './KanbanBoard.js';

export const SAMPLE_SCOPES: BoardScope[] = [
  { id: 'personal', name: 'Personal', color: 'var(--plou-blue)' },
  { id: 'feina', name: 'Feina', color: 'var(--plou-orange)' },
  { id: 'familia', name: 'Família', color: 'var(--plou-pink)' },
];

export const SAMPLE_TASKS: BoardTask[] = [
  { id: '1', title: 'Trucar al fontaner', status: 'inbox', scope_id: 'familia' },
  {
    id: '2',
    title: 'Enviar proposta',
    status: 'inbox',
    scope_id: 'feina',
    project: 'Client Salt',
    assigneeInitials: 'A',
  },
  { id: '3', title: 'Renovar el carnet', status: 'inbox', scope_id: 'personal', time: '17:30' },
  {
    id: '4',
    title: 'Revisar el pressupost',
    status: 'todo',
    scope_id: 'feina',
    project: 'Client Salt',
  },
  {
    id: '5',
    title: 'Comprar per al cap de setmana',
    status: 'todo',
    scope_id: 'familia',
    progress: { done: 3, total: 7, lists: 2 },
  },
  {
    id: '6',
    title: 'Migrar el servidor de casa',
    status: 'doing',
    scope_id: 'personal',
    aiMode: 'delegated',
    hasUnseenAiChange: true,
  },
  {
    id: '7',
    title: 'Preparar la reunió de dilluns',
    status: 'doing',
    scope_id: 'feina',
    aiMode: 'assisted',
  },
  { id: '8', title: 'Pagar la matrícula', status: 'done', scope_id: 'familia' },
];
