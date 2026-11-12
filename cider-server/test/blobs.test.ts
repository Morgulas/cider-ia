import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLOB_CONTENT_TYPE, buildApp, CiderApp, CSRF_HEADER, PROJECT_CONTENT_TYPE, SESSION_COOKIE } from '../src/app.js';
import { extractBlobs, findBlobRefs, inlineBlobs } from '../src/store/project-blobs.js';

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const image1 = Buffer.from('fake png image number one');
const image2 = Buffer.from('another image, a font maybe');

/** A Dexie export with assets stored inline, as the application exports them */
const inlineProject = (marker: string, images: Buffer[]) => JSON.stringify({
  formatName: 'dexie', formatVersion: 1,
  data: {
    databaseName: 'cider-db', databaseVersion: 12, marker,
    tables: [{ name: 'assets', schema: '++id,name,path', rowCount: images.length }],
    data: [{
      tableName: 'assets', inbound: true,
      rows: images.map((image, i) => ({
        id: i + 1, name: `image-${i}`, path: '',
        file: { type: 'image/png', data: image.toString('base64') },
        $types: { file: 'blob2' },
      })),
    }],
  },
});

/** The same project, assets referenced by hash (as the application now saves them) */
const refProject = (marker: string, images: Buffer[]) => JSON.stringify({
  formatName: 'dexie', formatVersion: 1,
  data: {
    databaseName: 'cider-db', databaseVersion: 12, marker,
    tables: [{ name: 'assets', schema: '++id,name,path', rowCount: images.length }],
    data: [{
      tableName: 'assets', inbound: true,
      rows: images.map((image, i) => ({
        id: i + 1, name: `image-${i}`, path: '',
        file: { $ciderBlob: sha(image), type: 'image/png', size: image.length },
      })),
    }],
  },
});

/** Assets as the application stores them: an ArrayBuffer "buffer" next to their "type" */
const bufferProject = (images: Buffer[]) => JSON.stringify({
  formatName: 'dexie', formatVersion: 1,
  data: {
    databaseName: 'cider-db', databaseVersion: 12,
    tables: [{ name: 'assets', schema: '++id,name,path', rowCount: images.length }],
    data: [{
      tableName: 'assets', inbound: true,
      rows: images.map((image, i) => ({
        id: i + 1, name: `image-${i}`, path: '', type: 'image/png', buffer: image.toString('base64'),
        $types: { buffer: 'arraybuffer' },
      })),
    }],
  },
});

describe('project blobs conversion', () => {
  it('moves ArrayBuffer assets out and puts them back identically', async () => {
    const big = Buffer.alloc(8000, 3);
    const original = Buffer.from(bufferProject([big, image1]));
    const { data, blobs } = extractBlobs(original);
    assert.equal(blobs.size, 2);
    const dump = JSON.parse(data.toString());
    assert.deepEqual(dump.data.data[0].rows[0].buffer, { $ciderBlob: sha(big), type: 'image/png', size: big.length, encoding: 'arraybuffer' });
    assert.equal(dump.data.data[0].rows[0].$types, undefined);
    const restored = await inlineBlobs(data, async hash => blobs.get(hash)!);
    assert.deepEqual(JSON.parse(restored.toString()), JSON.parse(original.toString()));
  });

  it('moves inline blobs out and puts them back identically', async () => {
    const big = Buffer.alloc(5000, 7);
    const original = Buffer.from(inlineProject('a', [image1, big]));
    const { data, blobs } = extractBlobs(original);
    assert.equal(blobs.size, 2);
    assert.ok(data.length < original.length);
    assert.ok(!data.includes('blob2'));
    assert.deepEqual([...findBlobRefs(data)].sort(), [sha(image1), sha(big)].sort());
    const restored = await inlineBlobs(data, async hash => blobs.get(hash)!);
    assert.deepEqual(JSON.parse(restored.toString()), JSON.parse(original.toString()));
  });

  it('leaves data without inline blobs untouched', () => {
    const original = Buffer.from(refProject('a', [image1]));
    assert.equal(extractBlobs(original).data, original);
  });
});

describe('project files API', () => {
  let dataDir: string;
  let server: CiderApp;
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let projectId: string;

  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, options: {
    cookie?: string; body?: unknown; raw?: string | Buffer; contentType?: string; headers?: Record<string, string>;
  } = {}) => {
    const headers: Record<string, string> = { [CSRF_HEADER]: '1', ...(options.headers ?? {}) };
    if (options.cookie) {
      headers['cookie'] = `${SESSION_COOKIE}=${options.cookie}`;
    }
    let payload: string | Buffer | undefined;
    if (options.raw !== undefined) {
      payload = options.raw;
      headers['content-type'] = options.contentType ?? PROJECT_CONTENT_TYPE;
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
    return { status: response.statusCode, json, body: response.body, raw: response.rawPayload, headers: response.headers,
      cookie: response.cookies.find(c => c.name === SESSION_COOKIE) };
  };

  const save = (data: string, revision: number, who = cookie) => call('PUT', `/api/projects/${projectId}/data`,
    { cookie: who, raw: data, headers: { 'x-base-revision': String(revision) } });

  before(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cider-blobs-'));
    server = await buildApp({
      dataDir, host: '127.0.0.1', port: 0, sessionDays: 30, maxProjectMb: 1, maxProjectsPerUser: 5,
      setupToken: 'code', cookieSecure: 'auto', logLevel: 'silent', trustedProxies: ['loopback'],
      ai: { defaultImageProvider: '', timeoutMs: 1000, defaultMonthlyImages: 1, promptTemplate: '{{subject}}' },
    });
    const setup = await call('POST', '/api/auth/setup', { body: { username: 'steve', password: 'steve-password', setupToken: 'code' } });
    cookie = setup.cookie!.value;
    userId = setup.json.user.id;
    await call('POST', '/api/users', { cookie, body: { username: 'other', password: 'other-password' } });
    otherCookie = (await call('POST', '/api/auth/login', { body: { username: 'other', password: 'other-password' } })).cookie!.value;
    projectId = (await call('POST', '/api/projects', { cookie, body: { name: 'Fangh' } })).json.project.id;
  });

  after(async () => {
    await server.app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('stores the images of a full export apart and serves the project with references', async () => {
    const saved = await save(inlineProject('v1', [image1]), 0);
    assert.equal(saved.status, 200, saved.body);
    // size: data and images
    assert.ok(saved.json.project.size > image1.length);
    const data = await call('GET', `/api/projects/${projectId}/data`, { cookie });
    assert.ok(!data.body.includes('blob2'));
    assert.deepEqual([...findBlobRefs(Buffer.from(data.body))], [sha(image1)]);
    const blob = await call('GET', `/api/blobs/${sha(image1)}`, { cookie });
    assert.equal(blob.status, 200);
    assert.deepEqual(blob.raw, image1);
    assert.match(String(blob.headers['cache-control']), /immutable/);
  });

  it('downloads the project and its versions as complete exports', async () => {
    const exported = await call('GET', `/api/projects/${projectId}/export`, { cookie });
    assert.equal(exported.status, 200);
    assert.deepEqual(JSON.parse(exported.body), JSON.parse(inlineProject('v1', [image1])));
    const version = await call('GET', `/api/projects/${projectId}/versions/1`, { cookie });
    assert.deepEqual(JSON.parse(version.body), JSON.parse(inlineProject('v1', [image1])));
  });

  it('tells which files are missing, then refuses a save until they are sent', async () => {
    const missing = await call('POST', '/api/blobs/missing', { cookie, body: { hashes: [sha(image1), sha(image2)] } });
    assert.deepEqual(missing.json.missing, [sha(image2)]);
    const refused = await save(refProject('v2', [image1, image2]), 1);
    assert.equal(refused.status, 422);
    assert.deepEqual(refused.json.missing, [sha(image2)]);
    const sent = await call('PUT', `/api/blobs/${sha(image2)}`, { cookie, raw: image2, contentType: BLOB_CONTENT_TYPE });
    assert.equal(sent.status, 200, sent.body);
    const saved = await save(refProject('v2', [image1, image2]), 1);
    assert.equal(saved.status, 200, saved.body);
  });

  it('refuses a save that makes the project larger than the limit, files included', async () => {
    // each file is under the 1 MB limit of a request, together they are over it
    const big1 = Buffer.alloc(600 * 1024, 1);
    const big2 = Buffer.alloc(600 * 1024, 2);
    for (const big of [big1, big2]) {
      const sent = await call('PUT', `/api/blobs/${sha(big)}`, { cookie, raw: big, contentType: BLOB_CONTENT_TYPE });
      assert.equal(sent.status, 200, sent.body);
    }
    const refused = await save(refProject('too big', [image1, big1, big2]), 2);
    assert.equal(refused.status, 413, refused.body);
    assert.equal(refused.json.maxSize, 1024 * 1024);
    assert.ok(refused.json.size > 1200 * 1024);
    // nothing saved: the project keeps its revision and size
    const project = (await call('GET', `/api/projects/${projectId}`, { cookie })).json.project;
    assert.equal(project.revision, 2);
    assert.ok(project.size < 1024 * 1024);
    // under the limit again: saved
    const saved = await save(refProject('fits', [image1, big1]), 2);
    assert.equal(saved.status, 200, saved.body);
    const back = await save(refProject('v2', [image1, image2]), 3);
    assert.equal(back.status, 200, back.body);
    // big2 was never part of a save: removed, so the cleanup test below only finds its own orphan
    await fs.rm(server.blobs.file(userId, sha(big2)));
  });

  it('checks that a file matches its identifier', async () => {
    const wrong = await call('PUT', `/api/blobs/${sha(image1)}`, { cookie, raw: image2, contentType: BLOB_CONTENT_TYPE });
    assert.equal(wrong.status, 400);
    assert.equal((await call('GET', '/api/blobs/not-a-hash', { cookie })).status, 400);
  });

  it('keeps the files of each user private', async () => {
    assert.equal((await call('GET', `/api/blobs/${sha(image1)}`, { cookie: otherCookie })).status, 404);
    assert.equal((await call('GET', `/api/blobs/${sha(image1)}`)).status, 401);
  });

  it('converts a project saved before the blob store when it is opened', async () => {
    const legacy = (await call('POST', '/api/projects', { cookie, body: { name: 'Ancien' } })).json.project.id;
    // written directly, as an older server did
    const file = path.join(dataDir, 'projects', userId, `${legacy}.json`);
    await fs.writeFile(file, inlineProject('old', [image2]));
    const data = await call('GET', `/api/projects/${legacy}/data`, { cookie });
    assert.equal(data.status, 200);
    assert.deepEqual([...findBlobRefs(Buffer.from(data.body))], [sha(image2)]);
    assert.ok(!(await fs.readFile(file, 'utf8')).includes('blob2'));
  });

  it('removes files that nothing references any more', async () => {
    const orphan = Buffer.from('an image deleted from the project');
    await call('PUT', `/api/blobs/${sha(orphan)}`, { cookie, raw: orphan, contentType: BLOB_CONTENT_TYPE });
    // a recent file is kept: it may belong to a save still to come
    assert.equal(await server.projects.collectBlobs(userId), 0);
    assert.equal(await server.projects.collectBlobs(userId, 0), 1);
    assert.equal(await server.blobs.has(userId, sha(orphan)), false);
    assert.equal(await server.blobs.has(userId, sha(image1)), true);
    assert.equal(await server.blobs.has(userId, sha(image2)), true);
  });
});
