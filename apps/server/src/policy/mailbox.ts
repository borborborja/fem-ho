/**
 * De quin calaix es mira la bústia.
 *
 * **És un commutador, no un filtre.** Canvies de calaix; no acotes una llista. Per això
 * es composa amb els àmbits actius de la barra de dalt en comptes de substituir-los.
 *
 * «Propi» i «compartit» surten del **tipus de l'àmbit** i no de qui té la tasca
 * assignada. Per assignació semblaria més fi i seria pitjor: a un àmbit individual tot
 * està assignat a tu per la regla d'autoassignació (`docs/01` §4), i a un de compartit
 * una tasca sense assignar no cauria a cap dels dos calaixos. Amb el tipus, cada cosa és
 * exactament d'un costat i es pot explicar en una frase — que és la prova de si un
 * commutador de tres posicions és intuïtiu o no.
 *
 * Viu a `policy/` i no dins d'un servei perquè el fan servir el de tasques i el de
 * preferències, i que un s'importés l'altre faria un cicle.
 */

export const MAILBOXES = ['own', 'shared', 'all'] as const;
export type Mailbox = (typeof MAILBOXES)[number];

export function isMailbox(value: unknown): value is Mailbox {
  return typeof value === 'string' && (MAILBOXES as readonly string[]).includes(value);
}
