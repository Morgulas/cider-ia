import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Writes a file atomically: the content goes to a temporary file in the same
 * folder, which then replaces the target. A crash never leaves a half-written file.
 */
export async function writeFileAtomic(file: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(content);
      // on disk before the rename: a power cut never leaves an empty file behind
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
    await syncDirectory(dir);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/** Makes a rename durable (not supported on every platform: best effort) */
async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await fs.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // directories cannot be opened for sync on some systems (Windows)
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

/**
 * Runs tasks one after the other, so two requests never write the same file at once.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
