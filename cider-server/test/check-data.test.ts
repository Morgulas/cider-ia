import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkProjectData, sameJson } from '../src/tools/check-data.js';

const run = promisify(execFile);
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const image = Buffer.alloc(5000, 9);
const stored = Buffer.from('an image already stored apart');

/** A project as older versions saved it: images inline (ArrayBuffer and Blob), a journal */
const legacy = JSON.stringify({
  formatName: 'dexie', formatVersion: 1,
  data: {
    databaseName: 'cider-db', databaseVersion: 12, tables: [],
    data: [
      { tableName: 'cards', inbound: true, rows: [{ id: 1, name: 'Grimoire' }] },
      { tableName: 'assets', inbound: true, rows: [
        { id: 1, name: 'fond', type: 'image/png', buffer: image.toString('base64'), $types: { buffer: 'arraybuffer' } },
        { id: 2, name: 'logo', file: { type: 'image/png', data: image.toString('base64') }, $types: { file: 'blob2' } },
      ] },
      { tableName: 'cardHistory', inbound: true, rows: [{ id: 1, op: 'create', snapshot: { name: 'Grimoire' } }] },
    ],
  },
});

const withRef = (hash: string) => JSON.stringify({
  formatName: 'dexie', formatVersion: 1,
  data: { databaseName: 'cider-db', databaseVersion: 12, tables: [], data: [
    { tableName: 'assets', inbound: true, rows: [{ id: 1, name: 'x', type: 'image/png',
      buffer: { $ciderBlob: hash, type: 'image/png', size: stored.length, encoding: 'arraybuffer' } }] },
  ] },
});

describe('data check before deploying', () => {
  let dataDir: string;
  const userId = '11111111-2222-3333-4444-555555555555';

  before(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cider-check-'));
    const userDir = path.join(dataDir, 'projects', userId);
    await fs.mkdir(path.join(userDir, 'versions', 'a'.repeat(32)), { recursive: true });
    await fs.writeFile(path.join(userDir, 'index.json'), JSON.stringify({ version: 1, projects: [
      { id: 'a'.repeat(32), name: 'Terre de Fangh' }, { id: 'b'.repeat(32), name: 'Déjà converti' },
    ] }));
    await fs.writeFile(path.join(userDir, `${'a'.repeat(32)}.json`), legacy);
    await fs.writeFile(path.join(userDir, 'versions', 'a'.repeat(32), '3.json'), legacy);
    await fs.writeFile(path.join(userDir, `${'b'.repeat(32)}.json`), withRef(sha(stored)));
    const blobDir = path.join(dataDir, 'blobs', userId, sha(stored).slice(0, 2));
    await fs.mkdir(blobDir, { recursive: true });
    await fs.writeFile(path.join(blobDir, sha(stored)), stored);
  });

  after(() => fs.rm(dataDir, { recursive: true, force: true }));

  it('compares JSON whatever the key order', () => {
    assert.ok(sameJson({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));
    assert.ok(!sameJson({ a: 1 }, { a: 1, b: undefined }));
  });

  it('converts a legacy project in memory and finds it identical once put back', async () => {
    const result = await checkProjectData(Buffer.from(legacy), path.join(dataDir, 'blobs', userId));
    assert.equal(result.ok, true, result.problem);
    assert.equal(result.images, 1, 'the same image used twice is stored once');
    assert.ok(result.sizeAfter < result.sizeBefore);
    assert.equal(result.tables['cardHistory'], 1);
    assert.ok(result.journalBytes > 0);
  });

  it('reports a referenced image missing from the blobs folder', async () => {
    const result = await checkProjectData(Buffer.from(withRef('c'.repeat(64))), path.join(dataDir, 'blobs', userId));
    assert.equal(result.ok, false);
    assert.equal(result.missing, 1);
  });

  it('reports unreadable data', async () => {
    const result = await checkProjectData(Buffer.from('{"formatName": "dexie", '), dataDir);
    assert.equal(result.ok, false);
  });

  it('checks a whole data folder without changing it', async () => {
    const before = await fs.readFile(path.join(dataDir, 'projects', userId, `${'a'.repeat(32)}.json`));
    const script = path.resolve('dist-test/src/tools/check-data.js');
    const { stdout } = await run(process.execPath, [script, dataDir]);
    assert.match(stdout, /Terre de Fangh : OK/);
    assert.match(stdout, /Déjà converti : OK/);
    assert.match(stdout, /1 version\(s\) conservée\(s\) : toutes OK/);
    assert.match(stdout, /peut être déployée/);
    const afterRun = await fs.readFile(path.join(dataDir, 'projects', userId, `${'a'.repeat(32)}.json`));
    assert.deepEqual(afterRun, before);
  });
});
