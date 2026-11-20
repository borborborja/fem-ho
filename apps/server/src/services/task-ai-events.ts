import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { safeFetch } from '../dav/fetch-safe.js';

export const TASK_EXECUTION_EVENT = 'task.execution_requested';

/** S'aprèn del protocol i no del comportament permissiu de Buffer en descodificar Base64. */
function signingKey(secret: string): Buffer | undefined {
  if (!secret.startsWith('whsec_')) return undefined;
  const encoded = secret.slice('whsec_'.length);
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 24 || key.length > 64 || key.toString('base64') !== encoded) return undefined;
  return key;
}

export function isWebhookSecret(value: string): boolean {
  return signingKey(value) !== undefined;
}

export function webhookCallbackUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.href.includes('#'))
      return url.href;
  } catch {
    // El client només ha de saber que l'adreça no és apta per rebre esdeveniments.
  }
  return undefined;
}

interface WebhookTarget {
  callbackUrl: string;
  secret: string;
  previousSecret?: string | null | undefined;
  subscriptionId: string;
}

function signatures(id: string, timestamp: string, body: Buffer, secrets: string[]): string {
  return secrets
    .map((secret) => {
      const key = signingKey(secret);
      if (key === undefined) throw new Error('Invalid MCP webhook signing key.');
      const signature = createHmac('sha256', key)
        .update(`${id}.${timestamp}.`)
        .update(body)
        .digest('base64');
      return `v1,${signature}`;
    })
    .join(' ');
}

function postWebhook(target: WebhookTarget, id: string, value: object) {
  const url = webhookCallbackUrl(target.callbackUrl);
  if (url === undefined) throw new Error('Invalid MCP callback URL.');
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const body = Buffer.from(JSON.stringify(value));
  const keys = target.previousSecret ? [target.secret, target.previousSecret] : [target.secret];

  // El challenge i el lliurament travessen el mateix transport perquè un callback
  // validat ahir podria resoldre avui a dins de la xarxa del servidor.
  return safeFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': signatures(id, timestamp, body, keys),
      'X-MCP-Subscription-Id': target.subscriptionId,
    },
    body,
    maxRedirects: 0,
    maxBytes: 8_192,
    timeoutMs: 10_000,
  });
}

const verifiedUntil = new Map<string, number>();
const VERIFICATION_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHED_VERIFICATIONS = 1_024;

export async function verifyMcpCallback(
  target: WebhookTarget,
): Promise<'http_4xx' | 'http_5xx' | 'challenge_failed' | undefined> {
  // Un canvi de clau torna a provar que el receptor la coneix. L'ID ja vincula la
  // verificació a l'autorització i a la URL, així que no es pot aprofitar d'un altre xat.
  const cacheKey = createHash('sha256')
    .update(`${target.subscriptionId}\0${target.secret}`)
    .digest('hex');
  if ((verifiedUntil.get(cacheKey) ?? 0) > Date.now()) return undefined;

  const challenge = randomBytes(24).toString('base64url');
  let response: Awaited<ReturnType<typeof postWebhook>>;
  try {
    response = await postWebhook(target, `msg_verification_${randomBytes(16).toString('hex')}`, {
      type: 'verification',
      challenge,
    });
  } catch {
    // Els errors de xarxa poden contenir la URL i el token de ruta del receptor.
    return 'challenge_failed';
  }
  if (response.status >= 500) return 'http_5xx';
  if (response.status >= 400) return 'http_4xx';
  if (response.status < 200 || response.status >= 300) return 'challenge_failed';
  try {
    const echoed: unknown = (JSON.parse(response.body) as { challenge?: unknown } | null)
      ?.challenge;
    if (typeof echoed !== 'string') return 'challenge_failed';
    const received = Buffer.from(echoed);
    const expected = Buffer.from(challenge);
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      return 'challenge_failed';
  } catch {
    return 'challenge_failed';
  }

  verifiedUntil.delete(cacheKey);
  verifiedUntil.set(cacheKey, Date.now() + VERIFICATION_TTL_MS);
  if (verifiedUntil.size > MAX_CACHED_VERIFICATIONS)
    verifiedUntil.delete(verifiedUntil.keys().next().value!);
  return undefined;
}

export async function dispatchMcpEvent(
  input: WebhookTarget & {
    id: string;
    scopeId: string;
    taskId: string;
    createdAt: string;
  },
): Promise<number> {
  try {
    const { status } = await postWebhook(input, input.id, {
      eventId: input.id,
      name: TASK_EXECUTION_EVENT,
      timestamp: input.createdAt,
      data: { execution_id: input.id, scope_id: input.scopeId, task_id: input.taskId },
      cursor: null,
    });
    return status;
  } catch {
    throw new Error('MCP webhook delivery could not be confirmed.');
  }
}
