/**
 * On es pot connectar el correu, i amb quines opcions.
 *
 * **Cap d'aquestes proves obre una connexió.** El que ha de ser cert —quines adreces es
 * rebutgen i que la verificació del certificat no s'apagui mai— no necessita cap servidor,
 * i una prova que necessités xarxa seria una prova que un dia se salta.
 */

import { describe, expect, it } from 'vitest';
import { SsrfError } from '../dav/fetch-safe.js';
import { imapOptions, resolveImapHost, readableError, type ImapTarget } from './imap-connect.js';

const resol =
  (...addresses: string[]) =>
  async (): Promise<string[]> =>
    addresses;

const TARGET: ImapTarget = {
  host: 'imap.example.test',
  port: 993,
  security: 'tls',
  username: 'borja',
  password: 'x',
};

describe('a on es pot anar', () => {
  it('una adreça pública passa', async () => {
    await expect(
      resolveImapHost('imap.example.test', 993, { resolve: resol('93.184.216.34') }),
    ).resolves.toBe('93.184.216.34');
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.5', 'RFC 1918'],
    ['192.168.1.10', 'la xarxa de casa'],
    ['169.254.169.254', 'les metadades del núvol'],
    ['::1', 'loopback en IPv6'],
    ['::ffff:127.0.0.1', 'loopback disfressat'],
  ])('%s es rebutja (%s)', async (address) => {
    await expect(resolveImapHost(address, 993, {})).rejects.toThrow(SsrfError);
  });

  it('i un nom que resol a una interna, també', async () => {
    await expect(
      resolveImapHost('imap.example.test', 993, { resolve: resol('127.0.0.1') }),
    ).rejects.toThrow(/interna/u);
  });

  it("**totes** les adreces han de passar, no només la primera", async () => {
    /**
     * El cas clàssic de reassignació: un nom que resol a una pública i una privada. Si
     * només es validés la primera, el sistema es podria acabar connectant a la segona.
     */
    await expect(
      resolveImapHost('imap.example.test', 993, { resolve: resol('93.184.216.34', '10.0.0.5') }),
    ).rejects.toThrow(/10\.0\.0\.5/u);
  });

  it('només els ports 993 i 143', async () => {
    // Sense això, un «compte de correu» a `localhost:6379` és una manera de fer que el
    // servidor parli amb el Redis de la casa.
    for (const port of [6379, 22, 80, 3306]) {
      await expect(
        resolveImapHost('imap.example.test', port, { resolve: resol('93.184.216.34') }),
      ).rejects.toThrow(SsrfError);
    }
    await expect(
      resolveImapHost('imap.example.test', 143, { resolve: resol('93.184.216.34') }),
    ).resolves.toBe('93.184.216.34');
  });

  it("la llista d'amfitrions permesos acota encara més, si n'hi ha", async () => {
    const options = { resolve: resol('93.184.216.34'), allowHosts: ['example.test'] };
    // El sufix hi val, perquè és com es mapa un proveïdor sencer.
    await expect(resolveImapHost('imap.example.test', 993, options)).resolves.toBeDefined();
    await expect(resolveImapHost('imap.altra.test', 993, options)).rejects.toThrow(/permesos/u);
  });
});

describe('amb quines opcions', () => {
  it('es connecta a la IP validada i verifica el certificat contra el nom', () => {
    /**
     * Això és el que `safeFetch` **no pot fer** amb HTTPS: allà s'ha de donar el nom i
     * tornar-hi a confiar, i entre la comprovació i la connexió hi ha una segona
     * resolució de DNS que pot donar una altra resposta. Aquí aquella finestra es tanca.
     */
    const options = imapOptions(TARGET, '93.184.216.34', 15_000);
    expect(options.host).toBe('93.184.216.34');
    expect(options.servername).toBe('imap.example.test');
    expect(options.tls?.servername).toBe('imap.example.test');
  });

  it('i la verificació no s’apaga mai', () => {
    // El cas simpàtic és un Dovecot de casa amb certificat propi. La resposta és afegir
    // la CA, no un interruptor que desactiva la verificació per a tothom qui hi cliqui.
    for (const security of ['tls', 'starttls'] as const) {
      const options = imapOptions({ ...TARGET, security }, '93.184.216.34', 1000);
      expect(options.tls?.rejectUnauthorized).toBe(true);
      expect(options.secure).toBe(security === 'tls');
    }
  });
});

describe('el que es diu quan falla', () => {
  it('unes credencials dolentes es diuen tal com són', () => {
    expect(readableError(new Error('Command failed: AUTHENTICATIONFAILED'))).toContain(
      'contrasenya',
    );
  });

  it("i la resposta crua del servidor no surt mai", () => {
    /**
     * Una resposta d'IMAP pot dur el nom d'usuari i part de la comanda, i això acaba en
     * una captura de pantalla en un xat de suport.
     */
    const cru = 'NO [AUTHENTICATIONFAILED] Invalid credentials for user borja@example.test';
    expect(readableError(new Error(cru))).not.toContain('borja@example.test');
  });

  it("i amb un certificat, es diu la sortida bona", () => {
    const missatge = readableError(new Error('self signed certificate in certificate chain'));
    expect(missatge).toContain('CA');
  });
});
