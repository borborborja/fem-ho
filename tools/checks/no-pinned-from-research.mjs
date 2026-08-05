#!/usr/bin/env node
/**
 * no-pinned-from-research — comprovació permanent de docs/13.
 *
 * "Versions copiades dels dossiers."
 *
 * Regla 2 d'instruccions.md: cap versió de dependència surt de research/. Es resolen en
 * crear l'scaffold, es comproven contra el registre real, i es congelen al lockfile.
 *
 * COM S'IMPLEMENTA, I PER QUÈ NO ÉS UNA COMPARACIÓ CONTRA research/
 * ------------------------------------------------------------------
 * La primera idea òbvia és comparar les versions fixades contra les que diuen els
 * dossiers i fallar si coincideixen. És equivocada: comprovat contra el registre el
 * 2026-08-05, la majoria de les versions que docs/14 Part 3 marcava com a inventades
 * són CORRECTES — typescript 6.0.3, vite 8.2.0, eslint 10.8.0, react 19.2.8. Fallar
 * per coincidir amb un dossier obligaria a triar una versió pitjor per motius
 * cerimonials.
 *
 * El que la regla vol de veritat és que cap versió entri sense procedència comprovable.
 * Per tant: cada dependència directa de cada package.json ha de tenir entrada a
 * resolved-versions.json, amb la versió i la data de consulta, i han de coincidir.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/scan.mjs';

const MANIFESTS = [
  'package.json',
  join('apps', 'server', 'package.json'),
  join('apps', 'web', 'package.json'),
  join('packages', 'contracts', 'package.json'),
  join('packages', 'design-system', 'package.json'),
];

const resolved = JSON.parse(
  readFileSync(join(ROOT, 'tools', 'checks', 'resolved-versions.json'), 'utf8'),
).resolved;

const problems = [];
let checked = 0;

for (const manifest of MANIFESTS) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
  } catch {
    continue;
  }

  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      // Els enllaços interns del monorepo no tenen versió de registre.
      if (name.startsWith('@fem-ho/')) continue;
      checked += 1;

      const entry = resolved[name];
      if (entry === undefined) {
        problems.push(
          `${manifest}: "${name}" no té procedència a resolved-versions.json. ` +
            `Consulta \`npm view ${name} version\`, anota-la amb la data, i després instal·la-la.`,
        );
        continue;
      }
      if (entry.version !== spec) {
        problems.push(
          `${manifest}: "${name}" està fixada a ${spec} però la procedència diu ${entry.version}.`,
        );
      }
      if (typeof entry.checkedAt !== 'string') {
        problems.push(`resolved-versions.json: "${name}" no diu quan es va consultar.`);
      }
    }
  }
}

// Cap versió es pot fixar amb un rang: el lockfile congela, però un rang al manifest
// convida a la deriva entre desenvolupadors.
for (const manifest of MANIFESTS) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
  } catch {
    continue;
  }
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (name.startsWith('@fem-ho/')) continue;
      if (/^[\^~><*]|\s-\s|\|\|/.test(spec)) {
        problems.push(`${manifest}: "${name}" fa servir el rang "${spec}". Fixa la versió exacta.`);
      }
    }
  }
}

console.log(`no-pinned-from-research · ${checked} dependències directes comprovades`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problemes de procedència:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('  totes tenen procedència registrada i versió exacta.');
