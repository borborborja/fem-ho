/**
 * Què se'n fa d'un correu que acaba d'arribar.
 *
 * **Funció pura**, com `inbox-visibility.ts`: sense base de dades, sense principal, sense
 * `async`. Qui la crida ja ha carregat les regles; aquí només es decideix.
 *
 * ELS QUATRE NIVELLS, I PER QUÈ AQUEST ORDRE
 * ------------------------------------------
 *   0. **Ja l'hem ingerit** → res. Guanya a tot, i és l'única línia que salva un
 *      `UIDVALIDITY` rotat: quan el servidor reindexa i tornem a veure la bústia sencera,
 *      això és el que evita duplicar cada tasca creada des del primer dia.
 *   1. **El fil ja té una tasca viva** → comentari. Guanya **fins i tot sobre una regla que
 *      digui «fes-ne una tasca»**: si no, una resposta obriria una segona tasca del mateix
 *      assumpte i acabaries amb el fil partit en dues coses a fer.
 *   2. **La regla més específica** de les carpetes on és → cau a la bústia.
 *   3. Cap regla → res.
 *
 * L'ESPECIFICITAT ÉS LA PROFUNDITAT, NO UN ORDRE A MÀ
 * ---------------------------------------------------
 * El cas que ho decideix és Gmail: **cada correu és a `[Gmail]/All Mail` i a la seva
 * etiqueta alhora**. Si algú mapa totes dues, cal una regla determinista, i
 * `INBOX/Feina/Clients` (profunditat 3) ha de guanyar el calaix de sastre (2). La
 * profunditat és una propietat de les dades; una llista ordenada a mà és una cosa que
 * algú s'ha de recordar d'actualitzar, i no se'n recorda.
 *
 * `position` només desempata entre iguals.
 *
 * I UNA CARPETA SENSE REGLA NO ES LLEGEIX
 * ---------------------------------------
 * Sense regla no es desa res i no es baixa res. El correu d'algú és seu, i «per si de cas»
 * no és una raó per copiar-lo al nostre disc.
 */

export interface MailRule {
  id: string;
  folder: string;
  position: string;
  enabled: boolean;
}

export interface MailRoutingInput {
  /** Totes les carpetes **mapades** on hem vist el correu, com les anomena el servidor. */
  folders: string[];
  /** El delimitador que ha dit el `LIST`: `.` a Dovecot, `/` a Gmail. */
  delimiter: string;
  rules: MailRule[];
  /** Ja tenim `(account_id, message_key)`. */
  alreadyIngested: boolean;
  /** El fil ja va donar una tasca que segueix viva. */
  threadTaskId: string | null;
}

export type MailRouting =
  | { kind: 'skip'; reason: 'duplicate' | 'no-rule' }
  | { kind: 'comment'; taskId: string }
  | { kind: 'inbox'; rule: MailRule };

/**
 * `INBOX` és insensible a majúscules per l'RFC 3501 i **tota la resta no ho és**.
 *
 * Abaixar-ho tot fusionaria `Feina` i `feina`, que en un servidor IMAP són dues carpetes
 * diferents i poden anar a dos projectes diferents.
 */
export function normalizeFolder(folder: string): string {
  return folder.toUpperCase() === 'INBOX' ? 'INBOX' : folder;
}

/** Quants segments té un camí de carpeta. `INBOX/Feina/Clients` amb `/` en té tres. */
export function folderDepth(folder: string, delimiter: string): number {
  if (delimiter === '') return 1;
  return folder.split(delimiter).filter((part) => part !== '').length;
}

export function routeMail(input: MailRoutingInput): MailRouting {
  if (input.alreadyIngested) return { kind: 'skip', reason: 'duplicate' };
  if (input.threadTaskId !== null) return { kind: 'comment', taskId: input.threadTaskId };

  const here = new Set(input.folders.map(normalizeFolder));
  const candidates = input.rules
    .filter((rule) => rule.enabled && here.has(normalizeFolder(rule.folder)))
    .sort((a, b) => {
      const depth = folderDepth(b.folder, input.delimiter) - folderDepth(a.folder, input.delimiter);
      if (depth !== 0) return depth;
      if (a.position !== b.position) return a.position < b.position ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });

  const rule = candidates[0];
  if (rule === undefined) return { kind: 'skip', reason: 'no-rule' };
  /**
   * **I sempre a la bústia.** Abans aquí hi havia una bifurcació: la regla podia dir
   * «converteix-ho en tasca». Posava coses a la llista de feina d'algú sense que ningú ho
   * hagués demanat, i el model és el contrari —el que arriba d'una font és un element que
   * **pots** convertir. Si es veu o no a l'inbox de Tasques ho decideix la visibilitat, que
   * no és feina d'aquesta funció.
   */
  return { kind: 'inbox', rule };
}
