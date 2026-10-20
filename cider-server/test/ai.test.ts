import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp, CiderApp, CSRF_HEADER, SESSION_COOKIE } from '../src/app.js';
import { AiConfig, ServerConfig } from '../src/config.js';
import { detectImageType, dimensionsFor } from '../src/ai/image-provider.js';
import { ComfyUiImageProvider, DEFAULT_COMFYUI_WORKFLOW, fillWorkflow } from '../src/ai/providers/comfyui.js';
import { GeminiImageProvider } from '../src/ai/providers/gemini.js';
import { OpenAiImageProvider } from '../src/ai/providers/openai.js';
import { AiUsageStore, QuotaExceededError } from '../src/store/ai-usage.js';
import { FakeImageServices, TINY_PNG, TINY_PNG_BASE64 } from './fake-image-services.js';

const signal = () => AbortSignal.timeout(5000);

describe('image providers', () => {
  const fake = new FakeImageServices();

  before(() => fake.start());
  after(() => fake.stop());

  it('OpenAI: sends the documented request and decodes b64_json images', async () => {
    const provider = new OpenAiImageProvider({ apiKey: 'sk-test', baseUrl: `${fake.baseUrl}/openai/v1`, model: 'gpt-image-2', quality: 'medium' });
    const images = await provider.generate({ prompt: 'a red apple', aspectRatio: '3:4', count: 2 }, signal());
    assert.equal(images.length, 2);
    assert.deepEqual(images[0].data, TINY_PNG);
    assert.equal(images[0].mimeType, 'image/png');
    const sent = fake.requests.at(-1)!;
    assert.equal(sent.headers['authorization'], 'Bearer sk-test');
    assert.deepEqual(sent.body, { model: 'gpt-image-2', prompt: 'a red apple', n: 2, size: '1024x1536', quality: 'medium', output_format: 'png' });
  });

  it('OpenAI: reports the service error message, never the key', async () => {
    fake.openAiFailure = { status: 400, body: { error: { message: 'Your request was rejected by the safety system.' } } };
    const provider = new OpenAiImageProvider({ apiKey: 'sk-secret', baseUrl: `${fake.baseUrl}/openai/v1`, model: 'gpt-image-2', quality: 'low' });
    await assert.rejects(provider.generate({ prompt: 'x', aspectRatio: '1:1', count: 1 }, signal()), (error: Error & { status: number }) => {
      assert.match(error.message, /rejected by the safety system/);
      assert.ok(!error.message.includes('sk-secret'));
      assert.equal(error.status, 400);
      return true;
    });
    fake.openAiFailure = undefined;
  });

  it('Gemini: one generateContent call per image, with the aspect ratio', async () => {
    const before = fake.requests.length;
    const provider = new GeminiImageProvider({ apiKey: 'g-test', baseUrl: `${fake.baseUrl}/gemini/v1beta`, model: 'gemini-3.1-flash-image' });
    const images = await provider.generate({ prompt: 'a green apple', aspectRatio: '16:9', count: 3 }, signal());
    assert.equal(images.length, 3);
    const calls = fake.requests.slice(before);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, '/gemini/v1beta/models/gemini-3.1-flash-image:generateContent');
    assert.equal(calls[0].headers['x-goog-api-key'], 'g-test');
    assert.deepEqual(calls[0].body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } });
    assert.equal(calls[0].body.contents[0].parts[0].text, 'a green apple');
  });

  it('Gemini: explains a blocked prompt', async () => {
    fake.geminiBlocked = true;
    const provider = new GeminiImageProvider({ apiKey: 'g', baseUrl: `${fake.baseUrl}/gemini/v1beta`, model: 'm' });
    await assert.rejects(provider.generate({ prompt: 'x', aspectRatio: '1:1', count: 1 }, signal()), /no image \(SAFETY\)/);
    fake.geminiBlocked = false;
  });

  it('ComfyUI: queues the filled workflow, waits for it and downloads the images', async () => {
    const before = fake.requests.length;
    const provider = new ComfyUiImageProvider({
      url: `${fake.baseUrl}/comfy`, workflowFile: '', checkpoint: 'model.safetensors', negativePrompt: 'blurry',
    }, 10);
    const images = await provider.generate({ prompt: 'a blue apple', aspectRatio: '2:3', count: 2 }, signal());
    assert.equal(images.length, 2);
    const queued = fake.requests.slice(before).find(r => r.url === '/comfy/prompt')!;
    const nodes = queued.body.prompt;
    assert.equal(nodes['6'].inputs.text, 'a blue apple');
    assert.equal(nodes['7'].inputs.text, 'blurry');
    assert.equal(nodes['4'].inputs.ckpt_name, 'model.safetensors');
    assert.deepEqual([nodes['5'].inputs.width, nodes['5'].inputs.height, nodes['5'].inputs.batch_size], [832, 1216, 2]);
    assert.equal(typeof nodes['3'].inputs.seed, 'number');
    assert.ok(fake.requests.slice(before).some(r => r.url.startsWith('/comfy/view?filename=cider_1.png')));
  });

  it('ComfyUI: reports a failed workflow', async () => {
    fake.comfyError = true;
    const provider = new ComfyUiImageProvider({ url: `${fake.baseUrl}/comfy`, workflowFile: '', checkpoint: 'c', negativePrompt: '' }, 10);
    await assert.rejects(provider.generate({ prompt: 'x', aspectRatio: '1:1', count: 1 }, signal()), /failed to run the workflow/);
    fake.comfyError = false;
  });

  it('reports a provider that cannot be reached', async () => {
    const provider = new OpenAiImageProvider({ apiKey: 'k', baseUrl: 'http://127.0.0.1:9', model: 'm', quality: 'low' });
    await assert.rejects(provider.generate({ prompt: 'x', aspectRatio: '1:1', count: 1 }, signal()), /cannot be reached/);
  });
});

describe('image helpers', () => {
  it('fills workflow placeholders, keeping numbers as numbers', () => {
    const filled = fillWorkflow(DEFAULT_COMFYUI_WORKFLOW, {
      prompt: 'p', negative_prompt: 'n', checkpoint: 'c', width: 10, height: 20, batch_size: 1, seed: 5,
    }) as any;
    assert.equal(filled['5'].inputs.width, 10);
    assert.equal(filled['3'].inputs.seed, 5);
    assert.equal(filled['6'].inputs.text, 'p');
    assert.deepEqual(filled['3'].inputs.model, ['4', 0]);
    assert.equal(fillWorkflow('style: {{prompt}}, {{unknown}}', { prompt: 'apple' }), 'style: apple, {{unknown}}');
  });

  it('recognizes image formats and rejects other data', () => {
    assert.equal(detectImageType(TINY_PNG), 'image/png');
    assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), 'image/jpeg');
    assert.equal(detectImageType(Buffer.from('<html>not an image</html>')), undefined);
  });

  it('gives about one megapixel for each aspect ratio', () => {
    for (const ratio of ['1:1', '2:3', '3:4', '4:3', '3:2', '9:16', '16:9'] as const) {
      const { width, height } = dimensionsFor(ratio);
      assert.ok(width * height > 900000 && width * height < 1100000, ratio);
      assert.equal(width % 64, 0);
    }
  });
});

describe('AI usage', () => {
  it('counts images per calendar month and refuses beyond the quota', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cider-usage-'));
    let now = new Date('2026-10-31T23:00:00Z');
    const usage = new AiUsageStore(dir, () => now);
    await usage.load();
    await usage.reserve('u', 3, 4);
    await assert.rejects(usage.reserve('u', 2, 4), (error: QuotaExceededError) => error.remaining === 1);
    await usage.release('u', 1);
    assert.equal(usage.used('u'), 2);
    now = new Date('2026-11-01T00:00:00Z');
    assert.equal(usage.used('u'), 0);
    await usage.reserve('u', 4, 4);
    const reloaded = new AiUsageStore(dir, () => now);
    await reloaded.load();
    assert.equal(reloaded.used('u'), 4);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('AI API', () => {
  const fake = new FakeImageServices();
  let dataDir: string;
  let server: CiderApp;
  let adminCookie: string;
  let userCookie: string;
  let userId: string;

  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: unknown) => {
    const response = await server.app.inject({
      method, url,
      headers: {
        [CSRF_HEADER]: '1',
        ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}),
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      payload: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    return { status: response.statusCode, json: response.json(), cookie: response.cookies.find(c => c.name === SESSION_COOKIE)?.value };
  };

  before(async () => {
    await fake.start();
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cider-ai-test-'));
    const ai: AiConfig = {
      defaultImageProvider: 'openai', timeoutMs: 5000, defaultMonthlyImages: 3,
      openai: { apiKey: 'sk-test', baseUrl: `${fake.baseUrl}/openai/v1`, model: 'gpt-image-2', quality: 'low' },
      gemini: { apiKey: 'g-test', baseUrl: `${fake.baseUrl}/gemini/v1beta`, model: 'gemini-3.1-flash-image' },
    };
    const config: ServerConfig = {
      dataDir, host: '127.0.0.1', port: 0, sessionDays: 30, maxProjectMb: 1, maxProjectsPerUser: 10,
      setupToken: 'setup-code-for-tests', cookieSecure: 'auto', logLevel: 'silent', trustedProxies: ['loopback'], ai,
    };
    server = await buildApp(config);
    adminCookie = (await call('POST', '/api/auth/setup', undefined,
      { username: 'admin', password: 'admin-password', setupToken: 'setup-code-for-tests' })).cookie!;
    const created = await call('POST', '/api/users', adminCookie, { username: 'maker', password: 'maker-password' });
    userId = created.json.user.id;
    userCookie = (await call('POST', '/api/auth/login', undefined, { username: 'maker', password: 'maker-password' })).cookie!;
  });

  after(async () => {
    await server.app.close();
    await fake.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('lists the configured providers; AI is off for new accounts', async () => {
    const status = await call('GET', '/api/ai/status', userCookie);
    assert.equal(status.status, 200);
    assert.deepEqual(status.json.imageProviders.map((p: { id: string }) => p.id), ['openai', 'gemini']);
    assert.equal(status.json.defaultImageProvider, 'openai');
    assert.equal(status.json.enabled, false);
    assert.equal(status.json.monthlyImages, 3);
    assert.equal(JSON.stringify(status.json).includes('sk-test'), false);
  });

  it('refuses generation until an administrator enables AI for the account', async () => {
    const refused = await call('POST', '/api/ai/images', userCookie, { prompt: 'an apple' });
    assert.equal(refused.status, 403);
    assert.equal((await call('POST', '/api/ai/images', undefined, { prompt: 'an apple' })).status, 401);
  });

  it('lets only administrators change AI access and quotas', async () => {
    assert.equal((await call('PATCH', `/api/users/${userId}`, userCookie, { aiEnabled: true })).status, 403);
    assert.equal((await call('PATCH', `/api/users/${userId}`, adminCookie, { aiMonthlyImages: -1 })).status, 400);
    assert.equal((await call('PATCH', `/api/users/${userId}`, adminCookie, { aiMonthlyImages: 1.5 })).status, 400);
    const enabled = await call('PATCH', `/api/users/${userId}`, adminCookie, { aiEnabled: true, aiMonthlyImages: 3 });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.json.user.aiEnabled, true);
    assert.equal(enabled.json.user.aiMonthlyImages, 3);
  });

  it('validates the request', async () => {
    assert.equal((await call('POST', '/api/ai/images', userCookie, { prompt: '  ' })).status, 400);
    assert.equal((await call('POST', '/api/ai/images', userCookie, { prompt: 'x'.repeat(4001) })).status, 400);
    assert.equal((await call('POST', '/api/ai/images', userCookie, { prompt: 'x', aspectRatio: '5:7' })).status, 400);
    assert.equal((await call('POST', '/api/ai/images', userCookie, { prompt: 'x', count: 5 })).status, 400);
    assert.equal((await call('POST', '/api/ai/images', userCookie, { prompt: 'x', provider: 'nope' })).status, 400);
  });

  it('generates images with the default or the chosen provider and counts them', async () => {
    const generated = await call('POST', '/api/ai/images', userCookie, { prompt: 'an apple', aspectRatio: '3:4', count: 1 });
    assert.equal(generated.status, 200);
    assert.equal(generated.json.provider, 'openai');
    assert.equal(generated.json.images.length, 1);
    assert.equal(generated.json.images[0].mimeType, 'image/png');
    assert.equal(generated.json.images[0].data, TINY_PNG_BASE64);
    assert.equal(generated.json.imagesThisMonth, 1);
    const withGemini = await call('POST', '/api/ai/images', userCookie, { prompt: 'a pear', count: 1, provider: 'gemini' });
    assert.equal(withGemini.json.provider, 'gemini');
    assert.equal(withGemini.json.imagesThisMonth, 2);
  });

  it('gives back the images of a failed generation', async () => {
    fake.openAiFailure = { status: 500, body: { error: { message: 'server overloaded' } } };
    const failed = await call('POST', '/api/ai/images', userCookie, { prompt: 'an apple', count: 1 });
    fake.openAiFailure = undefined;
    assert.equal(failed.status, 502);
    assert.match(failed.json.error, /server overloaded/);
    assert.equal((await call('GET', '/api/ai/status', userCookie)).json.imagesThisMonth, 2);
  });

  it('refuses a request beyond the monthly quota', async () => {
    const tooMany = await call('POST', '/api/ai/images', userCookie, { prompt: 'an apple', count: 2 });
    assert.equal(tooMany.status, 429);
    assert.equal(tooMany.json.remaining, 1);
  });

  it('runs one generation at a time per account', async () => {
    await call('PATCH', `/api/users/${userId}`, adminCookie, { aiMonthlyImages: 10 });
    fake.openAiDelayMs = 300;
    const [first, second] = await Promise.all([
      call('POST', '/api/ai/images', userCookie, { prompt: 'one', count: 1 }),
      new Promise(resolve => setTimeout(resolve, 50)).then(() => call('POST', '/api/ai/images', userCookie, { prompt: 'two', count: 1 })),
    ]);
    fake.openAiDelayMs = 0;
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  });

  it('shows each account\'s usage to the administrator', async () => {
    const list = await call('GET', '/api/users', adminCookie);
    const maker = list.json.users.find((u: { username: string }) => u.username === 'maker');
    assert.equal(maker.aiImagesThisMonth, 3);
    assert.equal(maker.aiMonthlyImages, 10);
  });

  it('answers 503 when no provider is configured', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cider-ai-none-'));
    const bare = await buildApp({
      dataDir: dir, host: '127.0.0.1', port: 0, sessionDays: 30, maxProjectMb: 1, maxProjectsPerUser: 10,
      setupToken: 'code', cookieSecure: 'auto', logLevel: 'silent', trustedProxies: ['loopback'],
      ai: { defaultImageProvider: '', timeoutMs: 5000, defaultMonthlyImages: 5 },
    });
    const setup = await bare.app.inject({
      method: 'POST', url: '/api/auth/setup', headers: { [CSRF_HEADER]: '1', 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'admin', password: 'admin-password', setupToken: 'code' }),
    });
    const cookie = setup.cookies.find(c => c.name === SESSION_COOKIE)!.value;
    const headers = { [CSRF_HEADER]: '1', cookie: `${SESSION_COOKIE}=${cookie}`, 'content-type': 'application/json' };
    const me = setup.json().user.id;
    await bare.app.inject({ method: 'PATCH', url: `/api/users/${me}`, headers, payload: JSON.stringify({ aiEnabled: true }) });
    const response = await bare.app.inject({ method: 'POST', url: '/api/ai/images', headers, payload: JSON.stringify({ prompt: 'x' }) });
    assert.equal(response.statusCode, 503);
    await bare.app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
