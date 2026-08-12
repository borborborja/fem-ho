/**
 * Parser d'afegida ràpida. docs/02 §4, D12.
 *
 * "`Enter` crea la tasca **sense obrir cap modal**." La riquesa arriba després, editant.
 *
 * A la v1 **només sigils** (D12): `#Àmbit`, `#Àmbit/Projecte`, `@Persona` i `!ia`. El
 * parseig de dates en català va a la v1.1 darrere de `POST /parse`, i **no s'escriu com
 * a anti-objectiu**: un anti-objectiu escrit en un document que la mateixa IA llegeix a
 * la mateixa sessió genera exactament la confusió que volíem evitar.
 *
 * EL PARSEIG DEPÈN DEL CONTEXT, I NO PODIA SER D'UNA ALTRA MANERA
 * ---------------------------------------------------------------
 * `#Feina/Client Salt Enviar proposta` té un projecte amb un espai al mig. Sense saber
 * quins projectes existeixen, no hi ha manera de decidir on acaba "Client Salt" i on
 * comença el títol: qualsevol tall és arbitrari.
 *
 * Per això el parser rep els noms coneguts i hi busca **la coincidència més llarga**.
 * docs/03 §1 avisa d'aquest cas concret: "ningú se n'adona fins que un usuari escriu
 * `#Feina/Client Salt` amb un espai".
 *
 * AQUEST FITXER ES PORTA A KOTLIN a M13 i els fixtures de `quickadd-fixtures.json` es
 * passen a les dues implementacions, verificats a CI (`parser-parity`). Sense això les
 * dues divergeixen i ningú se n'adona fins que passa a casa d'algú.
 */

export interface QuickAddScope {
  id: string;
  name: string;
  projects: { id: string; name: string }[];
}

export interface QuickAddPerson {
  id: string;
  name: string;
}

export interface QuickAddContext {
  scopes: QuickAddScope[];
  people: QuickAddPerson[];
  /**
   * Les tipologies triables amb `$`, dels àmbits actius.
   *
   * Buit vol dir que cap àmbit actiu en fa servir, i llavors `$` no és un sigil: és un
   * dòlar dins d'un títol, que és el que ha de continuar sent per a qui no les té.
   */
  taskTypes?: { id: string; name: string; scopeId: string }[];
  /**
   * Els àmbits actius a la barra superior. Amb més d'un i sense `#`, no es crea res i
   * es demana l'àmbit; amb un de sol, s'agafa aquell (docs/02 §4).
   */
  activeScopeIds: string[];
}

/** Un tros reconegut del text, que la interfície pinta com a xip reversible. */
export interface QuickAddToken {
  kind: 'scope' | 'project' | 'person' | 'aiMode' | 'taskType';
  /** El text literal que ocupava, sigil inclòs. Tornar-lo a posar desfà el xip. */
  raw: string;
  /** Posició dins del text original, per poder-hi pintar el xip al lloc. */
  start: number;
  end: number;
  /** L'identificador resolt. Per a `aiMode`, el valor de l'enum. */
  id: string;
  /** El que es veu al xip. */
  label: string;
}

export type QuickAddErrorCode = 'scope-required' | 'empty-title';

export interface QuickAddResult {
  title: string;
  scopeId: string | null;
  projectId: string | null;
  assigneeIds: string[];
  aiMode: 'manual' | 'assisted' | 'delegated';
  /** La tipologia, si s'ha escrit amb `$`. */
  taskTypeId: string | null;
  tokens: QuickAddToken[];
  error: QuickAddErrorCode | null;
}

/** Normalitza per comparar: sense accents, sense majúscules, sense ela geminada. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/l·l/g, 'll')
    .replace(/·/g, '')
    .replace(/[''']/g, "'");
}

/** Els modes d'IA que s'accepten al sigil `!ia`, en català i en canònic. */
const AI_MODE_WORDS: Record<string, 'assisted' | 'delegated'> = {
  ajuda: 'assisted',
  assistida: 'assisted',
  assisted: 'assisted',
  delegada: 'delegated',
  delegated: 'delegated',
};

/**
 * Busca la coincidència més llarga d'una llista de noms a partir d'una posició.
 * Retorna el nom trobat, o `null`.
 *
 * "Més llarga" i no "primera": si existeixen els projectes "Client" i "Client Salt",
 * escriure `#Feina/Client Salt` ha de triar el segon.
 */
function matchLongest(
  text: string,
  from: number,
  candidates: { id: string; name: string }[],
): { id: string; name: string; length: number } | null {
  const rest = fold(text.slice(from));
  let best: { id: string; name: string; length: number } | null = null;

  for (const candidate of candidates) {
    const folded = fold(candidate.name);
    if (folded === '') continue;
    if (!rest.startsWith(folded)) continue;
    // El nom ha d'acabar en límit de paraula: `#Fein` no ha de coincidir amb "Feina",
    // i `#Feinal` tampoc.
    const after = rest.charAt(folded.length);
    if (after !== '' && after !== ' ' && after !== '/') continue;
    if (best === null || folded.length > best.length) {
      best = { id: candidate.id, name: candidate.name, length: folded.length };
    }
  }
  return best;
}

/**
 * Analitza una línia d'afegida ràpida.
 *
 * No llança mai: torna `error` i el que hagi pogut entendre, perquè la interfície pugui
 * ensenyar el missatge **i conservar el que l'usuari ha escrit**.
 */
export function parseQuickAdd(text: string, context: QuickAddContext): QuickAddResult {
  const tokens: QuickAddToken[] = [];
  const titleParts: string[] = [];

  let scopeId: string | null = null;
  let projectId: string | null = null;
  const assigneeIds: string[] = [];
  let aiMode: 'manual' | 'assisted' | 'delegated' = 'manual';
  let taskTypeId: string | null = null;

  let i = 0;
  let plainFrom = 0;

  const flushPlain = (until: number): void => {
    const chunk = text.slice(plainFrom, until);
    if (chunk.trim() !== '') titleParts.push(chunk.trim());
  };

  while (i < text.length) {
    const char = text[i];

    if (char === '#') {
      /**
       * **Amb un sol àmbit actiu, `#X` mira primer els projectes d'aquell àmbit.**
       *
       * Abans `#` era **sempre** l'àmbit, i un projecte només s'escrivia `#Àmbit/Projecte`
       * —també quan l'àmbit era únic, que és absurd: en monoàmbit la barra ja no ensenya
       * cap xip d'àmbit i el sigil demanava el nom d'una cosa que la interfície ha deixat
       * de nomenar. Amb diversos actius no canvia res: allà `#` ha de poder triar l'àmbit,
       * que és la decisió que la interfície sí que et demana.
       *
       * No cal reinterpretar res en passar de mono a multi: del text cru no se'n desa res,
       * els sigils es resolen en escriure i el que es guarda són `scope_id` i `project_id`
       * ja resolts.
       */
      const unic =
        context.activeScopeIds.length === 1
          ? context.scopes.find((s) => s.id === context.activeScopeIds[0])
          : undefined;

      if (unic !== undefined) {
        const project = matchLongest(text, i + 1, unic.projects);
        if (project !== null) {
          flushPlain(i);
          const end = i + 1 + project.length;
          tokens.push({
            kind: 'project',
            raw: text.slice(i, end),
            start: i,
            end,
            id: project.id,
            label: project.name,
          });
          projectId = project.id;
          scopeId = unic.id;
          i = end;
          plainFrom = i;
          continue;
        }
      }

      const scope = matchLongest(text, i + 1, context.scopes);
      if (scope !== null) {
        flushPlain(i);
        let end = i + 1 + scope.length;

        tokens.push({
          kind: 'scope',
          raw: text.slice(i, end),
          start: i,
          end,
          id: scope.id,
          label: scope.name,
        });
        scopeId = scope.id;

        // `#Àmbit/Projecte` encamina també al projecte.
        if (text[end] === '/') {
          const owner = context.scopes.find((s) => s.id === scope.id);
          const project = matchLongest(text, end + 1, owner?.projects ?? []);
          if (project !== null) {
            const projectStart = end;
            end = end + 1 + project.length;
            tokens.push({
              kind: 'project',
              raw: text.slice(projectStart, end),
              start: projectStart,
              end,
              id: project.id,
              label: project.name,
            });
            projectId = project.id;
          }
        }

        i = end;
        plainFrom = i;
        continue;
      }
    }

    if (char === '@') {
      const person = matchLongest(text, i + 1, context.people);
      if (person !== null) {
        flushPlain(i);
        const end = i + 1 + person.length;
        tokens.push({
          kind: 'person',
          raw: text.slice(i, end),
          start: i,
          end,
          id: person.id,
          label: person.name,
        });
        if (!assigneeIds.includes(person.id)) assigneeIds.push(person.id);
        i = end;
        plainFrom = i;
        continue;
      }
    }

    /**
     * `$Tipologia` — en què es va anar el temps.
     *
     * **`$` i no `#`** perquè `#` ja és l'àmbit i el projecte. És el mateix sigil que fa
     * servir l'eina d'on ve aquesta funció, i per la mateixa raó: era el que quedava lliure.
     */
    if (char === '$') {
      const type = matchLongest(text, i + 1, context.taskTypes ?? []);
      if (type !== null) {
        flushPlain(i);
        const end = i + 1 + type.length;
        tokens.push({
          kind: 'taskType',
          raw: text.slice(i, end),
          start: i,
          end,
          id: type.id,
          label: type.name,
        });
        taskTypeId = type.id;
        i = end;
        plainFrom = i;
        continue;
      }
    }

    if (char === '!') {
      // `!ia` i `!ia:delegada` (docs/09 §2). Sense el sigil, tota tasca neix `manual`.
      const match = /^!ia(?::([\p{L}]+))?/u.exec(text.slice(i));
      if (match !== null) {
        flushPlain(i);
        const end = i + match[0].length;
        const word = match[1] === undefined ? undefined : fold(match[1]);
        const mode = word === undefined ? 'delegated' : (AI_MODE_WORDS[word] ?? 'delegated');
        tokens.push({
          kind: 'aiMode',
          raw: text.slice(i, end),
          start: i,
          end,
          id: mode,
          label: mode,
        });
        aiMode = mode;
        i = end;
        plainFrom = i;
        continue;
      }
    }

    i += 1;
  }

  flushPlain(text.length);

  // "La resta és el títol, amb els espais sobrants col·lapsats" (docs/02 §4).
  const title = titleParts.join(' ').replace(/\s+/g, ' ').trim();

  // Amb un sol àmbit actiu s'agafa aquell; amb més d'un, cal el `#` (docs/02 §4).
  if (scopeId === null && context.activeScopeIds.length === 1) {
    scopeId = context.activeScopeIds[0] ?? null;
  }

  const error: QuickAddErrorCode | null =
    scopeId === null ? 'scope-required' : title === '' ? 'empty-title' : null;

  return { title, scopeId, projectId, assigneeIds, aiMode, taskTypeId, tokens, error };
}

/**
 * Desfà un xip: torna el text amb el tros reconegut convertit en text pla.
 *
 * "Clicar-la la torna a text pla. Sense això, un parser agressiu és una trampa — és el
 * mecanisme amb què Todoist se'l pot permetre" (docs/02 §4, D12).
 *
 * Es fa treient el sigil i deixant el nom: així l'usuari veu què hi havia i pot
 * corregir-ho, en comptes de quedar-se amb un forat.
 */
export function revertToken(text: string, token: QuickAddToken): string {
  const plain = token.raw.replace(/^[#@!$]/, '').replace(/^ia:?/, '');
  return text.slice(0, token.start) + plain + text.slice(token.end);
}
