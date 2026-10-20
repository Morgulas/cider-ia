import { Card } from '../data-services/types/card.type';

/** Placeholders of the prompt template (same list as the server) */
export const PROMPT_PLACEHOLDERS = ['style', 'subject', 'card_name', 'no_text'] as const;
export type PromptValues = Partial<Record<(typeof PROMPT_PLACEHOLDERS)[number], string>>;

/** Subject suggested for a card's illustration: its name and, if any, its description */
export function suggestedSubject(card: Card): string {
  const values = card as unknown as Record<string, unknown>;
  const description = typeof values['description'] === 'string' ? values['description'].trim() : '';
  const name = (card.name ?? '').trim();
  return [name ? `"${name}".` : '', description].filter(part => part !== '').join(' ');
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Fills the prompt template, as the server does: a line whose placeholders are
 * all empty is left out. Used to preview the prompt sent to the image service.
 */
export function renderPrompt(template: string, values: PromptValues): string {
  const lines = template.split(/\r?\n/).flatMap(line => {
    let placeholders = 0;
    let filled = 0;
    const rendered = line.replace(PLACEHOLDER, (match, name: string) => {
      if (!(PROMPT_PLACEHOLDERS as readonly string[]).includes(name)) {
        return match;
      }
      placeholders++;
      const value = (values[name as keyof PromptValues] ?? '').trim();
      if (value) {
        filled++;
      }
      return value;
    });
    return placeholders > 0 && filled === 0 ? [] : [rendered.trimEnd()];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
