import { registerHandlebarsHelpers } from '../shared/utils/handlebars-helpers';
import { checkTemplate } from './template-check';
import { buildTemplatePrompt, ChatbotPromptTexts, parseChatbotAnswer } from './template-chatbot';
import { annotateLines, findCssVariables, formatColorLike, formatCss, matchableSelector, parseCssRules, pickOverflowCards, splitSelectorList } from './template-tools';

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

describe('template tools', () => {
  it('formats CSS without touching Handlebars', () => {
    const css = '.card{width:825px;background:url("{{assets.fond}}");}\n{{#if card.rare}}.card .title{color:gold}{{/if}}';
    expect(formatCss(css)).toBe(
      '.card {\n    width:825px;\n    background:url("{{assets.fond}}");\n}\n\n{{#if card.rare}}\n.card .title {\n    color:gold\n}\n\n{{/if}}\n');
  });

  it('marks each tag with its source line', () => {
    const html = '<div class="card">\n  {{#if card.a}}<b>{{card.a}}</b>{{/if}}\n  <!-- <i> -->\n  <img src="x">\n</div>';
    const annotated = annotateLines(html);
    expect(annotated).toContain('<div data-cider-line="1" class="card">');
    expect(annotated).toContain('<b data-cider-line="2">');
    expect(annotated).toContain('<!-- <i> -->');
    expect(annotated).toContain('<img data-cider-line="4" src="x">');
    expect(annotated).toContain('{{#if card.a}}');
  });

  it('finds CSS variables and the control that fits them', () => {
    const css = ':root { --titre: hsl(40, 80%, 50%); /* --old: red; */ --taille: 48px; --police: "Cinzel", serif }\n.card { --titre: blue; }';
    const variables = findCssVariables(css);
    expect(variables.map(v => [v.name, v.kind])).toEqual([['--titre', 'color'], ['--taille', 'length'], ['--police', 'text']]);
    const size = variables[1];
    expect([size.number, size.unit]).toEqual([48, 'px']);
    expect(css.slice(size.start, size.end)).toBe('48px');
    expect(css.slice(variables[2].start, variables[2].end)).toBe('"Cinzel", serif');
  });

  it('keeps the color format the value used', () => {
    expect(formatColorLike('hsl(0, 0%, 0%)', '#ff0000')).toBe('hsl(0, 100%, 50%)');
    expect(formatColorLike('rgb(0,0,0)', '#00ff00')).toBe('rgb(0, 255, 0)');
    expect(formatColorLike('#000', '#0000ff')).toBe('#0000ff');
  });

  it('picks the cards most likely to overflow', () => {
    const cards = [
      { id: 1, name: 'A', description: 'court' },
      { id: 2, name: 'Un nom vraiment très long', description: '' },
      { id: 3, name: 'B', description: 'une description <b>très</b> longue qui prend de la place' },
    ];
    const fields = [{ key: 'name', label: 'Nom' }, { key: 'description', label: 'Description' }];
    const picked = pickOverflowCards(cards, fields, cards[0]);
    expect(picked.map(p => p.card.id)).toEqual([1, 2, 3]);
    expect(picked[0].reasons).toContain({ kind: 'current' });
    expect(picked[0].reasons).toContain({ kind: 'shortest' });
    expect(picked[1].reasons).toContain({ kind: 'longest', field: 'Nom' });
    expect(picked[2].reasons).toContain({ kind: 'longest', field: 'Description' });
    expect(picked[2].reasons).toContain({ kind: 'total' });
  });
});

describe('CSS rules for the inspector', () => {
  it('lists style rules with their lines, inside @media too', () => {
    const css = [
      '@import url("https://fonts.googleapis.com/css2?family=Cinzel");',
      '/* .ignored { } */',
      '.card {',
      '  background: url("{{assets.fond}}");',
      '}',
      '@media print {',
      '  .card .title, .card h1 { color: black; }',
      '}',
      '@font-face { font-family: X; src: url(x.woff); }',
      '{{#if card.rare}}.card .title::after { content: "★"; }{{/if}}',
    ].join('\n');
    expect(parseCssRules(css).map(rule => [rule.selector, rule.line, rule.endLine])).toEqual([
      ['.card', 3, 5],
      ['.card .title, .card h1', 7, 7],
      ['.card .title::after', 10, 10],
    ]);
  });

  it('prepares selectors for matching', () => {
    expect(splitSelectorList('.a, .b:not(.c, .d)')).toEqual(['.a', '.b:not(.c, .d)']);
    expect(matchableSelector('.card .title::after')).toBe('.card .title');
    expect(matchableSelector('a:hover')).toBe('a');
    expect(matchableSelector('::selection')).toBeUndefined();
  });
});
