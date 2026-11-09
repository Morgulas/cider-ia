import { Booster } from '../data-services/types/booster.type';
import { Card } from '../data-services/types/card.type';
import { backOf, newBooster, openBooster, pickChance, poolOf, simulate } from './booster-logic';

function card(id: number, extra: Record<string, unknown> = {}): Card {
  return { id, deckId: 1, name: `C${id}`, count: 1, frontCardTemplateId: 1, backCardTemplateId: 1, ...extra } as Card;
}

/** Générateur pseudo-aléatoire reproductible. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

describe('booster-logic', () => {
  const cards = [card(1), card(2), card(3), card(4, { deckId: 2 })];

  function booster(extra: Partial<Booster> = {}): Booster {
    return { id: 1, ...newBooster('Test', [1]), ...extra };
  }

  it('le pool ne garde que les decks choisis et les poids > 0', () => {
    const pool = poolOf(booster({ weights: { 2: 0, 3: 5 } }), cards);
    expect(pool.map(e => [e.card.id, e.weight])).toEqual([[1, 1], [3, 5]]);
    expect(pickChance(pool[1], pool)).toBeCloseTo(5 / 6);
  });

  it('sans doublons, un booster ne contient chaque carte qu\'une fois tant que le pool suffit', () => {
    const b = booster({ cardsPerPack: 3 });
    const pulled = openBooster(b, poolOf(b, cards), undefined, seeded(7));
    expect(new Set(pulled.map(p => p.card.id)).size).toBe(3);
  });

  it('respecte les poids sur un grand nombre de boosters', () => {
    const b = booster({ cardsPerPack: 1, allowDuplicates: true, weights: { 1: 8, 2: 1, 3: 1 } });
    const stats = simulate(b, poolOf(b, cards), 5000, undefined, undefined, seeded(42));
    const share = stats.perCard.get(1)!.copies / 5000;
    expect(share).toBeGreaterThan(0.75);
    expect(share).toBeLessThan(0.85);
  });

  it('applique l\'attribut foil, puis la chance de foil du booster', () => {
    const b = booster({ cardsPerPack: 3, foilChance: 100, foilEffect: 'or' });
    const withAttr = [card(1, { f: 'galaxie' }), card(2), card(3)];
    const pulled = openBooster(b, poolOf(b, withAttr), 'f', seeded(3));
    const byId = new Map(pulled.map(p => [p.card.id, p.foil]));
    expect(byId.get(1)).toBe('galaxie');
    expect(byId.get(2)).toBe('or');
  });

  it('regroupe les cartes sorties par valeur d\'attribut', () => {
    const b = booster({ cardsPerPack: 2 });
    const rarity = [card(1, { r: 'C' }), card(2, { r: 'C' }), card(3, { r: 'R' })];
    const stats = simulate(b, poolOf(b, rarity), 200, c => String((c as unknown as Record<string, unknown>)['r'])
      , undefined, seeded(9));
    const total = [...stats.perGroup.values()].reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(2);
  });

  it('derives the back from the front unless it is customised', () => {
    const design = newBooster('Livres', []).design;
    const auto = backOf(design);
    expect(auto.mode).toBe('auto');
    expect(auto.colorA).toBe(design.colorB);
    expect(auto.colorB).toBe(design.colorA);
    const custom = backOf({ ...design, back: { ...auto, mode: 'form', text: 'Contenu : 10 cartes' } });
    expect(custom.mode).toBe('form');
    expect(custom.text).toBe('Contenu : 10 cartes');
    // repassé en automatique : on retrouve le verso tiré du recto
    expect(backOf({ ...design, back: { ...auto, mode: 'auto', text: 'ancien' } }).text).toBe('');
  });
});
