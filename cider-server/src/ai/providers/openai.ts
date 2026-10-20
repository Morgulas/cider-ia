import { OpenAiImageConfig } from '../../config.js';
import {
  AspectRatio, decodeImage, GeneratedImage, ImageProvider, ImageProviderError, ImageRequest,
  providerErrorMessage, providerFetch
} from '../image-provider.js';

/** Sizes accepted by every GPT Image model (gpt-image-1, 1-mini, 1.5 and 2) */
function openAiSize(aspectRatio: AspectRatio): string {
  switch (aspectRatio) {
    case '1:1':
      return '1024x1024';
    case '4:3':
    case '3:2':
    case '16:9':
      return '1536x1024';
    default:
      return '1024x1536';
  }
}

/**
 * OpenAI Images API (POST /images/generations), or any compatible gateway
 * (OPENAI_BASE_URL). The closest supported size is used for the aspect ratio.
 */
export class OpenAiImageProvider implements ImageProvider {
  readonly id = 'openai';
  readonly label: string;

  constructor(private readonly config: OpenAiImageConfig) {
    this.label = `OpenAI (${config.model})`;
  }

  async generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage[]> {
    const response = await providerFetch('OpenAI', `${this.config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        prompt: request.prompt,
        n: request.count,
        size: openAiSize(request.aspectRatio),
        quality: this.config.quality,
        output_format: 'png',
      }),
    }, signal);
    if (!response.ok) {
      throw new ImageProviderError(await providerErrorMessage('OpenAI', response),
        response.status === 400 ? 400 : 502);
    }
    const json = await response.json() as { data?: { b64_json?: string }[] };
    const images = (json.data ?? []).filter(item => typeof item.b64_json === 'string')
      .map(item => decodeImage(item.b64_json!));
    if (images.length === 0) {
      throw new ImageProviderError('OpenAI returned no image');
    }
    return images;
  }
}
