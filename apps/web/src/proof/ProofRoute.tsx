/**
 * Encaminament de les pàgines de comprovació aïllada.
 *
 * Viuen a part de l'app perquè el que comproven és **un component amb dades fixes**: els
 * vuit temes, l'arrossegament amb teclat, els xips reversibles, la cua de sortida. Cap
 * d'aquestes coses necessita un servidor, i fer-les passar per la sessió les faria
 * lentes i fràgils sense guanyar res.
 *
 * L'app de veritat es prova a `app.spec.ts`, contra un servidor real. Les dues menes de
 * prova fan falta: aquestes veuen que el component és correcte, aquella que el producte
 * funciona.
 */

import { AiModeProof } from '../AiModeProof.js';
import { BoardProof } from '../BoardProof.js';
import { CalendarProof } from '../CalendarProof.js';
import { OfflineProof } from '../OfflineProof.js';
import { QuickAddProof } from '../QuickAddProof.js';
import { TokenProof } from '../TokenProof.js';

export function ProofRoute({ path }: { path: string }) {
  const which = path.replace('/proof/', '');
  if (which.startsWith('ai')) return <AiModeProof />;
  if (which.startsWith('offline')) return <OfflineProof />;
  if (which.startsWith('calendar')) return <CalendarProof />;
  if (which.startsWith('quickadd')) return <QuickAddProof />;
  if (which.startsWith('board')) return <BoardProof />;
  return <TokenProof />;
}
