import path from 'node:path';

export interface ServerConfig {
  /** Folder holding users, sessions and projects (mounted as a Docker volume) */
  dataDir: string;
  host: string;
  port: number;
  /** Session lifetime, renewed while the user keeps using the app */
  sessionDays: number;
  /** Maximum size of one saved project, assets included */
  maxProjectMb: number;
  /** 'auto' marks the cookie Secure when the request came through HTTPS */
  cookieSecure: 'auto' | boolean;
  /** Log level of the HTTP server */
  logLevel: string;
}

function intFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min} (got "${raw}")`);
  }
  return value;
}

export function loadConfig(): ServerConfig {
  const secure = (process.env.CIDER_COOKIE_SECURE ?? 'auto').toLowerCase();
  return {
    dataDir: path.resolve(process.env.CIDER_DATA_DIR ?? '/data'),
    host: process.env.CIDER_HOST ?? '0.0.0.0',
    port: intFromEnv('CIDER_PORT', 3000, 1),
    sessionDays: intFromEnv('CIDER_SESSION_DAYS', 30, 1),
    maxProjectMb: intFromEnv('CIDER_MAX_PROJECT_MB', 500, 1),
    cookieSecure: secure === 'auto' ? 'auto' : secure === 'true',
    logLevel: process.env.CIDER_LOG_LEVEL ?? 'info',
  };
}
