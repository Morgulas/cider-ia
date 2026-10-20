import GameSimulatorActions from './game-simulator-actions';
import { CardStack, GameCard } from './game-simulator.types';
import { EntityField } from '../data-services/types/entity-field.type';
import { Card } from '../data-services/types/card.type';
import { FieldType } from '../data-services/types/field-type.type';

describe('GameSimulatorActions', () => {

  const gameCard = (id: string, card: Partial<Card> = {}): GameCard => ({
    uniqueId: id,
    card: { id: 1, deckId: 1, ...card } as Card,
    faceUp: true,
    pos: { x: 10, y: 20 },
  });

  const stackOf = (cards: GameCard[], extra: Partial<CardStack> = {}): CardStack => ({
    uniqueId: 'stack-1',
    name: 'Deck',
    cards: cards,
    faceUp: false,
    pos: { x: 100, y: 100 },
    deletable: true,
    ...extra,
  });

  it('shuffles in place and keeps every card', () => {
    const cards = ['a', 'b', 'c', 'd', 'e'].map(id => gameCard(id));
    GameSimulatorActions.shuffleCards(cards, () => 0);
    expect(cards.length).toBe(5);
    expect(cards.map(c => c.uniqueId).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(cards.map(c => c.uniqueId)).not.toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('rotates a stack and the cards it holds', () => {
    const stack = stackOf([gameCard('a'), gameCard('b')]);
    GameSimulatorActions.rotateStack(stack, 90);
    GameSimulatorActions.rotateStack(stack, 90);
    expect(stack.rotation).toBe(180);
    expect(stack.cards.every(c => c.rotation === 180)).toBeTrue();
  });

  it('removes an item only if present', () => {
    const a = gameCard('a');
    const items = [a, gameCard('b')];
    expect(GameSimulatorActions.removeItem(items, a)).toBeTrue();
    expect(items.length).toBe(1);
    expect(GameSimulatorActions.removeItem(items, a)).toBeFalse();
  });

  it('creates a stack from a card taken off the field', () => {
    const card = gameCard('a');
    const field = [card, gameCard('b')];
    const stack = GameSimulatorActions.createStackFromCard(field, card);
    expect(field.length).toBe(1);
    expect(stack?.cards).toEqual([card]);
    expect(stack?.pos).toEqual({ x: 10, y: 20 });
    expect(GameSimulatorActions.createStackFromCard(field, card)).toBeUndefined();
  });

  it('splits a stack in half into a new stack', () => {
    const stack = stackOf(['a', 'b', 'c', 'd'].map(id => gameCard(id)));
    const newStack = GameSimulatorActions.splitInHalf(stack, () => 0.5);
    expect(newStack?.cards.length).toBe(2);
    expect(stack.cards.length).toBe(2);
    expect(newStack?.pos).toEqual({ x: 150, y: 150 });
    expect(GameSimulatorActions.splitInHalf(stackOf([gameCard('x')]))).toBeUndefined();
  });

  it('splits a stack by attribute value, "None" for empty values', () => {
    const stack = stackOf([
      gameCard('a', { color: 'red' } as Partial<Card>),
      gameCard('b', { color: 'blue' } as Partial<Card>),
      gameCard('c', { color: 'red' } as Partial<Card>),
      gameCard('d', { color: '' } as Partial<Card>),
    ]);
    const attribute = { field: 'color', header: 'Color', type: FieldType.text } as unknown as EntityField<Card>;
    const stacks = GameSimulatorActions.splitByAttribute(stack, attribute, () => 0.5);
    expect(stacks.map(s => s.name).sort()).toEqual(['Deck None', 'Deck blue', 'Deck red']);
    expect(stacks.find(s => s.name === 'Deck red')?.cards.length).toBe(2);
    expect(stack.cards.length).toBe(0);
  });

  it('merges a stack into another', () => {
    const target = stackOf([gameCard('a')]);
    const source = stackOf([gameCard('b'), gameCard('c')], { uniqueId: 'stack-2' });
    GameSimulatorActions.mergeStacks(target, source);
    expect(target.cards.map(c => c.uniqueId)).toEqual(['a', 'b', 'c']);
    expect(source.cards.length).toBe(0);
  });
});
