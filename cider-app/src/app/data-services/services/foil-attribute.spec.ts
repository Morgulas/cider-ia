import { Table } from 'dexie';
import { CardAttribute } from '../types/card-attribute.type';
import { DropdownOption } from '../types/dropdown-option.type';
import { ensureFoilAttribute, isBuiltInAttribute } from './foil-attribute';

/** Table en mémoire : juste ce dont ensureFoilAttribute se sert */
function fakeTable(rows: Partial<CardAttribute>[]) {
  let next = 100;
  const table = {
    rows,
    where: (q: { deckId: number }) => ({ toArray: async () => rows.filter(r => r.deckId === q.deckId) }),
    add: async (row: Partial<CardAttribute>) => { rows.push({ ...row, id: next++ }); },
    update: async (id: number, changes: Partial<CardAttribute>) => { Object.assign(rows.find(r => r.id === id)!, changes); },
  };
  return table as unknown as Table & { rows: Partial<CardAttribute>[] };
}

describe('foil-attribute', () => {
  it('crée l\'attribut système Foil avec les 7 effets', async () => {
    const table = fakeTable([{ id: 1, deckId: 1, name: 'Name', isSystem: true }]);
    await ensureFoilAttribute(table, 1);
    const foil = table.rows.find(r => r.name === 'Foil')!;
    expect(foil.isSystem).toBeTrue();
    expect(foil.type as string).toBe('dropdown');
    expect((foil.options as DropdownOption[]).map(o => o.value)).toEqual(['holo', 'galaxie', 'or', 'argent', 'prisme', 'paillettes', 'cadre', 'glace', 'ecailles', 'hexagones', 'vernis', 'soleil']);
    expect(isBuiltInAttribute(foil as CardAttribute)).toBeFalse();
    // une seconde fois : rien de plus
    await ensureFoilAttribute(table, 1);
    expect(table.rows.filter(r => r.name === 'Foil').length).toBe(1);
  });

  it('reprend un attribut foil en texte : liste, système, valeurs gardées', async () => {
    const table = fakeTable([{ id: 7, deckId: 2, name: 'Brillance', type: 'text' as never, options: '' }]);
    await ensureFoilAttribute(table, 2);
    expect(table.rows.length).toBe(1);
    expect(table.rows[0].isSystem).toBeTrue();
    expect(table.rows[0].type as string).toBe('dropdown');
    expect((table.rows[0].options as DropdownOption[]).length).toBe(12);
  });

  it('complète la liste d\'un attribut Foil existant sans perdre ses options', async () => {
    const table = fakeTable([{ id: 3, deckId: 1, name: 'Foil', type: 'dropdown' as never,
      options: [{ value: 'or', color: '#000' }, { value: 'spécial', color: '#111' }] }]);
    await ensureFoilAttribute(table, 1);
    const values = (table.rows[0].options as DropdownOption[]).map(o => o.value);
    expect(values.slice(0, 2)).toEqual(['or', 'spécial']);
    expect(values.length).toBe(13);
    expect((table.rows[0].options as DropdownOption[])[0].color).toBe('#000');
  });

  it('laisse une case à cocher telle quelle, sans en créer un second', async () => {
    const table = fakeTable([{ id: 4, deckId: 1, name: 'Holo', type: 'checkbox' as never }]);
    await ensureFoilAttribute(table, 1);
    expect(table.rows.length).toBe(1);
    expect(table.rows[0].isSystem).toBeUndefined();
  });
});
