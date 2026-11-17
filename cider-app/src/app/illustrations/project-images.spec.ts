import { readProjectImages, targetPath } from './project-images';

const ref = (n: number) => ({ $ciderBlob: String(n).repeat(64).slice(0, 64), type: 'image/png', size: 10 });

describe('project-images', () => {
  it('lit les images par bibliothèque, la commune d\'abord', () => {
    const json = JSON.stringify({
      formatName: 'dexie',
      data: {
        data: [
          { tableName: 'decks', rows: [{ id: 7, name: 'Flocongers' }] },
          { tableName: 'assets', rows: [
            { id: 1, name: 'or', path: 'icones', buffer: ref(1), type: 'image/png' },
            { id: 2, name: 'flocon', path: '', deckId: 7, buffer: ref(2), type: 'image/webp' },
            { id: 3, name: 'argent', path: 'icones', buffer: ref(3) },
            { id: 4, name: 'sans-fichier', path: '' },
          ] },
        ],
      },
    });
    const libraries = readProjectImages(json);
    expect(libraries.map(l => l.name)).toEqual(['', 'Flocongers']);
    expect(libraries[0].images.map(i => i.name)).toEqual(['argent', 'or']);
    expect(libraries[1].images[0].file.type).toBe('image/webp');
  });

  it('range sous le dossier affiché, en gardant ou non le dossier d\'origine', () => {
    expect(targetPath('', 'icones', true)).toBe('icones');
    expect(targetPath('import', 'icones', true)).toBe('import/icones');
    expect(targetPath('import', 'icones', false)).toBe('import');
    expect(targetPath('', '', true)).toBe('');
  });
});
