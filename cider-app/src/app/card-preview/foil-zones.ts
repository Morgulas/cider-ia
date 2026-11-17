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
    if (element.closest('.' + PIECE_CLASS)) {
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
function place(piece: HTMLElement, element: HTMLElement, inside: boolean): void {
  piece.classList.add(PIECE_CLASS);
  piece.setAttribute('aria-hidden', 'true');
  inside = inside && !VOID.includes(element.tagName);
  const style = getComputedStyle(element);
  Object.assign(piece.style, {
    position: 'absolute', left: '0px', top: '0px', right: 'auto', bottom: 'auto', margin: '0',
    ...pieceSize(piece, element), boxSizing: 'border-box',
    transform: inside ? 'none' : style.transform, transformOrigin: style.transformOrigin,
  });
  if (inside) {
    element.appendChild(piece);
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
  for (const { zone, elements } of zoneGroups(root).values()) {
    for (const element of elements) {
      // éléments HTML affichés seulement (un SVG n'a pas de décalages)
      if (!(element instanceof HTMLElement) || !element.offsetWidth || !element.offsetHeight || !element.parentElement) {
        continue;
      }
      const isImage = element instanceof HTMLImageElement;
      const text = zone.kind === 'dorure' && !isImage && !!element.textContent?.trim();
      const piece = text ? gildedText(element, zone.effect)
        : zone.kind === 'dorure' && isImage ? gildedShape(element, zone.effect)
          : reflection(element, zone.effect);
      place(piece, element, text);
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
  zone.style.borderRadius = getComputedStyle(element).borderRadius;
  maskWithImage(zone, element);
  wrapper.appendChild(zone);
  return wrapper;
}

/** Dorure d'une image : le métal à la forme de l'image (sa transparence) */
function gildedShape(element: HTMLElement, effect: FoilEffect): HTMLElement {
  const zone = element.ownerDocument.createElement('span');
  zone.className = 'cc-dorure';
  Object.assign(zone.style, { pointerEvents: 'none', zIndex: '2147483000' });
  setMetal(zone, effect);
  maskWithImage(zone, element);
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
    opacity: '1', filter: 'none', animation: 'none',
    transition: 'none', mixBlendMode: 'normal', visibility: 'visible', pointerEvents: 'none',
    color: 'transparent', textShadow: 'none', boxShadow: 'none', borderColor: 'transparent',
    backgroundColor: 'transparent', overflow: 'visible',
    boxSizing: 'border-box', zIndex: '2147483000',
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
  return clone;
}

/** Dimensions d'une pièce : celles de l'élément, plus sa marge (et un pixel contre les retours à la ligne) */
function pieceSize(piece: HTMLElement, element: HTMLElement): { width: string; height: string } {
  const pad = Number(piece.dataset['pad'] ?? 0);
  const extra = pad ? 1 : 0;
  return { width: `${element.offsetWidth + 2 * pad + extra}px`, height: `${element.offsetHeight + 2 * pad}px` };
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
