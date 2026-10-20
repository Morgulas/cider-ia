import * as Handlebars from 'handlebars';
import { HandlebarsPipe } from './handlebars.pipe';

describe('HandlebarsPipe', () => {
  let pipe: HandlebarsPipe;
  const run = (template: string, context: any = {}) => Handlebars.compile(template)(context);

  beforeEach(() => {
    pipe = new HandlebarsPipe();
  });

  it('renders asset urls and drops !important (global styles)', () => {
    const css = pipe.transform('.bg { background: url({{assets.cave}}) !important; }', { cave: 'blob:x' });
    expect(css).toBe('.bg { background: url(blob:x) ; }');
  });

  it('returns an empty string for empty input', () => {
    expect(pipe.transform('')).toBe('');
  });

  describe('helpers', () => {
    it('compares values', () => {
      expect(run('{{#if (eq a 1)}}y{{else}}n{{/if}}', { a: 1 })).toBe('y');
      expect(run('{{#if (gt a 1)}}y{{else}}n{{/if}}', { a: 1 })).toBe('n');
      expect(run('{{#if (and a b)}}y{{else}}n{{/if}}', { a: true, b: false })).toBe('n');
      expect(run('{{#if (or a b)}}y{{else}}n{{/if}}', { a: true, b: false })).toBe('y');
    });

    it('does arithmetic', () => {
      expect(run('{{add 2 3}}')).toBe('5');
      expect(run('{{sub 5 3}}')).toBe('2');
      expect(run('{{multiply 4 3}}')).toBe('12');
      expect(run('{{divide 9 3}}')).toBe('3');
    });

    it('formats text', () => {
      expect(run('{{uppercase "apple"}}')).toBe('APPLE');
      expect(run('{{lowercase "APPLE"}}')).toBe('apple');
      expect(run('{{kebabcase "Big Apple"}}')).toBe('big-apple');
    });

    it('repeats a block', () => {
      expect(run('{{#repeat 3}}x{{/repeat}}')).toBe('xxx');
    });

    it('looks up an asset by name', () => {
      expect(run('{{index assets "red-apple"}}', { assets: { 'red-apple': 'blob:a' } })).toBe('blob:a');
    });

    it('compile: replaces placeholders with escaped image tags', () => {
      const out = run('{{compile text width=20}}', {
        text: 'Pay {{coin 2}}',
        assets: { coin: 'blob:c' }
      });
      expect(out).toBe('Pay <img src="blob:c" width="20"/><img src="blob:c" width="20"/>');
    });

    it('compile: drops placeholders for unknown assets', () => {
      expect(run('{{compile text}}', { text: 'Pay {{nothing}}', assets: {} })).toBe('Pay ');
    });
  });
});
