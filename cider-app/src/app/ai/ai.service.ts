import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AiStatus } from '../server/server.types';

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: string;
  count: number;
  /** provider id; the server's default when omitted */
  provider?: string;
}

export interface ImageGenerationResult {
  provider: string;
  images: Blob[];
  imagesThisMonth: number;
  monthlyImages: number;
}

/**
 * AI features offered by the server. The API keys stay on the server: the
 * browser sends the description and receives the images.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  readonly status = signal<AiStatus | null>(null);
  /** image generation can be used: enabled for the account and a provider is configured */
  readonly imagesAvailable = computed(() => {
    const status = this.status();
    return !!status && status.enabled && status.imageProviders.length > 0;
  });

  async refreshStatus(): Promise<AiStatus | null> {
    try {
      const status = await firstValueFrom(this.http.get<AiStatus>('/api/ai/status'));
      this.status.set(status);
      return status;
    } catch {
      this.status.set(null);
      return null;
    }
  }

  async generateImages(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const result = await firstValueFrom(this.http.post<{
      provider: string;
      images: { mimeType: string; data: string }[];
      imagesThisMonth: number;
      monthlyImages: number;
    }>('/api/ai/images', request));
    const status = this.status();
    if (status) {
      this.status.set({ ...status, imagesThisMonth: result.imagesThisMonth, monthlyImages: result.monthlyImages });
    }
    return {
      provider: result.provider,
      images: result.images.map(image => AiService.base64ToBlob(image.data, image.mimeType)),
      imagesThisMonth: result.imagesThisMonth,
      monthlyImages: result.monthlyImages,
    };
  }

  private static base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }
}
