import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { t } from '@fem-ho/contracts';

type ToastTone = 'info' | 'warning' | 'error';
interface Toast {
  id: string;
  version: number;
  text: string;
  tone: ToastTone;
}
interface Toasts {
  notify: (text: string, options?: { id?: string; tone?: ToastTone }) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}
const ToastContext = createContext<Toasts | null>(null);

export function useToasts(): Toasts {
  const value = useContext(ToastContext);
  if (value === null) throw new Error('ToastProvider is required');
  return value;
}

/** Avisos de gestos puntuals: fora del flux del tauler i limitats a tres alhora. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hidden, setHidden] = useState(document.hidden);
  const sequence = useRef(0);
  const notify = useCallback<Toasts['notify']>((text, options = {}) => {
    const tone = options.tone ?? 'info';
    const id = options.id ?? `${tone}:${text}`;
    const toast = { id, text, tone, version: ++sequence.current };
    // Repetir el gest renova el temps de lectura, sense apilar el mateix avís.
    setToasts((current) => [...current.filter((item) => item.id !== id), toast].slice(-3));
  }, []);
  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);
  const clear = useCallback(() => setToasts([]), []);
  const value = useMemo(() => ({ notify, dismiss, clear }), [notify, dismiss, clear]);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="femho-toast-viewport" data-testid="toast-viewport">
          {/* Les regions ja existeixen abans del missatge perquè s'anunciï el canvi. */}
          <div role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions text">
            {toasts
              .filter((toast) => toast.tone !== 'error')
              .map((toast) => (
                <ToastMessage key={toast.id} toast={toast} dismiss={dismiss} hidden={hidden} />
              ))}
          </div>
          <div aria-live="assertive" aria-atomic="false" aria-relevant="additions text">
            {toasts
              .filter((toast) => toast.tone === 'error')
              .map((toast) => (
                <ToastMessage key={toast.id} toast={toast} dismiss={dismiss} hidden={hidden} />
              ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastMessage({
  toast,
  dismiss,
  hidden,
}: {
  toast: Toast;
  dismiss: (id: string) => void;
  hidden: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const duration = toast.tone === 'info' ? 5000 : 8000;
  const remaining = useRef(duration);
  const version = useRef(toast.version);
  const paused = hidden || hovered || focused;

  useEffect(() => {
    if (version.current !== toast.version) {
      remaining.current = duration;
      version.current = toast.version;
    }
    if (paused) return;
    const started = performance.now();
    const timer = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [toast.id, toast.version, duration, paused, dismiss]);

  return (
    <div
      className="femho-toast"
      data-tone={toast.tone}
      data-testid="toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') dismiss(toast.id);
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        {toast.tone === 'info' ? <path d="M12 11v6M12 7v.01" /> : <path d="M12 7v6M12 17v.01" />}
      </svg>
      <span>{toast.text}</span>
      <button
        type="button"
        aria-label={t('nav.close')}
        title={t('nav.close')}
        data-testid="toast-dismiss"
        onClick={() => dismiss(toast.id)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M6 18 18 6" />
        </svg>
      </button>
    </div>
  );
}
