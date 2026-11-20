import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import * as network from '../dav/fetch-safe.js';
import { dispatchMcpEvent, isWebhookSecret, verifyMcpCallback } from './task-ai-events.js';

afterEach(() => vi.restoreAllMocks());

it('lliura només identificadors i signa els bytes exactes amb les dues claus durant la rotació', async () => {
  const callbackUrl = 'https://example.net/webhook';
  const keys = [randomBytes(32), randomBytes(32)];
  const [secret, previousSecret] = keys.map((key) => `whsec_${key.toString('base64')}`);
  const flags = vi.spyOn(network, 'safeFetch').mockResolvedValue({
    url: callbackUrl,
    body: '',
    bytes: Buffer.alloc(0),
    headers: new Headers(),
    status: 202,
  });
  const input = {
    callbackUrl,
    secret: secret!,
    previousSecret: previousSecret!,
    subscriptionId: 'sub_example',
    id: 'execution-id',
    scopeId: 'scope-id',
    taskId: 'task-id',
    createdAt: '2026-11-20T12:05:00.000Z',
  };

  await expect(dispatchMcpEvent(input)).resolves.toBe(202);
  const [url, options] = flags.mock.calls[0]!;
  expect(url).toBe(callbackUrl);
  expect(options).toMatchObject({ method: 'POST', maxRedirects: 0 });
  const body = options!.body!.toString();
  const headers = options!.headers!;
  expect(JSON.parse(body)).toEqual({
    eventId: input.id,
    name: 'task.execution_requested',
    timestamp: input.createdAt,
    data: { execution_id: input.id, scope_id: input.scopeId, task_id: input.taskId },
    cursor: null,
  });
  const expectedSignatures = keys.map((key) => {
    const hash = createHmac('sha256', key)
      .update(`${input.id}.${headers['webhook-timestamp']}.${body}`)
      .digest('base64');
    return `v1,${hash}`;
  });
  expect(headers).toEqual({
    'content-type': 'application/json',
    'webhook-id': input.id,
    'webhook-timestamp': expect.stringMatching(/^\d+$/u),
    'webhook-signature': expectedSignatures.join(' '),
    'X-MCP-Subscription-Id': input.subscriptionId,
  });
});

it('rebutja secrets que Buffer acceptaria amb bytes o símbols de més', () => {
  const base64 = randomBytes(32).toString('base64');
  expect(isWebhookSecret(`whsec_${base64}`)).toBe(true);
  expect(isWebhookSecret(base64)).toBe(false);
  expect(isWebhookSecret(`whsec_${base64}!`)).toBe(false);
  expect(isWebhookSecret(`whsec_${randomBytes(23).toString('base64')}`)).toBe(false);
  expect(isWebhookSecret(`whsec_${randomBytes(65).toString('base64')}`)).toBe(false);
});

it('impedeix verificar i lliurar a un callback dins la xarxa local', async () => {
  const target = {
    callbackUrl: 'https://127.0.0.1:123/events',
    secret: `whsec_${randomBytes(32).toString('base64')}`,
    subscriptionId: 'sub_local',
  };
  await expect(verifyMcpCallback(target)).resolves.toBe('challenge_failed');
  await expect(
    dispatchMcpEvent({
      ...target,
      id: 'execution-id',
      scopeId: 'scope-id',
      taskId: 'task-id',
      createdAt: '2026-11-20T12:05:00.000Z',
    }),
  ).rejects.toThrow('MCP webhook delivery could not be confirmed.');
});
