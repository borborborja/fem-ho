#!/usr/bin/env node
/**
 * Porta el full d'instruccions de l'agent al servidor.
 *
 *   node tools/gen/agent-skill.mjs           genera
 *   node tools/gen/agent-skill.mjs --check   comprova que el generat estigui al dia
 *
 * **Per què hi ha un generat i no es llegeix el fitxer.** Els tres textos viuen a
 * `docs/agent/skill/` perquè és on es revisen i es tradueixen amb la resta de documentació.
 * El servidor els ha de poder servir a Ajustos ▸ Usuari IA, i el `Dockerfile` **no copia
 * `docs/`**: llegir-los del disc en temps d'execució faria una funció que va bé al portàtil
 * i desapareix dins la imatge sense donar cap error, que és el pitjor dels dos móns.
 *
 * És la mateixa família que `tokens-compose` i `strings-xml`: hi ha una font, hi ha un
 * generat amb la capçalera que ho diu, i una comprovació permanent que no puguin divergir.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../checks/lib/scan.mjs';

const FONT = join(ROOT, 'docs', 'agent', 'skill');
const SORTIDA = join(ROOT, 'apps', 'server', 'src', 'ai', 'skill.generated.ts');
const IDIOMES = ['ca', 'en', 'es'];

function build() {
  const blocs = IDIOMES.map((lang) => {
    const text = readFileSync(join(FONT, `${lang}.md`), 'utf8');
    // Literal de plantilla: el text porta cometes, apòstrofs i salts de línia, i escapar
    // només els accents greus i `${` el deixa llegible al costat de l'original.
    const escapat = text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
    return `  ${lang}: \`${escapat}\`,`;
  });

  return `/**
 * GENERAT per tools/gen/agent-skill.mjs — NO EDITAR.
 *
 * La font és docs/agent/skill/{ca,en,es}.md. Es regenera i es compromet el resultat:
 * editar això és inútil, perquè la comprovació permanent el torna a escriure.
 *
 * Viu al codi i no es llegeix del disc perquè el Dockerfile no copia docs/ (veure el
 * generador). Serveix \`GET /api/v1/ai/skill\`, que és d'on el copia i el baixa la gent.
 */

export const AGENT_SKILL: Record<'ca' | 'en' | 'es', string> = {
${blocs.join('\n')}
};
`;
}

const generat = build();
const check = process.argv.includes('--check');

if (check) {
  // Si el generat no hi és, `actual` queda buit i la comparació falla, que és el que ha de
  // passar: «no s'ha generat mai» és tan divergent com «està desactualitzat».
  let actual;
  try {
    actual = readFileSync(SORTIDA, 'utf8');
  } catch {
    actual = '';
  }
  if (actual !== generat) {
    console.error(
      "agent-skill · el full d'instruccions del servidor no coincideix amb docs/agent/skill/.\n" +
        'Executa `node tools/gen/agent-skill.mjs` i compromet el resultat.',
    );
    process.exit(1);
  }
  console.log(`agent-skill · al dia (${String(IDIOMES.length)} idiomes)`);
} else {
  writeFileSync(SORTIDA, generat);
  console.log(`agent-skill · escrit ${SORTIDA}`);
}
