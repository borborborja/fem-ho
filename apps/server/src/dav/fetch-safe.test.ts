/**
 * docs/13 M10 · `test: ssrf`.
 *
 * Les set mitigacions de docs/10 §7, cap opcional. Cada prova és un atac concret, no una
 * comprovació genèrica: la llista de rangs bloquejats no serveix de res si el que
 * s'oblida és validar la redirecció.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SsrfError, isBlockedAddress, resolveSafely, safeFetch } from './fetch-safe.js';

/** Un DNS de mentida perquè les proves no depenguin de la xarxa. */
const dns = (map: Record<string, string[]>) => async (hostname: string) =>
  map[hostname] ?? Promise.reject(new Error('NXDOMAIN'));

describe('mitigació 1 · només http i https', () => {
  it.each(['file:///etc/passwd', 'gopher://intern/', 'ftp://intern/'])(
    'rebutja %s',
    async (url) => {
      await expect(resolveSafely(new URL(url))).rejects.toBeInstanceOf(SsrfError);
    },
  );

  it('http i https passen', async () => {
    const resolve = dns({ 'exemple.com': ['93.184.216.34'] });
    await expect(
      resolveSafely(new URL('https://exemple.com/cal.ics'), { resolve }),
    ).resolves.toMatchObject({ address: '93.184.216.34' });
  });
});

describe('mitigació 3 · rangs bloquejats', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'aquesta xarxa'],
    ['10.0.0.5', 'RFC 1918'],
    ['172.16.3.4', 'RFC 1918'],
    ['172.31.255.255', 'RFC 1918, límit alt'],
    ['192.168.1.1', 'el router de casa'],
    ['169.254.169.254', 'servei de metadades'],
    ['100.64.0.1', 'CGNAT'],
    ['224.0.0.1', 'multicast'],
    ['198.18.0.1', 'proves de rendiment'],
  ])('bloqueja %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['93.184.216.34', 'pública'],
    ['8.8.8.8', 'pública'],
    ['172.15.0.1', 'just per sota del rang privat'],
    ['172.32.0.1', 'just per damunt del rang privat'],
  ])('deixa passar %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it.each([
    ['::1', 'loopback'],
    ['fe80::1', 'enllaç local'],
    ['fc00::1', 'única local'],
    ['fd12:3456::1', 'única local'],
    ['ff02::1', 'multicast'],
    ['::ffff:127.0.0.1', 'loopback mapat a IPv6'],
    ['::ffff:192.168.1.1', 'privada mapada a IPv6'],
  ])('bloqueja %s (%s)', (address) => {
    // L'adreça mapada és la que se'n va: passa totes les comprovacions d'IPv6 i cap de
    // les d'IPv4 si no es desembolica.
    expect(isBlockedAddress(address)).toBe(true);
  });

  it('deixa passar una IPv6 pública', () => {
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('el que no és una IP tampoc no passa', () => {
    expect(isBlockedAddress('no-soc-una-ip')).toBe(true);
    expect(isBlockedAddress('999.1.1.1')).toBe(true);
  });
});

describe('mitigació 2 · es comprova la IP, no el nom', () => {
  it('un nom públic que resol a loopback es rebutja', async () => {
    // `localhost.attacker.com` és un nom d'aspecte innocent que resol a 127.0.0.1.
    // Cap comprovació de cadenes ho veuria.
    const resolve = dns({ 'calendari.exemple.com': ['127.0.0.1'] });
    await expect(
      resolveSafely(new URL('https://calendari.exemple.com/'), { resolve }),
    ).rejects.toThrow(/adreça interna/u);
  });

  it('TOTES les adreces han de passar, no només la primera', async () => {
    // Un nom que resol a una pública i una privada és el cas clàssic de reassignació.
    const resolve = dns({ 'doble.exemple.com': ['93.184.216.34', '192.168.1.1'] });
    await expect(resolveSafely(new URL('https://doble.exemple.com/'), { resolve })).rejects.toThrow(
      /192\.168\.1\.1/u,
    );
  });

  it('una IP literal privada tampoc no passa', async () => {
    await expect(resolveSafely(new URL('http://192.168.1.1/admin'))).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it('una IPv6 literal privada entre claudàtors tampoc', async () => {
    await expect(resolveSafely(new URL('http://[fd00::1]/'))).rejects.toBeInstanceOf(SsrfError);
  });
});

describe('mitigació 7 · llista blanca', () => {
  const resolve = dns({
    'calendari.exemple.com': ['93.184.216.34'],
    'altre.com': ['93.184.216.35'],
    'sub.calendari.exemple.com': ['93.184.216.36'],
  });

  it('amb llista, el que no hi és no passa encara que sigui públic', async () => {
    await expect(
      resolveSafely(new URL('https://altre.com/'), {
        resolve,
        allowHosts: ['calendari.exemple.com'],
      }),
    ).rejects.toThrow(/llista/u);
  });

  it('un subdomini del permès sí que passa', async () => {
    await expect(
      resolveSafely(new URL('https://sub.calendari.exemple.com/'), {
        resolve,
        allowHosts: ['calendari.exemple.com'],
      }),
    ).resolves.toBeDefined();
  });

  it('sense llista, tot el que passi la resta val', async () => {
    await expect(resolveSafely(new URL('https://altre.com/'), { resolve })).resolves.toBeDefined();
  });
});

describe('mitigacions 5 i 6 · contra un servidor viu', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? '/';

      if (path === '/cap-a-dins') {
        // El parany: una redirecció d'una URL pública cap a la xarxa interna. Si només
        // es validés el primer salt, aquí s'hi aniria de cap.
        response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        response.end();
        return;
      }

      if (path === '/bucle') {
        response.writeHead(302, { Location: '/bucle' });
        response.end();
        return;
      }

      if (path === '/gran') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('x'.repeat(200_000));
        return;
      }

      if (path === '/lent') {
        // No respon mai: és el que fa saltar el temps màxim.
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/calendar' });
      response.end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /**
   * El servidor de proves és a loopback, i la protecció el bloqueja amb raó. Aquestes
   * proves no volen apagar-la: volen provar el transport —redireccions, mida, temps— i
   * per això substitueixen la comprovació per una **igual d'estricta menys per a
   * `127.0.0.1`**. La redirecció cap a `169.254.169.254` la segueix aturant.
   *
   * No hi ha cap manera de fer això des de la configuració, i és volgut: la prova de
   * sota comprova que per defecte loopback es rebutja.
   */
  const permetLoopback = {
    guard: async (url: URL) => {
      const host = url.hostname;
      if (host !== '127.0.0.1' && isBlockedAddress(host)) {
        throw new SsrfError(`"${host}" és una adreça interna.`);
      }
      return { address: host, family: 4 };
    },
  };

  it('per defecte, loopback es rebutja encara que hi hagi un servidor', async () => {
    // Sense això, les altres proves d'aquest bloc estarien provant una versió
    // afluixada de la protecció sense que se sabés.
    await expect(safeFetch(`${base}/calendari.ics`)).rejects.toBeInstanceOf(SsrfError);
  });

  it('una redirecció cap a la xarxa interna es bloqueja', async () => {
    await expect(
      safeFetch(`${base}/cap-a-dins`, { ...permetLoopback, maxRedirects: 3 }),
    ).rejects.toThrow(/interna/u);
  });

  it('un bucle de redireccions es talla', async () => {
    await expect(
      safeFetch(`${base}/bucle`, { ...permetLoopback, maxRedirects: 3 }),
    ).rejects.toThrow(/redireccions/u);
  });

  it('una resposta massa gran es talla', async () => {
    await expect(safeFetch(`${base}/gran`, { ...permetLoopback, maxBytes: 1000 })).rejects.toThrow(
      /mida màxima/u,
    );
  });

  it('un servidor que no respon no penja el procés', async () => {
    await expect(safeFetch(`${base}/lent`, { ...permetLoopback, timeoutMs: 300 })).rejects.toThrow(
      /temps màxim/u,
    );
  });

  it('una petició normal funciona', async () => {
    const response = await safeFetch(`${base}/calendari.ics`, permetLoopback);
    expect(response.status).toBe(200);
    expect(response.body).toContain('BEGIN:VCALENDAR');
  });

  it('el verb va en MAJÚSCULES', async () => {
    // `fetch` només normalitza els verbs estàndard: `propfind` en minúscules viatja
    // així i el servidor remot respon 501 (docs/07 §1).
    let vist: string | undefined;
    const espia = createServer((request, response) => {
      vist = request.method;
      response.writeHead(207, { 'Content-Type': 'application/xml' });
      response.end('<multistatus xmlns="DAV:"/>');
    });
    await new Promise<void>((resolve) => espia.listen(0, '127.0.0.1', resolve));
    const port = (espia.address() as AddressInfo).port;

    await safeFetch(`http://127.0.0.1:${String(port)}/`, {
      ...permetLoopback,
      method: 'propfind',
    });

    expect(vist).toBe('PROPFIND');
    await new Promise<void>((resolve) => espia.close(() => resolve()));
  });
});

describe('robustesa', () => {
  it('una URL que no és una URL es rebutja', async () => {
    await expect(safeFetch('no soc una url')).rejects.toBeInstanceOf(SsrfError);
  });

  it('un nom que no resol es rebutja', async () => {
    await expect(
      resolveSafely(new URL('https://no-existeix.invalid/'), { resolve: dns({}) }),
    ).rejects.toThrow(/resoldre/u);
  });
});
