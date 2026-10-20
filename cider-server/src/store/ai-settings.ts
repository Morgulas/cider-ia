import path from 'node:path';
import { AI_DEFAULTS, AiConfig } from '../config.js';
import { PROMPT_TEMPLATE_MAX_LENGTH } from '../ai/prompt.js';
import { readJson, SerialQueue, writeFileAtomic } from './json-file.js';

/**
 * AI settings changed in the administration page (ai-settings.json). Every
 * field is optional: a field that is absent keeps the value of the Docker
 * environment variables, so the file only holds what the administrator changed.
 */
export interface AiSettings {
  defaultImageProvider?: string;
  timeoutSeconds?: number;
  defaultMonthlyImages?: number;
  promptTemplate?: string;
  openai?: { enabled?: boolean; apiKey?: string; baseUrl?: string; model?: string; quality?: string };
  gemini?: { enabled?: boolean; apiKey?: string; baseUrl?: string; model?: string };
  comfyui?: { enabled?: boolean; url?: string; checkpoint?: string; negativePrompt?: string; workflow?: string };
}

interface SettingsFile {
  version: 1;
  settings: AiSettings;
}

export const PROVIDER_IDS = ['openai', 'gemini', 'comfyui'] as const;
export const OPENAI_QUALITIES = ['low', 'medium', 'high', 'auto'];
export const MIN_TIMEOUT_SECONDS = 10;
/** nginx waits 300 s for the api: a generation must end before */
export const MAX_TIMEOUT_SECONDS = 290;
export const MAX_MONTHLY_IMAGES = 100000;
const MAX_TEXT = 500;
const MAX_WORKFLOW = 200000;

export class AiSettingsError extends Error {
  readonly status = 400;
}

const trimUrl = (url: string) => url.trim().replace(/\/+$/, '');
const isHttpUrl = (url: string) => /^https?:\/\/[^\s/]+/i.test(url);
/** last characters of a key, enough to recognize it without revealing it */
const keyHint = (key: string) => key ? `…${key.slice(-4)}` : '';

/**
 * Effective configuration: Docker variables, overridden by the administration
 * settings. A provider is active when its key (or URL) is set and it is enabled.
 */
export function effectiveAiConfig(base: AiConfig, settings: AiSettings): AiConfig {
  const o = settings.openai ?? {};
  const g = settings.gemini ?? {};
  const c = settings.comfyui ?? {};
  const openAiKey = o.apiKey ?? base.openai?.apiKey ?? '';
  const geminiKey = g.apiKey ?? base.gemini?.apiKey ?? '';
  const comfyUrl = c.url ?? base.comfyui?.url ?? '';
  return {
    defaultImageProvider: settings.defaultImageProvider ?? base.defaultImageProvider,
    timeoutMs: settings.timeoutSeconds !== undefined ? settings.timeoutSeconds * 1000 : base.timeoutMs,
    defaultMonthlyImages: settings.defaultMonthlyImages ?? base.defaultMonthlyImages,
    promptTemplate: settings.promptTemplate ?? base.promptTemplate,
    openai: openAiKey && o.enabled !== false ? {
      apiKey: openAiKey,
      baseUrl: o.baseUrl ?? base.openai?.baseUrl ?? AI_DEFAULTS.openai.baseUrl,
      model: o.model ?? base.openai?.model ?? AI_DEFAULTS.openai.model,
      quality: o.quality ?? base.openai?.quality ?? AI_DEFAULTS.openai.quality,
    } : undefined,
    gemini: geminiKey && g.enabled !== false ? {
      apiKey: geminiKey,
      baseUrl: g.baseUrl ?? base.gemini?.baseUrl ?? AI_DEFAULTS.gemini.baseUrl,
      model: g.model ?? base.gemini?.model ?? AI_DEFAULTS.gemini.model,
    } : undefined,
    comfyui: comfyUrl && c.enabled !== false ? {
      url: comfyUrl,
      workflowFile: base.comfyui?.workflowFile ?? '',
      workflow: c.workflow || undefined,
      checkpoint: c.checkpoint ?? base.comfyui?.checkpoint ?? AI_DEFAULTS.comfyui.checkpoint,
      negativePrompt: c.negativePrompt ?? base.comfyui?.negativePrompt ?? AI_DEFAULTS.comfyui.negativePrompt,
    } : undefined,
  };
}

/**
 * What the administration page shows: the effective values, keys reduced to a
 * hint (they are never sent back to the browser).
 */
export function settingsView(base: AiConfig, settings: AiSettings) {
  const o = settings.openai ?? {};
  const g = settings.gemini ?? {};
  const c = settings.comfyui ?? {};
  const openAiKey = o.apiKey ?? base.openai?.apiKey ?? '';
  const geminiKey = g.apiKey ?? base.gemini?.apiKey ?? '';
  return {
    defaultImageProvider: settings.defaultImageProvider ?? base.defaultImageProvider,
    timeoutSeconds: settings.timeoutSeconds ?? Math.round(base.timeoutMs / 1000),
    defaultMonthlyImages: settings.defaultMonthlyImages ?? base.defaultMonthlyImages,
    promptTemplate: settings.promptTemplate ?? base.promptTemplate,
    openai: {
      enabled: o.enabled !== false,
      apiKeySet: openAiKey !== '',
      apiKeyHint: keyHint(openAiKey),
      baseUrl: o.baseUrl ?? base.openai?.baseUrl ?? AI_DEFAULTS.openai.baseUrl,
      model: o.model ?? base.openai?.model ?? AI_DEFAULTS.openai.model,
      quality: o.quality ?? base.openai?.quality ?? AI_DEFAULTS.openai.quality,
    },
    gemini: {
      enabled: g.enabled !== false,
      apiKeySet: geminiKey !== '',
      apiKeyHint: keyHint(geminiKey),
      baseUrl: g.baseUrl ?? base.gemini?.baseUrl ?? AI_DEFAULTS.gemini.baseUrl,
      model: g.model ?? base.gemini?.model ?? AI_DEFAULTS.gemini.model,
    },
    comfyui: {
      enabled: c.enabled !== false,
      url: c.url ?? base.comfyui?.url ?? '',
      checkpoint: c.checkpoint ?? base.comfyui?.checkpoint ?? AI_DEFAULTS.comfyui.checkpoint,
      negativePrompt: c.negativePrompt ?? base.comfyui?.negativePrompt ?? AI_DEFAULTS.comfyui.negativePrompt,
      workflow: c.workflow ?? '',
      workflowFile: base.comfyui?.workflowFile ?? '',
    },
    /** true when the administration page changed something */
    customized: Object.keys(settings).length > 0,
  };
}

type Input = Record<string, unknown>;

function text(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new AiSettingsError(`${field} must be a text of at most ${max} characters`);
  }
  return value.trim();
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new AiSettingsError(`${field} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function url(value: unknown, field: string, allowEmpty: boolean): string {
  const result = trimUrl(text(value, field));
  if (!(allowEmpty && result === '') && !isHttpUrl(result)) {
    throw new AiSettingsError(`${field} must be an http(s) address`);
  }
  return result;
}

function section(value: unknown, field: string): Input | undefined {
  if (value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AiSettingsError(`${field} must be an object`);
  }
  return value as Input;
}

/** Removes the fields set to null from the settings, returns the other changes */
function removeNulls(settings: Input, input: Input): Input {
  const rest: Input = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) {
      delete settings[key];
    } else if (typeof value === 'object' && !Array.isArray(value) && PROVIDER_IDS.includes(key as typeof PROVIDER_IDS[number])) {
      const target = (settings[key] ?? {}) as Input;
      rest[key] = removeNulls(target, value as Input);
      if (Object.keys(target).length > 0) {
        settings[key] = target;
      } else {
        delete settings[key];
      }
    } else {
      rest[key] = value;
    }
  }
  return rest;
}

/**
 * Applies the changes sent by the administration page to the stored settings.
 * Only the fields present are changed; for a key, a text replaces it and an
 * empty text removes it (the provider is then off, even if Docker sets a key).
 */
export function applySettingsChanges(current: AiSettings, rawInput: Input): AiSettings {
  const next: AiSettings = structuredClone(current);
  // null: the field goes back to its Docker value
  const input = removeNulls(next as Input, rawInput);
  if (input['defaultImageProvider'] !== undefined) {
    const id = text(input['defaultImageProvider'], 'defaultImageProvider').toLowerCase();
    if (id !== '' && !(PROVIDER_IDS as readonly string[]).includes(id)) {
      throw new AiSettingsError(`defaultImageProvider must be one of ${PROVIDER_IDS.join(', ')}`);
    }
    next.defaultImageProvider = id;
  }
  if (input['timeoutSeconds'] !== undefined) {
    next.timeoutSeconds = integer(input['timeoutSeconds'], 'timeoutSeconds', MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
  }
  if (input['defaultMonthlyImages'] !== undefined) {
    next.defaultMonthlyImages = integer(input['defaultMonthlyImages'], 'defaultMonthlyImages', 0, MAX_MONTHLY_IMAGES);
  }
  if (input['promptTemplate'] !== undefined) {
    const template = text(input['promptTemplate'], 'promptTemplate', PROMPT_TEMPLATE_MAX_LENGTH);
    if (!template.includes('{{subject}}')) {
      throw new AiSettingsError('the prompt template must contain {{subject}}');
    }
    next.promptTemplate = template;
  }

  const openai = section(input['openai'], 'openai');
  if (openai) {
    const target = next.openai ??= {};
    if (openai['enabled'] !== undefined) target.enabled = openai['enabled'] === true;
    if (openai['apiKey'] !== undefined) target.apiKey = text(openai['apiKey'], 'openai.apiKey');
    if (openai['baseUrl'] !== undefined) target.baseUrl = url(openai['baseUrl'], 'openai.baseUrl', false);
    if (openai['model'] !== undefined) target.model = text(openai['model'], 'openai.model') || AI_DEFAULTS.openai.model;
    if (openai['quality'] !== undefined) {
      const quality = text(openai['quality'], 'openai.quality');
      if (!OPENAI_QUALITIES.includes(quality)) {
        throw new AiSettingsError(`openai.quality must be one of ${OPENAI_QUALITIES.join(', ')}`);
      }
      target.quality = quality;
    }
  }

  const gemini = section(input['gemini'], 'gemini');
  if (gemini) {
    const target = next.gemini ??= {};
    if (gemini['enabled'] !== undefined) target.enabled = gemini['enabled'] === true;
    if (gemini['apiKey'] !== undefined) target.apiKey = text(gemini['apiKey'], 'gemini.apiKey');
    if (gemini['baseUrl'] !== undefined) target.baseUrl = url(gemini['baseUrl'], 'gemini.baseUrl', false);
    if (gemini['model'] !== undefined) target.model = text(gemini['model'], 'gemini.model') || AI_DEFAULTS.gemini.model;
  }

  const comfyui = section(input['comfyui'], 'comfyui');
  if (comfyui) {
    const target = next.comfyui ??= {};
    if (comfyui['enabled'] !== undefined) target.enabled = comfyui['enabled'] === true;
    if (comfyui['url'] !== undefined) target.url = url(comfyui['url'], 'comfyui.url', true);
    if (comfyui['checkpoint'] !== undefined) target.checkpoint = text(comfyui['checkpoint'], 'comfyui.checkpoint');
    if (comfyui['negativePrompt'] !== undefined) {
      target.negativePrompt = text(comfyui['negativePrompt'], 'comfyui.negativePrompt', 2000);
    }
    if (comfyui['workflow'] !== undefined) {
      const workflow = text(comfyui['workflow'], 'comfyui.workflow', MAX_WORKFLOW);
      if (workflow !== '') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(workflow);
        } catch {
          throw new AiSettingsError('the ComfyUI workflow is not valid JSON (use "Export (API)" in ComfyUI)');
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new AiSettingsError('the ComfyUI workflow must be a JSON object (use "Export (API)" in ComfyUI)');
        }
        if (!workflow.includes('{{prompt}}')) {
          throw new AiSettingsError('the ComfyUI workflow must contain the {{prompt}} placeholder');
        }
      }
      target.workflow = workflow;
    }
  }
  return next;
}

/** Stores the administration settings (ai-settings.json, readable by the server only) */
export class AiSettingsStore {
  private settings: AiSettings = {};
  private readonly file: string;
  private readonly queue = new SerialQueue();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'ai-settings.json');
  }

  async load(): Promise<void> {
    this.settings = (await readJson<SettingsFile>(this.file, { version: 1, settings: {} })).settings ?? {};
  }

  get(): AiSettings {
    return this.settings;
  }

  update(input: Input): Promise<AiSettings> {
    return this.queue.run(async () => {
      const next = applySettingsChanges(this.settings, input);
      const content: SettingsFile = { version: 1, settings: next };
      await writeFileAtomic(this.file, JSON.stringify(content, null, 2));
      this.settings = next;
      return next;
    });
  }

  /** Back to the Docker variables only */
  reset(): Promise<void> {
    return this.queue.run(async () => {
      const content: SettingsFile = { version: 1, settings: {} };
      await writeFileAtomic(this.file, JSON.stringify(content, null, 2));
      this.settings = {};
    });
  }
}
