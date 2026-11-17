import { FoilEffect, foilFromValue } from '../card-binder/foil';

/**
 * Zones foil d'un modèle de carte : tout élément marqué data-foil="<effet>" brille avec cet effet
 * (holo, galaxie, or, argent, prisme, paillettes, cadre, ou leurs synonymes). La valeur peut venir
 * de la carte : data-foil="{{card.foil}}" ; vide ou inconnue = pas de foil.
 *
 * - Export vers l'appli de collection : un calque « foil-<effet> » par effet (forme exacte des éléments).
 * - Aperçu dans cider-ia : un reflet posé sur chaque élément (rectangle de l'élément ; pour une image,
 *   découpé à sa transparence).
 */

export const FOIL_LAYER_PREFIX = 'foil-';
const LAYER_CLASS = 'cc-foil-layer';
export const ZONE_CLASS = 'cc-foil-zone';

/** Éléments foil du modèle, regroupés par effet (ordre d'apparition) */
export function foilGroups(root: HTMLElement): Map<FoilEffect, HTMLElement[]> {
  const groups = new Map<FoilEffect, HTMLElement[]>();
  root.querySelectorAll<HTMLElement>('[data-foil]').forEach(element => {
    if (element.closest('.' + LAYER_CLASS)) {
      return;
    }
    const effect = foilFromValue(element.getAttribute('data-foil'));
    if (effect) {
      groups.set(effect, [...(groups.get(effect) ?? []), element]);
    }
  });
  return groups;
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

/** (Re)pose les reflets de l'aperçu sur les éléments data-foil ; renvoie le nombre de zones */
export function drawFoilZones(root: HTMLElement): number {
  clearFoilZones(root);
  const groups = foilGroups(root);
  if (!groups.size) {
    return 0;
  }
  const layer = document.createElement('div');
  layer.className = LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  let count = 0;
  for (const [effect, elements] of groups) {
    for (const element of elements) {
      const box = boxIn(element, root);
      if (!box) {
        continue;
      }
      const zone = document.createElement('span');
      zone.className = `foil foil-${effect} ${ZONE_CLASS}`;
      Object.assign(zone.style, {
        left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`,
        borderRadius: getComputedStyle(element).borderRadius,
      });
      const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : '';
      if (src) {
        // une image (icône, illustration détourée) : le reflet suit sa transparence
        const mask = `url("${src.replace(/"/g, '%22')}") center / 100% 100% no-repeat`;
        zone.style.setProperty('-webkit-mask', mask);
        zone.style.setProperty('mask', mask);
      }
      layer.appendChild(zone);
      count++;
    }
  }
  root.appendChild(layer);
  return count;
}
