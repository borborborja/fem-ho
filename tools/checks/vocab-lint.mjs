#!/usr/bin/env node
/**
 * vocab-lint — comprovació permanent de docs/13.
 *
 * "column en comptes de status, valors catalans en enums, femho_ en tools d'MCP."
 *
 * Sosté la regla 3 d'instruccions.md: un concepte, un nom, arreu. És una de les tres
 * comprovacions que sostenen les regles no negociables, i docs/13 avisa que sense
 * automatitzar-les es trenquen a la tercera setmana.
 *
 * El prototip que s'ha de portar a M5 parla un altre vocabulari (`column:'fet'`,
 * `iaMode:'auto'`), o sigui que aquesta comprovació és exactament la xarxa que impedeix
 * que el port l'arrossegui cap al codi.
 *
 * Amb --self-test es comprova a si mateixa contra un fragment amb infraccions conegudes.
 */

import { applyRules, report, walk } from './lib/scan.mjs';

const KANBAN_VALUES = 'inbox|todo|doing|done|per_fer|per-fer|fent|fet|bustia|bústia';

const RULES = [
  {
    name: 'status-no-column',
    // `column` com a clau amb un valor de kanban a dins. No toca flexDirection:'column'
    // ni gridTemplateColumns, que són CSS i surten a cada component de Plou.
    re: new RegExp(`\\bcolumn\\s*:\\s*['"\`](${KANBAN_VALUES})['"\`]`, 'i'),
    message: 'El camp es diu `status`, no `column` (D2). `column` xoca amb el vocabulari SQL.',
  },
  {
    name: 'status-no-column-db',
    re: /\b(ALTER|CREATE)[\s\S]*?\bcolumn\s+(TEXT|VARCHAR)/i,
    message: 'Cap taula pot tenir una columna que es digui `column` (D2).',
  },
  {
    name: 'enums-en-angles',
    // Valors catalans de kanban com a literals de cadena.
    re: /['"`](per_fer|per-fer|fent|fet|bustia|bústia)['"`]/i,
    message:
      "Els valors d'enum són en anglès: inbox · todo · doing · done. El català només " +
      'viu als fitxers de traducció (regla 3).',
    // "fet" apareix legítimament dins de textos catalans llargs; només es marca quan és
    // el literal sencer, que és el que fa el regex amb les cometes enganxades.
  },
  {
    name: 'ai-mode-canonic',
    re: /\b(iaMode|ia_mode)\b|['"`](assist|autonoma|autònoma|acompanya)['"`]/i,
    message:
      'El camp és `ai_mode` amb valors manual · assisted · delegated (docs/00). ' +
      "El prototip fa servir iaMode:'off'|'assist'|'auto' i no s'ha de portar.",
  },
  {
    name: 'mcp-sense-prefix',
    re: /['"`]femho_(list|get|create|update|move|complete|add|search|next|release|whoami)/i,
    message:
      "Les tools d'MCP van sense prefix i verb primer: `list_tasks`, no `femho_list_tasks` " +
      '(D6). Els clients ja fan namespace pel seu compte.',
  },
  {
    name: 'id-sense-prefix',
    re: /['"`](tsk|prj|scp|usr|evt)_[0-9a-f]/i,
    message: "L'identificador és un UUIDv7 nu, sense prefix (D4).",
  },
];

if (process.argv.includes('--self-test')) {
  const fixture = [
    "const t = { column: 'fet' };",
    "const mode = 'assist';",
    "tools.register('femho_list_tasks');",
    "const id = 'tsk_0192f3a1';",
    "const ok = { flexDirection: 'column' };", // no ha de saltar
    "const ok2 = { status: 'done' };", // no ha de saltar
    "const ok3 = { gridTemplateColumns: 'repeat(4, 1fr)' };", // no ha de saltar
  ].join('\n');
  const found = applyRules(fixture, RULES, 'autoprova');
  // S'assevera sobre QUINES regles salten, no sobre quantes: `column: 'fet'` en dispara
  // dues alhora —el nom del camp i el valor català— i això és correcte.
  const expected = new Set([
    'status-no-column',
    'enums-en-angles',
    'ai-mode-canonic',
    'mcp-sense-prefix',
    'id-sense-prefix',
  ]);
  const fired = new Set(found.map((v) => v.rule));
  const flaggedLines = new Set(found.map((v) => v.line));

  console.log(`vocab-lint --self-test · ${fired.size}/${expected.size} regles disparades`);
  const missing = [...expected].filter((r) => !fired.has(r));
  // Les línies 5, 6 i 7 del fragment són usos legítims i no han de saltar mai:
  // flexDirection:'column', status:'done' i gridTemplateColumns.
  const falsePositives = [5, 6, 7].filter((l) => flaggedLines.has(l));

  for (const r of missing) console.error(`  NO detecta: ${r}`);
  for (const l of falsePositives) console.error(`  FALS POSITIU a la línia ${l} del fragment`);

  if (missing.length > 0 || falsePositives.length > 0) {
    console.error("L'autoprova no quadra: la comprovació no detecta el que diu que detecta.");
    process.exit(1);
  }
  console.log('  autoprova correcta: detecta les 5 infraccions i cap fals positiu.');
  process.exit(0);
}

const violations = [];
for (const file of walk()) {
  violations.push(...applyRules(file.text, RULES, file.rel));
}
process.exit(report('vocab-lint', violations));
