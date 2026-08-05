/**
 * Errors de política, en format RFC 9457 (docs/05 §3).
 *
 * `type` i `title` són estables i en anglès per poder-hi programar; `detail` va en
 * l'idioma de qui pregunta.
 *
 * **Un 403 mut fa que un agent reintenti en bucle.** docs/05 §2 i docs/08 §3 hi
 * insisteixen: quan una petició es rebutja per abast, l'error ha de dir quins àmbits
 * veu el token i on és la cosa que ha demanat. Per això `detail` es construeix amb
 * dades i no és una constant.
 */

export class PolicyError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;

  constructor(type: string, title: string, status: number, detail: string) {
    super(`${title}: ${detail}`);
    this.name = 'PolicyError';
    this.type = `https://femho.app/errors/${type}`;
    this.title = title;
    this.status = status;
    this.detail = detail;
  }

  toProblem(instance?: string): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      ...(instance === undefined ? {} : { instance }),
    };
  }
}

export function unauthenticated(detail = 'Cal autenticar-se.'): PolicyError {
  return new PolicyError('unauthenticated', 'Authentication required', 401, detail);
}

export function missingCapability(capability: string): PolicyError {
  return new PolicyError(
    'missing-capability',
    'Capability not granted',
    403,
    `Aquest token no té la capacitat "${capability}".`,
  );
}

/**
 * L'error d'abast. Diu **quins** àmbits veu i **on** és el que s'ha demanat, perquè qui
 * el rebi pugui corregir en comptes de reintentar.
 */
export function scopeForbidden(
  visibleNames: string[],
  requestedName: string | undefined,
  entity?: { type: string; id: string },
): PolicyError {
  const veu =
    visibleNames.length === 0
      ? 'aquest token no té accés a cap àmbit'
      : visibleNames.length === 1
        ? `aquest token només té accés a l'àmbit ${visibleNames[0]}`
        : `aquest token té accés als àmbits ${visibleNames.join(', ')}`;

  const on =
    requestedName === undefined
      ? ''
      : entity === undefined
        ? ` L'àmbit ${requestedName} no hi és.`
        : ` ${entity.type} ${entity.id} és a ${requestedName}.`;

  return new PolicyError(
    'scope-forbidden',
    'Scope not accessible',
    403,
    `${veu.charAt(0).toUpperCase()}${veu.slice(1)}.${on}`,
  );
}

export function notFound(entityType: string, id: string): PolicyError {
  return new PolicyError(
    'not-found',
    'Not found',
    404,
    `No existeix cap ${entityType} amb identificador ${id}.`,
  );
}

export function versionConflict(): PolicyError {
  return new PolicyError(
    'version-conflict',
    'Version conflict',
    409,
    "Algú altre ha modificat això mentrestant. Es retorna l'estat actual per poder fusionar.",
  );
}
