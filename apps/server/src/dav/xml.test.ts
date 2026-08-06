/**
 * La capa XML del camí DAV.
 *
 * El que es prova aquí és exactament el parany de `docs/07` §1: **el mateix document
 * amb prefixos diferents ha de donar el mateix resultat**. Els cossos venen de clients
 * de veritat, no escrits d'esma (docs/07 §11).
 */

import { describe, expect, it } from 'vitest';
import {
  APPLE,
  CALDAV,
  CALENDARSERVER,
  DAV,
  XmlError,
  attribute,
  child,
  children,
  dav,
  escapeText,
  href,
  parseXml,
  serialize,
} from './xml.js';

/** El PROPFIND de descobriment que envia DAVx⁵. */
const DAVX5 = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop><d:current-user-principal/><d:resourcetype/><cs:getctag/></d:prop>
</d:propfind>`;

/** El mateix, però com l'escriu Apple: altres prefixos i l'ordre canviat. */
const APPLE_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<A:propfind xmlns:A="DAV:" xmlns:B="http://calendarserver.org/ns/">
  <A:prop><B:getctag/><A:resourcetype/><A:current-user-principal/></A:prop>
</A:propfind>`;

describe('despatx per espai de noms', () => {
  it('el MATEIX document amb prefixos diferents dona el mateix', () => {
    const llegeix = (body: string): string[] => {
      const root = parseXml(body);
      const prop = child(root!, DAV, 'prop');
      return prop!.children.map((c) => `${c.uri} ${c.local}`).sort();
    };

    expect(llegeix(DAVX5)).toEqual(llegeix(APPLE_BODY));
    expect(llegeix(DAVX5)).toEqual([
      'DAV: current-user-principal',
      'DAV: resourcetype',
      'http://calendarserver.org/ns/ getctag',
    ]);
  });

  it('tolera que el client redefineixi xmlns a mig document', () => {
    const root = parseXml(`
      <propfind xmlns="DAV:">
        <prop>
          <resourcetype/>
          <x xmlns="urn:ietf:params:xml:ns:caldav"><calendar-data/></x>
        </prop>
      </propfind>`);

    const prop = child(root!, DAV, 'prop')!;
    expect(child(prop, DAV, 'resourcetype')).toBeDefined();
    // El fill del subarbre redefinit NO és a DAV:, encara que no porti prefix.
    expect(child(prop, CALDAV, 'x')).toBeDefined();
    expect(child(prop, DAV, 'x')).toBeUndefined();
  });

  it("el prefix per defecte no s'aplica als atributs", () => {
    // A l'XML un atribut sense prefix NO hereta l'espai de noms per defecte.
    const root = parseXml('<c xmlns="DAV:" name="general"/>');
    expect(attribute(root!, 'name')).toBe('general');
    expect(attribute(root!, 'name', DAV)).toBeUndefined();
  });

  it('les declaracions xmlns no són atributs', () => {
    const root = parseXml('<d:propfind xmlns:d="DAV:" xmlns="DAV:"/>');
    expect(root!.attributes.size).toBe(0);
  });
});

describe('cossos reals', () => {
  it('el calendar-query de Thunderbird', () => {
    const root = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
      <calendar-query xmlns="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
        <D:prop><D:getetag/><calendar-data/></D:prop>
        <filter>
          <comp-filter name="VCALENDAR">
            <comp-filter name="VEVENT">
              <time-range start="20260801T000000Z" end="20260901T000000Z"/>
            </comp-filter>
          </comp-filter>
        </filter>
      </calendar-query>`);

    expect(root!.uri).toBe(CALDAV);
    expect(root!.local).toBe('calendar-query');

    const filter = child(root!, CALDAV, 'filter')!;
    const vcalendar = child(filter, CALDAV, 'comp-filter')!;
    expect(attribute(vcalendar, 'name')).toBe('VCALENDAR');

    const vevent = child(vcalendar, CALDAV, 'comp-filter')!;
    const range = child(vevent, CALDAV, 'time-range')!;
    expect(attribute(range, 'start')).toBe('20260801T000000Z');
  });

  it('el calendar-multiget amb diversos href', () => {
    const root = parseXml(`
      <C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        <D:prop><D:getetag/><C:calendar-data/></D:prop>
        <D:href>/dav/calendars/borja/personal-todos/a.ics</D:href>
        <D:href>/dav/calendars/borja/personal-todos/b.ics</D:href>
      </C:calendar-multiget>`);

    const hrefs = children(root!, DAV, 'href').map((h) => h.text.trim());
    expect(hrefs).toHaveLength(2);
    expect(hrefs[1]).toBe('/dav/calendars/borja/personal-todos/b.ics');
  });

  it('el sync-collection amb el token', () => {
    const root = parseXml(`
      <d:sync-collection xmlns:d="DAV:">
        <d:sync-token>http://fem-ho/ns/sync/42</d:sync-token>
        <d:sync-level>1</d:sync-level>
        <d:prop><d:getetag/></d:prop>
      </d:sync-collection>`);

    expect(child(root!, DAV, 'sync-token')!.text.trim()).toBe('http://fem-ho/ns/sync/42');
    expect(child(root!, DAV, 'sync-level')!.text.trim()).toBe('1');
  });
});

describe('robustesa', () => {
  it('un cos buit és allprop, no un error', () => {
    // PROPFIND sense cos és legal (RFC 4918 §9.1) i hi ha clients que el fan servir.
    expect(parseXml('')).toBeUndefined();
    expect(parseXml('   \n  ')).toBeUndefined();
  });

  it('un XML mal format es queixa, no es menja mig document', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError);
  });

  it("una bomba d'imbricació es talla", () => {
    const bomba = '<a xmlns="DAV:">'.repeat(500) + '</a>'.repeat(500);
    expect(() => parseXml(bomba)).toThrow(XmlError);
  });
});

describe('escriptura', () => {
  it("declara els quatre espais de noms a l'arrel i no els repeteix", () => {
    const xml = serialize(dav('multistatus', [dav('response', [dav('href', '/dav/')])]));

    for (const uri of [DAV, CALDAV, APPLE, CALENDARSERVER]) expect(xml).toContain(uri);
    // Repetir-los a cada fill és el que fa que una resposta de 200 recursos pesi el
    // triple del que cal.
    expect(xml.match(/xmlns:D=/g)).toHaveLength(1);
  });

  it("un element sense cos s'escriu buit", () => {
    expect(serialize(dav('resourcetype', [dav('collection', null)]))).toContain('<D:collection/>');
  });

  it('escapa el text', () => {
    expect(escapeText('Pa & vi <3')).toBe('Pa &amp; vi &lt;3');
    // `]]>` dins d'un text trencaria el document si `>` no s'escapés.
    expect(escapeText('a]]>b')).toBe('a]]&gt;b');
  });

  it('un href codifica per segments i NO es menja les barres', () => {
    expect(href('/dav/calendars/borja/casa i feina-todos/')).toBe(
      '/dav/calendars/borja/casa%20i%20feina-todos/',
    );
  });

  it("un UID amb # o ? no parteix l'URL", () => {
    // `encodeURI` els deixaria passar i el client llegiria una altra ruta.
    const resultat = href('/dav/c/vacances#2026?v.ics');
    expect(resultat).not.toContain('#');
    expect(resultat).not.toContain('?');
  });

  it("el que s'escriu es pot tornar a llegir", () => {
    const xml = serialize(
      dav('multistatus', [
        dav('response', [
          dav('href', '/dav/calendars/borja/personal-todos/'),
          dav('propstat', [
            dav('prop', [dav('displayname', 'Personal & família')]),
            dav('status', 'HTTP/1.1 200 OK'),
          ]),
        ]),
      ]),
    );

    const root = parseXml(xml)!;
    const response = child(root, DAV, 'response')!;
    const prop = child(child(response, DAV, 'propstat')!, DAV, 'prop')!;
    expect(child(prop, DAV, 'displayname')!.text).toBe('Personal & família');
  });
});
