import * as Handlebars from 'handlebars';
import { CardAttribute } from '../data-services/types/card-attribute.type';
import { Card } from '../data-services/types/card.type';
import StringUtils from '../shared/utils/string-utils';

/** A variable offered in the prompt template editor */
export interface PromptVariable {
  /** text inserted in the template, e.g. {{card.rarete}} */
  token: string;
  /** attribute name shown to the user */
  label: string;
}

/**
 * The card attributes usable in a prompt, with the same names as in card
 * templates: {{card.name}}, then {{card.<attribute in kebab-case>}}.
 * Count and front/back templates are left out: they say nothing about the picture.
 */
export function promptVariables(attributes: CardAttribute[]): PromptVariable[] {
  const sorted = [...attributes].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
  return [
    { token: '{{card.name}}', label: sorted.find(a => a.isSystem && a.name === 'Name')?.name ?? 'Name' },
    ...sorted
      .filter(attribute => !attribute.isSystem)
      .map(attribute => ({ token: `{{card.${StringUtils.toKebabCase(attribute.name)}}}`, label: attribute.name })),
    { token: '{{deck.name}}', label: 'Deck' },
  ];
}

/**
 * Template proposed when the deck has none yet: an instruction, then one line
 * per attribute, which the user then adapts (art direction, universe...).
 */
export function defaultPromptTemplate(intro: string, attributes: CardAttribute[]): string {
  const lines = promptVariables(attributes)
    .filter(variable => variable.token !== '{{deck.name}}')
    .map(variable => `${variable.label} : "${variable.token}"`);
  return `${intro}\n\n${lines.join('\n')}`;
}

/** Card values as plain text: HTML markup (bold, line breaks...) does not belong in a prompt */
function plainText(value: unknown): unknown {
  if (typeof value !== 'string' || !/[<&]/.test(value)) {
    return value;
  }
  const withBreaks = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  const parsed = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (parsed.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export interface RenderedPrompt {
  text: string;
  /** set when the template cannot be read (unbalanced {{#if}}...) */
  error?: string;
}

/**
 * Fills the deck's prompt template with a card. Same Handlebars syntax as the
 * card templates ({{card.description}}, {{#if card.lore}}...{{/if}}), without
 * HTML escaping: the result is plain text to copy into a chatbot.
 */
export function renderCardPrompt(template: string, card: Card, deckName: string): RenderedPrompt {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(card as unknown as Record<string, unknown>)) {
    values[key] = plainText(value);
  }
  try {
    const text = Handlebars.compile(template, { noEscape: true })({ card: values, deck: { name: deckName } });
    return { text: text.replace(/\n{3,}/g, '\n\n').trim() };
  } catch (error) {
    return { text: '', error: error instanceof Error ? error.message : String(error) };
  }
}
