#!/usr/bin/env node
/**
 * audit-coverage — comprovació permanent de docs/13.
 *
 * "Una escriptura sense entrada a `activity_log`."
 *
 * docs/13 M3 demana "una prova que recorre tots els endpoints d'escriptura i verifica
 * que cadascun ha escrit al log". Això són dues peces, i totes dues calen:
 *
 *   1. La prova dinàmica, a apps/server/src/**\/*.test.ts, que exercita els endpoints
 *      de veritat i mira que activity_log creixi.
 *   2. AQUESTA, que és estàtica i és la que impedeix que un endpoint d'escriptura NOU
 *      entri sense que ningú l'hagi cobert. Una prova dinàmica només cobreix el que
 *      algú ha recordat escriure; això obliga a recordar-ho.
 *
 * El mecanisme: tota operació d'escriptura d'openapi.yaml —POST, PUT, PATCH, DELETE—
 * ha de tenir entrada a audit-coverage.json. O està coberta, o està exempta **amb un
 * motiu escrit**. No hi ha tercera opció, i afegir un endpoint sense tocar aquest
 * fitxer fa fallar CI.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/scan.mjs';

const SPEC = join(ROOT, 'packages', 'contracts', 'openapi.yaml');
const MANIFEST = join(ROOT, 'tools', 'checks', 'audit-coverage.json');

const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/**
 * Extreu les operacions d'escriptura d'openapi.yaml.
 *
 * Es llegeix amb expressions regulars i no amb un analitzador de YAML a posta: aquesta
 * comprovació no ha de dependre de cap paquet, i el fitxer és nostre i té una forma
 * coneguda. Si algun dia deixa de ser previsible, es canvia — però llavors ja tindrem
 * un problema més gros que aquest script.
 */
function writeOperations(yaml) {
  const operations = [];
  let currentPath = null;
  let currentMethod = null;

  for (const line of yaml.split('\n')) {
    // Fi de la secció de rutes.
    if (/^components:/.test(line)) break;

    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch !== null) {
      currentPath = pathMatch[1];
      currentMethod = null;
      continue;
    }

    const methodMatch = /^ {4}([a-z]+):\s*$/.exec(line);
    if (methodMatch !== null && currentPath !== null) {
      currentMethod = WRITE_METHODS.has(methodMatch[1]) ? methodMatch[1] : null;
      continue;
    }

    const idMatch = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (idMatch !== null && currentMethod !== null && currentPath !== null) {
      operations.push({
        operationId: idMatch[1],
        method: currentMethod.toUpperCase(),
        path: currentPath,
      });
      currentMethod = null;
    }
  }

  return operations;
}

const yaml = readFileSync(SPEC, 'utf8');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const operations = writeOperations(yaml);

const covered = new Set(Object.keys(manifest.audited ?? {}));
const exempt = manifest.exempt ?? {};

const problems = [];

for (const op of operations) {
  if (covered.has(op.operationId)) continue;

  const reason = exempt[op.operationId];
  if (typeof reason === 'string' && reason.trim() !== '') continue;

  problems.push(
    `${op.method} ${op.path} (${op.operationId}) escriu i no consta a audit-coverage.json. ` +
      'Afegeix-lo a "audited" amb la prova que ho comprova, o a "exempt" amb el motiu.',
  );
}

// La llista tampoc pot tenir entrades fantasma: un endpoint esborrat que es quedi al
// manifest fa que la cobertura sembli més gran del que és.
const known = new Set(operations.map((o) => o.operationId));
for (const id of [...covered, ...Object.keys(exempt)]) {
  if (!known.has(id)) {
    problems.push(
      `audit-coverage.json parla de "${id}", que ja no és cap escriptura del contracte.`,
    );
  }
}

console.log(
  `audit-coverage · ${operations.length} operacions d'escriptura al contracte, ` +
    `${covered.size} cobertes i ${Object.keys(exempt).length} exemptes`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} problemes de cobertura:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log('  cap escriptura sense cobertura declarada.');
