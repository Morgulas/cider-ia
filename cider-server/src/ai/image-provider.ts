/**
 * Common interface of the image generation services (OpenAI, Google Gemini,
 * ComfyUI...). The server keeps the API keys; the browser only sees the images.
 */

export const ASPECT_RATIOS = ['1:1', '2:3', '3:4', '4:3', '3:2', '9:16', '16:9'] as const;
export type AspectRatio = typeof ASPECT_RATIOS[number];

export const MAX_IMAGES_PER_REQUEST = 4;
export const PROMPT_MAX_LENGTH = 4000;

export interface ImageRequest {
  prompt: string;
  aspectRatio: AspectRatio;
  /** number of images to generate, 1 to MAX_IMAGES_PER_REQUEST */
  count: number;
}

export interface GeneratedImage {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer;
}

export interface ImageProvider {
  /** stable identifier used by the API and the CIDER_IMAGE_PROVIDER setting */
  readonly id: string;
  /** name shown to users */
  readonly label: string;
  generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage[]>;
}

/**
 * A provider refused or failed the request. The message is shown to the user
 * (e.g. "the prompt was rejected by the safety system"): it never contains a key.
 */
export class ImageProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/** Width and height for an aspect ratio, about one megapixel, multiples of 64 */
export function dimensionsFor(aspectRatio: AspectRatio): { width: number; height: number } {
  const sizes: Record<AspectRatio, [number, number]> = {
    '1:1': [1024, 1024],
    '2:3': [832, 1216],
    '3:4': [896, 1152],
    '4:3': [1152, 896],
    '3:2': [1216, 832],
    '9:16': [768, 1344],
    '16:9': [1344, 768],
  };
  const [width, height] = sizes[aspectRatio];
  return { width, height };
}

/** Recognizes the image format from its first bytes; undefined if it is not an image */
export function detectImageType(data: Buffer): GeneratedImage['mimeType'] | undefined {
  if (data.length > 8 && data[0] === 0x89 && data.subarray(1, 4).toString('latin1') === 'PNG') {
    return 'image/png';
  }
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length > 12 && data.subarray(0, 4).toString('latin1') === 'RIFF'
    && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/** Decodes a base64 image returned by a provider and checks that it really is an image */
export function decodeImage(base64: string): GeneratedImage {
  const data = Buffer.from(base64, 'base64');
  const mimeType = detectImageType(data);
  if (!mimeType) {
    throw new ImageProviderError('the image service returned data that is not an image');
  }
  return { mimeType, data };
}

/**
 * Reads the error message of a failed provider response, shortened, for the user.
 * Provider error bodies describe the problem (quota, refused prompt...) and never echo the key.
 */
export async function providerErrorMessage(provider: string, response: Response): Promise<string> {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: unknown } | unknown; message?: unknown };
      const error = json.error;
      detail = typeof error === 'object' && error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : typeof error === 'string' ? error
          : typeof json.message === 'string' ? json.message : text;
    } catch {
      detail = text;
    }
  } catch {
    detail = '';
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `${provider} (HTTP ${response.status})${detail ? ': ' + detail : ''}`;
}

/** fetch() with the provider name in network errors, and timeouts reported clearly */
export async function providerFetch(provider: string, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (signal.aborted) {
      throw new ImageProviderError(`${provider}: no answer in time (timeout)`, 504);
    }
    throw new ImageProviderError(`${provider} cannot be reached: ${(error as Error).message}`);
  }
}
