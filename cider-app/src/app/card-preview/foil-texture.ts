/**
 * Foil texturé : un masque tiré de l'illustration même de l'élément (data-foil-texture), comme les cartes
 * « texturées » : le foil suit les traits du dessin (contours), ses zones claires (lumieres) ou sombres (ombres).
 *
 *   <div class="image" data-foil="holo" data-foil-texture="contours 0.6"></div>
 *
 * La finesse (0 à 1, 0,5 par défaut) : 0 = les traits forts seulement (ou les zones les plus claires / sombres),
 * 1 = tous les détails. Le masque est calculé à la forme de l'élément (l'image cadrée comme à l'écran : cover,
 * contain, position), en niveaux de gris : blanc = le foil brille. Il se combine avec data-foil-masque et
 * data-foil-force, et sert aussi au gaufrage de l'élément (data-gaufrage : les traits en relief).
 */

export type TextureMode = 'contours' | 'lumieres' | 'ombres';

export interface TextureSpec {
  mode: TextureMode;
  finesse: number;
}

/** Attribut posé par le calcul : le masque de la texture (data URL), lu comme un masque peint */
export const TEXTURE_ATTR = 'data-foil-texture-masque';
/** Ce que décrit le masque déjà calculé (source, mode, taille) : pour ne pas le recalculer */
const TEXTURE_KEY = 'data-foil-texture-cle';

const MAX_SIDE = 640;

/** « contours 0.6 », « lumières », « ombres 30% » ; inconnu : rien */
export function textureSpec(value: string | null | undefined): TextureSpec | null {
  const parts = (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/);
  const word = parts[0];
  const mode: TextureMode | null = /^(contours?|traits?|lignes?|edges?)$/.test(word) ? 'contours'
    : /^(lumieres?|clairs?|lights?|highlights?)$/.test(word) ? 'lumieres'
      : /^(ombres?|sombres?|shadows?|darks?)$/.test(word) ? 'ombres' : null;
  if (!mode) {
    return null;
  }
  let finesse = 0.5;
  if (parts[1]) {
    const n = parseFloat(parts[1].replace(',', '.'));
    if (Number.isFinite(n)) {
      finesse = parts[1].endsWith('%') || n > 1 ? n / 100 : n;
    }
  }
  return { mode, finesse: Math.min(1, Math.max(0, finesse)) };
}

/** L'image affichée par l'élément : une <img>, ou la première image de son fond */
export function sourceImage(element: HTMLElement): string | null {
  if (element instanceof HTMLImageElement) {
    return element.currentSrc || element.src || null;
  }
  const bg = getComputedStyle(element).backgroundImage;
  const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(bg || '');
  return match ? match[1] : null;
}

/** Cadrage de l'image dans la boîte de l'élément, comme le navigateur l'affiche */
function placement(element: HTMLElement, iw: number, ih: number, bw: number, bh: number): { x: number; y: number; w: number; h: number } {
  const style = getComputedStyle(element);
  const isImg = element instanceof HTMLImageElement;
  const size = (isImg ? style.objectFit : style.backgroundSize.split(',')[0]).trim();
  let w = iw, h = ih;
  if (size === 'cover' || size === 'contain') {
    const k = size === 'cover' ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih);
    w = iw * k; h = ih * k;
  } else if (size === 'fill' || (isImg && size !== 'none' && size !== 'scale-down')) {
    w = bw; h = bh;
  } else if (!isImg && size !== 'auto' && size !== 'auto auto') {
    const [sx, sy] = size.split(/\s+/);
    const len = (v: string | undefined, total: number, other: number | null) =>
      !v || v === 'auto' ? other : v.endsWith('%') ? total * parseFloat(v) / 100 : parseFloat(v);
    const ww = len(sx, bw, null);
    const hh = len(sy, bh, null);
    w = ww ?? (hh ? iw * hh / ih : iw);
    h = hh ?? (ww ? ih * ww / iw : ih);
  }
  const pos = (isImg ? style.objectPosition : style.backgroundPosition.split(',')[0]).trim().split(/\s+/);
  const at = (v: string | undefined, free: number) => {
    if (!v || v === 'center') return free / 2;
    if (v === 'left' || v === 'top') return 0;
    if (v === 'right' || v === 'bottom') return free;
    return v.endsWith('%') ? free * parseFloat(v) / 100 : parseFloat(v);
  };
  return { x: at(pos[0], bw - w), y: at(pos[1] ?? pos[0], bh - h), w, h };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image illisible'));
    image.src = src;
  });
}

/** Masque de texture (data URL, gris : blanc = foil) d'une image cadrée dans une boîte bw × bh */
export async function textureMask(src: string, spec: TextureSpec, element: HTMLElement, bw: number, bh: number): Promise<string> {
  const image = await loadImage(src);
  const k = Math.min(1, MAX_SIDE / Math.max(bw, bh));
  const w = Math.max(1, Math.round(bw * k)), h = Math.max(1, Math.round(bh * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const p = placement(element, image.naturalWidth, image.naturalHeight, bw, bh);
  ctx.drawImage(image, p.x * k, p.y * k, p.w * k, p.h * k);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const lum = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    lum[j] = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255 * (px[i + 3] / 255);
  }
  const out = new Float32Array(w * h);
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  if (spec.mode === 'contours') {
    // léger flou (le grain de la peinture ne compte pas), puis Sobel
    const blur = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
              sum += lum[yy * w + xx];
              n++;
            }
          }
        }
        blur[y * w + x] = sum / n;
      }
    }
    const grad = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const at = (dx: number, dy: number) => blur[(y + dy) * w + x + dx];
        const gx = -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1);
        const gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
        grad[y * w + x] = Math.hypot(gx, gy);
      }
    }
    // seuil par proportion de pixels, pas par rapport au trait le plus fort (une étoile très nette ne doit
    // pas éteindre le reste) : finesse 0 = les 3 % de traits les plus forts, 1 = les 30 %
    const keep = 0.03 + 0.27 * spec.finesse;
    const sorted = Float32Array.from(grad).sort();
    const lo = Math.max(1e-3, sorted[Math.floor(sorted.length * (1 - keep))]);
    const hi = Math.max(lo * 1.0001, sorted[Math.floor(sorted.length * (1 - keep / 3))]);
    for (let i = 0; i < grad.length; i++) {
      out[i] = smooth(lo, hi, grad[i]);
    }
    // traits épaissis d'un pixel sur les grandes images, pour qu'ils se voient
    if (Math.max(w, h) >= 320) {
      const thin = Float32Array.from(out);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              m = Math.max(m, thin[(y + dy) * w + x + dx] * (dx && dy ? 0.6 : 1));
            }
          }
          out[y * w + x] = m;
        }
      }
    }
  } else {
    // lumières : au-dessus d'un seuil ; finesse 1 = des zones moyennes aux plus claires
    const t = 0.82 - 0.5 * spec.finesse;
    for (let i = 0; i < lum.length; i++) {
      const v = spec.mode === 'lumieres' ? lum[i] : 1 - lum[i];
      out[i] = smooth(t - 0.12, t + 0.12, v);
    }
  }
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    px[i] = px[i + 1] = px[i + 2] = Math.round(out[j] * 255);
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Calcule (ou garde) le masque de texture de chaque élément data-foil-texture du rendu ; renvoie vrai si l'un
 * d'eux a changé (l'aperçu se redessine). Une image illisible : pas de texture.
 */
export async function ensureTextures(root: HTMLElement): Promise<boolean> {
  let changed = false;
  const elements = [...root.querySelectorAll<HTMLElement>('[data-foil-texture]')]
    .filter(e => !e.closest('.cc-foil-piece'));
  for (const element of elements) {
    const spec = textureSpec(element.getAttribute('data-foil-texture'));
    const src = spec ? sourceImage(element) : null;
    const bw = element.offsetWidth, bh = element.offsetHeight;
    if (!spec || !src || !bw || !bh) {
      if (element.hasAttribute(TEXTURE_ATTR)) {
        element.removeAttribute(TEXTURE_ATTR);
        element.removeAttribute(TEXTURE_KEY);
        changed = true;
      }
      continue;
    }
    const key = `${src}|${spec.mode}|${spec.finesse}|${bw}x${bh}`;
    if (element.getAttribute(TEXTURE_KEY) === key) {
      continue;
    }
    try {
      const mask = await textureMask(src, spec, element, bw, bh);
      element.setAttribute(TEXTURE_ATTR, mask);
      element.setAttribute(TEXTURE_KEY, key);
      changed = true;
    } catch {
      element.setAttribute(TEXTURE_KEY, key);
    }
  }
  return changed;
}
