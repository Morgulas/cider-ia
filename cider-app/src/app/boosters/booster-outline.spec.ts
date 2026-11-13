import { outlineOf, ratioGap } from './booster-outline';

/** Image de test w × h : fond (transparent ou uni), sachet rectangulaire avec des dents en haut. */
function packImage(w: number, h: number, opaqueBackground: boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const tooth = Math.floor(x / 4) % 2 === 0 ? 4 : 8;   // dents de 4 px, profondeur 4 px
      const inPack = x >= 5 && x < w - 5 && y >= tooth && y < h - 6;
      if (inPack) {
        data.set([30, 90, 220, 255], i);
      } else if (opaqueBackground) {
        data.set([20, 24, 30, 255], i);
      }
    }
  }
  return data;
}

function points(outline: string): [number, number][] {
  return outline.slice('polygon('.length, -1).split(', ').map(p => p.split(' ').map(v => parseFloat(v)) as [number, number]);
}

describe('booster-outline', () => {
  it('suit la silhouette d\'une image transparente, dents comprises', () => {
    const info = outlineOf(packImage(80, 128, false), 80, 128);
    expect(info.transparent).toBeTrue();
    const pts = points(info.outline!);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(5 / 80 * 100, 0);
    expect(Math.max(...xs)).toBeCloseTo(75 / 80 * 100, 0);
    expect(Math.min(...ys)).toBeCloseTo(4 / 128 * 100, 0);
    expect(Math.max(...ys)).toBeCloseTo(122 / 128 * 100, 0);
    // les dents du haut : plusieurs points à chacune des deux hauteurs
    const topPts = pts.filter(([, y]) => y < 8);
    expect(topPts.length).toBeGreaterThan(20);
    expect(pts.length).toBeLessThan(200);
  });

  it('détoure une image opaque posée sur un fond uni', () => {
    const info = outlineOf(packImage(80, 128, true), 80, 128);
    expect(info.transparent).toBeFalse();
    expect(info.plainBackground).toBeTrue();
    expect(info.outline).toMatch(/^polygon\(/);
  });

  it('ne découpe rien dans une image opaque sans fond uni', () => {
    const data = new Uint8ClampedArray(40 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251));
    expect(outlineOf(data, 40, 64).outline).toBeNull();
  });

  it('mesure l\'écart au format 5:8', () => {
    expect(ratioGap({ width: 1000, height: 1600 })).toBeCloseTo(0, 5);
    expect(ratioGap({ width: 1024, height: 1536 })).toBeCloseTo(0.0667, 3);
  });
});
