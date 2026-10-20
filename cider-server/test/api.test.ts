import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, CiderApp, CSRF_HEADER, PROJECT_CONTENT_TYPE, SESSION_COOKIE } from '../src/app.js';
import { ServerConfig } from '../src/config.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const sampleProject = (marker: string) => JSON.stringify({
  formatName: 'dexie',
  formatVersion: 1,
  data: { databaseName: 'cider-db', databaseVersion: 10, tables: [], data: [], marker },
});

describe('cider-server API', () => {
  let dataDir: string;
  let config: ServerConfig;
  let server: CiderApp;

  /** Sends a request, with the CSRF header unless told otherwise */
  const call = async (method: Method, url: string, options: {
    cookie?: string; body?: unknown; raw?: string; contentType?: string; csrf?: boolean; headers?: Record<string, string>;
  } = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.csrf !== false) {
      headers[CSRF_HEADER] = '1';
    }
    if (options.cookie) {
      headers['cookie'] = `${SESSION_COOKIE}=${options.cookie}`;
    }
    let payload: string | undefined;
    if (options.raw !== undefined) {
      payload = options.raw;
      headers['content-type'] = options.contentType ?? PROJECT_CONTENT_TYPE;
    } else if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }
    const response = await server.app.inject({ method, url, headers, payload });
    const cookie = response.cookies.find(c => c.name === SESSION_COOKIE);
    let json: any;
    try {
      json = response.json();
    } catch {
      json = undefined;
    }
    return { status: response.statusCode, json, body: response.body, headers: response.headers, cookie };
  };

  const login = async (username: string, password: string) => {
    const response = await call('POST', '/api/auth/login', { body: { username, password } });
    assert.equal(response.status, 200, response.body);
    return response.cookie!.value;
  };

  let adminCookie: string;
  let aliceCookie: string;
  let bobCookie: string;
  let aliceId: string;
  let bobId: string;

  before(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cider-server-test-'));
    config = {
      dataDir, host: '127.0.0.1', port: 0, sessionDays: 30, maxProjectMb: 1, maxProjectsPerUser: 3,
      setupToken: '', cookieSecure: 'auto', logLevel: 'silent', trustedProxies: ['loopback', '172.16.0.0/12'],
      ai: { defaultImageProvider: '', timeoutMs: 10000, defaultMonthlyImages: 50 },
    };
    server = await buildApp(config);
  });

  after(async () => {
    await server.app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('asks for the first administrator when there is no account', async () => {
    const response = await call('GET', '/api/auth/status');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { setupRequired: true, user: null });
  });

  it('requires the setup code printed in the logs to create the administrator', async () => {
    assert.ok(server.setupToken.length >= 12);
    const missing = await call('POST', '/api/auth/setup', { body: { username: 'admin', password: 'admin-password-1' } });
    assert.equal(missing.status, 403);
    const wrong = await call('POST', '/api/auth/setup',
      { body: { username: 'admin', password: 'admin-password-1', setupToken: 'not-the-code' } });
    assert.equal(wrong.status, 403);
    assert.equal(server.users.count(), 0);
  });

  it('refuses a too short password at setup', async () => {
    const response = await call('POST', '/api/auth/setup',
      { body: { username: 'admin', password: 'short', setupToken: server.setupToken } });
    assert.equal(response.status, 400);
  });

  it('creates exactly one administrator, even with simultaneous setups', async () => {
    const [first, second] = await Promise.all([
      call('POST', '/api/auth/setup', { body: { username: 'admin', password: 'admin-password-1', setupToken: server.setupToken } }),
      call('POST', '/api/auth/setup', { body: { username: 'other', password: 'admin-password-1', setupToken: server.setupToken } }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const winner = first.status === 200 ? first : second;
    assert.equal(winner.json.user.isAdmin, true);
    const cookie = winner.cookie!;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(cookie.path, '/api');
    adminCookie = cookie.value;
    // later setups are refused
    const again = await call('POST', '/api/auth/setup',
      { body: { username: 'third', password: 'admin-password-1', setupToken: server.setupToken } });
    assert.equal(again.status, 409);
  });

  it('requires the CSRF header on requests that change something', async () => {
    const response = await call('POST', '/api/auth/login',
      { body: { username: 'admin', password: 'admin-password-1' }, csrf: false });
    assert.equal(response.status, 403);
  });

  it('refuses a wrong password and an unknown user with the same message', async () => {
    const wrong = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope-nope-nope' } });
    const unknown = await call('POST', '/api/auth/login', { body: { username: 'ghost', password: 'nope-nope-nope' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.error, unknown.json.error);
  });

  it('lets the administrator create accounts', async () => {
    const alice = await call('POST', '/api/users',
      { cookie: adminCookie, body: { username: 'alice', password: 'alice-password' } });
    assert.equal(alice.status, 200, alice.body);
    assert.equal(alice.json.user.isAdmin, false);
    assert.equal(alice.json.user.passwordHash, undefined);
    aliceId = alice.json.user.id;
    const bob = await call('POST', '/api/users',
      { cookie: adminCookie, body: { username: 'bob', password: 'bob-password' } });
    bobId = bob.json.user.id;
    const duplicate = await call('POST', '/api/users',
      { cookie: adminCookie, body: { username: 'ALICE', password: 'alice-password' } });
    assert.equal(duplicate.status, 409);
    aliceCookie = await login('alice', 'alice-password');
    bobCookie = await login('Bob', 'bob-password');
  });

  it('keeps user administration for administrators only', async () => {
    assert.equal((await call('GET', '/api/users', { cookie: aliceCookie })).status, 403);
    assert.equal((await call('POST', '/api/users',
      { cookie: aliceCookie, body: { username: 'eve', password: 'eve-password' } })).status, 403);
    assert.equal((await call('GET', '/api/users')).status, 401);
  });

  it('requires a login for projects', async () => {
    assert.equal((await call('GET', '/api/projects')).status, 401);
  });

  let aliceProject: string;

  it('creates, saves and loads a project', async () => {
    const created = await call('POST', '/api/projects', { cookie: aliceCookie, body: { name: '  Mon jeu  ' } });
    assert.equal(created.status, 200, created.body);
    assert.equal(created.json.project.name, 'Mon jeu');
    assert.equal(created.json.project.revision, 0);
    aliceProject = created.json.project.id;

    const empty = await call('GET', `/api/projects/${aliceProject}/data`, { cookie: aliceCookie });
    assert.equal(empty.status, 204);
    assert.equal(empty.headers['x-project-revision'], '0');

    const saved = await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: aliceCookie, raw: sampleProject('v1'), headers: { 'x-base-revision': '0' } });
    assert.equal(saved.status, 200, saved.body);
    assert.equal(saved.json.project.revision, 1);

    const loaded = await call('GET', `/api/projects/${aliceProject}/data`, { cookie: aliceCookie });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.headers['x-project-revision'], '1');
    assert.equal(JSON.parse(loaded.body).data.marker, 'v1');
  });

  it('refuses a save based on an outdated revision, unless forced', async () => {
    const stale = await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: aliceCookie, raw: sampleProject('stale'), headers: { 'x-base-revision': '0' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.revision, 1);
    const forced = await call('PUT', `/api/projects/${aliceProject}/data?force=1`,
      { cookie: aliceCookie, raw: sampleProject('forced'), headers: { 'x-base-revision': '0' } });
    assert.equal(forced.status, 200);
    assert.equal(forced.json.project.revision, 2);
  });

  it('refuses project data that is not a Cider export', async () => {
    const notJson = await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: aliceCookie, raw: '{oops', headers: { 'x-base-revision': '2' } });
    assert.equal(notJson.status, 400);
    const truncated = await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: aliceCookie, raw: sampleProject('cut').slice(0, -5), headers: { 'x-base-revision': '2' } });
    assert.equal(truncated.status, 400);
    const notDexie = await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: aliceCookie, raw: '{"hello":1}', headers: { 'x-base-revision': '2' } });
    assert.equal(notDexie.status, 400);
    const wrongType = await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: aliceCookie, raw: sampleProject('x'), contentType: 'text/plain', headers: { 'x-base-revision': '2' } });
    assert.equal(wrongType.status, 415);
  });

  it('refuses a project larger than the configured limit', async () => {
    const big = sampleProject('x'.repeat(2 * 1024 * 1024));
    const response = await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: aliceCookie, raw: big, headers: { 'x-base-revision': '2' } });
    assert.equal(response.status, 413);
  });

  it('keeps each user\'s projects private', async () => {
    assert.deepEqual((await call('GET', '/api/projects', { cookie: bobCookie })).json.projects, []);
    assert.equal((await call('GET', `/api/projects/${aliceProject}`, { cookie: bobCookie })).status, 404);
    assert.equal((await call('GET', `/api/projects/${aliceProject}/data`, { cookie: bobCookie })).status, 404);
    assert.equal((await call('PUT', `/api/projects/${aliceProject}/data`,
      { cookie: bobCookie, raw: sampleProject('bob'), headers: { 'x-base-revision': '2' } })).status, 404);
    assert.equal((await call('DELETE', `/api/projects/${aliceProject}`, { cookie: bobCookie })).status, 404);
    // the administrator does not see alice's projects either
    assert.deepEqual((await call('GET', '/api/projects', { cookie: adminCookie })).json.projects, []);
  });

  it('rejects malformed project ids (no path traversal)', async () => {
    const response = await call('GET', `/api/projects/${encodeURIComponent('../users')}/data`, { cookie: aliceCookie });
    assert.equal(response.status, 404);
  });

  it('limits the number of projects per user', async () => {
    const created: string[] = [];
    let status = 200;
    while (status === 200) {
      const response = await call('POST', '/api/projects', { cookie: bobCookie, body: { name: `p${created.length}` } });
      status = response.status;
      if (status === 200) {
        created.push(response.json.project.id);
      }
    }
    assert.equal(status, 409);
    assert.equal(created.length, 3);
    for (const id of created) {
      await call('DELETE', `/api/projects/${id}`, { cookie: bobCookie });
    }
  });

  it('renames and deletes a project', async () => {
    const renamed = await call('PATCH', `/api/projects/${aliceProject}`, { cookie: aliceCookie, body: { name: 'Nouveau nom' } });
    assert.equal(renamed.json.project.name, 'Nouveau nom');
    const other = await call('POST', '/api/projects', { cookie: aliceCookie, body: { name: 'Brouillon' } });
    assert.equal((await call('DELETE', `/api/projects/${other.json.project.id}`, { cookie: aliceCookie })).status, 200);
    const list = await call('GET', '/api/projects', { cookie: aliceCookie });
    assert.deepEqual(list.json.projects.map((p: { name: string }) => p.name), ['Nouveau nom']);
  });

  it('closes other sessions when a user changes their password', async () => {
    const otherSession = await login('alice', 'alice-password');
    const wrong = await call('POST', '/api/auth/password',
      { cookie: aliceCookie, body: { currentPassword: 'bad-password', newPassword: 'alice-password-2' } });
    assert.equal(wrong.status, 400);
    const changed = await call('POST', '/api/auth/password',
      { cookie: aliceCookie, body: { currentPassword: 'alice-password', newPassword: 'alice-password-2' } });
    assert.equal(changed.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: aliceCookie })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: otherSession })).status, 401);
  });

  it('disables an account: its sessions end and it can no longer log in', async () => {
    const disabled = await call('PATCH', `/api/users/${bobId}`, { cookie: adminCookie, body: { disabled: true } });
    assert.equal(disabled.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: bobCookie })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'bob', password: 'bob-password' } })).status, 401);
    await call('PATCH', `/api/users/${bobId}`, { cookie: adminCookie, body: { disabled: false } });
    bobCookie = await login('bob', 'bob-password');
  });

  it('keeps the administrator logged in when they reset their own password', async () => {
    const me = await call('GET', '/api/auth/me', { cookie: adminCookie });
    const reset = await call('PATCH', `/api/users/${me.json.user.id}`,
      { cookie: adminCookie, body: { password: 'admin-password-2' } });
    assert.equal(reset.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: adminCookie })).status, 200);
    await login(me.json.user.username, 'admin-password-2');
  });

  it('always keeps an active administrator', async () => {
    const status = await call('GET', '/api/auth/me', { cookie: adminCookie });
    const adminId = status.json.user.id;
    assert.equal((await call('PATCH', `/api/users/${adminId}`, { cookie: adminCookie, body: { isAdmin: false } })).status, 409);
    assert.equal((await call('PATCH', `/api/users/${adminId}`, { cookie: adminCookie, body: { disabled: true } })).status, 409);
    assert.equal((await call('DELETE', `/api/users/${adminId}`, { cookie: adminCookie })).status, 409);
  });

  it('logs out', async () => {
    const session = await login('bob', 'bob-password');
    assert.equal((await call('POST', '/api/auth/logout', { cookie: session })).status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: session })).status, 401);
  });

  it('keeps accounts, sessions and projects across a restart, without plain passwords on disk', async () => {
    await server.app.close();
    server = await buildApp(config);
    const me = await call('GET', '/api/auth/me', { cookie: aliceCookie });
    assert.equal(me.status, 200);
    const loaded = await call('GET', `/api/projects/${aliceProject}/data`, { cookie: aliceCookie });
    assert.equal(JSON.parse(loaded.body).data.marker, 'forced');
    const usersFile = await fs.readFile(path.join(dataDir, 'users.json'), 'utf8');
    assert.ok(!usersFile.includes('alice-password'));
    const sessionsFile = await fs.readFile(path.join(dataDir, 'sessions.json'), 'utf8');
    assert.ok(!sessionsFile.includes(aliceCookie));
  });

  it('limits login attempts per client, even with a forged X-Forwarded-For', async () => {
    // what nginx forwards: the value sent by the client, then the real client address
    const attempt = (forged: string) => server.app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '172.18.0.3',
      headers: { [CSRF_HEADER]: '1', 'content-type': 'application/json', 'x-forwarded-for': `${forged}, 203.0.113.7` },
      payload: JSON.stringify({ username: 'nobody', password: 'wrong-password' }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await attempt(`10.0.0.${i}`)).statusCode);
    }
    assert.ok(statuses.includes(429), `no attempt was limited: ${statuses.join(',')}`);
  });

  it('deletes an account together with its projects', async () => {
    const response = await call('DELETE', `/api/users/${aliceId}`, { cookie: adminCookie });
    assert.equal(response.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { cookie: aliceCookie })).status, 401);
    await assert.rejects(fs.access(path.join(dataDir, 'projects', aliceId)));
  });
});
