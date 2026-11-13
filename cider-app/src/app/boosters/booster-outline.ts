/**
 * « Sachet complet » : l'illustration est le sachet entier (dents, bordures, forme comprises). Sa silhouette
 * devient la découpe du sachet (un clip-path polygon, comme les bords dentelés : un masque ferait dessiner le
 * foil à plat, décalé, une fois le sachet incliné). Brillance et foil s'arrêtent ainsi au dessin.
 *
 * La silhouette vient de la transparence de l'image ; une image sans transparence mais posée sur un fond uni
 * (les quatre coins de la même couleur) est détourée sur ce fond.
 */

/** Format du sachet (largeur / hauteur). */
export const PACK_RATIO = 5 / 8;

export interface PackImageInfo {
  width: number;
  height: number;
  /** l'image a des pixels transparents */
  transparent: boolean;
  /** pas de transparence, mais un fond uni (coins de même couleur) : détouré sur cette couleur */
  plainBackground: boolean;
  /** silhouette en clip-path (coordonnées du sachet), ou null si rien à détourer (image opaque sans fond uni) */
  outline: string | null;
}

/** Résolution de l'analyse : assez fine pour suivre les dents d'un sachet (19 dents sur la largeur). */
const COLS = 160;
const ROWS = 256;
const ALPHA_MIN = 40;
const COLOR_TOLERANCE = 48;

const cache = new Map<string, Promise<PackImageInfo | null>>();

/** Analyse (mise en cache) d'une illustration de sachet complet. */
export function packImageInfo(url: string | undefined): Promise<PackImageInfo | null> {
  if (!url) {
    return Promise.resolve(null);
  }
  let info = cache.get(url);
  if (!info) {
    info = analyse(url).catch(() => null);
    cache.set(url, info);
  }
  return info;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

async function analyse(url: string): Promise<PackImageInfo> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = COLS;
  canvas.height = ROWS;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('canvas');
  }
  // étirée au format du sachet, comme elle y est affichée
  ctx.drawImage(img, 0, 0, COLS, ROWS);
  const data = ctx.getImageData(0, 0, COLS, ROWS).data;
  return { width: img.naturalWidth, height: img.naturalHeight, ...outlineOf(data, COLS, ROWS) };
}

/** Silhouette d'une image RGBA (w × h) : exportée pour les tests. */
export function outlineOf(data: Uint8ClampedArray, w: number, h: number):
  Pick<PackImageInfo, 'transparent' | 'plainBackground' | 'outline'> {
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < ALPHA_MIN) {
      transparent = true;
      break;
    }
  }
  const px = (x: number, y: number) => (y * w + x) * 4;
  let inside: (x: number, y: number) => boolean;
  let plainBackground = false;
  if (transparent) {
    inside = (x, y) => data[px(x, y) + 3] >= ALPHA_MIN;
  } else {
    const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    const avg = [0, 1, 2].map(c => corners.reduce((s, i) => s + data[i + c], 0) / 4);
    const dist = (i: number) => Math.max(...[0, 1, 2].map(c => Math.abs(data[i + c] - avg[c])));
    plainBackground = corners.every(i => dist(i) <= COLOR_TOLERANCE / 2);
    if (!plainBackground) {
      return { transparent, plainBackground, outline: null };
    }
    inside = (x, y) => dist(px(x, y)) > COLOR_TOLERANCE;
  }

  // contour extérieur de la forme principale : on part du bord gauche de la ligne du milieu
  const midY = Math.floor(h / 2);
  let sx = 0;
  while (sx < w && !inside(sx, midY)) {
    sx++;
  }
  if (sx >= w) {
    return { transparent, plainBackground, outline: null };
  }
  const contour = traceContour(inside, w, h, sx, midY);
  // centres des pixels du bord, poussés d'un demi-pixel vers l'extérieur (repère : centre de l'image)
  const pts = simplify(contour.map(([x, y]) => [x + 0.5 + Math.sign(x + 0.5 - w / 2) * 0.5,
    y + 0.5 + Math.sign(y + 0.5 - h / 2) * 0.5] as [number, number]), 0.6);
  const pct = (v: number, n: number) => `${+(Math.min(n, Math.max(0, v)) / n * 100).toFixed(2)}%`;
  return { transparent, plainBackground, outline: `polygon(${pts.map(([x, y]) => `${pct(x, w)} ${pct(y, h)}`).join(', ')})` };
}

/** Voisins dans le sens horaire, en partant de l'ouest. */
const MOORE: [number, number][] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

/**
 * Suivi de contour (voisinage de Moore) depuis un pixel de bord dont le voisin ouest est vide.
 * Renvoie les pixels du bord dans l'ordre, sans répéter le premier.
 */
function traceContour(inside: (x: number, y: number) => boolean, w: number, h: number,
                      sx: number, sy: number): [number, number][] {
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && inside(x, y);
  const out: [number, number][] = [[sx, sy]];
  let [cx, cy] = [sx, sy];
  let back = 0;   // direction (dans MOORE) d'où l'on vient : le voisin ouest, vide
  const limit = 4 * w * h;
  for (let step = 0; step < limit; step++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (filled(cx + MOORE[d][0], cy + MOORE[d][1])) {
        found = d;
        break;
      }
    }
    if (found < 0) {
      break;   // pixel isolé
    }
    const nx = cx + MOORE[found][0];
    const ny = cy + MOORE[found][1];
    // le voisin vide examiné juste avant devient la direction de retour, vue depuis le nouveau pixel
    const prev = (found + 7) % 8;
    const bx = cx + MOORE[prev][0] - nx;
    const by = cy + MOORE[prev][1] - ny;
    back = MOORE.findIndex(([dx, dy]) => dx === bx && dy === by);
    if (nx === sx && ny === sy) {
      break;
    }
    out.push([nx, ny]);
    [cx, cy] = [nx, ny];
  }
  return out;
}

/** Ramer-Douglas-Peucker sur un contour fermé : garde les points qui s'écartent de plus de eps. */
function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 4) {
    return pts;
  }
  // contour fermé : coupé en deux au point le plus éloigné du premier
  const dist0 = ([x, y]: [number, number]) => Math.hypot(x - pts[0][0], y - pts[0][1]);
  let far = 0;
  pts.forEach((p, i) => {
    if (dist0(p) > dist0(pts[far])) {
      far = i;
    }
  });
  const ring = [...pts, pts[0]];
  const keep = ring.map(() => false);
  const rdp = (a: number, b: number) => {
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let dmax = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - ring[i][1]) - (ax - ring[i][0]) * (by - ay)) / len;
      if (d > dmax) {
        dmax = d;
        worst = i;
      }
    }
    if (dmax > eps && worst > 0) {
      keep[worst] = true;
      rdp(a, worst);
      rdp(worst, b);
    }
  };
  keep[0] = keep[far] = true;
  rdp(0, far);
  rdp(far, ring.length - 1);
  return ring.slice(0, -1).filter((_, i) => keep[i]);
}

/** Écart du format de l'image à celui du sachet (0,05 : 5 %). */
export function ratioGap(info: Pick<PackImageInfo, 'width' | 'height'>): number {
  return Math.abs(info.width / info.height / PACK_RATIO - 1);
}
