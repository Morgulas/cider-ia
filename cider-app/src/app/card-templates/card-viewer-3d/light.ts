/**
 * Éclairage de la vue 3D d'une carte : à partir de l'orientation de la carte et de la direction
 * de la lumière, les variables CSS des foils (--glare-x, --glare-y, --glare-o), l'ombrage de la face
 * et le reflet spéculaire. Repère CSS : x vers la droite, y vers le bas, z vers l'observateur.
 */

export interface LightSettings {
  /** intensité : 0 (éteinte) à 2 */
  intensity: number;
  /** direction autour de l'axe de vue, en degrés : 0 = d'en haut, 90 = de droite */
  azimuth: number;
  /** hauteur au-dessus du plan de l'écran, en degrés : 90 = de face, depuis l'observateur */
  elevation: number;
  /** lumière ambiante : 0 (noir hors lumière) à 1 (pas d'ombrage) */
  ambient: number;
}

export interface Lighting {
  /** face tournée vers l'observateur */
  side: 'front' | 'back';
  /** position du reflet sur la face visible, en % */
  glareX: number;
  glareY: number;
  /** intensité des foils, 0 à 1 : forte quand la carte renvoie la lumière vers l'œil, faible hors de cet angle */
  glareO: number;
  /** décalage des couleurs irisées (degrés) : suit l'angle de la carte, même au-delà de la course du reflet */
  hue: number;
  /** opacité de l'ombre sur la face visible */
  shade: number;
  /** intensité du reflet spéculaire, 0 à 1 */
  specular: number;
  /** côté d'où vient la lumière sur la face visible (-1 à 1) : liseré clair des gaufrages */
  reliefX: number;
  reliefY: number;
}

type Vec = [number, number, number];
const rad = (deg: number) => deg * Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm = (v: Vec): Vec => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Matrice de `rotateX(rx) rotateY(ry)` (CSS), lignes */
function rotation(rx: number, ry: number): number[][] {
  const [cx, sx, cy, sy] = [Math.cos(rad(rx)), Math.sin(rad(rx)), Math.cos(rad(ry)), Math.sin(rad(ry))];
  // Rx · Ry
  return [
    [cy, 0, sy],
    [sx * sy, cx, -sx * cy],
    [-cx * sy, sx, cx * cy],
  ];
}

/** Vecteur du monde exprimé dans le repère de la carte (transposée de la rotation) */
function toLocal(m: number[][], v: Vec): Vec {
  return [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ];
}

/** Direction de la lumière (vers la lumière), repère du monde */
export function lightDirection(light: LightSettings): Vec {
  const el = rad(clamp(light.elevation, 0, 90));
  const az = rad(light.azimuth);
  return norm([Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)]);
}

export function lighting(rx: number, ry: number, light: LightSettings): Lighting {
  const m = rotation(rx, ry);
  const normal = m.map(row => row[2]) as Vec; // rotation de (0, 0, 1)
  const side = normal[2] >= 0 ? 'front' : 'back';
  const L = lightDirection(light);
  const H = norm([L[0], L[1], L[2] + 1]); // entre la lumière et l'observateur
  const l = toLocal(m, L);
  const h = toLocal(m, H);
  // le verso est retourné autour de l'axe vertical : x et z inversés
  const flip = side === 'back' ? -1 : 1;
  const lz = l[2] * flip;
  const [lx, ly] = [l[0] * flip, l[1]];
  const spread = Math.max(0.5, Math.hypot(lx, ly));
  const [hx, hy, hz] = [h[0] * flip, h[1], h[2] * flip];
  const intensity = clamp(light.intensity, 0, 2);
  const diffuse = Math.max(0, lz) * intensity;
  const brightness = clamp(light.ambient + (1 - light.ambient) * diffuse, 0, 1);
  // lobe du reflet : 1 quand la carte renvoie la lumière droit vers l'œil, ~0,3 à 30° de cet angle, ~0 à 60°
  const lobe = Math.pow(Math.max(0, hz), 5);
  // irisation : écart entre la direction du reflet et celle de la carte à plat (même lumière), en degrés
  return {
    side,
    // course douce : le reflet glisse encore quand la carte penche beaucoup, sans buter sur le bord à 20°
    glareX: 50 + 50 * Math.tanh(hx * 2.2),
    glareY: 50 + 50 * Math.tanh(hy * 2.2),
    glareO: clamp(intensity * (0.12 + 0.88 * lobe) * (lz > 0 ? 1 : 0.35), 0, 1),
    hue: (hx - H[0] * flip) * 220 + (hy - H[1]) * 160,
    shade: clamp((1 - brightness) * 0.85, 0, 0.85),
    specular: clamp(Math.pow(Math.max(0, hz), 12) * intensity * 0.55 * (lz > 0 ? 1 : 0), 0, 1),
    reliefX: clamp(lx / spread, -1, 1),
    reliefY: clamp(ly / spread, -1, 1),
  };
}
