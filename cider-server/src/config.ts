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
  /** Maximum number of projects per user */
  maxProjectsPerUser: number;
  /**
   * Code required to create the first administrator. If empty, a random code is
   * generated at startup and printed in the logs while no account exists.
   */
  setupToken: string;
  /** 'auto' marks the cookie Secure when the request came through HTTPS */
  cookieSecure: 'auto' | boolean;
  /** Log level of the HTTP server */
  logLevel: string;
  /**
   * Proxies allowed to set X-Forwarded-* headers (nginx on the Docker network).
   * Only their addresses are skipped when looking for the client address, so a
   * client cannot forge X-Forwarded-For to get around the login rate limit.
   */
  trustedProxies: string[];
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
    maxProjectMb: intFromEnv('CIDER_MAX_PROJECT_MB', 200, 1),
    maxProjectsPerUser: intFromEnv('CIDER_MAX_PROJECTS_PER_USER', 100, 1),
    setupToken: (process.env.CIDER_SETUP_TOKEN ?? '').trim(),
    cookieSecure: secure === 'auto' ? 'auto' : secure === 'true',
    logLevel: process.env.CIDER_LOG_LEVEL ?? 'info',
    trustedProxies: (process.env.CIDER_TRUSTED_PROXIES ?? 'loopback,uniquelocal,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
      .split(',').map(entry => entry.trim()).filter(entry => entry !== ''),
  };
}
