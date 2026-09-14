import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import {
  createGoogleMailProvider,
  googleMailConfigured,
  verifyGoogleIdentity,
} from './google-oauth.js';

const config = {
  googleClientId: 'client',
  googleClientSecret: 'server-only-secret',
  baseUrl: 'https://tasks.example.test',
};
let privateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keySet = createLocalJWKSet({ keys: [await exportJWK(pair.publicKey)] });
});
afterEach(() => vi.unstubAllGlobals());
const signed = (overrides: JWTPayload = {}, key = privateKey) =>
  new SignJWT({
    iss: 'https://accounts.google.com',
    aud: 'client',
    sub: 'google-user',
    nonce: 'nonce',
    email: 'Me@Example.Test',
    email_verified: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(key);

it('uses a fixed callback, offline access, PKCE, nonce and the IMAP scope', () => {
  const url = new URL(
    createGoogleMailProvider(config).authorizationUrl('state', 'challenge', 'nonce'),
  );
  expect(url.origin).toBe('https://accounts.google.com');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    redirect_uri: `${config.baseUrl}/api/v1/mail/oauth/google/callback`,
    access_type: 'offline',
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: 'challenge',
    nonce: 'nonce',
    state: 'state',
  });
  expect(url.searchParams.get('scope')).toContain('https://mail.google.com/');
  expect(url.href).not.toContain(config.googleClientSecret);
  expect(googleMailConfigured({ ...config, baseUrl: 'http://public.example.test' })).toBe(false);
  expect(googleMailConfigured({ ...config, googleClientSecret: '' })).toBe(false);
});
it('verifies Google identity signatures and normalizes verified email', async () => {
  expect(await verifyGoogleIdentity(await signed(), 'client', 'nonce', keySet)).toEqual({
    subject: 'google-user',
    email: 'me@example.test',
  });
  const wrongKey = await generateKeyPair('RS256');
  await expect(
    verifyGoogleIdentity(await signed({}, wrongKey.privateKey), 'client', 'nonce', keySet),
  ).rejects.toThrow('invalid_identity');
});
it.each([
  { aud: 'other-client' },
  { iss: 'https://evil.example.test' },
  { nonce: 'wrong' },
  { exp: 1 },
  { email_verified: false },
  { azp: 'other-client' },
  { sub: '' },
])('rejects an invalid identity claim: %j', async (claims) => {
  await expect(
    verifyGoogleIdentity(await signed(claims), 'client', 'nonce', keySet),
  ).rejects.toThrow('invalid_identity');
});
it('sanitizes provider errors and translates revoked refresh grants', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'private-data' }),
          { status: 400 },
        ),
      ),
  );
  await expect(createGoogleMailProvider(config).refresh('private-refresh')).rejects.toThrow(
    /^reconnect_required$/,
  );
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-request-body')));
  await expect(createGoogleMailProvider(config).refresh('private-refresh')).rejects.toThrow(
    /^provider_unavailable$/,
  );
});
it('requires mail permission and sends refresh credentials only to the Google token endpoint', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: 'token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid email',
      }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  await expect(createGoogleMailProvider(config).refresh('private-refresh')).rejects.toThrow(
    'missing_scope',
  );
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
  const options = fetcher.mock.calls[0]?.[1] as RequestInit;
  expect(options.redirect).toBe('error');
  expect(String(options.body)).toContain('grant_type=refresh_token');
});
