/**
 * Punt d'entrada del servidor.
 *
 * Ha de tancar net amb SIGTERM: amb SQLite un tall brusc és arriscat, i cada reinici de
 * contenidor n'és un si el procés no col·labora (docs/12 §1).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

function readVersion(): string {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg: unknown = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8'));
  if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
    const { version } = pkg as { version: unknown };
    if (typeof version === 'string') return version;
  }
  throw new Error('El package.json del servidor no té cap versió llegible');
}

async function main(): Promise<void> {
  const config = loadConfig(readVersion());
  const app = buildApp(config);

  if (config.baseUrl === undefined) {
    app.log.warn(
      'FEMHO_BASE_URL no està definida. En desenvolupament és tolerable, però en ' +
        'producció CalDAV i els enllaços compartits generaran URL incorrectes.',
    );
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Tancant');
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
