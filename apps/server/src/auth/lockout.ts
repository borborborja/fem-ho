/**
 * Bloqueig per intents de login. docs/05 §7: "Login: 10 per 15 min, i bloqueig
 * progressiu." docs/13 M3: "el bloqueig per intents funciona."
 *
 * Es compta **per correu**, no per IP. Darrere d'un proxy invers casolà totes les
 * peticions poden compartir IP (docs/05 §7), o sigui que comptar per IP bloquejaria
 * tota la casa quan una persona s'equivoca de contrasenya. I un atacant que provi mil
 * correus diferents no ha de poder-hi fer res: cada correu té el seu comptador.
 *
 * Viu en memòria i no a la base, i és una decisió amb una contrapartida que val la pena
 * dir: **un reinici del procés esborra els comptadors**. Per a una instància familiar
 * és acceptable —reiniciar el contenidor cada pocs segons per allargar un atac de força
 * bruta és més sorollós que l'atac— i evita afegir una taula que docs/01 no té. Si algun
 * dia cal aguantar reinicis, es persisteix i prou.
 */

/** Intents permesos abans que comenci el bloqueig. */
export const MAX_ATTEMPTS = 10;

/** Finestra en què es compten. */
export const WINDOW_MS = 15 * 60 * 1000;

/**
 * Espera progressiva un cop passat el llindar. Es dobla a cada intent fallit i es
 * limita: sense límit, un atacant podria deixar un compte bloquejat durant anys.
 */
const BASE_LOCK_MS = 30 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;

interface Attempts {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

export class LoginLockout {
  readonly #byKey = new Map<string, Attempts>();

  /** Quant falta perquè es pugui tornar a provar. 0 si es pot ara. */
  retryAfterMs(key: string, now: number): number {
    const entry = this.#byKey.get(key);
    if (entry === undefined) return 0;
    return Math.max(0, entry.lockedUntil - now);
  }

  isLocked(key: string, now: number): boolean {
    return this.retryAfterMs(key, now) > 0;
  }

  /** Registra un intent fallit i retorna quant s'ha d'esperar ara. */
  recordFailure(key: string, now: number): number {
    const entry = this.#byKey.get(key);

    if (entry === undefined || now - entry.windowStart > WINDOW_MS) {
      this.#byKey.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
      return 0;
    }

    entry.count += 1;

    // docs/05 §7 diu "10 per 15 min": deu intents permesos, i l'ONZÈ ja rebota. Per
    // tant el bloqueig s'arma quan el comptador ARRIBA a MAX_ATTEMPTS, no quan el
    // supera — si s'armés en superar-lo, se'n permetrien onze.
    if (entry.count >= MAX_ATTEMPTS) {
      const excess = entry.count - MAX_ATTEMPTS;
      const wait = Math.min(BASE_LOCK_MS * 2 ** excess, MAX_LOCK_MS);
      entry.lockedUntil = now + wait;
      return wait;
    }
    return 0;
  }

  /** Un login correcte neteja el comptador. */
  recordSuccess(key: string): void {
    this.#byKey.delete(key);
  }

  /** Treu les entrades caducades. Sense això el mapa creix indefinidament. */
  prune(now: number): void {
    for (const [key, entry] of this.#byKey) {
      if (now - entry.windowStart > WINDOW_MS && entry.lockedUntil <= now) {
        this.#byKey.delete(key);
      }
    }
  }

  /** Només per a proves. */
  clear(): void {
    this.#byKey.clear();
  }
}
