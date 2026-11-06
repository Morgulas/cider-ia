import { createHash } from 'node:crypto';

/**
 * Images and other files of a project (Blob values of the Dexie export) are not
 * kept inside the project data: each one is stored once, under the SHA-256 of
 * its content (see BlobStore), and the project only holds a reference to it:
 *
 *   inline Blob:          "file": { "type": "image/png", "data": "<base64>" }  + "$types": { "file": "blob2" }
 *   inline ArrayBuffer:   "buffer": "<base64>"                                + "$types": { "buffer": "arraybuffer" }
 *   reference (stored):   "file": { "$ciderBlob": "<sha256>", "type": "image/png", "size": 1234 }
 *                         "buffer": { "$ciderBlob": "<sha256>", "type": "image/png", "size": 1234, "encoding": "arraybuffer" }
 * (the application stores asset images as an ArrayBuffer "buffer" next to their "type")
 *
 * The project data stays small: opening and saving a project no longer moves
 * every image, and each kept version costs a few kilobytes.
 */
export interface BlobRef {
  $ciderBlob: string;
  type: string;
  size: number;
  /** the value was an ArrayBuffer (a Blob otherwise) */
  encoding?: 'arraybuffer';
}

export const BLOB_HASH_PATTERN = /^[a-f0-9]{64}$/;
const BLOB_REF_KEY = '"$ciderBlob"';
const REF_PATTERN = /"\$ciderBlob"\s*:\s*"([a-f0-9]{64})"/g;
/** typeson type names of a Blob and of an ArrayBuffer in dexie-export-import */
const INLINE_BLOB_TYPE = 'blob2';
const INLINE_BUFFER_TYPE = 'arraybuffer';

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** true if the data may hold inline blobs (cheap test, no parsing) */
export function hasInlineBlobs(data: Buffer): boolean {
  return data.includes(`"${INLINE_BLOB_TYPE}"`) || data.includes(`"${INLINE_BUFFER_TYPE}"`);
}

/** Hashes of the blobs referenced by project data (no parsing) */
export function findBlobRefs(data: Buffer): Set<string> {
  const refs = new Set<string>();
  if (!data.includes(BLOB_REF_KEY)) {
    return refs;
  }
  for (const match of data.toString('utf8').matchAll(REF_PATTERN)) {
    refs.add(match[1]);
  }
  return refs;
}

type Row = Record<string, unknown> & { $types?: unknown };
interface DexieExport {
  data?: { data?: Array<{ rows?: unknown[] }> };
}

/** Rows of every table of a Dexie export */
function rowsOf(dump: DexieExport): Row[] {
  const rows: Row[] = [];
  for (const table of dump.data?.data ?? []) {
    for (const row of table.rows ?? []) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        rows.push(row as Row);
      }
    }
  }
  return rows;
}

/** typeson key paths escape "~" and "." */
const pathParts = (keyPath: string) => keyPath.split('.').map(part => part.replace(/~1/g, '.').replace(/~0/g, '~'));

function getAt(row: Row, parts: string[]): unknown {
  let value: unknown = row;
  for (const part of parts) {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function setAt(row: Row, parts: string[], value: unknown): void {
  let target: Record<string, unknown> = row;
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
}

/**
 * Takes the inline blobs out of project data: each becomes a reference, and its
 * bytes are returned to be stored. Data without inline blobs is returned as is.
 */
export function extractBlobs(data: Buffer): { data: Buffer; blobs: Map<string, Buffer> } {
  const blobs = new Map<string, Buffer>();
  if (!hasInlineBlobs(data)) {
    return { data, blobs };
  }
  const dump = JSON.parse(data.toString('utf8')) as DexieExport;
  let changed = false;
  for (const row of rowsOf(dump)) {
    const types = row.$types;
    if (!types || typeof types !== 'object' || Array.isArray(types)) {
      continue;
    }
    const typeMap = types as Record<string, unknown>;
    for (const [keyPath, type] of Object.entries(typeMap)) {
      if (type !== INLINE_BLOB_TYPE && type !== INLINE_BUFFER_TYPE) {
        continue;
      }
      const parts = pathParts(keyPath);
      if (parts.length !== 1) {
        // nested blobs stay inline (none in Cider projects): inlineBlobs only restores top-level fields
        continue;
      }
      let base64: string;
      let mime: string;
      if (type === INLINE_BLOB_TYPE) {
        const inline = getAt(row, parts) as { type?: unknown; data?: unknown } | undefined;
        if (!inline || typeof inline.data !== 'string') {
          continue;
        }
        base64 = inline.data;
        mime = typeof inline.type === 'string' ? inline.type : '';
      } else {
        // a repeated buffer is written { index: n }: left inline
        const inline = getAt(row, parts);
        if (typeof inline !== 'string') {
          continue;
        }
        base64 = inline;
        mime = typeof row['type'] === 'string' ? row['type'] as string : '';
      }
      const bytes = Buffer.from(base64, 'base64');
      const hash = sha256(bytes);
      blobs.set(hash, bytes);
      const ref: BlobRef = { $ciderBlob: hash, type: mime, size: bytes.length };
      if (type === INLINE_BUFFER_TYPE) {
        ref.encoding = 'arraybuffer';
      }
      setAt(row, parts, ref);
      delete typeMap[keyPath];
      changed = true;
    }
    if (Object.keys(typeMap).length === 0) {
      delete row.$types;
    }
  }
  return { data: changed ? Buffer.from(JSON.stringify(dump), 'utf8') : data, blobs };
}

/**
 * Puts the referenced blobs back inside project data: a complete Dexie export,
 * for a download that can be imported anywhere (another server, original Cider).
 */
export async function inlineBlobs(data: Buffer, read: (hash: string) => Promise<Buffer>): Promise<Buffer> {
  if (!data.includes(BLOB_REF_KEY)) {
    return data;
  }
  const dump = JSON.parse(data.toString('utf8')) as DexieExport;
  for (const row of rowsOf(dump)) {
    for (const [field, value] of Object.entries(row)) {
      if (!isBlobRef(value)) {
        continue;
      }
      const bytes = await read(value.$ciderBlob);
      const arrayBuffer = value.encoding === 'arraybuffer';
      row[field] = arrayBuffer ? bytes.toString('base64') : { type: value.type, data: bytes.toString('base64') };
      const types = (row.$types && typeof row.$types === 'object' && !Array.isArray(row.$types))
        ? row.$types as Record<string, unknown>
        : {};
      types[field.replace(/~/g, '~0').replace(/\./g, '~1')] = arrayBuffer ? INLINE_BUFFER_TYPE : INLINE_BLOB_TYPE;
      row.$types = types;
    }
  }
  return Buffer.from(JSON.stringify(dump), 'utf8');
}

export function isBlobRef(value: unknown): value is BlobRef {
  return !!value && typeof value === 'object' && typeof (value as BlobRef).$ciderBlob === 'string'
    && BLOB_HASH_PATTERN.test((value as BlobRef).$ciderBlob);
}
