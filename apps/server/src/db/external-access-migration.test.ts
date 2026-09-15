import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { it, expect } from 'vitest';
import { connect } from './connection.js';
import { migrateDown, migrateToLatest } from './migrator.js';
import { readExternalAccess } from '../services/external-access.js';

it('congela els àmbits dels tokens personals antics sense incorporar els futurs', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'femho-migration-external-'));
  const conn = connect(`sqlite://${join(temp, 'db')}`);
  try {
    await migrateToLatest(conn.db, { engine: 'sqlite' });
    expect(await migrateDown(conn.db, 'sqlite')).toBe('024-external-access');
    const now = new Date().toISOString();
    await sql`INSERT INTO users (id,email,name,kind,role,created_at,updated_at) VALUES ('u','migration@example.com','Migration','human','member',${now},${now})`.execute(
      conn.db,
    );
    await sql`INSERT INTO scopes (id,name,kind,color,owner_id,position,created_at,updated_at) VALUES ('old','Personal','individual','--plou-blue','u','a1',${now},${now})`.execute(
      conn.db,
    );
    await sql`INSERT INTO api_tokens (id,user_id,name,token_prefix,token_hash,capabilities,scope_ids,created_at) VALUES ('legacy','u','Legacy','prefix','hash','["tasks:read"]',NULL,${now})`.execute(
      conn.db,
    );
    await migrateToLatest(conn.db, { engine: 'sqlite' });
    await sql`INSERT INTO scopes (id,name,kind,color,owner_id,position,created_at,updated_at) VALUES ('future','Feina','individual','--plou-blue','u','a2',${now},${now})`.execute(
      conn.db,
    );
    const token = await sql<{
      scope_ids: string;
      channels: string;
    }>`SELECT scope_ids, channels FROM api_tokens WHERE id = 'legacy'`.execute(conn.db);
    expect(JSON.parse(token.rows[0]!.scope_ids)).toEqual(['old']);
    expect(JSON.parse(token.rows[0]!.channels)).toEqual(['api', 'mcp']);
    expect(await readExternalAccess(conn.db, 'u')).toEqual({
      api_enabled: true,
      mcp_enabled: true,
    });
  } finally {
    await conn.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
