import { Card } from '../data-services/types/card.type';
import { EntityField } from '../data-services/types/entity-field.type';
import { cardNumber, findNumberField, sortByNumber } from './card-order';

describe('card-order', () => {
  it('reconnaît le champ numéro (N°, Numéro, Number)', () => {
    const fields = (headers: string[]) => headers.map((header, i) => ({ header, field: `f${i}` }) as unknown as EntityField<Card>);
    expect(findNumberField(fields(['Name', 'N°', 'CardID']))).toBe('f1');
    expect(findNumberField(fields(['Numéro']))).toBe('f0');
    expect(findNumberField(fields(['Name', 'CardID']))).toBeUndefined();
  });

  it('lit le numéro de « 5/36 », « 005 » ou 5', () => {
    expect(cardNumber('5/36')).toBe(5);
    expect(cardNumber('005')).toBe(5);
    expect(cardNumber(5)).toBe(5);
    expect(cardNumber('')).toBeNull();
  });

  it('range par numéro, les cartes sans numéro à la fin', () => {
    const cards = ['28/36', '', '5/36', '6/36', '23'].map((n, id) => ({ id, name: String(id), n }) as unknown as Card);
    expect(sortByNumber(cards, 'n').map(c => c.id)).toEqual([2, 3, 4, 0, 1]);
  });
});
