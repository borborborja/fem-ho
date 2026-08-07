#!/usr/bin/env node
/**
 * scope-predicate — comprovació permanent.
 *
 * "Un cinquè lloc que decideixi qui veu un àmbit."
 *
 * EL DEFECTE QUE EXISTEIX PER ATURAR
 * ----------------------------------
 * El predicat de pertinença —`owner_id = ? OR EXISTS(scope_members …)`— estava escrit
 * **quatre vegades**: `listScopes`, `visibleScopeNames` i `assertScopeAccess` a
 * `services/scopes.ts`, i `scopeIdsOwnedBy` a `policy/resolve.ts`. Amb àmbits compartits
 * la pertinença deixa de ser trivial, i quatre còpies són quatre oportunitats de divergir.
 *
 * El que fa que això sigui pitjor que un simple duplicat és **com falla**: si un camí
 * d'accés nou no surt de `scopeIdsOwnedBy`, `intersectScopes` (`policy/resolve.ts`)
 * l'esborra sense error i sense registre, i **només per als tokens amb abast**. La sessió
 * del navegador no en té, o sigui que el defecte passa la prova manual i falla a Android,
 * a MCP i a la federació.
 *
 * COM ES COMPROVA
 * ---------------
 * Cap SQL del servidor pot anomenar `scope_members` fora de dos llocs: el predicat únic
 * (`policy/scope-visibility.ts`) i el CRUD de membres (`services/scopes.ts`), que
 * legítimament llegeix i escriu la taula.
 */

import { join } from 'node:path';
import { isComment, report, ROOT, walk } from './lib/scan.mjs';

/** Els dos únics fitxers que poden anomenar la taula. */
const ALLOWED = [
  join('apps', 'server', 'src', 'policy', 'scope-visibility.ts'),
  join('apps', 'server', 'src', 'services', 'scopes.ts'),
];

const TABLE = /\bscope_members\b/u;

/** Les migracions la creen i la modifiquen: és la seva feina. */
const MIGRATIONS = join('apps', 'server', 'src', 'db', 'migrations');

/**
 * Dos fitxers més que l'anomenen sense decidir res de pertinença:
 *
 * - `db/types.ts` és la declaració de taules de Kysely. És un tipus, no una consulta.
 * - `services/admin.ts` esborra les files d'un usuari que se'n va i llista la taula per
 *   netejar la instància. Són manteniment de la taula, no una comprovació d'accés.
 */
const HOUSEKEEPING = [
  join('apps', 'server', 'src', 'db', 'types.ts'),
  join('apps', 'server', 'src', 'services', 'admin.ts'),
];

export function offends(rel, line) {
  if (ALLOWED.includes(rel)) return false;
  if (HOUSEKEEPING.includes(rel)) return false;
  if (rel.startsWith(MIGRATIONS)) return false;
  if (rel.endsWith('.test.ts')) return false;
  if (isComment(line)) return false;
  return TABLE.test(line);
}

if (process.argv.includes('--self-test')) {
  const cases = [
    ['apps/server/src/services/tasks.ts', 'FROM scope_members m WHERE …', true],
    ['apps/server/src/policy/resolve.ts', 'EXISTS (SELECT 1 FROM scope_members)', true],
    [ALLOWED[0], 'FROM scope_members m', false], // el predicat únic
    [ALLOWED[1], 'FROM scope_members m LEFT JOIN users', false], // el CRUD de membres
    ['apps/server/src/db/migrations/001-initial-schema.ts', 'CREATE TABLE scope_members', false],
    ['apps/server/src/http/invariants.test.ts', 'INSERT INTO scope_members', false],
    ['apps/server/src/services/events.ts', '// scope_members no es toca aquí', false],
    ['apps/server/src/db/types.ts', 'scope_members: ScopeMembers;', false], // és un tipus
    ['apps/server/src/services/admin.ts', 'DELETE FROM scope_members', false], // manteniment
    ['apps/server/src/services/events.ts', 'WHERE scope_id IN (…)', false],
  ];

  let bad = 0;
  for (const [rel, line, expected] of cases) {
    if (offends(rel, line) !== expected) {
      console.error(`  ${rel}: "${line}" esperava ${String(expected)}`);
      bad += 1;
    }
  }
  console.log(`scope-predicate --self-test · ${String(cases.length)} casos`);
  if (bad > 0) process.exit(1);
  console.log('  autoprova correcta.');
  process.exit(0);
}

const violations = [];
for (const file of walk(join(ROOT, 'apps', 'server', 'src'), ['.ts'])) {
  const lines = file.text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (offends(file.rel, line)) {
      violations.push({
        rel: file.rel,
        line: index + 1,
        rule: 'scope-membership',
        message:
          'La pertinença a un àmbit es decideix a `policy/scope-visibility.ts` i enlloc més. ' +
          'Un camí que no en surti, `intersectScopes` el retalla en silenci.',
        excerpt: line.trim(),
      });
    }
  }
}

process.exit(report('scope-predicate', violations));
