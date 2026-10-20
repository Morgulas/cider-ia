/**
 * Brings a database export of an older CIDEr version up to the current tables,
 * as the database upgrades of the application would: the import only accepts
 * the tables the application has today.
 *  - version 1: "games" became "decks", "gameId" became "deckId", "printTemplates" was dropped
 *  - version 3: documents had no "mime" (only markdown existed)
 * Other conversions (attribute types, asset format...) are done when the project opens.
 */

interface TableExport {
  tableName: string;
  inbound?: boolean;
  rows: Record<string, unknown>[];
}

interface DexieExport {
  formatName: string;
  data: {
    databaseVersion?: number;
    tables: { name: string; schema: string; rowCount: number }[];
    data: TableExport[];
  };
}

const CURRENT_TABLES = ['decks', 'cards', 'assets', 'cardTemplates', 'cardAttributes', 'documents', 'assetFolders'];

export function isDexieExport(value: unknown): value is DexieExport {
  const data = (value as DexieExport | null)?.data;
  return (value as DexieExport | null)?.formatName === 'dexie' && !!data
    && Array.isArray(data.tables) && Array.isArray(data.data);
}

/** Returns true if the export was changed */
export function upgradeLegacyExport(dump: DexieExport): boolean {
  let changed = false;
  const tables = dump.data.tables;
  const data = dump.data.data;

  const games = data.find(table => table.tableName === 'games');
  if (games) {
    let decks = data.find(table => table.tableName === 'decks');
    if (!decks) {
      decks = { tableName: 'decks', inbound: games.inbound, rows: [] };
      data.push(decks);
      tables.push({ name: 'decks', schema: '++id,name', rowCount: 0 });
    }
    decks.rows.push(...games.rows);
    changed = true;
  }
  for (const table of data) {
    for (const row of table.rows) {
      if ('gameId' in row) {
        if (table.tableName !== 'assets' && row['deckId'] === undefined) {
          row['deckId'] = row['gameId'];
        }
        delete row['gameId'];
        changed = true;
      }
      if (table.tableName === 'documents' && !row['mime']) {
        row['mime'] = 'text/markdown';
        changed = true;
      }
    }
  }

  const before = data.length;
  dump.data.data = data.filter(table => CURRENT_TABLES.includes(table.tableName));
  dump.data.tables = tables.filter(table => CURRENT_TABLES.includes(table.name));
  for (const table of dump.data.tables) {
    table.rowCount = dump.data.data.find(entry => entry.tableName === table.name)?.rows.length ?? 0;
  }
  return changed || dump.data.data.length !== before;
}
