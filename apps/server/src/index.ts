/**
 * Punt d'entrada del servidor.
 *
 * Ha de tancar net amb SIGTERM: amb SQLite un tall brusc és arriscat, i cada reinici de
 * contenidor n'és un si el procés no col·labora (docs/12 §1).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ensureInstanceSecret } from './config/secret.js';
import { buildDavServer } from './dav/index.js';
import { loadConfig } from './config.js';
import { connect } from './db/connection.js';
import { parseDatabaseUrl } from './db/dialect.js';
import { ensureParentDir, migrateToLatest } from './db/migrator.js';

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

  // El directori s'ha de crear ABANS d'obrir la base: better-sqlite3 no el crea i falla
  // amb "directory does not exist". És el primer arrencament d'un volum nou.
  const target = parseDatabaseUrl(config.databaseUrl);
  const databasePath = target.engine === 'sqlite' ? target.target : undefined;
  if (databasePath !== undefined) ensureParentDir(databasePath);

  const connection = connect(config.databaseUrl);

  /**
   * **Els secrets es generen i es persisteixen a l'arrencada** (docs/12 §7), no la
   * primera vegada que algú els fa servir.
   *
   * Fer-ho mandrós semblava més net —`buildApp` no toca el disc— però tenia un forat
   * seriós: qui fes una còpia de seguretat abans de crear el primer enllaç compartit no
   * s'enduria el `secret.key`, i el dia que restaurés, tots els enllaços creats
   * entremig serien inservibles. `BACKUP.md` diu de copiar `/data`, i `/data` ha de
   * tenir-ho tot des del primer segon.
   */
  const secret = ensureInstanceSecret(config.dataDir, config.secret);
  const app = buildApp(config, { connection, secret });

  /**
   * Les migracions s'executen a l'arrencar, ABANS d'escoltar peticions, i si una falla
   * el procés NO arrenca (docs/12 §5). Res de continuar amb l'esquema a mitges: un
   * servidor que respon amb la meitat de les taules fa molt més mal que un que no
   * arrenca i ho diu.
   */

  try {
    await migrateToLatest(connection.db, {
      engine: connection.engine,
      ...(databasePath === undefined ? {} : { databasePath, dataDir: config.dataDir }),
      log: (message) => app.log.info(message),
    });
  } catch (error) {
    app.log.error({ err: error }, 'Una migració ha fallat. El servidor no arrencarà.');
    await connection.close();
    process.exit(1);
  }

  if (config.baseUrl === undefined) {
    app.log.warn(
      'FEMHO_BASE_URL no està definida. En desenvolupament és tolerable, però en ' +
        'producció CalDAV i els enllaços compartits generaran URL incorrectes.',
    );
  }

  /**
   * El servidor CalDAV, **al mateix procés i en un port propi** (D1 · docs/07 §1).
   *
   * "Al mateix procés" no és una manera de parlar: ctag i sync-token surten del mateix
   * `sync_seq` que s'incrementa dins de la transacció d'escriptura, i un segon procés
   * hauria de compartir-la.
   *
   * Fins ara aquesta línia no hi era. Tota la superfície DAV existia i les seves proves
   * la muntaven elles mateixes amb `buildDavServer`, o sigui que passaven en verd
   * mentre en producció el port 8081 no escoltava ningú. Ho va destapar posar-hi un
   * nginx al davant i rebre un 502.
   */
  const dav = buildDavServer(connection);
  await new Promise<void>((resolve, reject) => {
    dav.once('error', reject);
    dav.listen(config.davPort, '0.0.0.0', () => {
      app.log.info(`CalDAV escoltant al port ${String(config.davPort)}`);
      resolve();
    });
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Tancant');
      void new Promise<void>((resolve) => dav.close(() => resolve()))
        .then(() => app.close())
        .then(() => connection.close())
        .then(() => process.exit(0));
    });
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
