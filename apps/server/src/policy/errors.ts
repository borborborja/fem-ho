/**
 * Errors de política, en format RFC 9457 (docs/05 §3).
 *
 * **Qui llegeix un error no és qui el pateix.**
 *
 * Aquest missatge el reben tres públics molt diferents: una persona davant de l'app,
 * un agent d'IA per MCP, i un client CalDAV com DAVx⁵ o Thunderbird. Els dos últims no
 * tenen catàleg ni idioma, i els primers en tenen tres. Per això l'error viatja en dues
 * peces:
 *
 * - `type` i `title` **estables i en anglès**, i `detail` **també en anglès**: és el que
 *   llegeixen les màquines i qui programi contra l'API. Abans anava en català, que és
 *   una llengua que un client CalDAV no pot fer res per entendre.
 * - `params`, les **dades** de l'error. El client hi posa `t('error.<slug>', params)` i
 *   el pinta en l'idioma de qui mira. Si no en té la clau, ensenya el `detail`: així un
 *   error nou del servidor mai deixa una pantalla muda.
 *
 * **Un 403 mut fa que un agent reintenti en bucle.** docs/05 §2 i docs/08 §3 hi
 * insisteixen: quan una petició es rebutja per abast, l'error ha de dir quins àmbits
 * veu el token i on és la cosa que ha demanat. Per això `params` porta dades i no és
 * un adorn.
 */

/** Les dades d'un error. El client les fa servir per compondre el text del catàleg. */
export type ErrorParams = Record<string, string | number>;

export class PolicyError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly params: ErrorParams;

  constructor(
    type: string,
    title: string,
    status: number,
    detail: string,
    params: ErrorParams = {},
  ) {
    super(`${title}: ${detail}`);
    this.name = 'PolicyError';
    this.type = `https://femho.app/errors/${type}`;
    this.title = title;
    this.status = status;
    this.detail = detail;
    this.params = params;
  }

  /** El `slug` sense el prefix. És el que el client converteix en clau de catàleg. */
  get slug(): string {
    return this.type.slice(this.type.lastIndexOf('/') + 1);
  }

  toProblem(instance?: string): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      // Sense paràmetres no s'hi posa la clau: un `params: {}` a cada resposta és soroll
      // que qui llegeixi l'API ha d'aprendre a ignorar.
      ...(Object.keys(this.params).length === 0 ? {} : { params: this.params }),
      ...(instance === undefined ? {} : { instance }),
    };
  }
}

export function unauthenticated(detail = 'Authentication required.'): PolicyError {
  return new PolicyError('unauthenticated', 'Authentication required', 401, detail);
}

export function missingCapability(capability: string): PolicyError {
  return new PolicyError(
    'missing-capability',
    'Capability not granted',
    403,
    `This token does not have the "${capability}" capability.`,
    { capability },
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
  const sees =
    visibleNames.length === 0
      ? 'This token has access to no scope'
      : visibleNames.length === 1
        ? `This token only has access to the ${visibleNames[0]} scope`
        : `This token has access to the ${visibleNames.join(', ')} scopes`;

  const where =
    requestedName === undefined
      ? ''
      : entity === undefined
        ? ` The ${requestedName} scope is not among them.`
        : ` ${entity.type} ${entity.id} is in ${requestedName}.`;

  /**
   * Els `params` porten les **dades**, no la frase muntada.
   *
   * `visible` va com a llista separada per comes perquè `params` és pla —el client no
   * ha de saber muntar un JSON dins d'un JSON per pintar un error—, i el catàleg de
   * cada idioma la posa on toqui amb la seva puntuació.
   */
  return new PolicyError(
    'scope-forbidden',
    'Scope not accessible',
    403,
    `${sees}.${where}`,
    {
      count: visibleNames.length,
      visible: visibleNames.join(', '),
      ...(requestedName === undefined ? {} : { requested: requestedName }),
      ...(entity === undefined ? {} : { entityType: entity.type, entityId: entity.id }),
    },
  );
}

export function notFound(entityType: string, id: string): PolicyError {
  return new PolicyError(
    'not-found',
    'Not found',
    404,
    `There is no ${entityType} with identifier ${id}.`,
    { entityType, id },
  );
}

export function versionConflict(): PolicyError {
  return new PolicyError(
    'version-conflict',
    'Version conflict',
    409,
    'Someone else changed this in the meantime. The current state is returned so it can be merged.',
  );
}
