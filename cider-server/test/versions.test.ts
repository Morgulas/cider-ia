import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, CiderApp, CSRF_HEADER, PROJECT_CONTENT_TYPE, SESSION_COOKIE } from '../src/app.js';
import { VersionEntry, versionsToKeep } from '../src/store/projects.js';

const project = (marker: string) => JSON.stringify({
  formatName: 'dexie', formatVersion: 1, data: { databaseName: 'cider-db', databaseVersion: 10, tables: [], data: [], marker },
});

describe('version retention', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const entry = (revision: number, savedAt: string, keep = false): VersionEntry =>
    ({ revision, savedAt, by: '', label: '', size: 1, keep });

  it('keeps the 20 latest, the hourly and daily last versions, and important states', () => {
    const entries: VersionEntry[] = [];
    // 30 saves within the same minute today
    for (let i = 1; i <= 30; i++) {
      entries.push(entry(100 + i, '2026-10-21T11:59:00.000Z'));
    }
    entries.push(entry(50, '2026-10-20T10:00:00.000Z'));       // yesterday, last of its hour and day
    entries.push(entry(49, '2026-10-20T10:00:00.000Z'));       // same hour, older: dropped
    entries.push(entry(10, '2026-09-01T10:00:00.000Z'));       // 50 days: last of its day
    entries.push(entry(5, '2026-07-01T10:00:00.000Z'));        // 112 days: dropped
    entries.push(entry(4, '2026-08-01T10:00:00.000Z', true));  // important but > 60 days, < 90: kept
    entries.push(entry(3, '2026-08-01T09:00:00.000Z'));        // same day as 4, older: dropped
    const keep = versionsToKeep(entries, 130, now);
    for (let r = 110; r <= 130; r++) {
      assert.ok(keep.has(r), `latest ${r}`);
    }
    assert.ok(!keep.has(101), 'old saves of the same minute are thinned');
    assert.ok(keep.has(50));
    assert.ok(!keep.has(49));
    assert.ok(keep.has(10));
    assert.ok(!keep.has(5));
    assert.ok(keep.has(4));
    assert.ok(!keep.has(3));
  });
});

describe('project versions API', () => {
  let dataDir: string;
  let server: CiderApp;
  let cookie: string;
  let otherCookie: string;
  let projectId: string;

  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, options: {
    cookie?: string; body?: unknown; raw?: string; headers?: Record<string, string>;
  } = {}) => {
    const headers: Record<string, string> = { [CSRF_HEADER]: '1', ...(options.headers ?? {}) };
    if (options.cookie) {
      headers['cookie'] = `${SESSION_COOKIE}=${options.cookie}`;
    }
    let payload: string | undefined;
    if (options.raw !== undefined) {
      payload = options.raw;
      headers['content-type'] = PROJECT_CONTENT_TYPE;
    } else if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
    }
    const response = await server.app.inject({ method, url, headers, payload });
    let json: any;
    try {
      json = response.json();
    } catch {
      json = undefined;
    }
    return { status: response.statusCode, json, body: response.body, cookie: response.cookies.find(c => c.name === SESSION_COOKIE) };
  };

  before(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cider-versions-'));
    server = await buildApp({
      dataDir, host: '127.0.0.1', port: 0, sessionDays: 30, maxProjectMb: 1, maxProjectsPerUser: 5,
      setupToken: 'code', cookieSecure: 'auto', logLevel: 'silent', trustedProxies: ['loopback'],
      ai: { defaultImageProvider: '', timeoutMs: 1000, defaultMonthlyImages: 1, promptTemplate: '{{subject}}' },
    });
    cookie = (await call('POST', '/api/auth/setup', { body: { username: 'steve', password: 'steve-password', setupToken: 'code' } })).cookie!.value;
    await call('POST', '/api/users', { cookie, body: { username: 'other', password: 'other-password' } });
    otherCookie = (await call('POST', '/api/auth/login', { body: { username: 'other', password: 'other-password' } })).cookie!.value;
    projectId = (await call('POST', '/api/projects', { cookie, body: { name: 'Livres' } })).json.project.id;
  });

  after(async () => {
    await server.app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('records each save with its author and description', async () => {
    for (const [i, label] of ['v1', 'v2', 'v3'].entries()) {
      const saved = await call('PUT', `/api/projects/${projectId}/data`, {
        cookie, raw: project(label),
        headers: { 'x-base-revision': String(i), 'x-cider-change': encodeURIComponent(`Import de « ${label} »`),
          ...(label === 'v3' ? { 'x-cider-change-important': '1' } : {}) },
      });
      assert.equal(saved.status, 200, saved.body);
    }
    const list = await call('GET', `/api/projects/${projectId}/versions`, { cookie });
    assert.deepEqual(list.json.versions.map((v: { revision: number }) => v.revision), [3, 2, 1]);
    assert.equal(list.json.versions[0].current, true);
    assert.equal(list.json.versions[0].label, 'Import de « v3 »');
    assert.equal(list.json.versions[0].by, 'steve');
    // the state before an important change is kept longer
    assert.equal(list.json.versions[1].keep, true);
  });

  it('downloads an earlier version', async () => {
    const v1 = await call('GET', `/api/projects/${projectId}/versions/1`, { cookie });
    assert.equal(v1.status, 200);
    assert.equal(JSON.parse(v1.body).data.marker, 'v1');
    assert.equal((await call('GET', `/api/projects/${projectId}/versions/99`, { cookie })).status, 404);
  });

  it('restores a version as the current state, keeping the replaced one', async () => {
    const restored = await call('POST', `/api/projects/${projectId}/versions/1/restore`, { cookie, body: {} });
    assert.equal(restored.status, 200, restored.body);
    assert.equal(restored.json.project.revision, 4);
    const data = await call('GET', `/api/projects/${projectId}/versions/4`, { cookie });
    assert.equal(JSON.parse(data.body).data.marker, 'v1');
    const list = await call('GET', `/api/projects/${projectId}/versions`, { cookie });
    assert.equal(list.json.versions[0].label, 'restore:1');
    assert.equal(JSON.parse((await call('GET', `/api/projects/${projectId}/versions/3`, { cookie })).body).data.marker, 'v3');
  });

  it('restores a version as a new project', async () => {
    const copy = await call('POST', `/api/projects/${projectId}/versions/2/restore`, { cookie, body: { asNew: true, name: 'Livres (v2)' } });
    assert.equal(copy.status, 200, copy.body);
    const data = await call('GET', `/api/projects/${copy.json.project.id}/data`, { cookie });
    assert.equal(JSON.parse(data.body).data.marker, 'v2');
  });

  it('keeps versions private and removes them with the project', async () => {
    assert.equal((await call('GET', `/api/projects/${projectId}/versions`, { cookie: otherCookie })).status, 404);
    assert.equal((await call('GET', `/api/projects/${projectId}/versions/1`, { cookie: otherCookie })).status, 404);
    await server.app.inject({ method: 'DELETE', url: `/api/projects/${projectId}`,
      headers: { [CSRF_HEADER]: '1', cookie: `${SESSION_COOKIE}=${cookie}` } });
    const userDirs = await fs.readdir(path.join(dataDir, 'projects'));
    const versions = path.join(dataDir, 'projects', userDirs[0], 'versions', projectId);
    await assert.rejects(fs.access(versions));
  });
});
