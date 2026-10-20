import { Card } from '../data-services/types/card.type';

/** Sentence added to ask for a clean illustration, the card template providing the frame and texts */
export const NO_TEXT_INSTRUCTION = 'No text, letters, numbers, card frame or border in the image.';

/** Subject suggested for a card's illustration: its name and, if any, its description */
export function suggestedSubject(card: Card): string {
  const values = card as unknown as Record<string, unknown>;
  const description = typeof values['description'] === 'string' ? values['description'].trim() : '';
  const name = (card.name ?? '').trim();
  return [name ? `Illustration of "${name}" for a card game.` : 'Illustration for a card game.', description]
    .filter(part => part !== '')
    .join(' ');
}

/** The text sent to the image service: the project style, then the subject */
export function buildIllustrationPrompt(style: string, subject: string, noText: boolean): string {
  return [style.trim() ? `Style: ${style.trim()}` : '', subject.trim(), noText ? NO_TEXT_INSTRUCTION : '']
    .filter(part => part !== '')
    .join('\n\n');
}
