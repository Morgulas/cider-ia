import { randomInt } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { ComfyUiConfig } from '../../config.js';
import {
  detectImageType, dimensionsFor, GeneratedImage, ImageProvider, ImageProviderError, ImageRequest,
  providerErrorMessage, providerFetch
} from '../image-provider.js';

type Workflow = Record<string, unknown>;

/**
 * Default text-to-image workflow (ComfyUI API format) for a Stable Diffusion
 * checkpoint such as SDXL. Placeholders are replaced before each run.
 */
export const DEFAULT_COMFYUI_WORKFLOW: Workflow = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: '{{seed}}', steps: 25, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{checkpoint}}' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: '{{batch_size}}' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'cider', images: ['8', 0] } },
};

/**
 * Replaces the placeholders of a workflow: a value that is exactly "{{name}}"
 * becomes the value itself (a number stays a number), and placeholders inside
 * longer texts are replaced by their text.
 */
export function fillWorkflow(workflow: unknown, values: Record<string, string | number>): unknown {
  if (typeof workflow === 'string') {
    const exact = /^\{\{(\w+)\}\}$/.exec(workflow);
    if (exact && exact[1] in values) {
      return values[exact[1]];
    }
    return workflow.replace(/\{\{(\w+)\}\}/g, (match, name: string) => name in values ? String(values[name]) : match);
  }
  if (Array.isArray(workflow)) {
    return workflow.map(item => fillWorkflow(item, values));
  }
  if (workflow && typeof workflow === 'object') {
    return Object.fromEntries(Object.entries(workflow).map(([key, value]) => [key, fillWorkflow(value, values)]));
  }
  return workflow;
}

interface HistoryImage {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface HistoryEntry {
  outputs?: Record<string, { images?: HistoryImage[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new ImageProviderError('ComfyUI: no answer in time (timeout)', 504));
  }, { once: true });
});

/**
 * A ComfyUI server (local or on the network): queues a workflow with POST /prompt,
 * waits for it in /history, then downloads the images with /view.
 */
export class ComfyUiImageProvider implements ImageProvider {
  readonly id = 'comfyui';
  readonly label = 'ComfyUI';
  private workflow: Promise<Workflow> | undefined;

  constructor(private readonly config: ComfyUiConfig, private readonly pollIntervalMs = 1000) { }

  private loadWorkflow(): Promise<Workflow> {
    this.workflow ??= this.config.workflowFile
      ? fs.readFile(this.config.workflowFile, 'utf8').then(text => JSON.parse(text) as Workflow)
      : Promise.resolve(DEFAULT_COMFYUI_WORKFLOW);
    return this.workflow;
  }

  async generate(request: ImageRequest, signal: AbortSignal): Promise<GeneratedImage[]> {
    const { width, height } = dimensionsFor(request.aspectRatio);
    const workflow = fillWorkflow(await this.loadWorkflow(), {
      prompt: request.prompt,
      negative_prompt: this.config.negativePrompt,
      checkpoint: this.config.checkpoint,
      width,
      height,
      batch_size: request.count,
      seed: randomInt(0, 2 ** 47),
    });

    const queued = await providerFetch('ComfyUI', `${this.config.url}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    }, signal);
    if (!queued.ok) {
      throw new ImageProviderError(await providerErrorMessage('ComfyUI', queued));
    }
    const { prompt_id: promptId } = await queued.json() as { prompt_id?: string };
    if (!promptId) {
      throw new ImageProviderError('ComfyUI did not accept the workflow');
    }

    const entry = await this.waitForHistory(promptId, signal);
    const images = Object.values(entry.outputs ?? {})
      .flatMap(output => output.images ?? [])
      .filter(image => (image.type ?? 'output') === 'output');
    if (images.length === 0) {
      throw new ImageProviderError('ComfyUI finished without saving any image (the workflow needs a SaveImage node)');
    }
    return Promise.all(images.map(image => this.download(image, signal)));
  }

  private async waitForHistory(promptId: string, signal: AbortSignal): Promise<HistoryEntry> {
    for (;;) {
      const response = await providerFetch('ComfyUI', `${this.config.url}/history/${encodeURIComponent(promptId)}`,
        { method: 'GET' }, signal);
      if (!response.ok) {
        throw new ImageProviderError(await providerErrorMessage('ComfyUI', response));
      }
      const history = await response.json() as Record<string, HistoryEntry>;
      const entry = history[promptId];
      if (entry?.status?.status_str === 'error') {
        throw new ImageProviderError('ComfyUI failed to run the workflow (see the ComfyUI logs)');
      }
      if (entry && (entry.status?.completed || Object.keys(entry.outputs ?? {}).length > 0)) {
        return entry;
      }
      await sleep(this.pollIntervalMs, signal);
    }
  }

  private async download(image: HistoryImage, signal: AbortSignal): Promise<GeneratedImage> {
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' });
    const response = await providerFetch('ComfyUI', `${this.config.url}/view?${query}`, { method: 'GET' }, signal);
    if (!response.ok) {
      throw new ImageProviderError(await providerErrorMessage('ComfyUI', response));
    }
    const data = Buffer.from(await response.arrayBuffer());
    const mimeType = detectImageType(data);
    if (!mimeType) {
      throw new ImageProviderError('ComfyUI returned data that is not an image');
    }
    return { mimeType, data };
  }
}
