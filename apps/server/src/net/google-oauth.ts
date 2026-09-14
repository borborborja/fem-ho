import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Config } from '../config.js';

export const GOOGLE_MAIL_SCOPE = 'https://mail.google.com/';
export interface GoogleTokens {
  access_token: string;
  refresh_token?: string | undefined;
  expires_at: number;
  subject?: string | undefined;
  email?: string | undefined;
}
export class GoogleOAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export interface GoogleMailProvider {
  authorizationUrl(state: string, challenge: string, nonce: string): string;
  exchange(code: string, verifier: string, nonce: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
}
type GoogleConfig = Pick<Config, 'googleClientId' | 'googleClientSecret' | 'baseUrl'>;

export function googleMailConfigured(config: GoogleConfig): boolean {
  if (!config.googleClientId || !config.googleClientSecret || !config.baseUrl) return false;
  try {
    const url = new URL(config.baseUrl);
    return (
      url.username === '' &&
      url.password === '' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'))
    );
  } catch {
    return false;
  }
}

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 10_000,
});

export async function verifyGoogleIdentity(
  idToken: string,
  clientId: string,
  nonce: string,
  keySet: JWTVerifyGetKey = keys,
): Promise<{ subject: string; email: string }> {
  try {
    const { payload } = await jwtVerify(idToken, keySet, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
    });
    if (
      payload.nonce !== nonce ||
      !payload.sub ||
      payload.email_verified !== true ||
      typeof payload.email !== 'string' ||
      !payload.email.includes('@') ||
      (payload.azp !== undefined && payload.azp !== clientId)
    )
      throw new GoogleOAuthError('invalid_identity');
    return { subject: payload.sub, email: payload.email.trim().toLowerCase() };
  } catch {
    throw new GoogleOAuthError('invalid_identity');
  }
}

/** Endpoints fixos: un compte de correu no pot decidir on s'envien les credencials. */
export function createGoogleMailProvider(config: GoogleConfig): GoogleMailProvider {
  if (!googleMailConfigured(config)) throw new GoogleOAuthError('not_configured');
  const redirect = new URL('/api/v1/mail/oauth/google/callback', config.baseUrl).href;
  const clientId = config.googleClientId!;
  const clientSecret = config.googleClientSecret!;

  async function tokenRequest(fields: Record<string, string>): Promise<Record<string, unknown>> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }),
      });
      const text = await response.text();
      if (text.length > 100_000) throw new GoogleOAuthError('provider_unavailable');
      const value = JSON.parse(text) as Record<string, unknown>;
      if (!response.ok) {
        throw new GoogleOAuthError(
          value.error === 'invalid_grant' ? 'reconnect_required' : 'provider_unavailable',
        );
      }
      return value;
    } catch (error) {
      if (error instanceof GoogleOAuthError) throw error;
      // Els errors de xarxa no han d'exposar codis ni tokens al registre.
      throw new GoogleOAuthError('provider_unavailable');
    }
  }
  function tokens(value: Record<string, unknown>, requireScope: boolean): GoogleTokens {
    if (
      typeof value.access_token !== 'string' ||
      value.access_token === '' ||
      typeof value.expires_in !== 'number' ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0 ||
      typeof value.token_type !== 'string' ||
      value.token_type.toLowerCase() !== 'bearer'
    ) {
      throw new GoogleOAuthError('invalid_response');
    }
    if (
      (requireScope || value.scope !== undefined) &&
      (typeof value.scope !== 'string' || !value.scope.split(' ').includes(GOOGLE_MAIL_SCOPE))
    ) {
      throw new GoogleOAuthError('missing_scope');
    }
    return {
      access_token: value.access_token,
      refresh_token:
        typeof value.refresh_token === 'string' && value.refresh_token !== ''
          ? value.refresh_token
          : undefined,
      expires_at: Date.now() + value.expires_in * 1000,
    };
  }
  return {
    authorizationUrl(state, challenge, nonce) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: `openid email ${GOOGLE_MAIL_SCOPE}`,
        access_type: 'offline',
        prompt: 'consent select_account',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.href;
    },
    async exchange(code, verifier, nonce) {
      const value = await tokenRequest({
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      });
      const result = tokens(value, true);
      if (typeof value.id_token !== 'string') throw new GoogleOAuthError('invalid_identity');
      return { ...result, ...(await verifyGoogleIdentity(value.id_token, clientId, nonce)) };
    },
    async refresh(refreshToken) {
      return tokens(
        await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
        false,
      );
    },
  };
}
