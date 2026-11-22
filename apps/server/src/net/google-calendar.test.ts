import { describe, expect, it, vi } from 'vitest';
import { createGoogleCalendarProvider } from './google-calendar.js';

const config = {
  baseUrl: 'https://femho.example.test',
  googleClientId: 'calendar-client',
  googleClientSecret: 'calendar-secret',
};
const start = '2025-11-22T00:00:00.000Z';
const end = '2027-11-22T00:00:00.000Z';

describe('Google Calendar', () => {
  it('demana només l’accés de calendari i selecciona un compte Google', () => {
    const url = new URL(
      createGoogleCalendarProvider(config).authorizationUrl('state', 'pkce', 'nonce'),
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://femho.example.test/api/v1/calendars/google/oauth/callback',
    );
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ]);
    expect(url.searchParams.get('prompt')).toContain('select_account');
  });

  it('segueix la paginació i manté els paràmetres compatibles amb el cursor', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        Response.json({ accessRole: 'owner', nextPageToken: 'page-two', items: [] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          accessRole: 'owner',
          nextSyncToken: 'cursor',
          items: [{ id: 'event', etag: 'etag' }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          accessRole: 'owner',
          nextSyncToken: 'next-cursor',
          items: [{ id: 'event', status: 'cancelled' }],
        }),
      );
    const provider = createGoogleCalendarProvider(config, fetcher);
    const id = 'calendar+test@example.net';
    const first = await provider.listEvents('bearer', id, start, end);
    expect(first).toEqual({
      accessRole: 'owner',
      events: [{ id: 'event', etag: 'etag' }],
      syncToken: 'cursor',
    });
    expect(await provider.listEvents('bearer', id, start, end, first.syncToken)).toMatchObject({
      events: [{ id: 'event', status: 'cancelled' }],
      syncToken: 'next-cursor',
    });
    const calls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
    expect(calls[0]!.pathname).toBe('/calendar/v3/calendars/calendar%2Btest%40example.net/events');
    expect(calls[0]!.searchParams.get('timeMin')).toBe(start);
    expect(calls[1]!.searchParams.get('timeMax')).toBe(end);
    expect(calls[1]!.searchParams.get('pageToken')).toBe('page-two');
    expect(calls[2]!.searchParams.get('syncToken')).toBe('cursor');
    expect(calls[2]!.searchParams.has('timeMin')).toBe(false);
    for (const call of calls) {
      expect(call.searchParams.get('singleEvents')).toBe('true');
      expect(call.searchParams.get('showDeleted')).toBe('true');
    }
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer bearer',
    );
  });

  it('avisa quan una pàgina falla i no torna un resultat parcial', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(Response.json({ accessRole: 'reader', nextPageToken: 'remaining' }))
      .mockResolvedValueOnce(Response.json({}, { status: 410 }));
    const provider = createGoogleCalendarProvider(config, fetcher);
    await expect(provider.listEvents('token', 'c', start, end, 'stale')).rejects.toMatchObject({
      status: 410,
    });
  });
});
