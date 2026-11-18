import { FoilEffect, foilFromValue } from '../card-binder/foil';
import { TEXTURE_ATTR } from './foil-texture';

/**
 * Zones foil d'un modèle de carte : tout élément marqué data-foil="<effet>" brille avec cet effet
 * (holo, galaxie, or, argent, prisme, paillettes, cadre, ou leurs synonymes). La valeur peut venir
 * de la carte : data-foil="{{card.foil}}" ; vide ou inconnue = pas de foil.
 *
 * - Export vers l'appli de collection : un calque « foil-<effet> » par effet (forme exacte des éléments).
 * - Aperçu dans cider-ia : un reflet posé sur chaque élément (rectangle de l'élément ; pour une image,
 *   découpé à sa transparence).
 *
 * Dorure : data-foil="dorure-or" (ou dorure-argent, dorure-holo) remplace l'encre par le métal, comme une
 * dorure à chaud : un calque « dorure-<effet> » à l'export ; dans l'aperçu, les lettres mêmes remplies de métal.
 */

export const FOIL_LAYER_PREFIX = 'foil-';
export const GILDING_LAYER_PREFIX = 'dorure-';
export const EMBOSS_LAYER_PREFIX = 'gaufrage-';
/** Image cachée : calque « cache-<angle> » (masque du motif) */
export const HIDDEN_LAYER_PREFIX = 'cache-';
/** Lenticulaire : calque « lenticulaire » (seconde image, en couleurs) ou « lenticulaire-v » (sens vertical) */
export const LENTICULAR_LAYER = 'lenticulaire';
/** Pièces de l'aperçu (reflets, dorures), posées juste après leur élément */
export const PIECE_CLASS = 'cc-foil-piece';
export const ZONE_CLASS = 'cc-foil-zone';

/**
 * Dorures proposées : le métal remplace l'encre au lieu de s'y refléter. « noir » : encre noire brillante (dorure
 * noire, noire sur fond mat). Suffixe « mat » : métal satiné, sans éclat qui balaie les lettres (dorure-or-mat).
 */
export const GILDING_EFFECTS = ['or', 'argent', 'holo', 'noir'] as const;
export type GildingEffect = typeof GILDING_EFFECTS[number];
/** Valeur d'une dorure : métal, et « -mat » pour un métal satiné */
export type Gilding = GildingEffect | `${GildingEffect}-mat`;

/** Métal d'une dorure, déplacé par la lumière (--glare-x, --glare-y) */
const GILDING_GRADIENTS: Record<GildingEffect, string> = {
  or: 'linear-gradient(125deg, #a87a22 0%, #ffe9a3 18%, #d4a640 32%, #fffbe0 46%, #c99a36 60%, #ffe28a 76%, #94701e 100%)',
  argent: 'linear-gradient(125deg, #8a9098 0%, #f7f9fb 18%, #b4bac2 32%, #ffffff 46%, #a2a8b0 60%, #eceff2 76%, #7a8088 100%)',
  holo: 'linear-gradient(115deg, #d9d9e6 0%, #ffb3e6 16%, #fff2a8 32%, #b3ffd9 48%, #a8e6ff 64%, #d2b3ff 80%, #d9d9e6 100%)',
  noir: 'linear-gradient(125deg, #050506 0%, #2c2c33 18%, #0b0b0d 32%, #3d3d46 46%, #09090b 60%, #26262d 76%, #040405 100%)',
};

/** Angle où se montre une image cachée (data-foil-cache-angle) */
export const HIDDEN_ANGLES = ['droite', 'gauche', 'haut', 'bas', 'face'] as const;
export type HiddenAngle = typeof HIDDEN_ANGLES[number];
/**
 * Inclinaison où l'image cachée est la plus nette, en unités de 16° (--par-x, --par-y) : 12°, atteint au survol
 * (10° au plus), au gyroscope d'un téléphone et dans la vue 3D
 */
const HIDDEN_TARGETS: Record<HiddenAngle, [number, number]> = {
  droite: [0.75, 0], gauche: [-0.75, 0], haut: [0, -0.75], bas: [0, 0.75], face: [0, 0],
};
const HIDDEN_ALIASES: Record<HiddenAngle, string[]> = {
  droite: ['droite', 'right', 'd'], gauche: ['gauche', 'left', 'g'], haut: ['haut', 'up', 'top', 'dessus', 'h'],
  bas: ['bas', 'down', 'bottom', 'dessous', 'b'], face: ['face', 'front', 'plat', 'centre', 'center'],
};

/**
 * Une zone du modèle : reflet ou dorure (effet foil), gaufrage (relief ou creux), image cachée (visible sous un
 * angle) ou lenticulaire (seconde image quand on penche la carte)
 */
export type ZoneKind =
  | { kind: 'foil'; effect: FoilEffect }
  | { kind: 'dorure'; effect: Gilding }
  | { kind: 'gaufrage'; effect: 'relief' | 'creux' }
  | { kind: 'cache'; effect: HiddenAngle }
  | { kind: 'lenticulaire'; effect: 'h' | 'v' };

const lower = (value: string | null | undefined) =>
  (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/**
 * Image cachée : data-foil-cache="{{assets.rune}}" (image en niveaux de gris étirée sur l'élément, blanc = motif),
 * visible seulement quand la carte penche du côté de data-foil-cache-angle (droite par défaut). Vide : rien.
 */
export function hiddenKind(element: Element): ZoneKind | null {
  if (!(element.getAttribute('data-foil-cache') ?? '').trim()) {
    return null;
  }
  const angle = lower(element.getAttribute('data-foil-cache-angle'));
  const effect = HIDDEN_ANGLES.find(a => HIDDEN_ALIASES[a].includes(angle)) ?? 'droite';
  return { kind: 'cache', effect };
}

/**
 * Lenticulaire : data-lenticulaire="{{assets.attaque}}" sur une image (ou un élément à image de fond) : la seconde
 * image remplace la première quand on penche la carte (gauche ou droite ; data-lenticulaire-sens="vertical" :
 * haut ou bas). Vide : rien.
 */
export function lenticularKind(element: Element): ZoneKind | null {
  if (!(element.getAttribute('data-lenticulaire') ?? '').trim()) {
    return null;
  }
  return { kind: 'lenticulaire', effect: /^v/.test(lower(element.getAttribute('data-lenticulaire-sens'))) ? 'v' : 'h' };
}

/**
 * Valeur de data-gaufrage : « creux » (en creux), « non » / « aucun » (pas de gaufrage : une valeur venue
 * d'un attribut de la carte), sinon en relief (l'attribut seul, data-gaufrage, compris)
 */
export function embossKind(value: string | null): ZoneKind | null {
  if (value === null || /^\s*(non|aucun|aucune|none|no|false|faux|0|-)\s*$/i.test(value)) {
    return null;
  }
  return { kind: 'gaufrage', effect: /creux|deboss|enfonc/i.test(value) ? 'creux' : 'relief' };
}

/**
 * Réglages d'une zone : masque peint (data-foil-masque), texture tirée de l'illustration (data-foil-texture,
 * masque calculé par ensureTextures) et force (data-foil-force, 0 à 1 ou en %)
 */
export function zoneOptions(element: Element): { masque: string | null; texture: string | null; masques: string[]; force: number } {
  const masque = (element.getAttribute('data-foil-masque') ?? '').trim() || null;
  const texture = element.getAttribute(TEXTURE_ATTR) || null;
  const raw = (element.getAttribute('data-foil-force') ?? '').trim();
  let force = 1;
  if (raw) {
    const n = parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(n)) {
      force = raw.endsWith('%') || n > 1 ? n / 100 : n;
    }
  }
  return { masque, texture, masques: [masque, texture].filter((m): m is string => !!m), force: Math.min(1, Math.max(0, force)) };
}

/**
 * Valeur de data-foil : un effet foil (reflet), ou « dorure-or », « dorure-argent », « dorure-holo »
 * (le métal remplace l'encre). Vide ou inconnue : rien.
 */
export function zoneKind(value: string | null | undefined): ZoneKind | null {
  const gilding = /^\s*dorure[\s_-]+(.+?)(?:[\s_-]+(mat|matte|satin|satine))?\s*$/i.exec(lower(value));
  if (gilding) {
    const base = lower(gilding[1]);
    const effect = ['noir', 'noire', 'black'].includes(base) ? 'noir' : foilFromValue(base);
    if (!effect || !(GILDING_EFFECTS as readonly string[]).includes(effect)) {
      return null;
    }
    return { kind: 'dorure', effect: (gilding[2] ? `${effect}-mat` : effect) as Gilding };
  }
  const effect = foilFromValue(value);
  return effect ? { kind: 'foil', effect } : null;
}

/** Nom du calque exporté d'une zone : foil-<effet>, dorure-<effet>, gaufrage-<effet>, cache-<angle>, lenticulaire(-v) */
export function zoneLayerName(zone: ZoneKind): string {
  if (zone.kind === 'cache') {
    return HIDDEN_LAYER_PREFIX + zone.effect;
  }
  if (zone.kind === 'lenticulaire') {
    return zone.effect === 'v' ? LENTICULAR_LAYER + '-v' : LENTICULAR_LAYER;
  }
  const prefix = zone.kind === 'dorure' ? GILDING_LAYER_PREFIX : zone.kind === 'gaufrage' ? EMBOSS_LAYER_PREFIX : FOIL_LAYER_PREFIX;
  return prefix + zone.effect;
}

/** Éléments foil et dorure du modèle, regroupés par calque (ordre d'apparition) */
export function zoneGroups(root: HTMLElement): Map<string, { zone: ZoneKind; elements: HTMLElement[] }> {
  const groups = new Map<string, { zone: ZoneKind; elements: HTMLElement[] }>();
  const add = (zone: ZoneKind | null, element: HTMLElement) => {
    if (zone) {
      const name = zoneLayerName(zone);
      const group = groups.get(name) ?? { zone, elements: [] };
      group.elements.push(element);
      groups.set(name, group);
    }
  };
  root.querySelectorAll<HTMLElement>('[data-foil], [data-gaufrage], [data-foil-cache], [data-lenticulaire]').forEach(element => {
    if (element.closest('.' + PIECE_CLASS)) {
      return;
    }
    add(embossKind(element.getAttribute('data-gaufrage')), element);
    add(zoneKind(element.getAttribute('data-foil')), element);
    add(hiddenKind(element), element);
    add(lenticularKind(element), element);
  });
  return groups;
}

/** Éléments foil (reflets) du modèle, regroupés par effet */
export function foilGroups(root: HTMLElement): Map<FoilEffect, HTMLElement[]> {
  const out = new Map<FoilEffect, HTMLElement[]>();
  for (const { zone, elements } of zoneGroups(root).values()) {
    if (zone.kind === 'foil') {
      out.set(zone.effect as FoilEffect, elements);
    }
  }
  return out;
}

/** Position d'un élément dans la page, par ses décalages (sans les transformations) */
function offsetPosition(element: HTMLElement): { x: number; y: number } {
  let x = 0, y = 0;
  for (let n: HTMLElement | null = element; n; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft + (n !== element ? n.clientLeft : 0);
    y += n.offsetTop + (n !== element ? n.clientTop : 0);
  }
  return { x, y };
}

/** Éléments sans contenu : la pièce se pose à côté d'eux */
const VOID = ['IMG', 'INPUT', 'BR', 'HR', 'VIDEO', 'CANVAS', 'IFRAME', 'TEXTAREA', 'SELECT'];

/**
 * Pose une pièce à la place exacte de son élément, en gardant toutes les transformations du modèle
 * (un bandeau centré par translateX(-50%)...) et de l'affichage (échelle, vue 3D) :
 * - une dorure de texte va dans l'élément lui-même (sa transformation s'y applique d'elle-même) ;
 * - un reflet, ou une pièce d'image, va juste après l'élément (même parent) avec sa transformation
 *   recopiée : le reflet se mélange ainsi avec ce qui est autour, pas seulement avec l'élément.
 */
function place(piece: HTMLElement, element: HTMLElement, where: 'append' | 'prepend' | 'after'): void {
  piece.classList.add(PIECE_CLASS);
  piece.setAttribute('aria-hidden', 'true');
  if (VOID.includes(element.tagName)) {
    where = 'after';
  }
  const inside = where !== 'after';
  const style = getComputedStyle(element);
  Object.assign(piece.style, {
    position: 'absolute', left: '0px', top: '0px', right: 'auto', bottom: 'auto', margin: '0',
    ...pieceSize(piece, element), boxSizing: 'border-box',
    transform: inside ? 'none' : style.transform, transformOrigin: style.transformOrigin,
    // transformations individuelles (translate: -50%…) : déjà appliquées par l'élément à ce qu'il contient
    translate: inside ? 'none' : style.translate, rotate: inside ? 'none' : style.rotate, scale: inside ? 'none' : style.scale,
  });
  if (where === 'append') {
    element.appendChild(piece);
  } else if (where === 'prepend') {
    element.insertAdjacentElement('afterbegin', piece);
  } else {
    element.insertAdjacentElement('afterend', piece);
  }
  // le bloc de référence de la pièce peut différer de celui de l'élément : on mesure l'écart
  const at = offsetPosition(element);
  const zero = offsetPosition(piece);
  // marge autour de la pièce (dorure : jambages et accents qui dépassent de la boîte du texte)
  const pad = Number(piece.dataset['pad'] ?? 0);
  piece.style.left = `${at.x - zero.x - pad}px`;
  piece.style.top = `${at.y - zero.y - pad}px`;
}

/** Retire les reflets et dorures de l'aperçu */
export function clearFoilZones(root: HTMLElement): void {
  root.querySelectorAll('.' + PIECE_CLASS).forEach(piece => piece.remove());
}

/** (Re)pose les reflets et dorures de l'aperçu sur les éléments data-foil ; renvoie le nombre de zones */
export function drawFoilZones(root: HTMLElement): number {
  clearFoilZones(root);
  let count = 0;
  // ordre de pose : le gaufrage d'abord (la dorure et le reflet d'un même élément se posent par-dessus), le
  // lenticulaire en dernier : posé juste après l'élément, il passe sous les reflets et l'image cachée
  const rank = (z: ZoneKind) => ({ gaufrage: 0, cache: 1, foil: 2, dorure: 2, lenticulaire: 3 })[z.kind];
  const groups = [...zoneGroups(root).values()].sort((a, b) => rank(a.zone) - rank(b.zone));
  for (const { zone, elements } of groups) {
    for (const element of elements) {
      // éléments HTML affichés seulement (un SVG n'a pas de décalages)
      if (!(element instanceof HTMLElement) || !element.offsetWidth || !element.offsetHeight || !element.parentElement) {
        continue;
      }
      if (zone.kind === 'gaufrage') {
        // texturé : les traits de l'illustration en relief ; sinon l'élément entier
        const texture = zoneOptions(element).texture;
        place(texture ? texturedRelief(element, texture, zone.effect) : embossed(element, zone.effect), element,
          texture ? 'after' : 'prepend');
        count++;
        continue;
      }
      if (zone.kind === 'cache' || zone.kind === 'lenticulaire') {
        place(zone.kind === 'cache' ? hiddenImage(element, zone.effect) : lenticular(element, zone.effect), element, 'after');
        count++;
        continue;
      }
      const isImage = element instanceof HTMLImageElement;
      const text = zone.kind === 'dorure' && !isImage && !!element.textContent?.trim();
      const piece = zone.kind === 'foil' ? reflection(element, zone.effect)
        : text ? gildedText(element, zone.effect)
          : isImage ? gildedShape(element, zone.effect)
            // dorure d'un élément sans texte ni image : un reflet du métal (noir : un vernis)
            : reflection(element, gildingReflection(zone.effect));
      place(piece, element, text ? 'append' : 'after');
      count++;
    }
  }
  return count;
}

/**
 * Reflet posé sur l'élément (rectangle ; une image : découpé à sa transparence). L'enveloppe ne crée pas
 * de contexte d'empilement : le reflet se mélange (mix-blend-mode) avec la carte dessous.
 */
function reflection(element: HTMLElement, effect: FoilEffect): HTMLElement {
  const doc = element.ownerDocument;
  const wrapper = doc.createElement('span');
  const zone = doc.createElement('span');
  zone.className = `foil foil-${effect} ${ZONE_CLASS}`;
  const style = getComputedStyle(element);
  zone.style.borderRadius = style.borderRadius;
  // au niveau de l'élément : ce qui est posé par-dessus (un bandeau sur l'illustration) le recouvre aussi
  zone.style.zIndex = style.zIndex;
  applyMasks(zone, element, EFFECT_MASKS[effect]);
  // éclat de lumière (étoile), à la forme de la zone
  const star = doc.createElement('span');
  star.className = 'cc-eclat';
  star.style.borderRadius = style.borderRadius;
  star.style.zIndex = style.zIndex;
  applyMasks(star, element);
  wrapper.append(zone, star);
  return wrapper;
}

/** Dorure d'une image : le métal à la forme de l'image (sa transparence) */
function gildedShape(element: HTMLElement, effect: Gilding): HTMLElement {
  const zone = element.ownerDocument.createElement('span');
  zone.className = 'cc-dorure';
  Object.assign(zone.style, { pointerEvents: 'none', zIndex: getComputedStyle(element).zIndex });
  setMetal(zone, effect);
  zone.style.opacity = String(zoneOptions(element).force);
  applyMasks(zone, element, undefined, true);
  return zone;
}

const cssUrl = (u: string) => `url("${u.replace(/"/g, '%22')}")`;

/**
 * Image cachée : le motif (luminosité de data-foil-cache, étiré sur l'élément) en reflet irisé, net seulement quand
 * la carte penche du côté voulu (--par-x, --par-y : voir .cc-cache dans foil-zones.scss).
 */
function hiddenImage(element: HTMLElement, angle: HiddenAngle): HTMLElement {
  const doc = element.ownerDocument;
  const wrapper = doc.createElement('span');
  const zone = doc.createElement('span');
  zone.className = 'cc-cache';
  const style = getComputedStyle(element);
  zone.style.borderRadius = style.borderRadius;
  zone.style.zIndex = style.zIndex;
  const [cx, cy] = HIDDEN_TARGETS[angle];
  zone.style.setProperty('--cx', String(cx));
  zone.style.setProperty('--cy', String(cy));
  const layers = [`${cssUrl(element.getAttribute('data-foil-cache')!.trim())} center / 100% 100% no-repeat luminance`];
  const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : '';
  if (src) {
    layers.push(`${cssUrl(src)} center / 100% 100% no-repeat intersect`);
  }
  zone.style.setProperty('mask', layers.join(', '));
  wrapper.appendChild(zone);
  return wrapper;
}

/** Taille d'image de fond qui reproduit object-fit */
const FIT_SIZE: Record<string, string> = { fill: '100% 100%', contain: 'contain', cover: 'cover', none: 'auto', 'scale-down': 'contain' };

/**
 * Lenticulaire : la seconde image (data-lenticulaire) à la place exacte de la première (même cadrage : object-fit
 * d'une image, ou taille et position de l'image de fond), visible quand la carte penche ; de fines lignes de
 * lentilles par-dessus. Opacité : voir .cc-lenticulaire dans foil-zones.scss.
 */
function lenticular(element: HTMLElement, sens: 'h' | 'v'): HTMLElement {
  const doc = element.ownerDocument;
  const style = getComputedStyle(element);
  const url = cssUrl(element.getAttribute('data-lenticulaire')!.trim());
  const wrapper = doc.createElement('span');
  const image = doc.createElement('span');
  image.className = 'cc-lenticulaire' + (sens === 'v' ? ' cc-lenticulaire-v' : '');
  const common = { position: 'absolute', inset: '0', pointerEvents: 'none', borderRadius: style.borderRadius, zIndex: style.zIndex };
  Object.assign(image.style, common, { backgroundRepeat: 'no-repeat', backgroundColor: 'transparent' });
  if (element instanceof HTMLImageElement) {
    Object.assign(image.style, { backgroundImage: url, backgroundSize: FIT_SIZE[style.objectFit] ?? '100% 100%',
      backgroundPosition: style.objectPosition });
  } else if (/url\(/.test(style.backgroundImage)) {
    // la première image de fond de l'élément est remplacée, les autres couches (dégradés…) gardées
    Object.assign(image.style, { backgroundImage: style.backgroundImage.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/, url),
      backgroundSize: style.backgroundSize, backgroundPosition: style.backgroundPosition, backgroundRepeat: style.backgroundRepeat });
  } else {
    Object.assign(image.style, { backgroundImage: url, backgroundSize: 'cover', backgroundPosition: 'center' });
  }
  const lines = doc.createElement('span');
  lines.className = 'cc-lentilles' + (sens === 'v' ? ' cc-lentilles-v' : '');
  Object.assign(lines.style, common);
  wrapper.append(image, lines);
  return wrapper;
}

/** Force du reflet : la plus forte de l'inclinaison (--glare-o) et du reflet de la vue 3D (--spec) */
const SHINE = 'max(var(--glare-o, 0.5), var(--spec, 0))';

/**
 * Le métal d'une dorure et sa lumière : un éclat blanc qui balaie les lettres et s'intensifie avec le
 * reflet, un métal plus sombre quand il ne renvoie pas la lumière, et le dégradé du métal qui se déplace.
 */
function setMetal(zone: HTMLElement, gilding: Gilding): void {
  const matte = gilding.endsWith('-mat');
  const effect = gilding.replace(/-mat$/, '') as GildingEffect;
  const light = 'clamp(0%, var(--glare-x, 50%), 100%) clamp(0%, var(--glare-y, 50%), 100%)';
  const layers: [string, string, string][] = [...starLayers(light)];
  if (!matte) {
    // éclat blanc qui balaie les lettres
    layers.push([`linear-gradient(115deg, transparent 45%, rgb(255 255 255 / calc(${SHINE} * 0.95)) 50%, transparent 55%)`, '250% 250%', light]);
  }
  // hors de l'angle du reflet, le métal s'assombrit franchement (vue 3D : --glare-o tombe vers 0) ; satiné : à peine
  const shade = matte ? `rgb(0 0 0 / calc(0.22 - ${SHINE} * 0.15))` : `rgb(0 0 0 / calc(0.4 - ${SHINE} * 0.4))`;
  layers.push([`linear-gradient(${shade}, ${shade})`, '100% 100%', '0 0'],
    // satiné : le métal bouge à peine (reflets doux, étalés)
    [GILDING_GRADIENTS[effect], matte ? '130% 130%' : '200% 200%', light]);
  Object.assign(zone.style, {
    backgroundImage: layers.map(l => l[0]).join(', '),
    backgroundSize: layers.map(l => l[1]).join(', '),
    backgroundPosition: layers.map(l => l[2]).join(', '),
    backgroundRepeat: 'no-repeat', backgroundOrigin: 'border-box',
  });
  if (effect === 'holo') {
    // dorure holographique : couleurs qui tournent avec l'angle (vue 3D)
    zone.style.filter = 'var(--foil-irise, none)';
  }
}

/** Effet foil qui tient lieu d'une dorure sur un élément sans texte ni image */
function gildingReflection(gilding: Gilding): FoilEffect {
  const effect = gilding.replace(/-mat$/, '');
  return effect === 'noir' ? 'vernis' : effect as FoilEffect;
}

/**
 * Éclat : une étoile de lumière (cœur et deux traits en croix) au point du reflet, quand la carte est pile dans l'axe
 * (--eclat, 0 à 1 : vue 3D, classeur). Couches d'image de fond [image, taille, position].
 */
function starLayers(at: string): [string, string, string][] {
  const a = (k: number) => `rgb(255 255 255 / calc(var(--eclat, 0) * ${k}))`;
  return [
    [`radial-gradient(circle at ${at}, ${a(1)} 0, ${a(0.8)} 4px, transparent 14px)`, '100% 100%', '0 0'],
    [`radial-gradient(70px 2.5px at ${at}, ${a(0.95)}, transparent)`, '100% 100%', '0 0'],
    [`radial-gradient(2.5px 70px at ${at}, ${a(0.95)}, transparent)`, '100% 100%', '0 0'],
  ];
}

/** Masques propres à certains effets (classe CSS), repris quand la zone a ses propres masques */
const EFFECT_MASKS: Partial<Record<FoilEffect, { layers: string[]; composite: string[] }>> = {
  paillettes: { layers: ['radial-gradient(circle at var(--fx) var(--fy), #000 0%, rgba(0, 0, 0, 0.3) 30%, transparent 60%)',
    'radial-gradient(circle, #000 0 2.5px, transparent 3.5px) calc(var(--par-x, 0) * 37px + var(--fx) * 0.15) '
    + 'calc(var(--par-y, 0) * 29px + var(--fy) * 0.15) / 9px 13px'], composite: ['intersect', 'add'] },
  glace: { layers: ['radial-gradient(circle at var(--fx) var(--fy), #000 0%, rgba(0, 0, 0, 0.45) 45%, rgba(0, 0, 0, 0.15) 80%)'], composite: ['add'] },
  cadre: { layers: ['linear-gradient(#000 0 0) content-box', 'linear-gradient(#000 0 0)'], composite: ['exclude', 'add'] },
};

/**
 * Masques d'une pièce : forme d'une image (sa transparence), masque peint (data-foil-masque, sa luminosité :
 * blanc = foil, noir = rien), force (data-foil-force), puis ceux de l'effet. Tous se combinent (intersection).
 */
function applyMasks(zone: HTMLElement, element: HTMLElement, effect?: { layers: string[]; composite: string[] },
  forceInOpacity = false): void {
  const { masques, force } = zoneOptions(element);
  const url = (u: string) => `url("${u.replace(/"/g, '%22')}")`;
  const own: string[] = [];
  const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : '';
  if (src) {
    own.push(`${url(src)} center / 100% 100% no-repeat`);
  }
  for (const masque of masques) {
    own.push(`${url(masque)} center / 100% 100% no-repeat luminance`);
  }
  if (force < 1 && !forceInOpacity) {
    own.push(`linear-gradient(rgb(0 0 0 / ${force}), rgb(0 0 0 / ${force}))`);
  }
  if (!own.length) {
    return;
  }
  // opérateur de chaque couche dans la forme courte (une forme courte avec var() ne se combine pas
  // avec un mask-composite posé à part)
  const layers = [...own.map(layer => `${layer} intersect`),
    ...(effect?.layers ?? []).map((layer, i) => `${layer} ${effect!.composite[i]}`)];
  zone.style.setProperty('mask', layers.join(', '));
}

/**
 * Gaufrage d'une texture : liseré clair du côté de la lumière et sombre de l'autre, le long des traits du masque
 * de texture (chaque liseré : le masque décalé, moins le masque à sa place).
 */
function texturedRelief(element: HTMLElement, texture: string, effect: string): HTMLElement {
  const doc = element.ownerDocument;
  const wrapper = doc.createElement('span');
  wrapper.classList.add('cc-gaufrage');
  wrapper.style.zIndex = getComputedStyle(element).zIndex;
  const url = `url("${texture.replace(/"/g, '%22')}")`;
  const d = effect === 'creux' ? -1 : 1;
  const rim = (sign: number, color: string) => {
    const span = doc.createElement('span');
    const dx = `calc(var(--relief-x, -0.7) * ${sign * d * 2}px)`;
    const dy = `calc(var(--relief-y, -0.7) * ${sign * d * 2}px)`;
    Object.assign(span.style, { position: 'absolute', inset: '0', background: color, pointerEvents: 'none' });
    span.style.setProperty('mask', `${url} ${dx} ${dy} / 100% 100% no-repeat luminance subtract, ${url} 0 0 / 100% 100% no-repeat luminance`);
    return span;
  };
  wrapper.append(rim(1, 'rgb(255 255 255 / 0.75)'), rim(-1, 'rgb(0 0 0 / 0.6)'));
  return wrapper;
}

/**
 * Gaufrage : une copie de l'élément, identique, posée sur lui, avec un liseré clair du côté de la lumière
 * et sombre de l'autre (en creux : l'inverse). La lumière vient de --relief-x, --relief-y (-1 à 1 ; par
 * défaut d'en haut à gauche), posées par la vue 3D.
 */
function embossed(element: HTMLElement, effect: string): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  copyStyles(element, clone);
  const originals = [...element.querySelectorAll<HTMLElement>('*')];
  [...clone.querySelectorAll<HTMLElement>('*')].forEach((copy, i) => {
    if (originals[i]) {
      copyStyles(originals[i], copy);
    }
  });
  [clone, ...clone.querySelectorAll<HTMLElement>('[id], [data-foil], [data-calque], [data-gaufrage]')].forEach(node => {
    node.removeAttribute('id');
    node.removeAttribute('data-foil');
    node.removeAttribute('data-calque');
    node.removeAttribute('data-gaufrage');
    node.removeAttribute('data-foil-texture');
    node.removeAttribute(TEXTURE_ATTR);
  });
  clone.classList.add('cc-gaufrage');
  keepOneLine(element, clone);
  const size = Math.max(1, parseFloat(getComputedStyle(element).fontSize || '16') * 0.05);
  const d = effect === 'creux' ? -size : size;
  const x = 'var(--relief-x, -0.7)';
  const y = 'var(--relief-y, -0.7)';
  Object.assign(clone.style, {
    animation: 'none', transition: 'none', pointerEvents: 'none', zIndex: 'auto', overflow: 'visible',
    filter: `drop-shadow(calc(${x} * ${d}px) calc(${y} * ${d}px) 0 rgb(255 255 255 / 0.7)) `
      + `drop-shadow(calc(${x} * ${-d}px) calc(${y} * ${-d}px) ${size / 2}px rgb(0 0 0 / 0.6))`,
  });
  return clone;
}

/**
 * Dorure d'un texte : une copie du texte, à la même place et dans le même style, dont les lettres
 * sont remplies du métal (background-clip: text). Elle recouvre l'encre ; l'ombre du texte reste dessous.
 */
function gildedText(element: HTMLElement, effect: Gilding): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  copyStyles(element, clone);
  const originals = [...element.querySelectorAll<HTMLElement>('*')];
  [...clone.querySelectorAll<HTMLElement>('*')].forEach((copy, i) => {
    if (originals[i]) {
      copyStyles(originals[i], copy);
    }
    Object.assign(copy.style, { background: 'none', color: 'transparent', textShadow: 'none', boxShadow: 'none' });
    copy.style.setProperty('-webkit-text-fill-color', 'transparent');
    if (copy instanceof HTMLImageElement || copy instanceof SVGElement) {
      copy.style.visibility = 'hidden';
    }
  });
  [clone, ...clone.querySelectorAll<HTMLElement>('[id], [data-foil], [data-calque], [data-foil-texture]')].forEach(node => {
    node.removeAttribute('id');
    node.removeAttribute('data-foil');
    node.removeAttribute('data-calque');
    node.removeAttribute('data-foil-texture');
    node.removeAttribute(TEXTURE_ATTR);
  });
  // pas ZONE_CLASS : une dorure n'empêche pas le foil de la carte (attribut Foil) sur toute la carte
  clone.classList.add('cc-dorure');
  keepOneLine(element, clone);
  Object.assign(clone.style, {
    opacity: '1', filter: 'none', animation: 'none',
    transition: 'none', mixBlendMode: 'normal', visibility: 'visible', pointerEvents: 'none',
    color: 'transparent', textShadow: 'none', boxShadow: 'none', borderColor: 'transparent',
    backgroundColor: 'transparent', overflow: 'visible',
    // dans l'élément, juste au-dessus de son texte : ce qui couvre l'élément couvre aussi la dorure
    boxSizing: 'border-box', zIndex: 'auto',
  });
  setMetal(clone, effect);
  // le métal n'est peint que dans la boîte : elle est agrandie (et décalée d'autant par place) pour couvrir
  // les jambages (g, p), les accents et les lettres penchées qui dépassent de la boîte du texte
  const style = getComputedStyle(element);
  const pad = Math.ceil(parseFloat(style.fontSize || '16') * 0.4);
  clone.dataset['pad'] = String(pad);
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    clone.style.setProperty(`padding-${side.toLowerCase()}`, `${parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`) || '0') + pad}px`);
  }
  clone.style.setProperty('-webkit-text-fill-color', 'transparent');
  clone.style.setProperty('-webkit-background-clip', 'text');
  clone.style.setProperty('background-clip', 'text');
  clone.style.opacity = String(zoneOptions(element).force);
  applyMasks(clone, element, undefined, true);
  return clone;
}

/** Dimensions d'une pièce : celles de l'élément, plus sa marge (et un pixel contre les retours à la ligne) */
function pieceSize(piece: HTMLElement, element: HTMLElement): { width: string; height: string } {
  const pad = Number(piece.dataset['pad'] ?? 0);
  const extra = piece.classList.contains('cc-dorure') || piece.classList.contains('cc-gaufrage') ? 1 : 0;
  return { width: `${element.offsetWidth + 2 * pad + extra}px`, height: `${element.offsetHeight + 2 * pad}px` };
}

/**
 * Un texte sur une seule ligne (un titre, un élément en ligne) le reste dans sa copie : la largeur arrondie de
 * la copie ne doit pas renvoyer un mot à la ligne.
 */
function keepOneLine(element: HTMLElement, copy: HTMLElement): void {
  const lines = element.getClientRects().length;
  const style = getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
  if (lines <= 1 && element.offsetHeight < lineHeight * 1.6) {
    copy.style.whiteSpace = 'nowrap';
  }
}

/** Recopie le style calculé d'un élément (la copie n'a plus le contexte des sélecteurs du modèle) */
function copyStyles(from: Element, to: HTMLElement): void {
  const computed = getComputedStyle(from);
  for (const name of Array.from(computed)) {
    // pas les variables : la lumière (--glare-x...) doit rester héritée, pas figée au moment de la copie
    if (!name.startsWith('--')) {
      to.style.setProperty(name, computed.getPropertyValue(name));
    }
  }
}
