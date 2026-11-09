import { deckIdOf } from './deck-tabs.component';

describe('deckIdOf', () => {
  it('finds the deck of the deck pages only', () => {
    expect(deckIdOf('/decks/4/cards/thumbnails')).toBe(4);
    expect(deckIdOf('/decks/12')).toBe(12);
    expect(deckIdOf('/decks')).toBeNull();
    expect(deckIdOf('/boosters')).toBeNull();
  });
});
