import { EntityField } from '../data-services/types/entity-field.type';
import { Card } from '../data-services/types/card.type';
import { fieldOf } from '../data-services/types/entity-service.type';

/** Noms d'attribut reconnus comme numéro de carte (sans accents, ponctuation ni espaces). */
const NUMBER_ATTRIBUTE_NAMES = ['n', 'no', 'num', 'numero', 'number', 'cardnumber', 'numerocarte', 'numcarte'];

function key(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Le champ « numéro de carte » du deck (N°, Numéro, Number...), s'il y en a un. */
export function findNumberField(fields: EntityField<Card>[]): string | undefined {
  const field = fields.find(f => NUMBER_ATTRIBUTE_NAMES.includes(key(String(f.header ?? ''))));
  return field ? String(field.field) : undefined;
}

/** Le numéro d'une valeur : 5, « 5 », « 5/36 », « 005 », « #5 » donnent 5 ; sinon aucun. */
export function cardNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /\d+(?:[.,]\d+)?/.exec(value);
  return match ? parseFloat(match[0].replace(',', '.')) : null;
}

/**
 * Les cartes rangées par numéro (ordre stable : à numéro égal, l'ordre d'origine) ;
 * les cartes sans numéro restent à la fin, dans leur ordre d'origine.
 */
export function sortByNumber<T extends Card>(cards: T[], field: string | undefined): T[] {
  if (!field) {
    return cards;
  }
  return cards
    .map((card, index) => ({ card, index, n: cardNumber(fieldOf(card, field)) }))
    .sort((a, b) => {
      if (a.n === null || b.n === null) {
        return a.n === b.n ? a.index - b.index : a.n === null ? 1 : -1;
      }
      return a.n - b.n || a.index - b.index;
    })
    .map(entry => entry.card);
}
