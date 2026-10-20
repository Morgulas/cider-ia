import { Card } from '../data-services/types/card.type';
import { renderPrompt, suggestedSubject } from './illustration-prompt';

describe('illustration-prompt', () => {
  it('suggests a subject from the card name and description', () => {
    const card = { name: 'Fire Dragon', description: 'Breathes flames.' } as unknown as Card;
    expect(suggestedSubject(card)).toBe('"Fire Dragon". Breathes flames.');
  });

  it('ignores a missing or non-text description', () => {
    expect(suggestedSubject({ name: 'Elf', description: 3 } as unknown as Card)).toBe('"Elf".');
    expect(suggestedSubject({ name: '  ' } as unknown as Card)).toBe('');
  });

  it('fills the template and drops the lines left empty, like the server', () => {
    const template = 'Card art.\nStyle: {{style}}\n{{subject}}\nCard: {{card_name}}\n{{no_text}}\n{{unknown}}';
    expect(renderPrompt(template, { subject: ' A dragon ', style: 'watercolor', no_text: 'No text.' }))
      .toBe('Card art.\nStyle: watercolor\nA dragon\nNo text.\n{{unknown}}');
    expect(renderPrompt(template, { subject: 'A dragon', card_name: 'Smaug' }))
      .toBe('Card art.\nA dragon\nCard: Smaug\n{{unknown}}');
  });
});
