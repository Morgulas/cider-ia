import { GeminiImageConfig } from '../../config.js';
import {
  decodeImage, GeneratedImage, ImageProvider, ImageProviderError, ImageRequest,
  providerErrorMessage, providerFetch
} from '../image-provider.js';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Google Gemini image models ("Nano Banana") through generateContent.
 * One call returns one image: several images are requested in parallel.
 */
export class GeminiImageProvider implements ImageProvider {
  readonly id = 'gemini';
  readonly label: string;

  constructor(private readonly config: GeminiImageConfig) {
    this.label = `Google Gemini (${config.model})`;
  }

  async generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage[]> {
    const results = await Promise.all(
      Array.from({ length: request.count }, () => this.generateOne(request, signal)));
    return results.flat();
  }

  private async generateOne(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage[]> {
    const url = `${this.config.baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent`;
    const response = await providerFetch('Google Gemini', url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: request.aspectRatio },
        },
      }),
    }, signal);
    if (!response.ok) {
      throw new ImageProviderError(await providerErrorMessage('Google Gemini', response),
        response.status === 400 ? 400 : 502);
    }
    const json = await response.json() as GeminiResponse;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const images = parts
      .map(part => part.inlineData?.data ?? part.inline_data?.data)
      .filter((data): data is string => typeof data === 'string')
      .map(data => decodeImage(data));
    if (images.length === 0) {
      const reason = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason;
      const text = parts.map(part => part.text).filter(Boolean).join(' ').slice(0, 300);
      throw new ImageProviderError(`Google Gemini returned no image${reason ? ` (${reason})` : ''}${text ? ': ' + text : ''}`,
        reason ? 400 : 502);
    }
    return images;
  }
}
