import { Card } from '../data-services/types/card.type';
import { EntityField } from '../data-services/types/entity-field.type';
import { findFoilField, foilFromValue, foilOf } from './foil';

describe('foil', () => {
  it('reconnaît les effets, en français comme en anglais, sans tenir compte des accents', () => {
    expect(foilFromValue('Holo')).toBe('holo');
    expect(foilFromValue('Doré')).toBe('or');
    expect(foilFromValue('silver')).toBe('argent');
    expect(foilFromValue('Arc-en-ciel')).toBe('prisme');
    expect(foilFromValue('Reverse holo')).toBe('cadre');
    expect(foilFromValue({ value: 'Galaxie', color: '#fff' })).toBe('galaxie');
  });

  it('« oui » ou une case cochée donnent l\'effet par défaut, le reste aucun', () => {
    expect(foilFromValue(true)).toBe('holo');
    expect(foilFromValue('oui')).toBe('holo');
    expect(foilFromValue(false)).toBeNull();
    expect(foilFromValue('')).toBeNull();
    expect(foilFromValue('non')).toBeNull();
    expect(foilFromValue(undefined)).toBeNull();
  });

  it('trouve l\'attribut « Foil » ou « Brillance » parmi les champs', () => {
    const fields = [
      { field: 'name', header: 'Nom' },
      { field: 'attr7', header: 'Brillance' },
    ] as unknown as EntityField<Card>[];
    expect(findFoilField(fields)).toBe('attr7');
    expect(foilOf({ attr7: 'or' } as unknown as Card, 'attr7')).toBe('or');
    expect(foilOf({ attr7: 'or' } as unknown as Card, undefined)).toBeNull();
  });
});
