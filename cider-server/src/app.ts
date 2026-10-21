import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { ServerConfig } from './config.js';
import { checkPasswordRules, hashPassword, verifyPassword } from './passwords.js';
import { ProjectStore, ProjectStoreError, SaveInfo, VERSION_LABEL_MAX_LENGTH } from './store/projects.js';
import { SessionStore } from './store/sessions.js';
import { toPublicUser, UserChanges, UserRecord, UserStore, UserStoreError } from './store/users.js';
import { AiUsageStore, QuotaExceededError } from './store/ai-usage.js';
import { AiSettingsError, AiSettingsStore, effectiveAiConfig, settingsView } from './store/ai-settings.js';
import { NO_TEXT_INSTRUCTION, PROMPT_PLACEHOLDERS, renderPrompt } from './ai/prompt.js';
import {
  ASPECT_RATIOS, AspectRatio, ImageProvider, ImageProviderError, MAX_IMAGES_PER_REQUEST, PROMPT_MAX_LENGTH
} from './ai/image-provider.js';
import { createImageProviders, defaultImageProvider } from './ai/providers/index.js';

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
  aiUsage: AiUsageStore;
  aiSettings: AiSettingsStore;
  /** code required to create the first administrator */
  setupToken: string;
}

/** Highest monthly image quota an administrator can give */
const MAX_MONTHLY_IMAGES = 100000;

/** Start of a Dexie export: {"formatName":"dexie" (spaces allowed) */
const DEXIE_EXPORT_START = /^\s*\{\s*"formatName"\s*:\s*"dexie"/;

function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') {
    return false;
  }
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks that a project body looks like a whole Dexie export, without parsing it all */
function looksLikeDexieExport(body: Buffer): boolean {
  if (!DEXIE_EXPORT_START.test(body.subarray(0, 256).toString('utf8'))) {
    return false;
  }
  let end = body.length - 1;
  while (end >= 0 && /\s/.test(String.fromCharCode(body[end]))) {
    end--;
  }
  return end >= 0 && body[end] === 0x7d; // '}': the upload was not cut short
}

/**
 * imageProviders: replaces the providers built from the configuration (tests).
 */
export async function buildApp(config: ServerConfig, options: { imageProviders?: ImageProvider[] } = {}): Promise<CiderApp> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const aiSettings = new AiSettingsStore(config.dataDir);
  await aiSettings.load();
  /** AI configuration in force: Docker variables, overridden by the administration page */
  let ai = effectiveAiConfig(config.ai, aiSettings.get());
  const users = new UserStore(config.dataDir, () => ai.defaultMonthlyImages);
  const sessions = new SessionStore(config.dataDir, config.sessionDays);
  const projects = new ProjectStore(config.dataDir);
  const aiUsage = new AiUsageStore(config.dataDir);
  await users.load();
  await sessions.load();
  await aiUsage.load();
  let imageProviders = options.imageProviders ?? createImageProviders(ai);
  let defaultProvider = defaultImageProvider(imageProviders, ai.defaultImageProvider);
  const describeProviders = () => imageProviders.length > 0
    ? `Image providers: ${imageProviders.map(provider => provider.id).join(', ')} (default: ${defaultProvider?.id})`
    : 'No image provider configured: AI image generation is off';
  /** new settings from the administration page: providers rebuilt, running generations finish with the old ones */
  const applyAiSettings = () => {
    ai = effectiveAiConfig(config.ai, aiSettings.get());
    imageProviders = options.imageProviders ?? createImageProviders(ai);
    defaultProvider = defaultImageProvider(imageProviders, ai.defaultImageProvider);
  };
  /** users with a generation in progress: one at a time per user */
  const generating = new Set<string>();
  decoyHash ??= hashPassword('decoy-password-for-timing');

  // code needed to create the first administrator: only someone who can read the
  // server logs (or set CIDER_SETUP_TOKEN) can claim a fresh installation
  const setupToken = config.setupToken || randomBytes(9).toString('base64url');

  const app = Fastify({
    logger: { level: config.logLevel },
    // behind nginx: client address and protocol come from the X-Forwarded-* headers,
    // trusted only when they were set by a proxy of the private network
    trustProxy: config.trustedProxies,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // project bodies are stored as received: kept as raw bytes, never parsed whole
  app.addContentTypeParser(PROJECT_CONTENT_TYPE, { parseAs: 'buffer', bodyLimit: config.maxProjectMb * 1024 * 1024 },
    (_request, body, done) => done(null, body));

  if (users.count() === 0 && !config.setupToken) {
    app.log.warn(`No account yet. Setup code for the first administrator: ${setupToken}`);
  }
  app.log.info(describeProviders());

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof QuotaExceededError) {
      return reply.status(429).send({ error: error.message, remaining: error.remaining });
    }
    if (error instanceof ImageProviderError) {
      request.log.warn(`image generation failed: ${error.message}`);
      return reply.status(error.status).send({ error: error.message });
    }
    if (error instanceof HttpError || error instanceof AiSettingsError || error instanceof UserStoreError || error instanceof ProjectStoreError) {
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
    const { username, password, setupToken: givenToken } = body(request);
    if (!sameSecret(givenToken, setupToken)) {
      throw new HttpError(403, 'wrong setup code (see the logs of the api container)');
    }
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
    return {
      users: users.list().map(user => ({ ...toPublicUser(user), aiImagesThisMonth: aiUsage.used(user.id) })),
    };
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

  /**
   * Resets a password, grants or removes administrator rights, disables or enables
   * an account, enables AI features and sets the monthly image quota
   */
  app.patch<{ Params: { id: string } }>('/api/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const { password, isAdmin, disabled, aiEnabled, aiMonthlyImages } = body(request);
    const target = users.get(request.params.id);
    if (!target) {
      throw new HttpError(404, 'user not found');
    }
    if (target.id === admin.id && (isAdmin === false || disabled === true)) {
      throw new HttpError(409, 'you cannot remove your own administrator rights or disable your own account');
    }
    const changes: UserChanges = {};
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
    if (typeof aiEnabled === 'boolean') {
      changes.aiEnabled = aiEnabled;
    }
    if (aiMonthlyImages !== undefined) {
      if (!Number.isInteger(aiMonthlyImages) || (aiMonthlyImages as number) < 0 || (aiMonthlyImages as number) > MAX_MONTHLY_IMAGES) {
        throw new HttpError(400, `the monthly image quota must be a whole number from 0 to ${MAX_MONTHLY_IMAGES}`);
      }
      changes.aiMonthlyImages = aiMonthlyImages as number;
    }
    const user = await users.update(target.id, changes);
    if (changes.passwordHash || changes.disabled) {
      // an administrator resetting their own password stays logged in here
      await sessions.revokeUser(user.id, user.id === admin.id ? request.cookies[SESSION_COOKIE] : undefined);
    }
    return { user: { ...toPublicUser(user), aiImagesThisMonth: aiUsage.used(user.id) } };
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
    await aiUsage.forget(request.params.id);
    return { ok: true };
  });

  /*********************************************************************
   * Projects of the logged-in user
   *********************************************************************/

  app.get('/api/projects', async (request) => ({ projects: await projects.list(requireUser(request).id) }));

  app.post('/api/projects', async (request) => {
    const user = requireUser(request);
    return { project: await projects.create(user.id, body(request)['name'] as string, config.maxProjectsPerUser) };
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

  /** Author and description of a save, sent by the application in headers */
  const saveInfo = (request: FastifyRequest, user: UserRecord): SaveInfo => {
    const header = request.headers['x-cider-change'];
    let label = '';
    if (typeof header === 'string') {
      try {
        label = decodeURIComponent(header).slice(0, VERSION_LABEL_MAX_LENGTH);
      } catch {
        label = '';
      }
    }
    return { by: user.username, label, important: request.headers['x-cider-change-important'] === '1' };
  };

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
    if (request.headers['content-type']?.split(';')[0] !== PROJECT_CONTENT_TYPE || !Buffer.isBuffer(request.body)) {
      throw new HttpError(415, `project data must be sent as ${PROJECT_CONTENT_TYPE}`);
    }
    if (!looksLikeDexieExport(request.body)) {
      throw new HttpError(400, 'project data is not a complete Cider database export');
    }
    const baseHeader = request.headers['x-base-revision'];
    const baseRevision = typeof baseHeader === 'string' && /^\d+$/.test(baseHeader) ? Number(baseHeader) : undefined;
    const project = await projects.writeData(user.id, request.params.id, request.body,
      baseRevision, request.query.force === '1', saveInfo(request, user));
    return { project };
  });

  /** Kept versions of a project, newest first */
  app.get<{ Params: { id: string } }>('/api/projects/:id/versions', async (request) => ({
    versions: await projects.listVersions(requireUser(request).id, request.params.id),
  }));

  /** Data of a version (download) */
  app.get<{ Params: { id: string; revision: string } }>('/api/projects/:id/versions/:revision', async (request, reply) => {
    const data = await projects.readVersion(requireUser(request).id, request.params.id, Number(request.params.revision));
    reply.header('cache-control', 'no-store');
    return reply.type('application/json').send(data);
  });

  /**
   * Restores a version: as the new current state of the project (the state it
   * replaces stays in the history), or as a new project.
   */
  app.post<{ Params: { id: string; revision: string } }>('/api/projects/:id/versions/:revision/restore', async (request) => {
    const user = requireUser(request);
    const revision = Number(request.params.revision);
    const data = await projects.readVersion(user.id, request.params.id, revision);
    const { asNew, name } = body(request);
    const label = `restore:${revision}`;
    if (asNew === true) {
      const project = await projects.create(user.id, String(name ?? ''), config.maxProjectsPerUser, data,
        { by: user.username, label });
      return { project };
    }
    const project = await projects.writeData(user.id, request.params.id, data, undefined, true,
      { by: user.username, label, important: true });
    return { project };
  });

  /*********************************************************************
   * AI: image generation
   *********************************************************************/

  /** What the logged-in user can do with AI: providers, access, quota */
  app.get('/api/ai/status', async (request) => {
    const user = requireUser(request);
    return {
      imageProviders: imageProviders.map(provider => ({ id: provider.id, label: provider.label })),
      defaultImageProvider: defaultProvider?.id ?? null,
      aspectRatios: ASPECT_RATIOS,
      maxImagesPerRequest: MAX_IMAGES_PER_REQUEST,
      enabled: user.aiEnabled,
      monthlyImages: user.aiMonthlyImages,
      imagesThisMonth: aiUsage.used(user.id),
      promptTemplate: ai.promptTemplate,
      noTextInstruction: NO_TEXT_INSTRUCTION,
    };
  });

  /** AI settings for the administration page (keys reduced to a hint) */
  app.get('/api/ai/settings', async (request) => {
    requireAdmin(request);
    return {
      settings: settingsView(config.ai, aiSettings.get()),
      activeProviders: imageProviders.map(provider => provider.id),
      placeholders: PROMPT_PLACEHOLDERS,
    };
  });

  app.patch('/api/ai/settings', async (request) => {
    const admin = requireAdmin(request);
    await aiSettings.update(body(request));
    applyAiSettings();
    request.log.info(`AI settings changed by ${admin.username}. ${describeProviders()}`);
    return {
      settings: settingsView(config.ai, aiSettings.get()),
      activeProviders: imageProviders.map(provider => provider.id),
      placeholders: PROMPT_PLACEHOLDERS,
    };
  });

  /** Forgets the administration settings: back to the Docker variables */
  app.delete('/api/ai/settings', async (request) => {
    const admin = requireAdmin(request);
    await aiSettings.reset();
    applyAiSettings();
    request.log.info(`AI settings reset by ${admin.username}. ${describeProviders()}`);
    return {
      settings: settingsView(config.ai, aiSettings.get()),
      activeProviders: imageProviders.map(provider => provider.id),
      placeholders: PROMPT_PLACEHOLDERS,
    };
  });

  /**
   * Generates images from the description of the subject, framed by the prompt
   * template of the administration page (with the project style and the card name). The images are counted against the user's
   * monthly quota (given back if the generation fails) and returned in base64:
   * nothing is stored on the server, the user chooses what to keep.
   */
  app.post('/api/ai/images', async (request) => {
    const user = requireUser(request);
    if (!user.aiEnabled) {
      throw new HttpError(403, 'AI features are not enabled for this account (ask an administrator)');
    }
    const { subject, style, cardName, noText, aspectRatio, count, provider: providerId } = body(request);
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new HttpError(400, 'a description of the image is required');
    }
    for (const [name, value] of [['subject', subject], ['style', style], ['cardName', cardName]] as const) {
      if (value !== undefined && (typeof value !== 'string' || value.length > PROMPT_MAX_LENGTH)) {
        throw new HttpError(400, `${name} must be a text of at most ${PROMPT_MAX_LENGTH} characters`);
      }
    }
    const prompt = renderPrompt(ai.promptTemplate, {
      subject,
      style: style as string | undefined,
      card_name: cardName as string | undefined,
      no_text: noText === false ? '' : NO_TEXT_INSTRUCTION,
    });
    const ratio = (aspectRatio ?? '1:1') as AspectRatio;
    if (!ASPECT_RATIOS.includes(ratio)) {
      throw new HttpError(400, `the aspect ratio must be one of ${ASPECT_RATIOS.join(', ')}`);
    }
    const imageCount = count ?? 1;
    if (!Number.isInteger(imageCount) || (imageCount as number) < 1 || (imageCount as number) > MAX_IMAGES_PER_REQUEST) {
      throw new HttpError(400, `the number of images must be from 1 to ${MAX_IMAGES_PER_REQUEST}`);
    }
    const provider = providerId === undefined || providerId === null
      ? defaultProvider
      : imageProviders.find(candidate => candidate.id === providerId);
    if (!provider) {
      throw new HttpError(providerId ? 400 : 503, providerId
        ? 'unknown image provider'
        : 'no image provider is configured on this server');
    }
    if (generating.has(user.id)) {
      throw new HttpError(429, 'an image generation is already in progress for this account');
    }

    generating.add(user.id);
    const requested = imageCount as number;
    try {
      await aiUsage.reserve(user.id, requested, user.aiMonthlyImages);
      const started = Date.now();
      let images;
      try {
        images = (await provider.generate({ prompt, aspectRatio: ratio, count: requested },
          AbortSignal.timeout(ai.timeoutMs))).slice(0, requested);
      } catch (error) {
        await aiUsage.release(user.id, requested);
        throw error;
      }
      if (images.length < requested) {
        await aiUsage.release(user.id, requested - images.length);
      }
      request.log.info(`user ${user.username} generated ${images.length} image(s) with ${provider.id} in ${Date.now() - started} ms`);
      return {
        provider: provider.id,
        prompt,
        images: images.map(image => ({ mimeType: image.mimeType, data: image.data.toString('base64') })),
        imagesThisMonth: aiUsage.used(user.id),
        monthlyImages: user.aiMonthlyImages,
      };
    } finally {
      generating.delete(user.id);
    }
  });

  return { app, users, sessions, projects, aiUsage, aiSettings, setupToken };
}
