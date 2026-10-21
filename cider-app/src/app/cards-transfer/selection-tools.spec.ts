import { numberedIds, replaceInText, suggestNumbering } from './selection-tools';

describe('selection tools', () => {
  it('proposes the numbering of the existing identifiers', () => {
    const numbering = suggestNumbering(['LDF001', 'LDF029', 'LDF103', 'X1', '', null, 'free text']);
    expect(numbering).toEqual({ prefix: 'LDF', digits: 3, next: 104 });
    expect(numberedIds({ ...numbering, next: 30 }, 3)).toEqual(['LDF030', 'LDF031', 'LDF032']);
    expect(suggestNumbering([], 'C')).toEqual({ prefix: 'C', digits: 3, next: 1 });
  });

  it('replaces text, with case and whole-word options', () => {
    expect(replaceInText('les montres et Montres', 'montres', 'monstres', { caseSensitive: false, wholeWord: false }))
      .toEqual({ text: 'les monstres et monstres', count: 2 });
    expect(replaceInText('les montres et Montres', 'montres', 'monstres', { caseSensitive: true, wholeWord: false }))
      .toEqual({ text: 'les monstres et Montres', count: 1 });
    expect(replaceInText('épée, épées', 'épée', 'lame', { caseSensitive: false, wholeWord: true }))
      .toEqual({ text: 'lame, épées', count: 1 });
    expect(replaceInText('1+1 (x)', '(x)', '[y]', { caseSensitive: false, wholeWord: false }).text).toBe('1+1 [y]');
    expect(replaceInText('abc', '', 'z', { caseSensitive: false, wholeWord: false })).toEqual({ text: 'abc', count: 0 });
  });
});
