import { lighting, lightDirection } from './light';

describe('vue 3D : éclairage', () => {
  const light = { intensity: 1, azimuth: 0, elevation: 90, ambient: 0.3 };

  it('carte de face, lumière de face : recto, éclairée, reflet au centre', () => {
    const l = lighting(0, 0, light);
    expect(l.side).toBe('front');
    expect(l.glareX).toBeCloseTo(50, 0);
    expect(l.glareY).toBeCloseTo(50, 0);
    expect(l.shade).toBeCloseTo(0, 5);
    expect(l.specular).toBeGreaterThan(0.5);
  });

  it('carte retournée : verso visible', () => {
    expect(lighting(0, 180, light).side).toBe('back');
    expect(lighting(180, 0, light).side).toBe('back');
    expect(lighting(0, 30, light).side).toBe('front');
  });

  it('lumière éteinte : ombre de l\'ambiance seule, pas de reflet ni de foil', () => {
    const l = lighting(0, 0, { ...light, intensity: 0 });
    expect(l.glareO).toBe(0);
    expect(l.specular).toBe(0);
    expect(l.shade).toBeCloseTo(0.7 * 0.85, 5);
  });

  it('lumière rasante de droite : le reflet part vers la droite', () => {
    const l = lighting(0, 0, { ...light, azimuth: 90, elevation: 20 });
    expect(l.glareX).toBeGreaterThan(70);
    expect(lightDirection({ ...light, azimuth: 90, elevation: 0 })[0]).toBeCloseTo(1, 5);
  });

  it('foil vif quand la carte renvoie la lumière vers l\'œil, terne hors de cet angle', () => {
    const l = { ...light, azimuth: -35, elevation: 55 };
    const glare = (ry: number) => lighting(0, ry, l).glareO;
    expect(glare(-10)).toBeGreaterThan(0.8);
    expect(glare(45)).toBeLessThan(0.25);
    // lumière de face, carte de face : reflet maximal (et non minimal)
    expect(lighting(0, 0, light).glareO).toBeGreaterThan(0.95);
  });

  it('le reflet continue de glisser au-delà de 20° (pas de palier) et les couleurs tournent', () => {
    const l = { ...light, azimuth: -35, elevation: 55 };
    const xs = [20, 30, 45].map(ry => lighting(0, ry, l).glareX);
    expect(xs[0]).toBeGreaterThan(xs[1]);
    expect(xs[1]).toBeGreaterThan(xs[2]);
    expect(xs[2]).toBeGreaterThan(0);
    expect(lighting(0, 0, l).hue).toBeCloseTo(0, 5);
    expect(Math.abs(lighting(0, 30, l).hue)).toBeGreaterThan(60);
  });
});
