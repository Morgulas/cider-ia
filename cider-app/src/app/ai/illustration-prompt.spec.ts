import { Card } from '../data-services/types/card.type';
import { buildIllustrationPrompt, NO_TEXT_INSTRUCTION, suggestedSubject } from './illustration-prompt';

describe('illustration-prompt', () => {
  it('suggests a subject from the card name and description', () => {
    const card = { name: 'Fire Dragon', description: 'Breathes flames.' } as unknown as Card;
    expect(suggestedSubject(card)).toBe('Illustration of "Fire Dragon" for a card game. Breathes flames.');
  });

  it('ignores a missing or non-text description', () => {
    expect(suggestedSubject({ name: 'Elf', description: 3 } as unknown as Card))
      .toBe('Illustration of "Elf" for a card game.');
    expect(suggestedSubject({ name: '  ' } as unknown as Card)).toBe('Illustration for a card game.');
  });

  it('builds the prompt with the style first and the no-text instruction last', () => {
    expect(buildIllustrationPrompt(' watercolor ', 'A dragon', true))
      .toBe(`Style: watercolor\n\nA dragon\n\n${NO_TEXT_INSTRUCTION}`);
  });

  it('leaves out empty parts', () => {
    expect(buildIllustrationPrompt('', ' A dragon ', false)).toBe('A dragon');
  });
});
