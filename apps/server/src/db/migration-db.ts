/**
 * El tipus de connexió que rep una migració.
 *
 * Les migracions parlen SQL cru: docs/01 dona el DDL escrit i les seves divergències de
 * dialecte, i un constructor d'esquema portable no sap expressar índexs parcials,
 * `COLLATE BINARY` ni els CHECK compostos sense perdre'n la literalitat.
 *
 * Per tant no necessiten conèixer l'esquema tipat —que és, precisament, el que estan
 * creant— i el reben sense parametritzar.
 */

import type { Kysely, Transaction } from 'kysely';

// Una migració crea l'esquema que els tipus descriuen; no pot dependre'n.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type MigrationDb = Kysely<any> | Transaction<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
