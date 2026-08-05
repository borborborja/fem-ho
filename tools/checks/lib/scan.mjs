/**
 * Recorregut de fitxers font compartit per les comprovacions de text.
 *
 * Exclou el que no és codi del projecte: Plou ve vendoritzat i no es reescriu, el
 * prototip és una maqueta amb un DSL que no és el nostre, i els tipus generats els
 * escriu el generador.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'generated']);

/** Rutes senceres excloses, relatives a l'arrel. */
const EXCLUDED_PATHS = [
  join('packages', 'design-system', 'plou'),
  join('design', 'prototip'),
  join('docs'),
  join('research'),
  join('apps', 'android', 'build'),
  // Les comprovacions contenen per força els patrons que prohibeixen: les seves regles
  // són literalment `column: 'fet'` i `femho_list_tasks`. Sense excloure-les, cada
  // linter es denunciaria a si mateix. La seva correcció la garanteix `--self-test`.
  join('tools', 'checks'),
];

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.kt', '.kts', '.sql', '.yaml'];

export function* walk(dir = ROOT, extensions = DEFAULT_EXTENSIONS) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    if (EXCLUDED_PATHS.some((p) => rel === p || rel.startsWith(p + sep))) continue;

    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry)) continue;
      yield* walk(full, extensions);
    } else if (extensions.some((e) => entry.endsWith(e))) {
      yield { path: full, rel, text: readFileSync(full, 'utf8') };
    }
  }
}

/**
 * Un comentari no és codi. Cobreix les quatre formes que es donen al projecte:
 * `//`, `/* …`, `{/* …` de JSX, i la continuació ` * …` d'un bloc.
 *
 * Val per a TOTES les comprovacions de text: un comentari que explica quin patró està
 * prohibit ha de poder escriure'l, o no es pot documentar res.
 */
export function isComment(line) {
  return /^\s*\*|\/\/|\{?\/\*|<!--/.test(line);
}

/**
 * Aplica una llista de regles a un text i retorna les infraccions amb número de línia.
 * Una regla és { name, re, message, allow? }. `allow` és un predicat sobre la línia
 * sencera que perdona un fals positiu conegut.
 */
export function applyRules(text, rules, rel) {
  const violations = [];
  const lines = text.split('\n');
  const IGNORE = /vocab-lint-ignore|check-ignore/;
  const COMMENT = /^\s*(\/\/|\*|\/\*|\{?\/\*)/;

  /**
   * El marcador val a la mateixa línia o dins del bloc de comentari que la precedeix
   * immediatament. Es mira tot el bloc i no només la línia anterior: una excusa ha
   * d'explicar-se, i una explicació sovint no cap en una línia.
   */
  function isIgnored(index) {
    if (IGNORE.test(lines[index])) return true;
    for (let j = index - 1; j >= 0 && COMMENT.test(lines[j]); j -= 1) {
      if (IGNORE.test(lines[j])) return true;
    }
    return false;
  }

  for (const [i, line] of lines.entries()) {
    if (isIgnored(i)) continue;
    // Cap regla salta dins d'un comentari, tret que ho demani explícitament.
    if (isComment(line)) continue;

    for (const rule of rules) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(line);
      if (m === null) continue;
      if (rule.allow !== undefined && rule.allow(line, m)) continue;
      violations.push({
        rel,
        line: i + 1,
        rule: rule.name,
        message: rule.message,
        excerpt: line.trim().slice(0, 120),
      });
    }
  }
  return violations;
}

export function report(checkName, violations) {
  if (violations.length === 0) {
    console.log(`${checkName} · net`);
    return 0;
  }
  console.error(`${checkName} · ${violations.length} infraccions:`);
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  [${v.rule}] ${v.message}`);
    console.error(`      ${v.excerpt}`);
  }
  return 1;
}
