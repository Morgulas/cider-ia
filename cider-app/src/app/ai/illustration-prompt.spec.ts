import { renderPrompt } from './illustration-prompt';

describe('illustration-prompt', () => {
  it('fills the template and drops the lines left empty, like the server', () => {
    const template = 'Card art.\nStyle: {{style}}\n{{subject}}\nCard: {{card_name}}\n{{no_text}}\n{{unknown}}';
    expect(renderPrompt(template, { subject: ' A dragon ', style: 'watercolor', no_text: 'No text.' }))
      .toBe('Card art.\nStyle: watercolor\nA dragon\nNo text.\n{{unknown}}');
    expect(renderPrompt(template, { subject: 'A dragon', card_name: 'Smaug' }))
      .toBe('Card art.\nA dragon\nCard: Smaug\n{{unknown}}');
  });
});
