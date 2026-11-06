import { CardHistoryEntry, cardHistory, entriesOverBudget, MAX_AGE_DAYS } from './card-history';
import { AppDB } from './db';

const entry = (id: number, size: number, at = new Date().toISOString()): CardHistoryEntry => ({
  id, at, user: 'steve', origin: 'edit', label: '', op: 'update', cardId: 1, deckId: 1, cardName: 'x', cardKey: '',
  field: 'lore', after: 'y'.repeat(size),
});

describe('card journal size', () => {
  it('keeps the newest entries within the byte budget', () => {
    const entries = [entry(1, 1000), entry(2, 1000), entry(3, 1000)];
    const one = JSON.stringify(entries[0]).length;
    expect(entriesOverBudget(entries, one * 2 + 10)).toEqual([1]);
    expect(entriesOverBudget(entries, one * 10)).toEqual([]);
  });

  describe('in the local copy', () => {
    let db: AppDB;

    beforeEach(async () => {
      db = new AppDB();
      await db.loadProject(null);
    });

    afterEach(async () => {
      await db.loadProject(null);
      db.close();
    });

    it('removes entries older than the kept period when new ones are written', async () => {
      const table = db.table(AppDB.CARD_HISTORY_TABLE);
      const old = new Date(Date.now() - (MAX_AGE_DAYS + 5) * 24 * 3600 * 1000).toISOString();
      await table.bulkAdd([entry(1, 10, old), entry(2, 10, old), entry(3, 10)].map(({ id: _id, ...rest }) => rest));
      // a card change: its journal entry triggers the cleanup
      const cardId = await db.table(AppDB.CARDS_TABLE).add({ deckId: 1, name: 'Grimoire', count: 1 });
      await cardHistory.flush();
      const left = await table.toArray();
      expect(left.every(item => item.at > old)).toBeTrue();
      expect(left.some(item => item.cardId === cardId && item.op === 'create')).toBeTrue();
      expect(left.length).toBe(2);
    });
  });
});
