#!/usr/bin/env node
/**
 * mail-invariants — la comprovació permanent número setze.
 *
 * El correu és el canal més hostil del producte: és l'únic on **qualsevol pot escriure't**
 * sense que li donis res. Tres coses hi han de ser certes sempre, i les tres es trencarien
 * en silenci —cap prova fallaria, cap error sortiria— i es notarien mesos després.
 *
 * 1 · `rejectUnauthorized: false` NO APAREIX ENLLOC
 * -------------------------------------------------
 * Hauria aturat el pitjor error que aquesta funció pot cometre, i **el pitjor és que es
 * cometria amb bona intenció**: algú amb un Dovecot de casa i un certificat propi, algú
 * ajudant-lo, un «només mentre ho provo». Un cop escrit, el TLS deixa de protegir de res
 * per a tothom qui hi passi, i no hi ha cap símptoma.
 *
 * La sortida bona és afegir la CA a la instància, i `readableError` ho diu amb aquestes
 * paraules quan un certificat falla.
 *
 * 2 · NO ES TOQUEN ELS INDICADORS DE NINGÚ
 * ----------------------------------------
 * `setFlags`, `messageFlagsAdd` i `\Seen` no apareixen als mòduls de correu. Modificar la
 * bústia d'algú és la manera més ràpida de fer que desconfiï de la funció, i **que no ho
 * fem ha de ser una regla i no un costum**: un costum deixa de ser cert en un any, quan
 * algú necessiti marcar «processat» i li sembli innocent.
 *
 * 3 · CAP ÍNDEX ÚNIC SOBRE `mail_messages` QUE INCLOGUI `uid`
 * -----------------------------------------------------------
 * L'anàleg directe de la lliçó de la 011, i el que aquesta comprovació existeix per aturar:
 * desduplicar per UID **sembla una optimització**. Ho és fins que el servidor de correu
 * reindexa —el protocol diu literalment «oblida tots els UID que t'he donat»—, i llavors la
 * següent lectura duplica **cada tasca creada des del primer dia**. Sense error, mesos
 * després, i sense desfer massiu.
 */

import { join } from 'node:path';
import { ROOT, report, walk } from './lib/scan.mjs';

/** Els fitxers on viu el correu. Fora d'aquí, `\Seen` pot ser qualsevol altra cosa. */
const MAIL_FILES = /(mail|imap)/iu;

const RULES = [
  {
    id: 'no-reject-unauthorized-false',
    // Amb espais i salts pel mig: `rejectUnauthorized:\n  false` és el mateix defecte.
    pattern: /rejectUnauthorized\s*:\s*false/u,
    message:
      'Desactivar la verificació del certificat TLS. La sortida per a un servidor amb ' +
      "certificat propi és afegir-ne la CA a la instància, no un interruptor que l'apaga " +
      'per a tothom qui hi passi.',
    everywhere: true,
  },
  {
    id: 'no-touching-flags',
    pattern: /\b(setFlags|messageFlagsAdd|messageFlagsSet|messageFlagsRemove)\b|\\\\Seen/u,
    message:
      "Modificar els indicadors de la bústia d'algú. Res del que fem ha de marcar cap " +
      'correu: les carpetes s\'obren amb `readOnly` (que en IMAP és `EXAMINE`).',
    everywhere: false,
  },
];

/** Un índex únic sobre `mail_messages` que inclogui `uid`. */
const UNIQUE_UID = /CREATE\s+UNIQUE\s+INDEX[^;]*\bON\s+mail_messages\s*\(([^)]*)\)/giu;

const violations = [];

for (const file of walk(join(ROOT, 'apps', 'server', 'src'), ['.ts'])) {
  const esCorreu = MAIL_FILES.test(file.rel);

  // Els comentaris no compten: aquest fitxer i els capçals del correu **han de poder
  // anomenar** el que prohibeixen, o no podrien explicar per què.
  const codi = file.text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
  const lines = codi.split('\n');

  for (const rule of RULES) {
    if (!rule.everywhere && !esCorreu) continue;
    for (const [index, line] of lines.entries()) {
      if (rule.pattern.test(line)) {
        violations.push({
          rel: file.rel,
          line: index + 1,
          rule: rule.id,
          message: rule.message,
          excerpt: line.trim(),
        });
      }
    }
  }

  for (const match of codi.matchAll(UNIQUE_UID)) {
    const columns = match[1].split(',').map((c) => c.trim().toLowerCase());
    if (!columns.includes('uid')) continue;

    const line = codi.slice(0, match.index).split('\n').length;
    violations.push({
      rel: file.rel,
      line,
      rule: 'no-unique-index-on-uid',
      message:
        "La identitat d'un correu és el seu `Message-ID`, mai l'UID d'IMAP (P11 a docs/14). " +
        'Una reindexació del servidor invalida tots els UID de cop, i amb això la següent ' +
        'lectura duplicaria cada tasca creada des del primer dia.',
      excerpt: match[0].split('\n')[0].trim(),
    });
  }
}

/**
 * L'autoprova.
 *
 * `run-all` la crida amb `--self-test` perquè una comprovació que no detecta res passa en
 * verd exactament igual que una que funciona. Els casos són el defecte de veritat, no una
 * versió simplificada: si el patró deixés de trobar-los, això falla abans que el codi.
 */
if (process.argv.includes('--self-test')) {
  const cases = [
    ['tls: { rejectUnauthorized: false }', 'no-reject-unauthorized-false', true],
    ['rejectUnauthorized : false,', 'no-reject-unauthorized-false', true],
    ['rejectUnauthorized: true,', 'no-reject-unauthorized-false', false],
    ["await client.messageFlagsAdd(uid, ['\\\\Seen'])", 'no-touching-flags', true],
    ['await client.mailboxOpen(path, { readOnly: true })', 'no-touching-flags', false],
  ];

  let bad = 0;
  for (const [text, id, expected] of cases) {
    const rule = RULES.find((r) => r.id === id);
    const hit = rule.pattern.test(text);
    if (hit !== expected) {
      bad += 1;
      console.error(`  ✗ "${text}" → ${String(hit)}, s'esperava ${String(expected)}`);
    }
  }

  const indexos = [
    ['CREATE UNIQUE INDEX i ON mail_messages(account_id, uid)', true],
    ['CREATE UNIQUE INDEX i ON mail_messages(account_id, message_key)', false],
  ];
  for (const [sql, expected] of indexos) {
    UNIQUE_UID.lastIndex = 0;
    const match = UNIQUE_UID.exec(sql);
    const hit =
      match !== null &&
      match[1]
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .includes('uid');
    if (hit !== expected) {
      bad += 1;
      console.error(`  ✗ "${sql}" → ${String(hit)}, s'esperava ${String(expected)}`);
    }
  }

  console.log(`mail-invariants --self-test · ${String(cases.length + indexos.length)} casos`);
  if (bad > 0) process.exit(1);
  console.log('  autoprova correcta.');
  process.exit(0);
}

process.exit(report('mail-invariants', violations));
