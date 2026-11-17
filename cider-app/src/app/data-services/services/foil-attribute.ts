import { Table } from 'dexie';
import { CardAttribute } from '../types/card-attribute.type';
import { DropdownOption } from '../types/dropdown-option.type';
import { FieldType } from '../types/field-type.type';
import { FOIL_EFFECTS } from '../../card-binder/foil';

/** Attributs système liés à une propriété de la carte (nom, quantité, modèles) */
const BUILT_IN = ['Name', 'Count', 'Front Template', 'Back Template'];

/** Attribut système propre à la carte (Name, Count, modèles), à part de ses valeurs libres comme Foil */
export function isBuiltInAttribute(attribute: CardAttribute): boolean {
  return !!attribute.isSystem && BUILT_IN.includes(attribute.name);
}

export const FOIL_ATTRIBUTE = 'Foil';
const FOIL_DESCRIPTION = 'Effet foil de la carte (vide : pas de foil)';

/** Les effets proposés dans la liste de l'attribut Foil, chacun avec sa couleur */
const COLORS: Record<string, string> = {
  holo: '#C77DFF', galaxie: '#5A4FCF', or: '#D4AF37', argent: '#C0C0C0',
  prisme: '#7FDBFF', paillettes: '#FFB3D9', cadre: '#9AD1D4',
  glace: '#BDE8FF', ecailles: '#7FE0C0', hexagones: '#FFD27F',
};
export const FOIL_OPTIONS: DropdownOption[] = FOIL_EFFECTS.map(value => ({ value, color: COLORS[value] }));

/** Noms d'attribut lus comme « effet foil » (voir card-binder/foil.ts) */
const FOIL_NAMES = ['foil', 'brillance', 'effet foil', 'holo'];
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function optionsOf(options: CardAttribute['options']): DropdownOption[] {
  if (Array.isArray(options)) {
    return options.map(o => (typeof o === 'string' ? { value: o, color: '#FFFFFF' } : o));
  }
  if (typeof options === 'string' && options.trim()) {
    try {
      const parsed = JSON.parse(options);
      if (Array.isArray(parsed)) {
        return optionsOf(parsed);
      }
    } catch { /* liste séparée par des virgules */ }
    return options.split(',').map(o => ({ value: o.trim(), color: '#FFFFFF' })).filter(o => o.value);
  }
  return [];
}

/** Les options existantes, complétées des effets qui manquent (null : rien à ajouter) */
function withEffects(options: CardAttribute['options']): DropdownOption[] | null {
  const current = optionsOf(options);
  const missing = FOIL_OPTIONS.filter(effect => !current.some(o => normalize(o.value) === effect.value));
  return missing.length || !Array.isArray(options) ? [...current, ...missing] : null;
}

/**
 * Attribut système « Foil » d'un deck : une liste déroulante des effets, impossible à supprimer.
 * - absent : créé ;
 * - un attribut foil existe déjà (Foil, Brillance, Effet foil, Holo) en texte ou en liste : il le devient,
 *   ses valeurs sont gardées et la liste complétée des effets ;
 * - s'il est d'un autre type (case à cocher...) : laissé tel quel, sans en créer un second.
 */
export async function ensureFoilAttribute(table: Table, deckId: number): Promise<void> {
  const attributes = await table.where({ deckId }).toArray() as CardAttribute[];
  const existing = attributes.find(a => FOIL_NAMES.includes(normalize(String(a.name ?? ''))));
  if (!existing) {
    await table.add({
      deckId, name: FOIL_ATTRIBUTE, type: FieldType.dropdown, description: FOIL_DESCRIPTION,
      options: FOIL_OPTIONS, width: 135, order: -0.5, isSystem: true,
    });
    return;
  }
  const type = String(existing.type);
  if (type !== FieldType.text && type !== FieldType.dropdown) {
    return;
  }
  const options = withEffects(existing.options);
  if (existing.isSystem && type === FieldType.dropdown && !options) {
    return;
  }
  await table.update(existing.id, {
    type: FieldType.dropdown, isSystem: true,
    ...(options ? { options } : {}),
    ...(existing.description ? {} : { description: FOIL_DESCRIPTION }),
  });
}
