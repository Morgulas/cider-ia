import { AppDB } from './db';
import { findBlobRefs, sha256Fallback, sha256Hex } from './project-blobs';

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

describe('project files', () => {
  it('computes SHA-256 without crypto.subtle (pages served over http)', async () => {
    expect(hex(sha256Fallback(new TextEncoder().encode('abc'))))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256Fallback(new Uint8Array(0))))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    // several blocks, odd length: same result as the browser implementation
    const data = new Uint8Array(100003).map((_, i) => (i * 31) % 251);
    expect(hex(sha256Fallback(data))).toBe(await sha256Hex(new Blob([data])));
  });

  describe('local copy export and import', () => {
    let db: AppDB;

    beforeEach(async () => {
      db = new AppDB();
      await db.loadProject(null);
    });

    afterEach(async () => {
      await db.loadProject(null);
      db.close();
    });

    const addAsset = (name: string, content: string) =>
      db.table(AppDB.ASSETS_TABLE).add({ name, path: '', file: new Blob([content], { type: 'image/png' }) });

    it('replaces asset files by references, and gets them back on import', async () => {
      const id = await addAsset('logo', 'png bytes');
      await addAsset('same-image', 'png bytes');
      const { data, blobs } = await db.exportProjectForServer();
      const json = await data.text();
      expect(json).not.toContain('blob2');
      const hash = await sha256Hex(new Blob(['png bytes']));
      // the same image used twice is sent once
      expect(findBlobRefs(json)).toEqual([hash]);
      expect([...blobs.keys()]).toEqual([hash]);

      await db.loadProject(null);
      await db.loadProject(data, undefined, blobs as Map<string, Blob>);
      const asset = await db.table(AppDB.ASSETS_TABLE).get(id);
      expect(asset.file instanceof Blob).toBeTrue();
      expect(asset.file.type).toBe('image/png');
      expect(await asset.file.text()).toBe('png bytes');
    });

    it('handles assets stored as ArrayBuffer, as AssetsService stores them', async () => {
      const bytes = new TextEncoder().encode('image bytes').buffer;
      const id = await db.table(AppDB.ASSETS_TABLE).add({ name: 'fond', path: '', type: 'image/png', buffer: bytes });
      const { data, blobs } = await db.exportProjectForServer();
      const json = await data.text();
      expect(json).not.toContain('"buffer":"');
      expect(json).toContain('"encoding":"arraybuffer"');
      const hash = await sha256Hex(bytes);
      expect(findBlobRefs(json)).toEqual([hash]);
      // the data itself, sent only if the server lacks it
      expect(blobs.get(hash) instanceof ArrayBuffer).toBeTrue();

      await db.loadProject(null);
      await db.loadProject(data, undefined, new Map([[hash, new Blob([bytes])]]));
      const asset = await db.table(AppDB.ASSETS_TABLE).get(id);
      expect(asset.buffer instanceof ArrayBuffer).toBeTrue();
      expect(new TextDecoder().decode(asset.buffer)).toBe('image bytes');
      expect(asset.type).toBe('image/png');
    });

    it('hashes a changed file again', async () => {
      const id = await addAsset('logo', 'first');
      await db.exportProjectForServer();
      await db.table(AppDB.ASSETS_TABLE).update(id, { file: new Blob(['other'], { type: 'image/png' }) });
      const { data, blobs } = await db.exportProjectForServer();
      const hash = await sha256Hex(new Blob(['other']));
      expect(findBlobRefs(await data.text())).toEqual([hash]);
      expect([...blobs.keys()]).toEqual([hash]);
    });

    it('refuses to load a project whose files were not downloaded', async () => {
      await addAsset('logo', 'png bytes');
      const { data } = await db.exportProjectForServer();
      await expectAsync(db.loadProject(data, undefined, new Map())).toBeRejected();
    });
  });
});
