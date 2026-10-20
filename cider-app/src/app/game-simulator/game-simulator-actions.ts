import { Card } from '../data-services/types/card.type';
import { EntityField } from '../data-services/types/entity-field.type';
import StringUtils from '../shared/utils/string-utils';
import { CardStack, GameCard, Positionable } from './game-simulator.types';

/**
 * Board operations of the game simulator, independent of the display:
 * they only change the stacks and cards they are given, so they can be
 * unit-tested and reused (e.g. by an AI playtester) without a browser.
 */
export default class GameSimulatorActions {

  /** Shuffles the cards in place (Fisher-Yates) */
  static shuffleCards(cards: GameCard[], random: () => number = Math.random): void {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }

  /** Rotates a stack and every card in it, so cards drawn from it keep the rotation */
  static rotateStack(stack: CardStack, angle: number): void {
    stack.rotation = (stack.rotation || 0) + angle;
    stack.cards.forEach(card => card.rotation = stack.rotation);
  }

  static rotateCard(card: GameCard, angle: number): void {
    card.rotation = (card.rotation || 0) + angle;
  }

  /** Removes an item from a list; returns false when it was not in it */
  static removeItem<T extends Positionable>(items: T[], item: T): boolean {
    const index = items.indexOf(item);
    if (index < 0) {
      return false;
    }
    items.splice(index, 1);
    return true;
  }

  /**
   * Takes a card out of a list (usually the field) and returns a new stack
   * holding only that card, at the card's position. Undefined if the card is not in the list.
   */
  static createStackFromCard(cards: GameCard[], card: GameCard): CardStack | undefined {
    if (!GameSimulatorActions.removeItem(cards, card)) {
      return undefined;
    }
    return {
      uniqueId: StringUtils.generateRandomString(),
      name: 'stack-' + StringUtils.generateRandomString(3),
      cards: [card],
      faceUp: card.faceUp,
      pos: { x: card.pos.x, y: card.pos.y },
      rotation: card.rotation,
      deletable: true,
    };
  }

  /**
   * Moves part of a stack into a new stack placed next to it.
   * Undefined when the stack has fewer than 2 cards.
   */
  static splitInHalf(stack: CardStack, random: () => number = Math.random): CardStack | undefined {
    if (stack.cards.length < 2) {
      return undefined;
    }
    const half = Math.floor(stack.cards.length / 2);
    const cards = stack.cards.splice(half - 1, half);
    return {
      uniqueId: StringUtils.generateRandomString(),
      name: stack.name + ' copy',
      cards: cards,
      faceUp: false,
      pos: {
        x: stack.pos.x + 50 + (random() * 20 - 10),
        y: stack.pos.y + 50 + (random() * 20 - 10)
      },
      deletable: true,
    };
  }

  /**
   * Splits a stack into one new stack per value of a card attribute.
   * The cards are moved out of the original stack; the new stacks are returned.
   */
  static splitByAttribute(stack: CardStack, attribute: EntityField<Card>,
    random: () => number = Math.random): CardStack[] {
    if (stack.cards.length < 2) {
      return [];
    }
    const valueOf = (gameCard: GameCard) => (gameCard.card as unknown as Record<string, unknown>)[attribute.field as string];
    const uniqueValues = Array.from(new Set(stack.cards.map(valueOf)));

    const newStacks: CardStack[] = uniqueValues.map((value) => {
      const displayValue = (value === undefined || value === null
        || (typeof value === 'string' && value.trim() === '')) ? 'None' : String(value);
      return {
        uniqueId: StringUtils.generateRandomString(),
        name: stack.name + ' ' + displayValue,
        cards: stack.cards.filter(gameCard => valueOf(gameCard) === value),
        faceUp: false,
        pos: {
          x: stack.pos.x + (random() * 100 - 50),
          y: stack.pos.y + (random() * 100 - 50)
        },
        deletable: true,
      };
    }).filter(cardStack => cardStack.cards.length > 0);

    stack.cards = stack.cards.filter(gameCard => !newStacks.some(newStack => newStack.cards.includes(gameCard)));
    return newStacks;
  }

  /** Moves every card of the source stack onto the target stack */
  static mergeStacks(target: CardStack, source: CardStack): void {
    target.cards.push(...source.cards);
    source.cards = [];
  }
}
