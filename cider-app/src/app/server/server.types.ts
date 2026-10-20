/** An account, as returned by the cider-server API */
export interface PublicUser {
  id: string;
  username: string;
  isAdmin: boolean;
  disabled: boolean;
  /** AI features allowed for this account */
  aiEnabled: boolean;
  /** images the account may generate per month */
  aiMonthlyImages: number;
  /** images generated this month (administration list only) */
  aiImagesThisMonth?: number;
  createdAt: string;
}

/** What the logged-in user can do with AI */
export interface AiStatus {
  imageProviders: { id: string; label: string }[];
  defaultImageProvider: string | null;
  aspectRatios: string[];
  maxImagesPerRequest: number;
  enabled: boolean;
  monthlyImages: number;
  imagesThisMonth: number;
  /** administrator's text framing every request, with {{subject}}, {{style}}... */
  promptTemplate: string;
  noTextInstruction: string;
}

/** AI settings as shown to administrators: effective values, keys reduced to a hint */
export interface AiSettingsView {
  defaultImageProvider: string;
  timeoutSeconds: number;
  defaultMonthlyImages: number;
  promptTemplate: string;
  openai: { enabled: boolean; apiKeySet: boolean; apiKeyHint: string; baseUrl: string; model: string; quality: string };
  gemini: { enabled: boolean; apiKeySet: boolean; apiKeyHint: string; baseUrl: string; model: string };
  comfyui: {
    enabled: boolean; url: string; checkpoint: string; negativePrompt: string; workflow: string; workflowFile: string;
  };
  customized: boolean;
}

export interface AiSettingsResponse {
  settings: AiSettingsView;
  activeProviders: string[];
  placeholders: string[];
}

/** A project saved on the server */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** incremented on every save, used to detect edits made elsewhere */
  revision: number;
  /** size of the saved data, in bytes */
  size: number;
}

/** Content type of a project body (a Dexie database export) */
export const PROJECT_CONTENT_TYPE = 'application/vnd.cider.project+json';
/** Header required by the server on every request that changes something */
export const CSRF_HEADER = 'X-Cider-Request';

/** Reads the error message sent by the server, or a fallback */
export function apiErrorMessage(error: unknown, fallback = 'Unexpected error'): string {
  const body = (error as { error?: unknown })?.error;
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return fallback;
}
