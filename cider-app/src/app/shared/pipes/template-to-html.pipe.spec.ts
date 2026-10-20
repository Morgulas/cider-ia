import { DomSanitizer } from '@angular/platform-browser';
import { HandlebarsPipe } from './handlebars.pipe';
import { CardToHtmlPipe } from './template-to-html.pipe';
import { CardTemplate } from 'src/app/data-services/types/card-template.type';
import { Card } from 'src/app/data-services/types/card.type';

describe('CardToHtmlPipe', () => {
  // stand-in for Angular's DomSanitizer: returns the string it is asked to trust
  const fakeSanitizer = { bypassSecurityTrustHtml: (value: string) => value } as unknown as DomSanitizer;
  let pipe: CardToHtmlPipe;

  // renders a template for a card and returns the resulting html string
  const render = (html: string, css: string, card: any, assets: any = {}): string =>
    pipe.transform({ html, css } as CardTemplate, card as Card, assets, 'u1') as unknown as string;

  beforeEach(() => {
    // the Handlebars helpers (compile, eq, add...) are registered by HandlebarsPipe
    new HandlebarsPipe(fakeSanitizer);
    pipe = new CardToHtmlPipe(fakeSanitizer);
  });

  it('returns an empty string without template or card', () => {
    expect(pipe.transform(undefined as any, {} as Card) as unknown).toBe('');
    expect(pipe.transform({ html: 'x', css: 'y' } as CardTemplate, undefined as any) as unknown).toBe('');
  });

  it('renders card data into the template', () => {
    const out = render('<div class="name">{{card.name}}</div>', '.name { color: red; }', { name: 'Apple' });
    expect(out).toContain('<div class="name">Apple</div>');
  });

  it('scopes the css to the card and drops !important', () => {
    const out = render('<div class="name">x</div>', '.name { color: red !important; }', {});
    expect(out).toContain('<style>');
    expect(out).toContain('.card-preview.card-u1 .name');
    expect(out).not.toContain('!important');
  });

  it('escapes card data rendered with double braces', () => {
    const out = render('<div>{{card.name}}</div>', 'a {}', { name: '<img src=x onerror=alert(1)>' });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('removes scripts and event handlers from the template', () => {
    const out = render('<script>alert(1)</script><img src="x" onerror="alert(1)"><div>ok</div>', 'a {}', {});
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
    expect(out).toContain('<div>ok</div>');
  });

  it('keeps html from card data rendered raw, without its event handlers', () => {
    const out = render('<div>{{{card.text}}}</div>', 'a {}', { text: '<b>bold</b><img src=x onerror=alert(1)>' });
    expect(out).toContain('<b>bold</b>');
    expect(out).not.toContain('onerror');
  });

  it('does not let the css break out of its style block', () => {
    const out = render('<div>x</div>', 'a {}</style><img src=x onerror=alert(1)><style>', {});
    expect(out).not.toContain('onerror');
  });

  it('replaces asset placeholders with images in compiled card text', () => {
    const out = render('<p>{{compile card.text width=20}}</p>', 'a {}',
      { text: 'Gain {{apple 2}} <i>now</i><svg onload=alert(1)></svg>' },
      { apple: 'blob:http://localhost/abc' });
    const images = out.match(/<img src="blob:http:\/\/localhost\/abc" width="20">/g) || [];
    expect(images.length).toBe(2);
    expect(out).toContain('<i>now</i>');
    expect(out).not.toContain('onload');
  });
});
