import { Injectable, inject } from '@angular/core';
import { CardHistoryEntry } from '../data-services/indexed-db/card-history';
import { AppDB } from '../data-services/indexed-db/db';

/** A group of journal entries: one operation (import, bulk action) or the edits of a minute */
export interface HistoryGroup {
  key: string;
  at: string;
  user: string;
  origin: CardHistoryEntry['origin'];
  label: string;
  /** set for an operation that can be undone as a whole */
  batch?: string;
  entries: CardHistoryEntry[];
}

/** Reads the card journal and undoes operations */
@Injectable({ providedIn: 'root' })
export class CardHistoryService {
  private readonly db = inject(AppDB);

  private table() {
    return this.db.table<CardHistoryEntry, number>(AppDB.CARD_HISTORY_TABLE);
  }

  /** Entries of a deck, or of some cards, newest first, grouped by operation */
  async groups(deckId: number, cardIds: number[] = [], limit = 3000): Promise<HistoryGroup[]> {
    const entries = cardIds.length
      ? await this.table().where('cardId').anyOf(cardIds).toArray()
      : await this.table().where('deckId').equals(deckId).toArray();
    entries.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    const groups: HistoryGroup[] = [];
    const byKey = new Map<string, HistoryGroup>();
    for (const entry of entries.slice(0, limit)) {
      // single edits (spreadsheet) are grouped by user and minute
      const key = entry.batch ?? `edit:${entry.user}:${entry.at.slice(0, 16)}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, at: entry.at, user: entry.user, origin: entry.origin, label: entry.label, batch: entry.batch, entries: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.entries.push(entry);
    }
    return groups;
  }

  /**
   * Undoes an operation: its entries are reversed, newest first. A field changed
   * again since is left alone (counted as skipped): undoing must not erase later work.
   */
  async undo(batch: string): Promise<{ undone: number; skipped: number }> {
    const entries = (await this.table().where('batch').equals(batch).toArray())
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    const cards = this.db.table<Record<string, unknown>, number>(AppDB.CARDS_TABLE);
    let undone = 0;
    let skipped = 0;
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
    for (const entry of entries) {
      const card = await cards.get(entry.cardId);
      if (entry.op === 'update' && entry.field) {
        if (card && same(card[entry.field], entry.after)) {
          await cards.put({ ...card, [entry.field]: entry.before });
          undone++;
        } else {
          skipped++;
        }
      } else if (entry.op === 'create') {
        if (card) {
          await cards.delete(entry.cardId);
          undone++;
        } else {
          skipped++;
        }
      } else if (entry.op === 'delete' && entry.snapshot) {
        if (!card) {
          await cards.add({ ...entry.snapshot, id: entry.cardId });
          undone++;
        } else {
          skipped++;
        }
      }
    }
    return { undone, skipped };
  }
}
