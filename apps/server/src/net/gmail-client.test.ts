import { afterEach, describe, expect, it, vi } from 'vitest';
import { openGmailClient } from './gmail-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('Gmail API en només lectura', () => {
  it('obtains metadata safely before requesting MIME data or a selected attachment', async () => {
    const seen: URL[] = [];
    const encoded = (value: string) => Buffer.from(value).toString('base64url');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, options: RequestInit) => {
        expect(url.origin).toBe('https://gmail.googleapis.com');
        expect(options.method).toBe('GET');
        expect(options.redirect).toBe('error');
        expect(options.headers).toMatchObject({ Authorization: 'Bearer private-access' });
        seen.push(url);
        if (url.pathname.endsWith('/attachments/attach')) {
          return Response.json({ data: encoded('fitxer') });
        }
        if (url.searchParams.get('format') === 'metadata') {
          return Response.json({
            id: 'opaque-id',
            labelIds: ['INBOX', 'Label_11'],
            payload: {
              headers: [
                { name: 'Subject', value: 'Assumpte' },
                { name: 'From', value: 'Escola <sender@example.test>' },
                { name: 'To', value: 'reader@example.test' },
                { name: 'Message-ID', value: '<test@example.test>' },
              ],
            },
          });
        }
        if (url.searchParams.get('fields') === 'sizeEstimate,internalDate') {
          return Response.json({ internalDate: '1795334400000', sizeEstimate: 4096 });
        }
        expect(url.searchParams.get('fields')).toBe('payload');
        return Response.json({
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              { mimeType: 'text/plain', body: { data: encoded('Hola'), size: 4 } },
              {
                mimeType: 'image/gif',
                filename: 'logo.gif',
                headers: [{ name: 'Content-ID', value: 'x' }],
                body: { attachmentId: 'inline', size: 1024 },
              },
              {
                mimeType: 'text/plain',
                filename: 'fitxer.txt',
                body: { attachmentId: 'attach', size: 6 },
              },
            ],
          },
        });
      }),
    );
    const gmail = openGmailClient('private-access');
    const header = await gmail.header('opaque-id', 8192);
    expect(header).toMatchObject({
      uid: 'opaque-id',
      labelIds: ['INBOX', 'Label_11'],
      messageId: '<test@example.test>',
      fromName: 'Escola',
      toAddresses: ['reader@example.test'],
      size: 4096,
    });
    expect(seen.length).toBe(2);
    const body = await gmail.fetchBody('INBOX', 'opaque-id');
    expect(body.text).toBe('Hola');
    expect(body.attachments.map(({ filename }) => filename)).toEqual(['fitxer.txt']);
    expect(seen.length).toBe(3);
    const attachment = body.attachments[0]!;
    expect(await gmail.fetchAttachment('INBOX', 'opaque-id', attachment.part, 5)).toBeNull();
    expect(seen.length).toBe(3);
    const bytes = await gmail.fetchAttachment('INBOX', 'opaque-id', attachment.part, 6);
    expect(Buffer.from(bytes!).toString()).toBe('fitxer');
    expect(seen.length).toBe(4);
  });

  it('only advances a label from message arrivals and matching label additions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        expect(url.pathname).toBe('/gmail/v1/users/me/history');
        expect(url.searchParams.get('startHistoryId')).toBe('90071992547409938');
        expect(url.searchParams.get('labelId')).toBe('Label_11');
        expect(url.searchParams.get('pageToken')).toBe('opaque-page');
        expect(url.searchParams.getAll('historyTypes')).toEqual(['messageAdded', 'labelAdded']);
        return Response.json({
          historyId: '90071992547409939',
          nextPageToken: 'next',
          history: [
            {
              messagesAdded: [{ message: { id: 'first' } }],
              labelsAdded: [
                { message: { id: 'first' }, labelIds: ['Label_11'] },
                { message: { id: 'ignored' }, labelIds: ['Label_12'] },
                { message: { id: 'second' }, labelIds: ['Label_11'] },
              ],
            },
          ],
        });
      }),
    );
    await expect(
      openGmailClient('private-access').changes('Label_11', '90071992547409938', 'opaque-page'),
    ).resolves.toEqual({
      ids: ['first', 'second'],
      historyId: '90071992547409939',
      nextPageToken: 'next',
    });
  });
});
