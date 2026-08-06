/**
 * Migració 002 — reserves de tasques delegades (docs/09 §5).
 *
 * `docs/01` no porta aquesta taula: la necessitat surt de `docs/09`, que exigeix que
 * "l'assignació de la reserva ha de ser atòmica: dos `next_task` simultanis han de rebre
 * tasques diferents". Sense reserva, dos agents amb el mateix token fan la mateixa feina
 * dues vegades.
 *
 * **`task_id` és la clau primària, i aquí és on viu l'atomicitat.** Un `INSERT` que
 * violi la clau vol dir que algú altre ja la té, i això funciona igual a SQLite i a
 * Postgres sense cap `SELECT … FOR UPDATE` ni cap bloqueig explícit. Amb una columna a
 * `tasks` caldria llegir-la i escriure-la, i entremig hi cap un altre agent.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

function ddl(engine: Engine): string[] {
  const t = typeMap(engine);

  return [
    `CREATE TABLE task_leases (
      task_id     ${t.text} PRIMARY KEY NOT NULL REFERENCES tasks(id),
      user_id     ${t.text} NOT NULL REFERENCES users(id),
      agent_id    ${t.text} REFERENCES ai_agents(id),
      acquired_at ${t.instant} NOT NULL,
      expires_at  ${t.instant} NOT NULL
    )`,
    // La consulta que més es fa és "quines han caducat": una reserva caducada torna a
    // estar disponible i s'ha de poder trobar sense recórrer la taula.
    `CREATE INDEX idx_task_leases_expiry ON task_leases(expires_at)`,
  ];
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS task_leases').execute(db);
}
