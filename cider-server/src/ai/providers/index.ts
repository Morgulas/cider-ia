import { AiConfig } from '../../config.js';
import { ImageProvider } from '../image-provider.js';
import { ComfyUiImageProvider } from './comfyui.js';
import { GeminiImageProvider } from './gemini.js';
import { OpenAiImageProvider } from './openai.js';

/** The image providers that are configured (key or URL set), in a stable order */
export function createImageProviders(config: AiConfig): ImageProvider[] {
  const providers: ImageProvider[] = [];
  if (config.openai) {
    providers.push(new OpenAiImageProvider(config.openai));
  }
  if (config.gemini) {
    providers.push(new GeminiImageProvider(config.gemini));
  }
  if (config.comfyui) {
    providers.push(new ComfyUiImageProvider(config.comfyui));
  }
  return providers;
}

/** The default provider: CIDER_IMAGE_PROVIDER if it is configured, otherwise the first one */
export function defaultImageProvider(providers: ImageProvider[], wanted: string): ImageProvider | undefined {
  return providers.find(provider => provider.id === wanted) ?? providers[0];
}
