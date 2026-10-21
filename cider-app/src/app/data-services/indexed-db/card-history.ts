/**
 * Journal of the changes made to cards, stored in the project (table
 * "cardHistory", saved and versioned with it).
 *
 * Entries are produced by Dexie hooks on the cards table (db.ts), so every
 * change is recorded whatever made it: spreadsheet, import, bulk action...
 * The code doing an operation describes it with runInHistoryContext(): its
 * entries then share an origin, a label and a batch id, which allows undoing
 * the whole operation.
 */

export type HistoryOrigin = 'edit' | 'import' | 'bulk' | 'renumber' | 'replace' | 'transfer' | 'duplicate'
  | 'delete' | 'undo' | 'illustration';

export interface CardHistoryEntry {
  id?: number;
  /** ISO date */
  at: string;
  user: string;
  origin: HistoryOrigin;
  /** what the operation was, e.g. "Import de livres.json" */
  label: string;
  /** entries of the same operation; undefined for single edits */
  batch?: string;
  op: 'create' | 'update' | 'delete';
  cardId: number;
  deckId: number;
  /** card name and identifier at the time of the change, to read the journal */
  cardName: string;
  cardKey: string;
  /** update: one field */
  field?: string;
  before?: unknown;
  after?: unknown;
  /** create and delete: the whole card (a deleted card can be restored) */
  snapshot?: Record<string, unknown>;
}

export interface HistoryContext {
  origin: HistoryOrigin;
  label: string;
  batch?: string;
}

/** Fields that identify a card for the source of the data: their former values are kept */
export const IDENTIFIER_FIELDS = ['cardid', 'card-id', 'code', 'ref', 'reference'];

/** Fields of a card that are not user data (bookkeeping), never journaled */
export function isInternalField(field: string): boolean {
  return field === 'id' || field.startsWith('__');
}

const MAX_ENTRIES = 5000;

class CardHistoryRecorder {
  user = '';
  private context: HistoryContext = { origin: 'edit', label: '' };
  private pending: CardHistoryEntry[] = [];
  private writer: ((entries: CardHistoryEntry[]) => Promise<void>) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  /** Set by the database: how entries are stored */
  setWriter(writer: (entries: CardHistoryEntry[]) => Promise<void>): void {
    this.writer = writer;
  }

  get current(): HistoryContext {
    return this.context;
  }

  async run<T>(origin: HistoryOrigin, label: string, action: () => Promise<T>): Promise<T> {
    const previous = this.context;
    this.context = { origin, label, batch: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
    try {
      return await action();
    } finally {
      this.context = previous;
      await this.flush();
    }
  }

  record(entry: Omit<CardHistoryEntry, 'at' | 'user' | 'origin' | 'label' | 'batch'>): void {
    this.pending.push({
      ...entry,
      at: new Date().toISOString(),
      user: this.user,
      origin: this.context.origin,
      label: this.context.label,
      batch: this.context.batch,
    });
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), 0);
    }
  }

  /** Writes the pending entries (outside the transaction of the card change) */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const entries = this.pending;
    this.pending = [];
    if (entries.length > 0 && this.writer) {
      const writer = this.writer;
      this.writing = this.writing.then(() => writer(entries)).catch(error => console.error('card history', error));
    }
    return this.writing;
  }

  /** Forgets what was not written yet (a project is being replaced) */
  discard(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = [];
  }

  get maxEntries(): number {
    return MAX_ENTRIES;
  }
}

export const cardHistory = new CardHistoryRecorder();

/** Runs an operation on cards; its changes are journaled together, with this label */
export function runInHistoryContext<T>(origin: HistoryOrigin, label: string, action: () => Promise<T>): Promise<T> {
  return cardHistory.run(origin, label, action);
}

/** Name and identifier of a card, for the journal */
export function describeCard(card: Record<string, unknown>): { cardName: string; cardKey: string } {
  const key = IDENTIFIER_FIELDS.map(field => card[field]).find(value => value !== undefined && value !== null && value !== '');
  return { cardName: String(card['name'] ?? ''), cardKey: key === undefined ? '' : String(key) };
}
