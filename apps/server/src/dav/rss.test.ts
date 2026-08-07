/**
 * L'RSS com a font del calendari.
 *
 * No és a `docs/07`: ve del disseny validat, que promet que "els esdeveniments d'aquest
 * RSS es mostren al calendari". Les proves fixen les tres coses que decideixen si això
 * és cert o només ho sembla: que se'n llegeixi la data, que l'identificador sigui
 * estable entre refrescos, i que un canal trencat no s'endugui la resta.
 */

import { describe, expect, it } from 'vitest';
import { extractFeedEvents, parseFeed } from './rss.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Escola</title>
    <item>
      <title>Reunió de pares</title>
      <link>https://escola.example/reunio</link>
      <guid isPermaLink="false">reunio-2026-09</guid>
      <pubDate>Tue, 15 Sep 2026 18:30:00 +0200</pubDate>
    </item>
    <item>
      <title>Sortida al bosc</title>
      <link>https://escola.example/bosc</link>
      <pubDate>Wed, 30 Sep 2026 09:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Ajuntament</title>
  <entry>
    <title>Recollida de voluminosos</title>
    <link href="https://ajuntament.example/voluminosos"/>
    <id>tag:ajuntament,2026:voluminosos</id>
    <published>2026-10-02T07:00:00Z</published>
  </entry>
</feed>`;

describe('llegir el canal', () => {
  it("treu el títol, l'enllaç i la data d'un RSS 2.0", () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('Reunió de pares');
    expect(items[0]?.link).toBe('https://escola.example/reunio');
    // RFC 822 amb desfasament: les 18:30 de Madrid a l'estiu són les 16:30 UTC.
    expect(items[0]?.at).toBe('2026-09-15T16:30:00.000Z');
  });

  it("també llegeix Atom, on l'enllaç és un atribut i no el text", () => {
    const items = parseFeed(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Recollida de voluminosos');
    expect(items[0]?.link).toBe('https://ajuntament.example/voluminosos');
    expect(items[0]?.at).toBe('2026-10-02T07:00:00.000Z');
  });

  it("un canal que no s'entén no peta: torna el que hagi pogut llegir", () => {
    expect(parseFeed('<rss><channel><item><title>A</title>')).toHaveLength(0);
    expect(parseFeed('no sóc xml')).toEqual([]);
  });

  it('un element sense data no arriba al calendari', () => {
    const sense = `<rss><channel><item><title>Sense data</title></item></channel></rss>`;
    expect(parseFeed(sense)).toHaveLength(1);
    expect(extractFeedEvents(sense, 'cal-1')).toHaveLength(0);
  });
});

describe('convertir en esdeveniments', () => {
  it('cada element és un instant, no una durada', () => {
    const [primer] = extractFeedEvents(RSS, 'cal-1');
    expect(primer?.startsAt).toBe('2026-09-15T16:30:00.000Z');
    // Donar-li mitja hora perquè es vegi millor seria inventar-se una dada.
    expect(primer?.endsAt).toBe(primer?.startsAt);
    expect(primer?.allDay).toBe(false);
  });

  it("l'identificador és estable entre refrescos", () => {
    const primera = extractFeedEvents(RSS, 'cal-1');
    const segona = extractFeedEvents(RSS, 'cal-1');
    expect(primera.map((c) => c.uid)).toEqual(segona.map((c) => c.uid));
    // Amb `guid`, el UID el porta; sense, surt del resum de l'enllaç i el títol.
    expect(primera[0]?.uid).toBe('cal-1-reunio-2026-09');
    expect(primera[1]?.uid).toMatch(/^cal-1-[0-9a-f]{32}$/u);
  });

  it('dos canals diferents no es trepitgen encara que publiquin el mateix', () => {
    const [un] = extractFeedEvents(RSS, 'cal-1');
    const [altre] = extractFeedEvents(RSS, 'cal-2');
    expect(un?.uid).not.toBe(altre?.uid);
  });

  it("el `raw_ical` és un VCALENDAR servible, amb l'enllaç a dins", () => {
    const [primer] = extractFeedEvents(RSS, 'cal-1');
    expect(primer?.raw).toContain('BEGIN:VCALENDAR');
    expect(primer?.raw).toContain('BEGIN:VEVENT');
    expect(primer?.raw).toContain('SUMMARY:Reunió de pares');
    expect(primer?.raw).toContain('https://escola.example/reunio');
  });

  it("una data nua és de tot el dia: no s'inventa cap hora", () => {
    const nu = `<rss><channel><item><title>Festa major</title><guid>fm</guid>
      <pubDate>2026-08-15</pubDate></item></channel></rss>`;
    const [event] = extractFeedEvents(nu, 'cal-1');
    expect(event?.allDay).toBe(true);
  });
});
