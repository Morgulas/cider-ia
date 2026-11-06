import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './json-file.js';
import { BLOB_HASH_PATTERN, sha256 } from './project-blobs.js';

const USER_ID_PATTERN = /^[0-9a-f-]{36}$/;

export class BlobStoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Files of the projects (images, fonts...), one folder per user, each file
 * stored once under the SHA-256 of its content:
 *   blobs/<userId>/<2 first characters>/<sha256>
 * Projects and their versions only reference them (see project-blobs.ts), so
 * the same image shared by several versions or projects is stored once.
 */
export class BlobStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, 'blobs');
  }

  private userDir(userId: string): string {
    if (!USER_ID_PATTERN.test(userId)) {
      throw new BlobStoreError('invalid user', 400);
    }
    return path.join(this.root, userId);
  }

  file(userId: string, hash: string): string {
    if (!BLOB_HASH_PATTERN.test(hash)) {
      throw new BlobStoreError('invalid file identifier', 400);
    }
    return path.join(this.userDir(userId), hash.slice(0, 2), hash);
  }

  /** Size of a stored blob, undefined if it is missing */
  async size(userId: string, hash: string): Promise<number | undefined> {
    try {
      return (await fs.stat(this.file(userId, hash))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async has(userId: string, hash: string): Promise<boolean> {
    return (await this.size(userId, hash)) !== undefined;
  }

  /** The hashes among these that are not stored yet */
  async missing(userId: string, hashes: Iterable<string>): Promise<string[]> {
    const missing: string[] = [];
    for (const hash of new Set(hashes)) {
      if (!(await this.has(userId, hash))) {
        missing.push(hash);
      }
    }
    return missing;
  }

  /**
   * Stores a blob. Its hash is checked against its content: a stored blob can
   * never hold something else than its name says.
   */
  async write(userId: string, hash: string, data: Buffer): Promise<void> {
    const file = this.file(userId, hash);
    if (sha256(data) !== hash) {
      throw new BlobStoreError('the file content does not match its identifier', 400);
    }
    if (await this.has(userId, hash)) {
      // same content: refresh its date, so a cleanup running now keeps it
      const now = new Date();
      await fs.utimes(file, now, now).catch(() => undefined);
      return;
    }
    await writeFileAtomic(file, data);
  }

  async read(userId: string, hash: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.file(userId, hash));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BlobStoreError('file not found', 404);
      }
      throw error;
    }
  }

  /**
   * Removes the blobs of a user that nothing references any more. Blobs written
   * recently are kept: they may have just been sent for a save still to come.
   * Returns the number of blobs removed.
   */
  async collect(userId: string, referenced: Set<string>, minAgeMs: number, now = Date.now()): Promise<number> {
    const dir = this.userDir(userId);
    let removed = 0;
    let prefixes: string[];
    try {
      prefixes = await fs.readdir(dir);
    } catch {
      return 0;
    }
    for (const prefix of prefixes) {
      let names: string[];
      try {
        names = await fs.readdir(path.join(dir, prefix));
      } catch {
        continue;
      }
      for (const name of names) {
        if (!BLOB_HASH_PATTERN.test(name) || referenced.has(name)) {
          continue;
        }
        const file = path.join(dir, prefix, name);
        try {
          const stat = await fs.stat(file);
          if (now - stat.mtimeMs >= minAgeMs) {
            await fs.rm(file, { force: true });
            removed++;
          }
        } catch {
          // already gone
        }
      }
    }
    return removed;
  }

  /** Users that have blobs */
  async users(): Promise<string[]> {
    try {
      return (await fs.readdir(this.root)).filter(name => USER_ID_PATTERN.test(name));
    } catch {
      return [];
    }
  }

  deleteAll(userId: string): Promise<void> {
    return fs.rm(this.userDir(userId), { recursive: true, force: true });
  }
}
