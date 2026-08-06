/**
 * Dreceres de teclat. docs/02 §11.
 *
 * **No s'activen mentre el focus és en un camp de text.** És la regla que fa que `c`
 * sigui una drecera i no un caràcter perdut: sense ella, escriure "casa" dins d'una
 * tasca et catapultaria a l'afegida ràpida a la primera lletra.
 *
 * `g` és un prefix, com a Gmail o GitHub: `g` i després `d` va al tauler general, `g` i
 * després `s` a Ajustos. La finestra per completar-lo és curta a posta; si fos llarga,
 * una `d` escrita molt després faria un salt que ningú relacionaria amb la `g` d'abans.
 */

const PREFIX_MS = 900;

export interface ShortcutHandlers {
  onQuickAdd: () => void;
  onTasks: () => void;
  onCalendar: () => void;
  onScope: (index: number) => void;
  onDashboard: () => void;
  onSettings: () => void;
  onSearch: () => void;
  onHelp: () => void;
  onPalette: () => void;
  onEscape: () => void;
}

/** Cert si el focus és en un lloc on les tecles són text i no ordres. */
function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function installShortcuts(handlers: ShortcutHandlers): () => void {
  let prefixAt = 0;

  const onKey = (event: KeyboardEvent): void => {
    // Escape val SEMPRE, també escrivint: és la manera de sortir d'un camp.
    if (event.key === 'Escape') {
      handlers.onEscape();
      return;
    }
    /**
     * `Cmd/Ctrl+K` val **també escrivint**.
     *
     * És l'única amb modificador i l'única que no és una lletra solta: no hi ha manera
     * de teclejar-la sense voler, i qui l'usa la vol des d'on sigui.
     */
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      handlers.onPalette();
      return;
    }

    if (typing(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const now = Date.now();
    const afterPrefix = now - prefixAt < PREFIX_MS;
    prefixAt = 0;

    if (afterPrefix) {
      if (event.key === 'd') {
        event.preventDefault();
        handlers.onDashboard();
        return;
      }
      if (event.key === 's') {
        event.preventDefault();
        handlers.onSettings();
        return;
      }
      // Qualsevol altra tecla després de `g` no és res: cau al maneig normal de sota.
    }

    switch (event.key) {
      case 'g':
        prefixAt = now;
        break;
      case 'c':
        event.preventDefault();
        handlers.onQuickAdd();
        break;
      case 't':
        event.preventDefault();
        handlers.onTasks();
        break;
      case 'k':
        event.preventDefault();
        handlers.onCalendar();
        break;
      case '/':
        event.preventDefault();
        handlers.onSearch();
        break;
      case '?':
        event.preventDefault();
        handlers.onHelp();
        break;
      default:
        if (/^[1-9]$/u.test(event.key)) {
          event.preventDefault();
          handlers.onScope(Number(event.key) - 1);
        }
    }
  };

  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
