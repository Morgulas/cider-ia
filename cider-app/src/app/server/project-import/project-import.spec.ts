import { isDexieExport, upgradeLegacyExport } from './legacy-export';
import { ProjectFile, projectRoot } from './project-files';

const file = (path: string): ProjectFile => ({ path, file: new Blob(['x']) });

describe('project import', () => {
  it('finds the project folder at the top of the selection or inside it', () => {
    const top = projectRoot([file('README.md'), file('decks/deck/cards.csv'), file('assets/a.png')]);
    expect(top?.name).toBe('');
    expect(top?.files.map(f => f.path)).toEqual(['README.md', 'decks/deck/cards.csv', 'assets/a.png']);

    const inside = projectRoot([file('Backup/My Game/README.md'), file('Backup/My Game/decks/d/cards.csv'),
      file('Backup/My Game/assets/assets/x.png'), file('Backup/other.txt')]);
    expect(inside?.name).toBe('My Game');
    expect(inside?.files.map(f => f.path)).toEqual(['README.md', 'decks/d/cards.csv', 'assets/assets/x.png']);
  });

  it('rejects a folder that is not a desktop project', () => {
    expect(projectRoot([file('photos/a.png'), file('notes.md')])).toBeNull();
  });

  it('brings a version 1 export up to the current tables', () => {
    const dump = {
      formatName: 'dexie',
      data: {
        tables: [
          { name: 'games', schema: '++id,name', rowCount: 1 },
          { name: 'cards', schema: '++id,gameId', rowCount: 1 },
          { name: 'assets', schema: '++id,gameId,name', rowCount: 1 },
          { name: 'documents', schema: '++id,name,content', rowCount: 1 },
          { name: 'printTemplates', schema: '++id,gameId', rowCount: 0 },
        ],
        data: [
          { tableName: 'games', inbound: true, rows: [{ id: 1, name: 'Deck' }] as Record<string, unknown>[] },
          { tableName: 'cards', inbound: true, rows: [{ id: 3, gameId: 1, name: 'Card' }] as Record<string, unknown>[] },
          { tableName: 'assets', inbound: true, rows: [{ id: 4, gameId: 1, name: 'img' }] as Record<string, unknown>[] },
          { tableName: 'documents', inbound: true, rows: [{ id: 5, name: 'README', content: '#' }] as Record<string, unknown>[] },
          { tableName: 'printTemplates', inbound: true, rows: [] as Record<string, unknown>[] },
        ],
      },
    };
    expect(isDexieExport(dump)).toBeTrue();
    expect(upgradeLegacyExport(dump)).toBeTrue();
    const table = (name: string) => dump.data.data.find(t => t.tableName === name)?.rows;
    expect(table('decks')).toEqual([{ id: 1, name: 'Deck' }]);
    expect(table('cards')).toEqual([{ id: 3, deckId: 1, name: 'Card' }]);
    expect(table('assets')).toEqual([{ id: 4, name: 'img' }]);
    expect(table('documents')).toEqual([{ id: 5, name: 'README', content: '#', mime: 'text/markdown' }]);
    expect(dump.data.tables.map(t => t.name).sort()).toEqual(['assets', 'cards', 'decks', 'documents']);
  });

  it('leaves a current export untouched', () => {
    const dump = {
      formatName: 'dexie',
      data: {
        tables: [{ name: 'decks', schema: '++id,name', rowCount: 1 }],
        data: [{ tableName: 'decks', inbound: true, rows: [{ id: 1, name: 'Deck' }] as Record<string, unknown>[] }],
      },
    };
    expect(upgradeLegacyExport(dump)).toBeFalse();
    expect(isDexieExport({ formatName: 'other' })).toBeFalse();
  });
});
