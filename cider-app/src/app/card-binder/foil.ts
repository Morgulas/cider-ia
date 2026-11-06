import { EntityField } from '../data-services/types/entity-field.type';
import { Card } from '../data-services/types/card.type';
import { fieldOf } from '../data-services/types/entity-service.type';

/** Effets foil proposés : la clé sert de classe CSS (`foil-<clé>`). */
export const FOIL_EFFECTS = ['holo', 'galaxie', 'or', 'argent', 'prisme', 'paillettes', 'cadre'] as const;
export type FoilEffect = typeof FOIL_EFFECTS[number];

/** Noms d'attribut reconnus comme « effet foil » (sans accents ni majuscules). */
const FOIL_ATTRIBUTE_NAMES = ['foil', 'brillance', 'effet foil', 'holo'];

/** Autres façons d'écrire chaque effet dans l'attribut. */
const ALIASES: Record<FoilEffect, string[]> = {
  holo: ['holo', 'holographique', 'holographic', 'hologramme'],
  galaxie: ['galaxie', 'galaxy', 'cosmos', 'etoiles', 'stars'],
  or: ['or', 'gold', 'dore', 'doree'],
  argent: ['argent', 'silver', 'chrome', 'argente', 'argentee'],
  prisme: ['prisme', 'prism', 'arc-en-ciel', 'arc en ciel', 'rainbow'],
  paillettes: ['paillettes', 'glitter', 'sparkle', 'eclats', 'etincelles'],
  cadre: ['cadre', 'reverse', 'reverse holo', 'inverse', 'bordure'],
};

/** Valeurs qui veulent juste dire « oui, foil » : effet par défaut. */
const YES = ['oui', 'yes', 'true', 'vrai', 'x', '1', 'foil'];
const DEFAULT_EFFECT: FoilEffect = 'holo';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** Le champ des cartes qui porte l'effet foil, d'après le nom de l'attribut. */
export function findFoilField(fields: EntityField<Card>[]): string | undefined {
  const field = fields.find(f => FOIL_ATTRIBUTE_NAMES.includes(normalize(String(f.header ?? ''))));
  return field ? String(field.field) : undefined;
}

/**
 * L'effet foil d'une valeur d'attribut : nom d'effet (FR ou EN), case cochée ou
 * « oui » (effet par défaut), sinon aucun.
 */
export function foilFromValue(value: unknown): FoilEffect | null {
  if (value === true) {
    return DEFAULT_EFFECT;
  }
  if (value && typeof value === 'object' && 'value' in value) {
    value = (value as { value: unknown }).value; // option de liste déroulante
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const text = normalize(String(value));
  if (!text) {
    return null;
  }
  for (const effect of FOIL_EFFECTS) {
    if (ALIASES[effect].includes(text)) {
      return effect;
    }
  }
  return YES.includes(text) ? DEFAULT_EFFECT : null;
}

export function foilOf(card: Card, field: string | undefined): FoilEffect | null {
  return field ? foilFromValue(fieldOf(card, field)) : null;
}
