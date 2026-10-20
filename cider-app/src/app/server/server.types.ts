/** An account, as returned by the cider-server API */
export interface PublicUser {
  id: string;
  username: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
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
