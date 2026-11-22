import { createRequire } from 'node:module';
import type { MailAttachmentMeta, MailBody, MailHeader } from './mail-client.js';

const root = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const require = createRequire(import.meta.url);
type AddressList = { value: { name?: string; address?: string }[] };
const { simpleParser } = require('mailparser') as {
  simpleParser(message: string): Promise<{
    from?: AddressList;
    to?: AddressList | AddressList[];
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string[] | string;
    date?: Date;
  }>;
};

export class GmailError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface GmailLabel {
  id: string;
  name: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  parts?: GmailPart[];
  body?: { size?: number; data?: string; attachmentId?: string };
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessage {
  id: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  sizeEstimate?: number;
  payload?: GmailPart;
}

interface GmailHistoryRecord {
  messagesAdded?: { message?: { id?: string } }[];
  labelsAdded?: { labelIds?: string[]; message?: { id?: string } }[];
}

export interface GmailPage {
  ids: string[];
  nextPageToken?: string | undefined;
}

export interface GmailHistoryPage extends GmailPage {
  historyId: string;
}

export interface GmailMessageHeader extends MailHeader {
  labelIds: string[];
}

export interface GmailClient {
  transport: 'gmail_api';
  profile: () => Promise<{ emailAddress: string; historyId: string }>;
  labels: () => Promise<GmailLabel[]>;
  changes: (labelId: string, cursor: string, pageToken?: string) => Promise<GmailHistoryPage>;
  messages: (labelId: string, after: string, pageToken?: string) => Promise<GmailPage>;
  header: (id: string, maxBytes: number) => Promise<GmailMessageHeader | null>;
  fetchBody: (path: string, uid: string) => Promise<MailBody>;
  fetchAttachment: (
    path: string,
    uid: string,
    part: string,
    maxBytes: number,
  ) => Promise<Uint8Array | null>;
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function boundedJson<T>(response: Response, maxBytes: number): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader) throw new GmailError(502, 'gmail-invalid-response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as T;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new GmailError(413, 'gmail-response-too-large');
    }
    chunks.push(value);
  }
}

function partsOf(rootPart: GmailPart | undefined): GmailPart[] {
  if (!rootPart) return [];
  if (!rootPart.parts?.length) return [rootPart];
  return rootPart.parts.flatMap(partsOf);
}

const headerValue = (part: GmailPart, name: string): string =>
  part.headers?.find((header) => header.name.toLowerCase() === name)?.value ?? '';

export function openGmailClient(accessToken: string): GmailClient {
  async function get<T>(
    path: string,
    params: URLSearchParams = new URLSearchParams(),
    maxBytes = 2 * 1024 * 1024,
  ): Promise<T> {
    try {
      const url = new URL(root + path);
      url.search = params.toString();
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        await res.body?.cancel();
        const code =
          res.status === 401
            ? 'reconnect_required'
            : res.status === 403
              ? 'gmail-access-denied'
              : 'gmail-provider-unavailable';
        throw new GmailError(res.status, code);
      }
      return await boundedJson<T>(res, maxBytes);
    } catch (error) {
      if (error instanceof GmailError) throw error;
      throw new GmailError(502, 'gmail-provider-unavailable');
    }
  }

  let loaded: { id: string; parts: GmailPart[] } | undefined;
  let approvedSize = 0;
  const messagePath = (id: string) => `messages/${encodeURIComponent(id)}`;
  async function partBytes(id: string, part: GmailPart, maxBytes: number): Promise<Buffer | null> {
    const body = part.body;
    if (!body || (body.size ?? Infinity) > maxBytes) return null;
    let data = body.data;
    if (data === undefined && body.attachmentId) {
      ({ data } = await get<{ data?: string }>(
        `${messagePath(id)}/attachments/${encodeURIComponent(body.attachmentId)}`,
        new URLSearchParams({ fields: 'data' }),
        Math.ceil((maxBytes * 4) / 3) + 1024,
      ));
    }
    if (!data || data.length > Math.ceil((maxBytes * 4) / 3) + 4) return null;
    const bytes = Buffer.from(data, 'base64url');
    return bytes.length <= maxBytes ? bytes : null;
  }

  return {
    transport: 'gmail_api',
    async profile() {
      const profile = await get<{ emailAddress?: string; historyId?: string }>(
        'profile',
        new URLSearchParams({ fields: 'emailAddress,historyId' }),
      );
      if (!profile.emailAddress || !profile.historyId)
        throw new GmailError(502, 'gmail-invalid-response');
      return { emailAddress: profile.emailAddress, historyId: profile.historyId };
    },
    async labels() {
      const { labels = [] } = await get<{ labels?: GmailLabel[] }>(
        'labels',
        new URLSearchParams({ fields: 'labels(id,name)' }),
      );
      return labels
        .filter(({ id, name }) => typeof id === 'string' && typeof name === 'string')
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async changes(labelId, cursor, pageToken) {
      const params = new URLSearchParams({
        labelId,
        startHistoryId: cursor,
        maxResults: '50',
        fields:
          'history(messagesAdded(message/id),labelsAdded(labelIds,message/id)),historyId,nextPageToken',
      });
      params.append('historyTypes', 'messageAdded');
      params.append('historyTypes', 'labelAdded');
      if (pageToken) params.set('pageToken', pageToken);
      const {
        history = [],
        historyId,
        nextPageToken,
      } = await get<{
        history?: GmailHistoryRecord[];
        historyId?: string;
        nextPageToken?: string;
      }>('history', params);
      if (!historyId) throw new GmailError(502, 'gmail-invalid-response');
      const ids = new Set<string>();
      for (const change of history) {
        for (const added of change.messagesAdded ?? [])
          if (added.message?.id) ids.add(added.message.id);
        for (const added of change.labelsAdded ?? [])
          if (added.message?.id && added.labelIds?.includes(labelId)) ids.add(added.message.id);
      }
      return { ids: [...ids], historyId, nextPageToken };
    },
    async messages(labelId, after, pageToken) {
      const params = new URLSearchParams({
        labelIds: labelId,
        q: `after:${Math.floor(Date.parse(after) / 1000)}`,
        maxResults: '50',
        fields: 'messages(id),nextPageToken',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const { messages = [], nextPageToken } = await get<{
        messages?: { id: string }[];
        nextPageToken?: string;
      }>('messages', params);
      return { ids: messages.map(({ id }) => id), nextPageToken };
    },
    async header(id, maxBytes) {
      const params = new URLSearchParams({
        format: 'metadata',
        fields: 'id,labelIds,internalDate,sizeEstimate,payload(headers)',
      });
      for (const name of [
        'Message-ID',
        'In-Reply-To',
        'References',
        'Subject',
        'From',
        'To',
        'Date',
      ])
        params.append('metadataHeaders', name);
      let message: GmailMessage;
      try {
        message = await get<GmailMessage>(messagePath(id), params);
        if (message.sizeEstimate === undefined || message.internalDate === undefined) {
          // El format metadata pot ometre la mida. La màscara evita demanar el cos.
          const details = await get<Pick<GmailMessage, 'sizeEstimate' | 'internalDate'>>(
            messagePath(id),
            new URLSearchParams({ format: 'full', fields: 'sizeEstimate,internalDate' }),
          );
          message = { ...message, ...details };
        }
      } catch (error) {
        if (error instanceof GmailError && error.status === 404) return null;
        throw error;
      }
      const prepared = (message.payload?.headers ?? [])
        .map(
          ({ name, value }) => `${name.replace(/[^\w-]/gu, '')}: ${value.replace(/\r?\n/gu, ' ')}`,
        )
        .join('\r\n');
      const parsed = await simpleParser(prepared + '\r\n\r\n');
      const from = parsed.from?.value[0];
      const to = parsed.to ?? [];
      approvedSize = Math.min(message.sizeEstimate ?? 0, maxBytes);
      return {
        uid: message.id,
        labelIds: message.labelIds ?? [],
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references:
          typeof parsed.references === 'string'
            ? parsed.references.split(/\s+/u)
            : (parsed.references ?? []),
        subject: parsed.subject ?? null,
        fromName: from?.name ?? null,
        fromAddress: from?.address ?? null,
        toAddresses: (Array.isArray(to) ? to : [to])
          .flatMap((list) => list.value)
          .flatMap(({ address }) => address ?? []),
        internalDate: isoDate(message.internalDate),
        sentAt:
          parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : null,
        size: message.sizeEstimate ?? maxBytes + 1,
        hasHtml: false,
      };
    },
    async fetchBody(_path, id) {
      loaded = undefined;
      const params = new URLSearchParams({ format: 'full', fields: 'payload' });
      let message: GmailMessage;
      try {
        message = await get<GmailMessage>(
          messagePath(id),
          params,
          Math.ceil((approvedSize * 4) / 3) + 512 * 1024,
        );
      } catch (error) {
        if (error instanceof GmailError && error.status === 404)
          return { text: null, html: null, attachments: [] };
        throw error;
      }
      const parts = partsOf(message.payload);
      loaded = { id, parts };
      const plain = parts.find((part) => part.mimeType === 'text/plain' && !part.filename);
      const rendered = parts.find((part) => part.mimeType === 'text/html' && !part.filename);
      const text = plain
        ? ((await partBytes(id, plain, approvedSize))?.toString('utf8') ?? null)
        : null;
      const html =
        !text && rendered
          ? ((await partBytes(id, rendered, approvedSize))?.toString('utf8') ?? null)
          : null;
      const attachments: MailAttachmentMeta[] = parts.flatMap((part, index) =>
        part.filename && part.body?.size && !headerValue(part, 'content-id')
          ? [
              {
                filename: part.filename,
                contentType: part.mimeType ?? null,
                size: part.body.size,
                inline: false,
                part: String(index),
              },
            ]
          : [],
      );
      return { text, html, attachments };
    },
    async fetchAttachment(_path, id, part, maxBytes) {
      const item = loaded?.id === id ? loaded.parts[Number(part)] : undefined;
      return item ? partBytes(id, item, maxBytes) : null;
    },
  };
}
