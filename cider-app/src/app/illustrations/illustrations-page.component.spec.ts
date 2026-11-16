import { uniqueName } from './illustrations-page.component';

describe('IllustrationsPageComponent', () => {
  it('names an added file after it, without extension, unique in its folder', () => {
    const taken = new Set(['dos', 'troll']);
    expect(uniqueName('Dos.png', taken)).toBe('Dos-2');
    expect(uniqueName('dos.svg', taken)).toBe('dos-3');
    expect(uniqueName('Gobelin.webp', taken)).toBe('Gobelin');
    expect(taken.has('gobelin')).toBeTrue();
  });
});
