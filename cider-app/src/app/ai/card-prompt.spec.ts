import { CardAttribute } from '../data-services/types/card-attribute.type';
import { Card } from '../data-services/types/card.type';
import { FieldType } from '../data-services/types/field-type.type';
import { defaultPromptTemplate, promptVariables, renderCardPrompt } from './card-prompt';

const attribute = (id: number, name: string, isSystem = false): CardAttribute =>
  ({ id, deckId: 1, name, type: FieldType.text, description: '', options: [], order: id, isSystem });

describe('card prompt', () => {
  const attributes = [attribute(1, 'Name', true), attribute(2, 'Count', true), attribute(5, 'Texte de lore'),
    attribute(4, 'Rareté'), attribute(3, 'Front Template', true)];

  it('offers the name and the deck attributes as variables', () => {
    expect(promptVariables(attributes).map(v => v.token)).toEqual(
      ['{{card.name}}', '{{card.raret}}', '{{card.texte-de-lore}}', '{{deck.name}}']);
  });

  it('proposes a template listing the attributes', () => {
    expect(defaultPromptTemplate('Draw it.', attributes)).toBe(
      'Draw it.\n\nName : "{{card.name}}"\nRareté : "{{card.raret}}"\nTexte de lore : "{{card.texte-de-lore}}"');
  });

  it('fills the template with plain text, without HTML escaping', () => {
    const card = { name: 'Grimoire Niv:1', raret: 'Commune', description: 'Débloque<br>les <b>sorts</b> &amp; plus',
      'texte-de-lore': '"Ta magie !"' } as unknown as Card;
    const template = 'Titre: "{{card.name}}"\nDescription: {{card.description}}\n'
      + '{{#if card.couleur}}Couleur: {{card.couleur}}{{/if}}\nLore: {{card.texte-de-lore}} ({{deck.name}})';
    expect(renderCardPrompt(template, card, 'Livre de Fangh').text).toBe(
      'Titre: "Grimoire Niv:1"\nDescription: Débloque\nles sorts & plus\n\nLore: "Ta magie !" (Livre de Fangh)');
  });

  it('reports a template that cannot be read', () => {
    const rendered = renderCardPrompt('{{#if card.name}}open', { name: 'x' } as unknown as Card, '');
    expect(rendered.error).toBeTruthy();
  });
});
