/**
 * Files of a project (images, fonts...) are saved on the server apart from the
 * project data, once each, under the SHA-256 of their content. In the data sent
 * to the server, each binary value is replaced by a reference (same format as
 * the server, see cider-server/src/store/project-blobs.ts):
 *
 *   "file":   { "$ciderBlob": "<sha256>", "type": "image/png", "size": 1234 }                          (a Blob)
 *   "buffer": { "$ciderBlob": "<sha256>", "type": "image/png", "size": 1234, "encoding": "arraybuffer" } (an ArrayBuffer)
 *
 * Assets are stored as { buffer: ArrayBuffer, type } by AssetsService.
 */
export interface BlobRef {
    $ciderBlob: string;
    type: string;
    size: number;
    /** the value was an ArrayBuffer (a Blob otherwise) */
    encoding?: 'arraybuffer';
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REF_PATTERN = /"\$ciderBlob"\s*:\s*"([a-f0-9]{64})"/g;

export function isBlobRef(value: unknown): value is BlobRef {
    return !!value && typeof value === 'object' && !(value instanceof Blob)
        && typeof (value as BlobRef).$ciderBlob === 'string' && HASH_PATTERN.test((value as BlobRef).$ciderBlob);
}

/** Hashes of the files referenced by project data */
export function findBlobRefs(json: string): string[] {
    const hashes = new Set<string>();
    for (const match of json.matchAll(REF_PATTERN)) {
        hashes.add(match[1]);
    }
    return [...hashes];
}

/** SHA-256 of a file or of binary data, in hexadecimal */
export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
    // crypto.subtle only exists in secure contexts (https, localhost): the site
    // may be opened over plain http on a home network
    const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
    const digest = subtle ? new Uint8Array(await subtle.digest('SHA-256', bytes)) : sha256Fallback(bytes);
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 in plain JavaScript, for pages served without https */
export function sha256Fallback(message: Uint8Array): Uint8Array {
    const length = message.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(message);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(length / 0x20000000), false);
    view.setUint32(padded.length - 4, (length << 3) >>> 0, false);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
            const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (s0 + maj) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    h.forEach((value, i) => outView.setUint32(i * 4, value, false));
    return out;
}

/** Runs fn on every item, at most `limit` at a time */
export async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            await fn(items[next++]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
