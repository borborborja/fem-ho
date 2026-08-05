/**
 * Prova de contracte de les rutes d'instància.
 *
 * docs/05 §8 punt 4: "Proves de contracte que llancen peticions reals contra el
 * servidor i validen les respostes contra l'esquema."
 *
 * Es valida contra l'esquema d'openapi.yaml llegit del fitxer, no contra una còpia
 * escrita aquí. Si algú canvia la forma de la resposta sense tocar el contracte, això
 * ha de petar — que és tot el sentit de la regla 5.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

/** Lector mínim de l'esquema: en treu les propietats requerides i les permeses. */
function schemaOf(name: string): { required: string[]; properties: string[]; additional: boolean } {
  const yaml = readFileSync(
    fileURLToPath(new URL('../../../../packages/contracts/openapi.yaml', import.meta.url)),
    'utf8',
  );
  const block = yaml.split(`    ${name}:\n`)[1];
  if (block === undefined) throw new Error(`L'esquema ${name} no és a openapi.yaml`);
  const body = block.split(/\n {4}\w/)[0] ?? '';

  const requiredLine = body.match(/required:\s*\[([^\]]*)\]/);
  const required =
    requiredLine === null
      ? []
      : requiredLine[1]!
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');

  const propsBlock = body.split('properties:\n')[1] ?? '';
  const properties = [...propsBlock.matchAll(/^ {8}(\w+):/gm)].map((m) => m[1]!);

  return { required, properties, additional: !body.includes('additionalProperties: false') };
}

function appForTest() {
  // Sense variables d'entorn: s'han de fer servir els valors per defecte de docs/12 §3.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }
  // El log de peticions no aporta res a la sortida de les proves i n'amaga els errors.
  return buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' });
}

describe('GET /info', () => {
  it('respon amb el nom i la versió de la instància', async () => {
    const app = appForTest();
    const res = await app.inject({ method: 'GET', url: '/info' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.name).toBe('Fem-ho');
    expect(body.version).toBe('0.1.0-test');

    await app.close();
  });

  it("compleix l'esquema Info del contracte", async () => {
    const app = appForTest();
    const res = await app.inject({ method: 'GET', url: '/info' });
    const body = res.json<Record<string, unknown>>();
    const schema = schemaOf('Info');

    for (const key of schema.required) {
      expect(body, `falta el camp requerit "${key}"`).toHaveProperty(key);
    }
    if (!schema.additional) {
      for (const key of Object.keys(body)) {
        expect(schema.properties, `"${key}" no és al contracte`).toContain(key);
      }
    }

    await app.close();
  });

  it('per defecte no accepta altes, que és el correcte per a una instància exposada', async () => {
    const app = appForTest();
    const body = (await app.inject({ method: 'GET', url: '/info' })).json<{
      registration: string;
    }>();
    expect(body.registration).toBe('disabled');
    await app.close();
  });

  it('és pública: no demana cap credencial', async () => {
    const app = appForTest();
    const res = await app.inject({ method: 'GET', url: '/info' });
    expect(res.statusCode).not.toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
    await app.close();
  });
});

describe('GET /healthz', () => {
  it('diu que el procés és viu', async () => {
    const app = appForTest();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

describe('capçaleres de seguretat', () => {
  // docs/10 §8. Es comproven a una ruta qualsevol perquè s'apliquen a totes.
  it('van a totes les respostes', async () => {
    const app = appForTest();
    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

    await app.close();
  });
});
