import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SQLite from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connect, type Connection } from './connection.js';
import { MIGRATIONS, migrateDown, migrateToLatest } from './migrator.js';

const NOW = '2026-11-19T10:00:00.000Z';
const BACKUP_NAME = 'femho-2026-11-19T10-00-00-000Z.db';

describe('la còpia SQLite abans de migrar', () => {
  let conn: Connection;
  let dataDir: string;
  let databasePath: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'femho-migration-backup-'));
    databasePath = join(dataDir, 'femho.db');
    conn = connect(`sqlite://${databasePath}`);
    await migrateToLatest(conn.db, { engine: 'sqlite' });
    await migrateDown(conn.db, 'sqlite');
  });

  afterEach(async () => {
    await conn.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('restaura les files confirmades al WAL amb l’esquema anterior', async () => {
    await sql`PRAGMA wal_autocheckpoint = 0`.execute(conn.db);
    await sql`CREATE TABLE backup_probe (id INTEGER PRIMARY KEY)`.execute(conn.db);
    await sql`INSERT INTO backup_probe VALUES (1)`.execute(conn.db);
    await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(conn.db);
    // La segona fila només és al WAL. Comprovar només `integrity_check` amagaria la pèrdua.
    await sql`INSERT INTO backup_probe VALUES (2)`.execute(conn.db);
    expect(statSync(`${databasePath}-wal`).size).toBeGreaterThan(0);

    const result = await migrateToLatest(conn.db, {
      engine: 'sqlite',
      databasePath,
      dataDir,
      now: NOW,
    });
    const latest = MIGRATIONS.at(-1)!.name;
    expect(result.applied).toEqual([latest]);
    const backupPath = join(dataDir, 'backups', BACKUP_NAME);
    expect(result.backup).toBe(backupPath);
    expect(readdirSync(join(dataDir, 'backups'))).toEqual([BACKUP_NAME]);

    const restored = new SQLite(backupPath, { readonly: true, fileMustExist: true });
    try {
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restored.prepare('SELECT id FROM backup_probe ORDER BY id').all()).toEqual([
        { id: 1 },
        { id: 2 },
      ]);
      expect(
        restored.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(latest),
      ).toBeUndefined();
    } finally {
      restored.close();
    }
  });

  it('atura la migració si la còpia no es pot publicar i permet reintentar', async () => {
    const backupsDir = join(dataDir, 'backups');
    const blocked = join(backupsDir, BACKUP_NAME);
    mkdirSync(blocked, { recursive: true });
    const options = { engine: 'sqlite' as const, databasePath, dataDir, now: NOW };

    await expect(migrateToLatest(conn.db, options)).rejects.toThrow();
    const latest = MIGRATIONS.at(-1)!.name;
    const applied = await sql`SELECT name FROM schema_migrations WHERE name = ${latest}`.execute(
      conn.db,
    );
    expect(applied.rows).toEqual([]);
    expect(readdirSync(backupsDir)).toEqual([BACKUP_NAME]);

    rmSync(blocked, { recursive: true });
    await expect(migrateToLatest(conn.db, options)).resolves.toMatchObject({
      applied: [latest],
      backup: blocked,
    });
  });

  it('conserva la còpia nova i quatre d’anteriors quan el rellotge va enrere', async () => {
    const backupsDir = join(dataDir, 'backups');
    mkdirSync(backupsDir);
    const previous = ['20', '21', '22', '23', '24'].map(
      (day) => `femho-2026-11-${day}T10-00-00-000Z.db`,
    );
    for (const name of previous) writeFileSync(join(backupsDir, name), 'còpia anterior');

    await migrateToLatest(conn.db, { engine: 'sqlite', databasePath, dataDir, now: NOW });

    expect(readdirSync(backupsDir).sort()).toEqual([BACKUP_NAME, ...previous.slice(1)]);
  });
});
