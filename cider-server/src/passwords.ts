import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt parameters (memory ~16 MB per hash): slow enough to resist guessing,
// fast enough for a login. Stored with the hash so they can be raised later.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: n, r, p, maxmem: 128 * n * r * 2 }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

/** Returns "scrypt$N$r$p$salt$hash" (base64 salt and hash) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await derive(password, Buffer.from(saltB64, 'base64'),
    Number(n), Number(r), Number(p), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function checkPasswordRules(password: unknown): string | null {
  if (typeof password !== 'string') {
    return 'password is required';
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `password must have at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `password must have at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}
