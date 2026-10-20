import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { promises as fs } from 'node:fs';
import { ServerConfig } from './config.js';
import { checkPasswordRules, hashPassword, verifyPassword } from './passwords.js';
import { ProjectStore, ProjectStoreError } from './store/projects.js';
import { SessionStore } from './store/sessions.js';
import { toPublicUser, UserRecord, UserStore, UserStoreError } from './store/users.js';

export const SESSION_COOKIE = 'cider_session';
/** Every request that changes something must carry this header (CSRF protection) */
export const CSRF_HEADER = 'x-cider-request';
/** Content type of a project body: a Dexie database export, kept as text */
export const PROJECT_CONTENT_TYPE = 'application/vnd.cider.project+json';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRecord;
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// a password hash computed once, to spend the same time on unknown usernames
let decoyHash: Promise<string> | undefined;

export interface CiderApp {
  app: FastifyInstance;
  users: UserStore;
  sessions: SessionStore;
  projects: ProjectStore;
}

export async function buildApp(config: ServerConfig): Promise<CiderApp> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const users = new UserStore(config.dataDir);
  const sessions = new SessionStore(config.dataDir, config.sessionDays);
  const projects = new ProjectStore(config.dataDir);
  await users.load();
  await sessions.load();
  decoyHash ??= hashPassword('decoy-password-for-timing');

  const app = Fastify({
    logger: { level: config.logLevel },
    // behind nginx: client address and protocol come from the X-Forwarded-* headers
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // project bodies are stored as received: parse them as text, not as an object
  app.addContentTypeParser(PROJECT_CONTENT_TYPE, { parseAs: 'string', bodyLimit: config.maxProjectMb * 1024 * 1024 },
    (_request, body, done) => done(null, body));

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof HttpError || error instanceof UserStoreError || error instanceof ProjectStoreError) {
      const status = error.status;
      const body: Record<string, unknown> = { error: error.message };
      if (error instanceof ProjectStoreError && error.revision !== undefined) {
        body['revision'] = error.revision;
      }
      return reply.status(status).send(body);
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal server error' });
  });

  // CSRF: a cross-site form or script cannot add a custom header without a CORS
  // preflight, which this server never accepts
  app.addHook('onRequest', async (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, `missing ${CSRF_HEADER} header`);
    }
  });

  // resolve the logged-in user from the session cookie
  app.addHook('preHandler', async (request) => {
    const userId = await sessions.resolve(request.cookies[SESSION_COOKIE]);
    const user = userId ? users.get(userId) : undefined;
    request.user = user && !user.disabled ? user : undefined;
  });

  const requireUser = (request: FastifyRequest): UserRecord => {
    if (!request.user) {
      throw new HttpError(401, 'not logged in');
    }
    return request.user;
  };

  const requireAdmin = (request: FastifyRequest): UserRecord => {
    const user = requireUser(request);
    if (!user.isAdmin) {
      throw new HttpError(403, 'administrator only');
    }
    return user;
  };

  const setSessionCookie = (request: FastifyRequest, reply: FastifyReply, token: string) => {
    const secure = config.cookieSecure === 'auto' ? request.protocol === 'https' : config.cookieSecure;
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure,
      maxAge: config.sessionDays * 24 * 60 * 60,
    });
  };

  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;

  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  /*********************************************************************
   * Health and authentication
   *********************************************************************/

  app.get('/api/health', async () => ({ status: 'ok' }));

  /** Tells the login page whether the first administrator still has to be created */
  app.get('/api/auth/status', async (request) => ({
    setupRequired: users.count() === 0,
    user: request.user ? toPublicUser(request.user) : null,
  }));

  /** Creates the first account, as administrator; only possible while there is none */
  app.post('/api/auth/setup', loginLimit, async (request, reply) => {
    if (users.count() > 0) {
      throw new HttpError(409, 'the administrator account already exists');
    }
    const { username, password } = body(request);
    const passwordProblem = checkPasswordRules(password);
    if (passwordProblem) {
      throw new HttpError(400, passwordProblem);
    }
    const user = await users.create(String(username ?? ''), await hashPassword(password as string), true, true);
    setSessionCookie(request, reply, await sessions.create(user.id));
    return { user: toPublicUser(user) };
  });

  app.post('/api/auth/login', loginLimit, async (request, reply) => {
    const { username, password } = body(request);
    const user = typeof username === 'string' ? users.findByUsername(username) : undefined;
    const valid = user && typeof password === 'string'
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyPassword('x', await decoyHash!), false);
    if (!user || !valid || user.disabled) {
      throw new HttpError(401, 'wrong username or password');
    }
    setSessionCookie(request, reply, await sessions.create(user.id));
    return { user: toPublicUser(user) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await sessions.revoke(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/api' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => ({ user: toPublicUser(requireUser(request)) }));

  /** Changes one's own password; other sessions of the user are closed */
  app.post('/api/auth/password', loginLimit, async (request) => {
    const user = requireUser(request);
    const { currentPassword, newPassword } = body(request);
    if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'current password is wrong');
    }
    const passwordProblem = checkPasswordRules(newPassword);
    if (passwordProblem) {
      throw new HttpError(400, passwordProblem);
    }
    await users.update(user.id, { passwordHash: await hashPassword(newPassword as string) });
    await sessions.revokeUser(user.id, request.cookies[SESSION_COOKIE]);
    return { ok: true };
  });

  /*********************************************************************
   * User administration
   *********************************************************************/

  app.get('/api/users', async (request) => {
    requireAdmin(request);
    return { users: users.list().map(toPublicUser) };
  });

  app.post('/api/users', async (request) => {
    requireAdmin(request);
    const { username, password, isAdmin } = body(request);
    const passwordProblem = checkPasswordRules(password);
    if (passwordProblem) {
      throw new HttpError(400, passwordProblem);
    }
    const user = await users.create(String(username ?? ''), await hashPassword(password as string), isAdmin === true);
    return { user: toPublicUser(user) };
  });

  /** Resets a password, grants or removes administrator rights, disables or enables an account */
  app.patch<{ Params: { id: string } }>('/api/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const { password, isAdmin, disabled } = body(request);
    const target = users.get(request.params.id);
    if (!target) {
      throw new HttpError(404, 'user not found');
    }
    if (target.id === admin.id && (isAdmin === false || disabled === true)) {
      throw new HttpError(409, 'you cannot remove your own administrator rights or disable your own account');
    }
    const changes: Partial<Pick<UserRecord, 'passwordHash' | 'isAdmin' | 'disabled'>> = {};
    if (password !== undefined) {
      const passwordProblem = checkPasswordRules(password);
      if (passwordProblem) {
        throw new HttpError(400, passwordProblem);
      }
      changes.passwordHash = await hashPassword(password as string);
    }
    if (typeof isAdmin === 'boolean') {
      changes.isAdmin = isAdmin;
    }
    if (typeof disabled === 'boolean') {
      changes.disabled = disabled;
    }
    const user = await users.update(target.id, changes);
    if (changes.passwordHash || changes.disabled) {
      await sessions.revokeUser(user.id);
    }
    return { user: toPublicUser(user) };
  });

  /** Deletes an account and all of its projects */
  app.delete<{ Params: { id: string } }>('/api/users/:id', async (request) => {
    const admin = requireAdmin(request);
    if (request.params.id === admin.id) {
      throw new HttpError(409, 'you cannot delete your own account');
    }
    await users.delete(request.params.id);
    await sessions.revokeUser(request.params.id);
    await projects.deleteAll(request.params.id);
    return { ok: true };
  });

  /*********************************************************************
   * Projects of the logged-in user
   *********************************************************************/

  app.get('/api/projects', async (request) => ({ projects: await projects.list(requireUser(request).id) }));

  app.post('/api/projects', async (request) => {
    const user = requireUser(request);
    return { project: await projects.create(user.id, body(request)['name'] as string) };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) => ({
    project: await projects.get(requireUser(request).id, request.params.id),
  }));

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (request) => ({
    project: await projects.rename(requireUser(request).id, request.params.id, body(request)['name'] as string),
  }));

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    await projects.delete(requireUser(request).id, request.params.id);
    return { ok: true };
  });

  /** Project data (Dexie export); 204 for a project that was never saved */
  app.get<{ Params: { id: string } }>('/api/projects/:id/data', async (request, reply) => {
    const { project, data } = await projects.readData(requireUser(request).id, request.params.id);
    reply.header('x-project-revision', String(project.revision));
    reply.header('cache-control', 'no-store');
    if (data === null) {
      return reply.status(204).send();
    }
    return reply.type('application/json').send(data);
  });

  /**
   * Saves the project data. The x-base-revision header carries the revision the
   * client started from; ?force=1 overwrites a newer version saved elsewhere.
   */
  app.put<{ Params: { id: string }; Querystring: { force?: string } }>('/api/projects/:id/data', async (request) => {
    const user = requireUser(request);
    if (request.headers['content-type']?.split(';')[0] !== PROJECT_CONTENT_TYPE || typeof request.body !== 'string') {
      throw new HttpError(415, `project data must be sent as ${PROJECT_CONTENT_TYPE}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      throw new HttpError(400, 'project data is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || (parsed as { formatName?: unknown }).formatName !== 'dexie') {
      throw new HttpError(400, 'project data is not a Cider database export');
    }
    const baseHeader = request.headers['x-base-revision'];
    const baseRevision = typeof baseHeader === 'string' && /^\d+$/.test(baseHeader) ? Number(baseHeader) : undefined;
    const project = await projects.writeData(user.id, request.params.id, request.body,
      baseRevision, request.query.force === '1');
    return { project };
  });

  return { app, users, sessions, projects };
}
