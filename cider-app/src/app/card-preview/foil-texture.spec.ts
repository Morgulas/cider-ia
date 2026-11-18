import { ensureTextures, TEXTURE_ATTR, textureMask, textureSpec } from './foil-texture';
import { zoneOptions } from './foil-zones';

/** Image de test : moitié gauche noire, moitié droite blanche (un trait vertical au milieu) */
function halfImage(w = 40, h = 20): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w / 2, h);
  ctx.fillStyle = '#fff'; ctx.fillRect(w / 2, 0, w / 2, h);
  return c.toDataURL();
}

async function pixels(src: string, w: number, h: number): Promise<number[]> {
  const img = new Image();
  await new Promise(resolve => { img.onload = resolve; img.src = src; });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  return Array.from({ length: w }, (_, x) => d[(Math.floor(h / 2) * w + x) * 4]);
}

describe('foil-texture', () => {
  it('lit le mode et la finesse', () => {
    expect(textureSpec('contours')).toEqual({ mode: 'contours', finesse: 0.5 });
    expect(textureSpec('Lumières 0,8')).toEqual({ mode: 'lumieres', finesse: 0.8 });
    expect(textureSpec('ombres 30%')).toEqual({ mode: 'ombres', finesse: 0.3 });
    expect(textureSpec('autre')).toBeNull();
  });

  it('contours : le trait du milieu brille, les aplats non', async () => {
    const el = document.createElement('div');
    el.style.cssText = 'width:40px;height:20px;background-size:100% 100%';
    document.body.appendChild(el);
    const mask = await textureMask(halfImage(), { mode: 'contours', finesse: 0.5 }, el, 40, 20);
    const row = await pixels(mask, 40, 20);
    el.remove();
    expect(row[20]).toBeGreaterThan(200);
    expect(row[5]).toBeLessThan(20);
    expect(row[35]).toBeLessThan(20);
  });

  it('lumières et ombres : les zones claires, ou sombres', async () => {
    const el = document.createElement('div');
    el.style.cssText = 'width:40px;height:20px;background-size:100% 100%';
    document.body.appendChild(el);
    const light = await pixels(await textureMask(halfImage(), { mode: 'lumieres', finesse: 0.5 }, el, 40, 20), 40, 20);
    const dark = await pixels(await textureMask(halfImage(), { mode: 'ombres', finesse: 0.5 }, el, 40, 20), 40, 20);
    el.remove();
    expect([light[5], light[35]]).toEqual([0, 255]);
    expect([dark[5], dark[35]]).toEqual([255, 0]);
  });

  it('calcule le masque d\'un élément au fond illustré, une seule fois', async () => {
    const root = document.createElement('div');
    root.innerHTML = `<div data-foil="holo" data-foil-texture="contours"
      style="width:40px;height:20px;background:url(${halfImage()}) center / cover"></div>`;
    document.body.appendChild(root);
    expect(await ensureTextures(root)).toBeTrue();
    const el = root.firstElementChild!;
    expect(el.getAttribute(TEXTURE_ATTR)).toContain('data:image/png');
    expect(zoneOptions(el).masques.length).toBe(1);
    expect(await ensureTextures(root)).toBeFalse();
    root.remove();
  });
});
