/**
 * Prompt template: the administrator's text that frames every illustration
 * request. Placeholders are replaced by the values of the request; a line whose
 * placeholders are all empty is left out, so optional parts disappear cleanly.
 * The same rules are applied by the client to preview the prompt.
 */

export const PROMPT_PLACEHOLDERS = ['style', 'subject', 'card_name', 'no_text'] as const;
export type PromptValues = Partial<Record<(typeof PROMPT_PLACEHOLDERS)[number], string>>;

export const NO_TEXT_INSTRUCTION = 'No text, letters, numbers, card frame or border in the image.';

export const DEFAULT_PROMPT_TEMPLATE = [
  'Illustration for a card game: a single clear subject that stays readable at small size, full-bleed artwork.',
  'Style: {{style}}',
  '{{subject}}',
  '{{no_text}}',
].join('\n');

export const PROMPT_TEMPLATE_MAX_LENGTH = 4000;

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

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
