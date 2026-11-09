import { FieldType } from '../data-services/types/field-type.type';
import { DeckColumn, exportJson } from '../cards-transfer/card-transfer';
import { buildCollectorSet, suggestSetCode } from './collector-set';

const columns: DeckColumn[] = [
  { field: 'name', header: 'Name', type: FieldType.text },
  { field: 'count', header: 'Count', type: FieldType.numeric },
  { field: 'frontCardTemplateId', header: 'Front Template', type: FieldType.dropdown, template: true },
  { field: 'cardid', header: 'CardID', type: FieldType.text },
  { field: 'rarete', header: 'Rareté', type: FieldType.dropdown, options: ['Commune', 'Rare'] },
  { field: 'lore', header: 'Lore', type: FieldType.text },
];
const templates = [{ id: 1, name: 'Recto' }];
const settings = { code: 'FANGH-S1', nom: 'Série 1', univers: 'Terre de Fangh', publication: 2 };

function json(cards: Record<string, unknown>[]) {
  return exportJson('Livres', columns, cards, templates);
}

describe('collector set', () => {
  it('builds set.json with the set block and without template columns', () => {
    const plan = buildCollectorSet(json([
      { name: 'Grimoire', count: 1, frontCardTemplateId: 1, cardid: 'LDF001', rarete: 'Rare', lore: '' },
      { name: 'Dague', count: 2, frontCardTemplateId: 1, cardid: 'LDF002', rarete: 'Commune', lore: 'x' },
    ]), settings);
    expect(plan.errors).toEqual([]);
    expect(plan.cardIds).toEqual(['LDF001', 'LDF002']);
    const doc = JSON.parse(plan.setJson);
    expect(doc.format).toBe('cartes-fangh');
    expect(doc.set).toEqual({ code: 'FANGH-S1', nom: 'Série 1', univers: 'Terre de Fangh', publication: 2 });
    expect(doc.cartes[0]['Front Template']).toBeUndefined();
    expect(doc.cartes[0]['Lore']).toBeUndefined();
    expect(doc.cartes[1]['Lore']).toBe('x');
    expect(doc.champs.find((c: { nom: string }) => c.nom === 'Rareté').options).toEqual(['Commune', 'Rare']);
  });

  it('reports missing, invalid and duplicate identifiers and rarities', () => {
    const plan = buildCollectorSet(json([
      { name: 'A', cardid: '', rarete: 'Rare' },
      { name: 'B', cardid: 'X 1', rarete: 'Rare' },
      { name: 'C', cardid: 'C1', rarete: 'Mythique' },
      { name: 'D', cardid: 'C1', rarete: '' },
    ]), settings);
    expect(plan.errors.length).toBe(5);
    expect(plan.errors.join('\n')).toContain('en double');
  });

  it('checks the settings', () => {
    const plan = buildCollectorSet(json([{ name: 'A', cardid: 'A1', rarete: 'Rare' }]),
      { ...settings, code: 'x', publication: 0 });
    expect(plan.errors.length).toBe(2);
  });

  it('carries the pack, the foil effects and the booster draws', () => {
    const foilColumns: DeckColumn[] = [...columns, { field: 'foil', header: 'Foil', type: FieldType.text }];
    const text = exportJson('Livres', foilColumns, [
      { name: 'A', cardid: 'A1', rarete: 'Rare', foil: 'gold' },
      { name: 'B', cardid: 'B1', rarete: 'Commune', foil: 'non' },
      { name: 'C', cardid: 'C1', rarete: 'Commune', foil: '' },
    ], templates);
    const plan = buildCollectorSet(text, settings, {
      image: 'pack.png', imageBack: 'pack-back.png', finition: 'holo', dentele: true, tirage: { cardsPerPack: 5, weights: [1, 10, 0] },
    });
    expect(plan.errors).toEqual([]);
    const doc = JSON.parse(plan.setJson);
    expect(doc.set.paquet).toBe('pack.png');
    expect(doc.set.paquet_dos).toBe('pack-back.png');
    expect(doc.set.paquet_style).toEqual({ finition: 'holo', dentele: true });
    expect(doc.set.booster).toEqual({ slots: [{ nom: 'Cartes', nombre: 5, raretes: { Rare: 1, Commune: 10 } }] });
    expect(doc.cartes[0]['Foil']).toBe('or');
    expect(doc.cartes[1]['Foil']).toBeUndefined();
    expect(doc.cartes.map((c: Record<string, unknown>) => c['Poids'])).toEqual([1, 10, 0]);
  });

  it('suggests a code from the deck name', () => {
    expect(suggestSetCode('Livres de Fangh')).toBe('LIVRES-DE-FANGH');
    expect(suggestSetCode('é')).toBe('SET-1');
  });
});
