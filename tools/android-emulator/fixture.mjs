const [origin, suffix] = process.argv.slice(2);
if (!origin || !suffix) throw new Error('Pass the test server URL and fixture suffix.');

const password = 'femho-emulator-fixture';
const email = `android-${suffix}@example.test`;
const otherEmail = `android-other-${suffix}@example.test`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

async function api(path, { method, body, token } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method ?? 'GET'} ${path}: ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

if ((await api('/api/v1/setup')).open) {
  await api('/setup', {
    method: 'POST',
    body: { name: 'Emulator setup', email: 'android-setup@example.test', password, locale: 'en' },
  });
}

async function account(address, name, locale) {
  const { access_token: token } = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { name, email: address, password, locale },
  });
  await api('/api/v1/auth/settings', {
    method: 'PATCH',
    token,
    body: { scope_mode: 'multi' },
  });
  const scopes = await api('/api/v1/scopes', { token });
  return { token, scope: scopes[0].id };
}

const first = await account(email, 'Android Primary', 'en');
const second = await account(otherEmail, 'Android Secondary', 'es');
await api(`/api/v1/scopes/${first.scope}/settings`, {
  method: 'PATCH',
  token: first.token,
  body: { time_tracking: true },
});
async function project(scope, name) {
  return api('/api/v1/projects', {
    method: 'POST',
    token: first.token,
    body: { scope_id: scope, name },
  });
}
const firstProject = await project(first.scope, 'Personal project A');
const secondProject = await project(first.scope, 'Personal project B');
for (let index = 1; index <= 8; index += 1) {
  await project(first.scope, `Long project name for the scrollable project menu ${index}`);
}
const task = await api('/api/v1/tasks', {
  method: 'POST',
  token: first.token,
  body: {
    scope_id: first.scope,
    project_id: firstProject.id,
    title: 'Android fixture task',
    description: 'Initial description',
    due_date: today,
    due_time: '09:30',
    deadline: `${today}T17:00:00+01:00`,
    rrule: 'FREQ=WEEKLY',
    checklists: [{ name: 'Release', items: [{ text: 'Check the workspace' }] }],
  },
});
const team = await api('/api/v1/scopes', {
  method: 'POST',
  token: first.token,
  body: { name: 'Android fixture team', kind: 'collective', color: '--plou-blue' },
});
const teamProject = await project(team.id, 'Team project');
await api('/api/v1/tasks', {
  method: 'POST',
  token: first.token,
  body: {
    scope_id: team.id,
    project_id: teamProject.id,
    title: 'Team calendar fixture task',
    status: 'todo',
    due_date: today,
    due_time: '10:30',
  },
});
await api('/api/v1/tasks', {
  method: 'POST',
  token: second.token,
  body: { scope_id: second.scope, title: 'Secondary account fixture' },
});

const resource = `http://10.0.2.2:${new URL(origin).port}/mcp`;
const redirect = `${origin}/oauth-callback`;
const verifier = randomBytes(32).toString('base64url');
const { client_id: clientId } = await api('/oauth/register', {
  method: 'POST',
  body: { client_name: 'Android fixture OAuth', redirect_uris: [redirect] },
});
const query = new URLSearchParams({
  client_id: clientId,
  response_type: 'code',
  redirect_uri: redirect,
  resource,
  state: 'test',
  code_challenge_method: 'S256',
  code_challenge: createHash('sha256').update(verifier).digest('base64url'),
});
const start = await fetch(`${origin}/oauth/authorize?${query}`, { redirect: 'manual' });
if (start.status !== 302) throw new Error(`OAuth fixture start: ${start.status}`);
const requestId = new URL(start.headers.get('location')).searchParams.get('request');
const consent = await api(`/api/v1/mcp/authorization/${requestId}`, {
  method: 'POST',
  token: first.token,
  body: {
    approve: true,
    enable_mcp: true,
    permission: 'custom',
    capabilities: ['tasks:read', 'tasks:move'],
    scope_ids: [first.scope],
  },
});
const exchanged = await fetch(`${origin}/oauth/token`, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: new URL(consent.redirect_url).searchParams.get('code'),
    code_verifier: verifier,
    redirect_uri: redirect,
    resource,
  }),
});
if (!exchanged.ok) throw new Error(`OAuth fixture exchange: ${exchanged.status}`);
const grants = await api('/api/v1/tokens', { token: first.token });
const oauthGrant = grants.data.find((grant) => grant.credential_type === 'oauth');
await api('/api/v1/external-access', {
  method: 'PATCH',
  token: first.token,
  body: { mcp_enabled: false },
});

process.stdout.write(
  JSON.stringify({
    email,
    otherEmail,
    password,
    scopeId: first.scope,
    teamScopeId: team.id,
    firstProjectId: firstProject.id,
    secondProjectId: secondProject.id,
    teamProjectId: teamProject.id,
    taskId: task.id,
    today,
    oauthGrantId: oauthGrant.id,
  }),
);
import { createHash, randomBytes } from 'node:crypto';
