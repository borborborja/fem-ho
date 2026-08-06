/**
 * Límits numèrics que arriben de fora.
 *
 * Existeix perquè `Math.min(Math.max(value, min), max)` **no és una barrera**: amb `NaN`,
 * totes dues comparacions són falses i el `NaN` passa de llarg intacte. Escrit així
 * sembla que hi hagi validació, i el `NaN` acaba a un `LIMIT` de SQL, que respon amb un
 * `SQLITE_MISMATCH` i un 500.
 *
 * Ho va destapar una sonda amb `?limit=abc`: hi havia el clamp als dos llocs on es fa
 * servir, i als dos petava igual.
 */

export interface ClampOptions {
  min: number;
  max: number;
  fallback: number;
}

/**
 * Un enter dins de rang, o el valor per defecte.
 *
 * Qualsevol cosa que no sigui un número finit —`NaN`, `Infinity`, una cadena, `null`,
 * un objecte— cau al valor per defecte. **No es llança**: un `?limit=abc` és un client
 * despistat, no un atac, i mereix la pàgina normal amb el límit de sempre.
 */
export function clampInt(value: unknown, { min, max, fallback }: ClampOptions): number {
  /**
   * **No es fa servir `Number(value)` a seques.** `Number(null)`, `Number('')` i
   * `Number([])` són tots `0`, i el clamp els portaria al mínim: un `?limit=` buit
   * acabaria demanant una fila, que no és el que ningú volia dir. Un valor absent és
   * absent, no zero.
   */
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    parsed = Number(value);
  } else {
    return fallback;
  }

  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
