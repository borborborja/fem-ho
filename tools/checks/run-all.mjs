#!/usr/bin/env node
/**
 * Executa les vuit comprovacions permanents de docs/13.
 *
 * Les executa TOTES abans de decidir el resultat: aturar-se a la primera obliga a fer
 * vuit rondes per veure vuit problemes.
 *
 * Dues encara no poden funcionar i ho diuen clarament, amb la fita on s'activen. No es
 * marquen com a passades: una comprovació que diu "verd" sense comprovar res és pitjor
 * que no tenir-la.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHECKS = [
  { name: 'openapi-diff', script: 'openapi-diff.mjs' },
  { name: 'vocab-lint', script: 'vocab-lint.mjs', selfTest: true },
  { name: 'no-hardcoded-colors', script: 'no-hardcoded-colors.mjs', selfTest: true },
  { name: 'i18n-lint', script: 'i18n-lint.mjs', selfTest: true },
  { name: 'no-pinned-from-research', script: 'no-pinned-from-research.mjs' },
  { name: 'contrast-check', script: 'contrast-check.mjs' },
  {
    name: 'audit-coverage',
    pending: 'M3',
    why: "necessita els endpoints d'escriptura i la taula activity_log",
  },
  {
    name: 'parser-parity',
    pending: 'M6 (TS) i M13 (Kotlin)',
    why: 'necessita els fixtures del parser i les dues implementacions',
  },
];

const results = [];

for (const check of CHECKS) {
  if (check.pending !== undefined) {
    results.push({
      name: check.name,
      state: 'pendent',
      detail: `s'activa a ${check.pending} — ${check.why}`,
    });
    continue;
  }

  const script = fileURLToPath(new URL(`./${check.script}`, import.meta.url));

  if (check.selfTest === true) {
    const self = spawnSync(process.execPath, [script, '--self-test'], { stdio: 'inherit' });
    if (self.status !== 0) {
      results.push({ name: check.name, state: 'trencada', detail: "l'autoprova ha fallat" });
      continue;
    }
  }

  const res = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  results.push({ name: check.name, state: res.status === 0 ? 'passa' : 'falla' });
  console.log('');
}

console.log('─'.repeat(72));
for (const r of results) {
  const mark = { passa: '  ok  ', falla: ' FALLA', trencada: ' TRENC', pendent: ' pend ' }[r.state];
  console.log(`[${mark}] ${r.name}${r.detail === undefined ? '' : ` · ${r.detail}`}`);
}

const bad = results.filter((r) => r.state === 'falla' || r.state === 'trencada');
if (bad.length > 0) {
  console.error(`\n${bad.length} comprovacions no passen.`);
  process.exit(1);
}
const pending = results.filter((r) => r.state === 'pendent').length;
console.log(`\nTotes les comprovacions actives passen. ${pending} encara no aplicables.`);
