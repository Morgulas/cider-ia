import http from 'node:http';
import { AddressInfo } from 'node:net';

/** A 1x1 PNG, the smallest valid image */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

/**
 * One local HTTP server imitating the three image services, as documented:
 * - OpenAI:  POST /openai/v1/images/generations -> { data: [{ b64_json }] }
 * - Gemini:  POST /gemini/v1beta/models/<model>:generateContent -> candidates[0].content.parts[].inlineData
 * - ComfyUI: POST /comfy/prompt -> { prompt_id }, GET /comfy/history/<id>, GET /comfy/view?filename=...
 * Behaviour can be changed per test (failures, delays, refused prompts).
 */
export class FakeImageServices {
  readonly requests: RecordedRequest[] = [];
  /** answer every OpenAI call with this status and body instead of images */
  openAiFailure?: { status: number; body: unknown };
  /** delay before answering OpenAI, in ms */
  openAiDelayMs = 0;
  /** Gemini answers with a blocked prompt */
  geminiBlocked = false;
  /** ComfyUI history polls before the result appears */
  comfyPendingPolls = 1;
  /** ComfyUI reports an execution error */
  comfyError = false;

  private server = http.createServer((request, response) => void this.handle(request, response));
  private comfyPolls = new Map<string, number>();
  private comfyBatch = new Map<string, number>();
  baseUrl = '';

  async start(): Promise<void> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise(resolve => this.server.close(() => resolve()));
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : undefined;
    const url = request.url ?? '';
    this.requests.push({ method: request.method ?? '', url, headers: request.headers, body });
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };

    if (url === '/openai/v1/images/generations') {
      if (this.openAiDelayMs) {
        await new Promise(resolve => setTimeout(resolve, this.openAiDelayMs));
      }
      if (this.openAiFailure) {
        return json(this.openAiFailure.status, this.openAiFailure.body);
      }
      return json(200, { created: 1, data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: TINY_PNG_BASE64 })) });
    }

    if (url.startsWith('/gemini/v1beta/models/') && url.endsWith(':generateContent')) {
      if (this.geminiBlocked) {
        return json(200, { promptFeedback: { blockReason: 'SAFETY' } });
      }
      return json(200, {
        candidates: [{
          content: { parts: [{ text: 'Here is your image.' }, { inlineData: { mimeType: 'image/png', data: TINY_PNG_BASE64 } }] },
          finishReason: 'STOP',
        }],
      });
    }

    if (url === '/comfy/prompt') {
      const id = `prompt-${this.comfyBatch.size + 1}`;
      const latent = Object.values(body.prompt as Record<string, any>).find(node => node.class_type === 'EmptyLatentImage');
      this.comfyBatch.set(id, latent?.inputs?.batch_size ?? 1);
      return json(200, { prompt_id: id, number: 1, node_errors: {} });
    }
    if (url.startsWith('/comfy/history/')) {
      const id = decodeURIComponent(url.slice('/comfy/history/'.length));
      const polls = (this.comfyPolls.get(id) ?? 0) + 1;
      this.comfyPolls.set(id, polls);
      if (polls <= this.comfyPendingPolls) {
        return json(200, {});
      }
      if (this.comfyError) {
        return json(200, { [id]: { outputs: {}, status: { status_str: 'error', completed: false } } });
      }
      const images = Array.from({ length: this.comfyBatch.get(id) ?? 1 },
        (_, i) => ({ filename: `cider_${i}.png`, subfolder: '', type: 'output' }));
      return json(200, { [id]: { outputs: { '9': { images } }, status: { status_str: 'success', completed: true } } });
    }
    if (url.startsWith('/comfy/view?')) {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(TINY_PNG);
      return;
    }

    json(404, { error: { message: `no fake route for ${url}` } });
  }
}
