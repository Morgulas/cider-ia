import path from 'node:path';

export interface OpenAiImageConfig {
  apiKey: string;
  /** https://api.openai.com/v1, or any OpenAI-compatible gateway */
  baseUrl: string;
  model: string;
  /** low, medium or high */
  quality: string;
}

export interface GeminiImageConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ComfyUiConfig {
  /** address of the ComfyUI server, e.g. http://192.168.1.20:8188 */
  url: string;
  /** workflow in ComfyUI API format, with {{prompt}}, {{width}}... placeholders; built-in one if empty */
  workflowFile: string;
  checkpoint: string;
  negativePrompt: string;
}

export interface AiConfig {
  /** provider used when the user does not choose one (openai, gemini or comfyui) */
  defaultImageProvider: string;
  /** maximum duration of one generation request to a provider */
  timeoutMs: number;
  /** monthly image quota given to accounts that have no quota set */
  defaultMonthlyImages: number;
  openai?: OpenAiImageConfig;
  gemini?: GeminiImageConfig;
  comfyui?: ComfyUiConfig;
}

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
  ai: AiConfig;
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

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Image providers: a provider is available when its key (or URL) is set */
export function loadAiConfig(): AiConfig {
  const openAiKey = env('OPENAI_API_KEY');
  const geminiKey = env('GEMINI_API_KEY');
  const comfyUrl = env('COMFYUI_URL');
  return {
    defaultImageProvider: env('CIDER_IMAGE_PROVIDER').toLowerCase(),
    timeoutMs: intFromEnv('CIDER_AI_TIMEOUT_SECONDS', 180, 10) * 1000,
    defaultMonthlyImages: intFromEnv('CIDER_AI_DEFAULT_MONTHLY_IMAGES', 50, 0),
    openai: openAiKey ? {
      apiKey: openAiKey,
      baseUrl: (env('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: env('OPENAI_IMAGE_MODEL') || 'gpt-image-2',
      quality: env('OPENAI_IMAGE_QUALITY') || 'medium',
    } : undefined,
    gemini: geminiKey ? {
      apiKey: geminiKey,
      baseUrl: (env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
      model: env('GEMINI_IMAGE_MODEL') || 'gemini-3.1-flash-image',
    } : undefined,
    comfyui: comfyUrl ? {
      url: comfyUrl.replace(/\/+$/, ''),
      workflowFile: env('COMFYUI_WORKFLOW_FILE'),
      checkpoint: env('COMFYUI_CHECKPOINT') || 'sd_xl_base_1.0.safetensors',
      negativePrompt: env('COMFYUI_NEGATIVE_PROMPT') || 'text, letters, watermark, signature, frame, border, blurry, low quality',
    } : undefined,
  };
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
    ai: loadAiConfig(),
  };
}
