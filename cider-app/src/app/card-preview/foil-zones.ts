import { FoilEffect, foilFromValue } from '../card-binder/foil';

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
const LAYER_CLASS = 'cc-foil-layer';
export const ZONE_CLASS = 'cc-foil-zone';

/** Effets proposés en dorure : le métal remplace l'encre au lieu de s'y refléter */
export const GILDING_EFFECTS: FoilEffect[] = ['or', 'argent', 'holo'];

/** Métal d'une dorure, déplacé par la lumière (--glare-x, --glare-y) */
const GILDING_GRADIENTS: Record<string, string> = {
  or: 'linear-gradient(125deg, #8a6416 0%, #f7e08a 20%, #b8892c 34%, #fff5c0 48%, #a77c22 62%, #f2d06a 78%, #7a5a14 100%)',
  argent: 'linear-gradient(125deg, #6b7078 0%, #f4f6f8 20%, #9aa0a8 36%, #ffffff 48%, #858b93 62%, #e6e9ec 78%, #5d6168 100%)',
  holo: 'linear-gradient(115deg, #d9d9e6 0%, #ffb3e6 16%, #fff2a8 32%, #b3ffd9 48%, #a8e6ff 64%, #d2b3ff 80%, #d9d9e6 100%)',
};

/** Une zone du modèle : son type (reflet ou dorure) et son effet */
export interface ZoneKind {
  kind: 'foil' | 'dorure';
  effect: FoilEffect;
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
  return (zone.kind === 'dorure' ? GILDING_LAYER_PREFIX : FOIL_LAYER_PREFIX) + zone.effect;
}

/** Éléments foil et dorure du modèle, regroupés par calque (ordre d'apparition) */
export function zoneGroups(root: HTMLElement): Map<string, { zone: ZoneKind; elements: HTMLElement[] }> {
  const groups = new Map<string, { zone: ZoneKind; elements: HTMLElement[] }>();
  root.querySelectorAll<HTMLElement>('[data-foil]').forEach(element => {
    if (element.closest('.' + LAYER_CLASS)) {
      return;
    }
    const zone = zoneKind(element.getAttribute('data-foil'));
    if (zone) {
      const name = zoneLayerName(zone);
      const group = groups.get(name) ?? { zone, elements: [] };
      group.elements.push(element);
      groups.set(name, group);
    }
  });
  return groups;
}

/** Éléments foil (reflets) du modèle, regroupés par effet */
export function foilGroups(root: HTMLElement): Map<FoilEffect, HTMLElement[]> {
  const out = new Map<FoilEffect, HTMLElement[]>();
  for (const { zone, elements } of zoneGroups(root).values()) {
    if (zone.kind === 'foil') {
      out.set(zone.effect, elements);
    }
  }
  return out;
}

/** Position d'un élément dans la carte, sans tenir compte des transformations (échelle, inclinaison) */
function boxIn(element: HTMLElement, root: HTMLElement): { x: number; y: number; w: number; h: number } | null {
  if (!(element instanceof HTMLElement)) {
    // SVG : pas d'offsetLeft ; mesure à l'écran ramenée à l'échelle de la carte
    const r = (element as Element).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const k = root.offsetWidth ? box.width / root.offsetWidth : 1;
    return r.width && r.height && k ? { x: (r.left - box.left) / k, y: (r.top - box.top) / k, w: r.width / k, h: r.height / k } : null;
  }
  const page = (e: HTMLElement) => {
    let x = 0, y = 0;
    for (let n: HTMLElement | null = e; n; n = n.offsetParent as HTMLElement | null) {
      x += n.offsetLeft + (n !== e ? n.clientLeft : 0);
      y += n.offsetTop + (n !== e ? n.clientTop : 0);
    }
    return { x, y };
  };
  if (!element.offsetWidth || !element.offsetHeight) {
    return null;
  }
  const a = page(element);
  const b = page(root);
  return { x: a.x - b.x - root.clientLeft, y: a.y - b.y - root.clientTop, w: element.offsetWidth, h: element.offsetHeight };
}

/** Retire les reflets de l'aperçu */
export function clearFoilZones(root: HTMLElement): void {
  root.querySelectorAll(':scope > .' + LAYER_CLASS).forEach(layer => layer.remove());
}

/** (Re)pose les reflets et dorures de l'aperçu sur les éléments data-foil ; renvoie le nombre de zones */
export function drawFoilZones(root: HTMLElement): number {
  clearFoilZones(root);
  const groups = zoneGroups(root);
  if (!groups.size) {
    return 0;
  }
  const layer = root.ownerDocument.createElement('div');
  layer.className = LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  let count = 0;
  for (const { zone, elements } of groups.values()) {
    for (const element of elements) {
      const box = boxIn(element, root);
      if (!box) {
        continue;
      }
      const isImage = element instanceof HTMLImageElement;
      const piece = zone.kind === 'dorure' && !isImage && element.textContent?.trim()
        ? gildedText(element, zone.effect)
        : zone.kind === 'dorure' && isImage ? gildedShape(element, zone.effect)
          : reflection(element, zone.effect);
      Object.assign(piece.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
      layer.appendChild(piece);
      count++;
    }
  }
  root.appendChild(layer);
  return count;
}

/** Reflet posé sur l'élément (rectangle ; une image : découpé à sa transparence) */
function reflection(element: HTMLElement, effect: FoilEffect): HTMLElement {
  const zone = element.ownerDocument.createElement('span');
  zone.className = `foil foil-${effect} ${ZONE_CLASS}`;
  zone.style.borderRadius = getComputedStyle(element).borderRadius;
  maskWithImage(zone, element);
  return zone;
}

/** Dorure d'une image : le métal à la forme de l'image (sa transparence) */
function gildedShape(element: HTMLElement, effect: FoilEffect): HTMLElement {
  const zone = element.ownerDocument.createElement('span');
  zone.className = 'cc-dorure';
  Object.assign(zone.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2147483000' });
  zone.style.backgroundImage = GILDING_GRADIENTS[effect];
  setMetalLight(zone);
  maskWithImage(zone, element);
  return zone;
}

/** Le métal suit la lumière (variables posées par l'inclinaison ou la vue 3D) */
function setMetalLight(zone: HTMLElement): void {
  Object.assign(zone.style, {
    backgroundSize: '300% 300%', backgroundRepeat: 'no-repeat', backgroundOrigin: 'border-box',
    backgroundPosition: 'clamp(0%, var(--glare-x, 50%), 100%) clamp(0%, var(--glare-y, 50%), 100%)',
  });
}

function maskWithImage(zone: HTMLElement, element: HTMLElement): void {
  const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : '';
  if (src) {
    const mask = `url("${src.replace(/"/g, '%22')}") center / 100% 100% no-repeat`;
    zone.style.setProperty('-webkit-mask', mask);
    zone.style.setProperty('mask', mask);
  }
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
  [clone, ...clone.querySelectorAll<HTMLElement>('[id], [data-foil], [data-calque]')].forEach(node => {
    node.removeAttribute('id');
    node.removeAttribute('data-foil');
    node.removeAttribute('data-calque');
  });
  // pas ZONE_CLASS : une dorure n'empêche pas le foil de la carte (attribut Foil) sur toute la carte
  clone.classList.add('cc-dorure');
  Object.assign(clone.style, {
    position: 'absolute', margin: '0', transform: 'none', opacity: '1', filter: 'none', animation: 'none',
    transition: 'none', mixBlendMode: 'normal', visibility: 'visible', pointerEvents: 'none',
    color: 'transparent', textShadow: 'none', boxShadow: 'none', borderColor: 'transparent',
    backgroundColor: 'transparent', backgroundImage: GILDING_GRADIENTS[effect], overflow: 'visible',
    boxSizing: 'border-box', zIndex: '2147483000',
  });
  setMetalLight(clone);
  clone.style.setProperty('-webkit-text-fill-color', 'transparent');
  clone.style.setProperty('-webkit-background-clip', 'text');
  clone.style.setProperty('background-clip', 'text');
  return clone;
}

/** Recopie le style calculé d'un élément (la copie n'a plus le contexte des sélecteurs du modèle) */
function copyStyles(from: Element, to: HTMLElement): void {
  const computed = getComputedStyle(from);
  for (const name of Array.from(computed)) {
    to.style.setProperty(name, computed.getPropertyValue(name));
  }
}
