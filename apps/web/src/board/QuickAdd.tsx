/**
 * L'afegida ràpida: uneix el parser compartit amb el component del design system.
 *
 * Aquí hi viu el que és de la web i no del parser: l'autocompletat, el maneig de teclat
 * i la decisió de què passa quan falta l'àmbit. El parser és a `packages/contracts`
 * perquè Kotlin l'ha de replicar; això no.
 */

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  parseQuickAdd,
  revertToken,
  t,
  type QuickAddContext,
  type QuickAddToken,
} from '@fem-ho/contracts';
import { QuickAddInput } from '@fem-ho/design-system/femho';

export interface QuickAddProps {
  context: QuickAddContext;
  /** El nom de la columna, per al marcador de posició. */
  columnLabel: string;
  /** Colors dels àmbits, per als punts del desplegable. */
  scopeColors?: Record<string, string> | undefined;
  onCreate: (task: {
    title: string;
    scopeId: string;
    projectId: string | null;
    assigneeIds: string[];
    aiMode: 'manual' | 'assisted' | 'delegated';
  }) => void;
}

interface Suggestion {
  id: string;
  label: string;
  color?: string | undefined;
  /** El que s'insereix al camp en triar-la. */
  insert: string;
}

/**
 * Què s'està escrivint ara mateix, si és un sigil obert.
 *
 * Es mira **el final del text** i no tot el contingut: l'autocompletat ha de sortir
 * mentre s'escriu el sigil, i desaparèixer quan ja s'ha completat amb un espai.
 */
function openSigil(text: string): { sigil: '#' | '@'; query: string; start: number } | null {
  const match = /([#@])([^#@]*)$/.exec(text);
  if (match === null) return null;
  const query = match[2] ?? '';
  // Un espai després del sigil vol dir que ja s'ha acabat d'escriure el nom, tret que
  // el nom mateix en tingui —"Client Salt"— i llavors encara hi pot haver coincidència.
  return { sigil: match[1] as '#' | '@', query, start: match.index };
}

export function QuickAdd({ context, columnLabel, scopeColors = {}, onCreate }: QuickAddProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  /**
   * Escape tanca el desplegable **sense tocar el text**. Abans hi afegia un espai per
   * tancar-lo, i era un error: canviar el que l'usuari ha escrit per tancar un menú és
   * exactament el que un camp d'afegida ràpida no ha de fer mai.
   */
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseQuickAdd(text, context), [text, context]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (dismissed) return [];
    const open = openSigil(text);
    if (open === null) return [];

    /**
     * Si el sigil JA està resolt del tot, no hi ha res a suggerir.
     *
     * Sense això, escriure `#Feina Enviar proposta @Alba` i prémer Enter
     * **autocompletava en comptes de crear la tasca**: el desplegable seguia obert
     * sobre `@Alba` i es quedava la tecla. És el cas més normal del món i era un bug
     * de veritat, no una raresa de la prova.
     */
    const resolved = parsed.tokens.some((token) => token.end === text.length);
    if (resolved) return [];

    const fold = (value: string): string =>
      value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const query = fold(open.query.trim());

    if (open.sigil === '#') {
      const scopes = context.scopes.map((scope) => ({
        id: scope.id,
        label: scope.name,
        color: scopeColors[scope.id],
        insert: `#${scope.name} `,
      }));
      // Els projectes surten com a `#Àmbit/Projecte`, que és com s'escriuen.
      const projects = context.scopes.flatMap((scope) =>
        scope.projects.map((project) => ({
          id: project.id,
          label: `${scope.name}/${project.name}`,
          color: scopeColors[scope.id],
          insert: `#${scope.name}/${project.name} `,
        })),
      );
      return [...scopes, ...projects].filter((s) => query === '' || fold(s.label).includes(query));
    }

    return context.people
      .map((person) => ({ id: person.id, label: person.name, insert: `@${person.name} ` }))
      .filter((s) => query === '' || fold(s.label).includes(query));
  }, [text, context, scopeColors, dismissed, parsed.tokens]);

  const pick = (suggestion: Suggestion): void => {
    const open = openSigil(text);
    if (open === null) return;
    setText(text.slice(0, open.start) + suggestion.insert);
    setActive(0);
    setDismissed(false);
    inputRef.current?.focus();
  };

  /** Torna `true` si la tecla és de l'autocompletat i no del camp. */
  const handleSuggestionKey = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (suggestions.length === 0) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % suggestions.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const chosen = suggestions[active];
      if (chosen !== undefined) {
        event.preventDefault();
        pick(chosen);
        return true;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
      return true;
    }
    return false;
  };

  /** Crea i deixa el camp llest per a la següent. */
  const crear = (scopeId: string): void => {
    onCreate({
      title: parsed.title,
      scopeId,
      projectId: parsed.projectId,
      assigneeIds: parsed.assigneeIds,
      aiMode: parsed.aiMode,
    });

    // El camp es buida i MANTÉ EL FOCUS, per poder-ne encadenar (docs/02 §4).
    setText('');
    setSubmitted(false);
    inputRef.current?.focus();
  };

  const submit = (): void => {
    setSubmitted(true);
    // "Si hi ha més d'un àmbit actiu i no s'ha escrit #, NO ES CREA RES" (docs/02 §4).
    if (parsed.error !== null || parsed.scopeId === null) return;
    crear(parsed.scopeId);
  };

  const errorMessage =
    submitted && parsed.error === 'scope-required'
      ? t('board.quickAdd.scopeRequired', {
          scopes: context.scopes
            .filter((scope) => context.activeScopeIds.includes(scope.id))
            .map((scope) => scope.name)
            .join(', #'),
        })
      : undefined;

  const chips = parsed.tokens.map((token: QuickAddToken) => ({
    kind: token.kind,
    start: token.start,
    end: token.end,
    label: token.kind === 'aiMode' ? t(`ai.mode.${token.id}`) : token.label,
    revertLabel: t('board.quickAdd.revert', { label: token.label }),
  }));

  /**
   * Els àmbits per triar, quan la regla diu que en falta un.
   *
   * **Abans això era només una frase vermella** —«Indica l'àmbit amb #Personal, #Feina,
   * #Família»— i la persona havia de tornar al camp, escriure una coixinet i encertar el
   * nom. La regla del brief (línia 19) segueix igual: amb més d'un àmbit actiu **no es crea
   * res** sense dir-ne un. El que canvia és que dir-lo costa un clic i no una relectura.
   */
  const perTriar =
    errorMessage === undefined
      ? []
      : context.scopes.filter((scope) => context.activeScopeIds.includes(scope.id));

  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <QuickAddInput
        inputRef={inputRef}
        value={text}
        onChange={(next) => {
          setText(next);
          setActive(0);
          // Tornar a escriure reobre el desplegable: el descart val per a aquell moment,
          // no per a la resta de la sessió.
          setDismissed(false);
          // L'error desapareix en tornar a escriure: no s'ha de quedar clavat.
          if (submitted) setSubmitted(false);
        }}
        onSubmit={submit}
        placeholder={t('board.quickAdd.placeholder', { column: columnLabel })}
        tokens={chips}
        onRevertToken={(chip) => {
          const token = parsed.tokens.find(
            (candidate) => candidate.start === chip.start && candidate.kind === chip.kind,
          );
          if (token !== undefined) setText(revertToken(text, token));
          inputRef.current?.focus();
        }}
        error={errorMessage}
        suggestions={suggestions}
        activeSuggestion={active}
        onSuggestionKeyDown={handleSuggestionKey}
        onSuggestionPick={(suggestion) => pick(suggestion as Suggestion)}
      />

      {perTriar.length === 0 ? null : (
        <div
          data-testid="quick-add-scope-picker"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
          {perTriar.map((scope) => (
            <button
              key={scope.id}
              type="button"
              data-testid={`quick-add-scope-${scope.id}`}
              onClick={() => crear(scope.id)}
              className="plou-btn plou-btn-ghost"
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: scopeColors[scope.id] ?? 'var(--ink-faint)',
                }}
              />
              {scope.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
