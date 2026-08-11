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
  /**
   * Una que és d'algú altre: per defecte no es veu, i el commutador de l'epígraf la
   * treu. Sense una així, el filtre no es podria captar en cap prova visual.
   */
  {
    id: '9',
    title: 'Portar el cotxe al taller',
    status: 'todo',
    scope_id: 'familia',
    assigneeInitials: 'M',
    assignedToOther: true,
  },
];

/**
 * El que hi ha cada dia, per a la prova visual del calendari.
 *
 * Va aquí i no a la pantalla de prova pel mateix motiu que la resta: **són dades de mostra
 * i no text del producte**. A `CalendarProof.tsx` el linter d'idiomes les llegiria com a
 * cadenes que haurien de sortir del catàleg, i tindria raó si ho fossin.
 */
export const SAMPLE_DAY_ITEMS: Record<
  string,
  { id: string; title: string; color: string; muted?: boolean }[]
> = {
  '2026-08-05': [
    { id: 'a', title: '9:00 Reunió de pares', color: 'var(--plou-pink)' },
    { id: 'b', title: '17:30 Renovar el carnet', color: 'var(--plou-orange)' },
  ],
  '2026-08-12': [{ id: 'c', title: '12:00 Dentista', color: 'var(--plou-blue)' }],
  '2026-08-19': [
    { id: 'd', title: '8:30 Enviar proposta', color: 'var(--plou-orange)' },
    { id: 'e', title: '13:00 Dinar amb la Marta', color: 'var(--plou-blue)' },
    { id: 'f', title: '19:00 Partit', color: 'var(--plou-pink)' },
    // El quart no es dibuixa: surt com a "+1", que és el que evita que la cel·la creixi.
    { id: 'g', title: '21:00 Sopar', color: 'var(--plou-pink)', muted: true },
  ],
};
