import { z } from 'zod';
import type { Config } from '../config.js';
import {
  createGoogleOAuthProvider,
  googleMailConfigured,
  type GoogleOAuthProvider,
} from './google-oauth.js';

export type GoogleCalendarConfig = Pick<
  Config,
  'baseUrl' | 'googleClientId' | 'googleClientSecret'
> & {
  enabled?: boolean;
};
export function googleCalendarConfigured(config: GoogleCalendarConfig): boolean {
  return config.enabled !== false && googleMailConfigured(config);
}

const scopes = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export type GoogleCalendarAccessRole = 'reader' | 'writerWithoutPrivateAccess' | 'writer' | 'owner';

export function isGoogleCalendarReadable(role: unknown): role is GoogleCalendarAccessRole {
  return (
    role === 'reader' ||
    role === 'writerWithoutPrivateAccess' ||
    role === 'writer' ||
    role === 'owner'
  );
}

export function isGoogleCalendarWritable(role: unknown): boolean {
  return role === 'writer' || role === 'writerWithoutPrivateAccess' || role === 'owner';
}

export interface GoogleCalendarChoice {
  id: string;
  name: string;
  primary: boolean;
  access_role: GoogleCalendarAccessRole;
  writable: boolean;
}

const googleDate = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});

export const googleEventSchema = z.object({
  id: z.string().min(1).max(1024),
  etag: z.string().min(1).optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  visibility: z.enum(['default', 'public', 'private', 'confidential']).optional(),
  transparency: z.enum(['opaque', 'transparent']).optional(),
  start: googleDate.optional(),
  end: googleDate.optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().min(1).max(1024).optional(),
  originalStartTime: googleDate.optional(),
  eventType: z.string().optional(),
  locked: z.boolean().optional(),
  attendeesOmitted: z.boolean().optional(),
  attendees: z.array(z.object({ self: z.boolean().optional() })).optional(),
  organizer: z.object({ self: z.boolean().optional() }).optional(),
  guestsCanModify: z.boolean().optional(),
});

export type GoogleCalendarEvent = z.infer<typeof googleEventSchema>;

export function isGoogleEventPrivate(event: Pick<GoogleCalendarEvent, 'visibility'>): boolean {
  return event.visibility === 'private' || event.visibility === 'confidential';
}

export function googleEventWritable(event: GoogleCalendarEvent): boolean {
  return (
    event.status !== 'cancelled' &&
    event.locked !== true &&
    !event.recurrence?.length &&
    (event.eventType === undefined || event.eventType === 'default') &&
    (event.organizer?.self === true ||
      (event.organizer?.self === undefined && !googleEventHasGuests(event)))
  );
}

export function googleEventHasGuests(event: GoogleCalendarEvent): boolean {
  return (
    event.attendeesOmitted === true || event.attendees?.some((attendee) => !attendee.self) === true
  );
}

export interface GoogleCalendarSnapshot {
  accessRole: GoogleCalendarAccessRole;
  events: GoogleCalendarEvent[];
  syncToken?: string | undefined;
}

export interface GoogleCalendarRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean> | undefined;
  body?: Record<string, unknown> | undefined;
  etag?: string | undefined;
}

export interface GoogleCalendarProvider extends GoogleOAuthProvider {
  listCalendars(accessToken: string): Promise<GoogleCalendarChoice[]>;
  listEvents(
    accessToken: string,
    remoteCalendarId: string,
    timeMin: string,
    timeMax: string,
    syncToken?: string,
  ): Promise<GoogleCalendarSnapshot>;
  request(
    accessToken: string,
    segments: readonly string[],
    options: GoogleCalendarRequest,
  ): Promise<unknown>;
}

export class GoogleCalendarError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super(code);
  }
}

const discoveryPage = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(1024),
        summary: z.string().optional(),
        summaryOverride: z.string().optional(),
        primary: z.boolean().optional(),
        deleted: z.boolean().optional(),
        accessRole: z.string(),
      }),
    )
    .optional(),
});

const eventsPage = z.object({
  accessRole: z.string(),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().min(1).optional(),
  items: z.array(googleEventSchema).optional(),
});

const errorResponse = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

function responseError(status: number, body: unknown): GoogleCalendarError {
  const parsed = errorResponse.safeParse(body);
  const reasons = parsed.success
    ? (parsed.data.error.errors ?? []).map(({ reason }) => reason)
    : [];
  if (
    status === 429 ||
    reasons.some((reason) =>
      ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason ?? ''),
    )
  )
    return new GoogleCalendarError('rate_limited', status);
  switch (status) {
    case 401:
      return new GoogleCalendarError('reconnect_required', status);
    case 403:
      return new GoogleCalendarError('access_denied', status);
    case 404:
    case 410:
      return new GoogleCalendarError('not_found', status);
    case 409:
      return new GoogleCalendarError('already_exists', status);
    case 412:
      return new GoogleCalendarError('conflict', status);
    default:
      return new GoogleCalendarError(
        status >= 500 ? 'provider_unavailable' : 'invalid_response',
        status,
      );
  }
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 8 * 1024 * 1024) {
      await reader.cancel();
      throw new GoogleCalendarError('invalid_response');
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  if (body === '') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    if (!response.ok) return undefined;
    throw new GoogleCalendarError('invalid_response');
  }
}

export function createGoogleCalendarProvider(
  config: GoogleCalendarConfig,
  fetcher: typeof fetch = fetch,
): GoogleCalendarProvider {
  if (!googleCalendarConfigured(config)) throw new GoogleCalendarError('not_configured');
  const oauth = createGoogleOAuthProvider(config, {
    redirectPath: '/api/v1/calendars/google/oauth/callback',
    requiredScopes: scopes,
  });
  async function request(
    accessToken: string,
    segments: readonly string[],
    options: GoogleCalendarRequest,
  ): Promise<unknown> {
    if (segments.some((segment) => segment === '.' || segment === '..' || segment === ''))
      throw new GoogleCalendarError('invalid_resource', 422);
    const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
    const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, String(value));
    const headers = new Headers({ Authorization: `Bearer ${accessToken}` });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.etag !== undefined) headers.set('If-Match', options.etag);
    try {
      const response = await fetcher(url, {
        method: options.method,
        headers,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const result = await readJson(response);
      if (!response.ok) throw responseError(response.status, result);
      return result;
    } catch (error) {
      if (error instanceof GoogleCalendarError) throw error;
      throw new GoogleCalendarError('provider_unavailable');
    }
  }
  return {
    ...oauth,
    request,
    async listCalendars(accessToken) {
      const calendars = new Map<string, GoogleCalendarChoice>();
      let page: string | undefined;
      const seen = new Set<string>();
      do {
        const data = discoveryPage.safeParse(
          await request(accessToken, ['users', 'me', 'calendarList'], {
            method: 'GET',
            query: { maxResults: 250, showHidden: true, ...(page ? { pageToken: page } : {}) },
          }),
        );
        if (!data.success) throw new GoogleCalendarError('invalid_response');
        for (const calendar of data.data.items ?? []) {
          if (calendar.deleted === true || !isGoogleCalendarReadable(calendar.accessRole)) continue;
          calendars.set(calendar.id, {
            id: calendar.id,
            name: calendar.summaryOverride || calendar.summary || calendar.id,
            primary: calendar.primary === true,
            access_role: calendar.accessRole,
            writable: isGoogleCalendarWritable(calendar.accessRole),
          });
        }
        page = nextPage(data.data.nextPageToken, seen);
      } while (page !== undefined);
      return Array.from(calendars.values()).sort(
        (a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name),
      );
    },
    async listEvents(accessToken, remoteCalendarId, timeMin, timeMax, syncToken) {
      const events: GoogleCalendarEvent[] = [];
      let accessRole: GoogleCalendarAccessRole | undefined;
      let page: string | undefined;
      let nextSyncToken: string | undefined;
      const seen = new Set<string>();
      do {
        const data = eventsPage.safeParse(
          await request(accessToken, ['calendars', remoteCalendarId, 'events'], {
            method: 'GET',
            query: {
              maxResults: 1000,
              singleEvents: true,
              showDeleted: true,
              ...(syncToken === undefined ? { timeMin, timeMax } : { syncToken }),
              ...(page ? { pageToken: page } : {}),
            },
          }),
        );
        if (!data.success) throw new GoogleCalendarError('invalid_response');
        if (!isGoogleCalendarReadable(data.data.accessRole))
          throw new GoogleCalendarError('access_denied', 403);
        if (accessRole !== undefined && accessRole !== data.data.accessRole)
          throw new GoogleCalendarError('invalid_response');
        accessRole = data.data.accessRole;
        events.push(...(data.data.items ?? []));
        if (events.length > 15_000) throw new GoogleCalendarError('too_many_events');
        page = nextPage(data.data.nextPageToken, seen);
        nextSyncToken = data.data.nextSyncToken;
      } while (page !== undefined);
      if (nextSyncToken === undefined) throw new GoogleCalendarError('invalid_response');
      return { accessRole, events, syncToken: nextSyncToken };
    },
  };
}

function nextPage(page: string | undefined, seen: Set<string>): string | undefined {
  if (!page) return undefined;
  if (seen.has(page) || seen.size >= 30) throw new GoogleCalendarError('too_many_pages');
  seen.add(page);
  return page;
}
