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
/** Pièces de l'aperçu (reflets, dorures), posées juste après leur élément */
export const PIECE_CLASS = 'cc-foil-piece';
export const ZONE_CLASS = 'cc-foil-zone';

/** Effets proposés en dorure : le métal remplace l'encre au lieu de s'y refléter */
export const GILDING_EFFECTS: FoilEffect[] = ['or', 'argent', 'holo'];

/** Métal d'une dorure, déplacé par la lumière (--glare-x, --glare-y) */
const GILDING_GRADIENTS: Record<string, string> = {
  or: 'linear-gradient(125deg, #a87a22 0%, #ffe9a3 18%, #d4a640 32%, #fffbe0 46%, #c99a36 60%, #ffe28a 76%, #94701e 100%)',
  argent: 'linear-gradient(125deg, #8a9098 0%, #f7f9fb 18%, #b4bac2 32%, #ffffff 46%, #a2a8b0 60%, #eceff2 76%, #7a8088 100%)',
  holo: 'linear-gradient(115deg, #d9d9e6 0%, #ffb3e6 16%, #fff2a8 32%, #b3ffd9 48%, #a8e6ff 64%, #d2b3ff 80%, #d9d9e6 100%)',
};

/** Une zone du modèle : reflet ou dorure (effet foil), ou gaufrage (relief ou creux) */
export type ZoneKind =
  | { kind: 'foil' | 'dorure'; effect: FoilEffect }
  | { kind: 'gaufrage'; effect: 'relief' | 'creux' };

/** Valeur de data-gaufrage : « creux » (en creux), sinon en relief */
export function embossKind(value: string | null): ZoneKind | null {
  if (value === null) {
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
  const gilding = /^\s*dorure[\s_-]+(.+)$/i.exec(value ?? '');
  if (gilding) {
    const effect = foilFromValue(gilding[1]);
    return effect && GILDING_EFFECTS.includes(effect) ? { kind: 'dorure', effect } : null;
  }
  const effect = foilFromValue(value);
  return effect ? { kind: 'foil', effect } : null;
}

/** Nom du calque exporté d'une zone : foil-<effet> ou dorure-<effet> */
export function zoneLayerName(zone: ZoneKind): string {
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
  root.querySelectorAll<HTMLElement>('[data-foil], [data-gaufrage]').forEach(element => {
    if (element.closest('.' + PIECE_CLASS)) {
      return;
    }
    add(embossKind(element.getAttribute('data-gaufrage')), element);
    add(zoneKind(element.getAttribute('data-foil')), element);
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
  // le gaufrage d'abord : la dorure et le reflet d'un même élément se posent par-dessus
  const groups = [...zoneGroups(root).values()].sort((a, b) =>
    Number(b.zone.kind === 'gaufrage') - Number(a.zone.kind === 'gaufrage'));
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
      const isImage = element instanceof HTMLImageElement;
      const text = zone.kind === 'dorure' && !isImage && !!element.textContent?.trim();
      const piece = text ? gildedText(element, zone.effect)
        : zone.kind === 'dorure' && isImage ? gildedShape(element, zone.effect)
          : reflection(element, zone.effect);
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
  wrapper.appendChild(zone);
  return wrapper;
}

/** Dorure d'une image : le métal à la forme de l'image (sa transparence) */
function gildedShape(element: HTMLElement, effect: FoilEffect): HTMLElement {
  const zone = element.ownerDocument.createElement('span');
  zone.className = 'cc-dorure';
  Object.assign(zone.style, { pointerEvents: 'none', zIndex: getComputedStyle(element).zIndex });
  setMetal(zone, effect);
  zone.style.opacity = String(zoneOptions(element).force);
  applyMasks(zone, element, undefined, true);
  return zone;
}

/** Force du reflet : la plus forte de l'inclinaison (--glare-o) et du reflet de la vue 3D (--spec) */
const SHINE = 'max(var(--glare-o, 0.4), var(--spec, 0))';

/**
 * Le métal d'une dorure et sa lumière : un éclat blanc qui balaie les lettres et s'intensifie avec le
 * reflet, un métal plus sombre quand il ne renvoie pas la lumière, et le dégradé du métal qui se déplace.
 */
function setMetal(zone: HTMLElement, effect: FoilEffect): void {
  const glint = `linear-gradient(115deg, transparent 45%, rgb(255 255 255 / calc(${SHINE} * 0.95)) 50%, transparent 55%)`;
  const shade = `rgb(0 0 0 / calc(0.28 - ${SHINE} * 0.28))`;
  const light = 'clamp(0%, var(--glare-x, 50%), 100%) clamp(0%, var(--glare-y, 50%), 100%)';
  Object.assign(zone.style, {
    backgroundImage: `${glint}, linear-gradient(${shade}, ${shade}), ${GILDING_GRADIENTS[effect]}`,
    backgroundSize: '250% 250%, 100% 100%, 200% 200%',
    backgroundPosition: `${light}, 0 0, ${light}`,
    backgroundRepeat: 'no-repeat', backgroundOrigin: 'border-box',
  });
}

/** Masques propres à certains effets (classe CSS), repris quand la zone a ses propres masques */
const EFFECT_MASKS: Partial<Record<FoilEffect, { layers: string[]; composite: string[] }>> = {
  paillettes: { layers: ['radial-gradient(circle at var(--fx) var(--fy), #000 0%, rgba(0, 0, 0, 0.3) 30%, transparent 60%)'], composite: ['add'] },
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
function gildedText(element: HTMLElement, effect: FoilEffect): HTMLElement {
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
