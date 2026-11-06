import { registerHandlebarsHelpers } from '../shared/utils/handlebars-helpers';
import { checkTemplate } from './template-check';
import { buildTemplatePrompt, ChatbotPromptTexts, parseChatbotAnswer } from './template-chatbot';

describe('template check', () => {
  beforeAll(() => registerHandlebarsHelpers());

  it('accepts a valid template', () => {
    expect(checkTemplate('<div>{{card.name}}</div>\n{{#if card.niveau}}<b>{{card.niveau}}</b>{{/if}}', { name: 'A' })).toBeNull();
    expect(checkTemplate('')).toBeNull();
  });

  it('points to the block that is never closed', () => {
    const issue = checkTemplate('<div>\n{{#if card.a}}\n  <b>x</b>\n</div>');
    expect(issue?.code).toBe('unclosed-block');
    expect(issue?.params['name']).toBe('if');
    expect(issue?.line).toBe(2);
  });

  it('explains a block closed by the wrong name', () => {
    const issue = checkTemplate('<p>\n{{#if card.a}}\n{{/each}}</p>');
    expect(issue?.code).toBe('mismatched-block');
    expect(issue?.params).toEqual({ open: 'if', close: 'each' });
    expect(issue?.line).toBe(2);
  });

  it('finds a {{ that is not closed', () => {
    const issue = checkTemplate('<div>\n  <h1>{{card.name}</h1>\n</div>');
    expect(issue?.code).toBe('unclosed-tag');
    expect(issue?.line).toBe(2);
  });
});

describe('chatbot prompt', () => {
  const texts: ChatbotPromptTexts = {
    intro: 'INTRO', requestTitle: 'DEMANDE', rulesTitle: 'REGLES', rules: ['r1', 'r2'], attributesTitle: 'ATTRIBUTS',
    optionsLabel: 'valeurs', exampleLabel: 'ex.', helpersTitle: 'HELPERS', assetsTitle: 'IMAGES',
    htmlTitle: 'HTML', cssTitle: 'CSS', answerFormat: 'FORMAT',
  };

  it('holds the request, the attributes with examples, the images and the current code', () => {
    const prompt = buildTemplatePrompt({
      request: 'Mets le niveau en haut à droite', html: '<div>{{card.name}}</div>', css: '.card { color: red; }',
      deckName: 'Livres',
      variables: [
        { token: '{{card.name}}', label: 'Name', type: 'text', example: 'Grimoire' },
        { token: '{{card.classe}}', label: 'Classe', type: 'dropdown', options: ['Mage', 'Prêtre'], example: 'Mage' },
      ],
      assets: ['{{assets.parchemin}}'], helpers: ['{{eq a b}}'], texts,
    });
    expect(prompt).toContain('INTRO (Livres)');
    expect(prompt).toContain('Mets le niveau en haut à droite');
    expect(prompt).toContain('- {{card.classe}} : Classe (dropdown) — valeurs "Mage", "Prêtre" — ex. Mage');
    expect(prompt).toContain('- {{assets.parchemin}}');
    expect(prompt).toContain('```html\n<div>{{card.name}}</div>\n```');
    expect(prompt).toContain('```css\n.card { color: red; }\n```');
    expect(prompt.trim().endsWith('FORMAT')).toBeTrue();
  });

  it('reads the html and css blocks of an answer', () => {
    const answer = 'Voici le modèle :\n\n```html\n<div class="card">{{card.name}}</div>\n```\n\nEt le style :\n```css\n.card { color: blue; }\n```\nBon jeu !';
    expect(parseChatbotAnswer(answer)).toEqual({ html: '<div class="card">{{card.name}}</div>', css: '.card { color: blue; }' });
  });

  it('recognizes unlabelled and handlebars blocks, and keeps the last block of a kind', () => {
    const answer = '```\n.a { b: c; }\n```\n```handlebars\n<p>court</p>\n```\n```html\n<p>complet</p>\n```';
    expect(parseChatbotAnswer(answer)).toEqual({ css: '.a { b: c; }', html: '<p>complet</p>' });
  });

  it('leaves out what the answer does not contain', () => {
    expect(parseChatbotAnswer('```css\n.x { y: z; }\n```')).toEqual({ css: '.x { y: z; }' });
    expect(parseChatbotAnswer('pas de code')).toEqual({});
  });
});
