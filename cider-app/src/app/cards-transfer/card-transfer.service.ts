import { Injectable, inject } from '@angular/core';
import { CardAttributesService } from '../data-services/services/card-attributes.service';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { CardsService } from '../data-services/services/cards.service';
import { CardAttribute } from '../data-services/types/card-attribute.type';
import { Card } from '../data-services/types/card.type';
import { DropdownOption } from '../data-services/types/dropdown-option.type';
import { FieldType } from '../data-services/types/field-type.type';
import {
  CardFile, DeckColumn, exportCsv, exportJson, FieldDefinition, ImportPlan, planImport, PlanOptions
} from './card-transfer';

export interface DeckData {
  columns: DeckColumn[];
  templates: { id: number; name: string }[];
  cards: Card[];
  attributes: CardAttribute[];
}

export interface ImportResult {
  created: number;
  updated: number;
  attributesCreated: number;
  optionsAdded: number;
}

/** Reads and writes the cards of a deck for the import and export of card rows */
@Injectable({ providedIn: 'root' })
export class CardTransferService {
  private readonly cards = inject(CardsService);
  private readonly attributes = inject(CardAttributesService);
  private readonly templates = inject(CardTemplatesService);

  /** Columns of the deck in the order of its attributes, its templates and its cards */
  async load(deckId: number): Promise<DeckData> {
    const [fields, attributes, templates, cards] = await Promise.all([
      this.cards.getFieldsUnfiltered({ deckId }),
      this.attributes.getAllUnfiltered({ deckId }),
      this.templates.getAllUnfiltered({ deckId }),
      this.cards.getAllUnfiltered({ deckId }),
    ]);
    // attribute order, as in the card list (the system attributes come first)
    const order = new Map(attributes.map(a => [a.name, a.order ?? a.id]));
    const columns: DeckColumn[] = fields
      .filter(field => !field.hidden)
      .map(field => ({
        field: String(field.field),
        header: field.header,
        type: field.type,
        options: field.type === FieldType.dropdown && !field.service
          ? ((field.options ?? []) as DropdownOption[]).map(option => option.value)
          : undefined,
        template: !!field.service,
      }));
    columns.sort((a, b) => (order.get(a.header) ?? 0) - (order.get(b.header) ?? 0));
    return {
      columns,
      templates: templates.map(t => ({ id: t.id, name: t.name })),
      cards: cards.sort((a, b) => a.id - b.id),
      attributes,
    };
  }

  plan(file: CardFile, deck: DeckData, options: PlanOptions): ImportPlan {
    return planImport(file, deck.columns, deck.templates,
      deck.cards as unknown as { id: number;[field: string]: unknown }[], options);
  }

  /** Creates the attributes chosen for the unknown columns, after the existing ones */
  async createAttributes(deckId: number, definitions: FieldDefinition[], existing: CardAttribute[]): Promise<number> {
    let order = Math.max(0, ...existing.map(a => a.order ?? a.id));
    for (const definition of definitions) {
      await this.attributes.create({
        deckId,
        name: definition.name,
        type: definition.type as FieldType,
        description: '',
        options: definition.type === 'dropdown' ? definition.options as unknown as DropdownOption[] : [],
        width: 135,
        order: ++order,
      } as CardAttribute, true);
    }
    return definitions.length;
  }

  /** Adds the missing values to the options of dropdown attributes */
  async addOptions(deckId: number, plan: ImportPlan): Promise<number> {
    let added = 0;
    const attributes = await this.attributes.getAllUnfiltered({ deckId });
    for (const missing of plan.missingOptions) {
      const attribute = attributes.find(a => a.name === missing.header);
      if (!attribute) {
        continue;
      }
      const options = this.attributes.normalizeDropdownOptions(attribute.options);
      const values = missing.values.filter(value => !options.some(option => option.value === value));
      if (values.length > 0) {
        await this.attributes.update(attribute.id,
          { ...attribute, options: [...options, ...values.map(value => value as unknown as DropdownOption)] }, true);
        added += values.length;
      }
    }
    return added;
  }

  /** Creates and updates the cards; only the fields of the file are written */
  async applyRows(deckId: number, plan: ImportPlan): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    for (const row of plan.rows) {
      if (row.action === 'create') {
        await this.cards.create({ ...row.values, deckId } as unknown as Card, true);
        created++;
      } else if (row.action === 'update' && row.cardId !== undefined) {
        const current = await this.cards.getAllUnfiltered({ id: row.cardId });
        const card = current[0];
        if (card) {
          await this.cards.update(card.id, { ...card, ...row.values } as Card, true);
          updated++;
        }
      }
    }
    return { created, updated };
  }

  /** The cards of the deck, or only those whose id is given, in the order of the ids */
  async export(deckId: number, deckName: string, format: 'csv' | 'json', ids?: number[]): Promise<Blob> {
    const deck = await this.load(deckId);
    const selected = ids
      ? ids.map(id => deck.cards.find(card => card.id === id)).filter((card): card is Card => !!card)
      : deck.cards;
    const cards = selected as unknown as Record<string, unknown>[];
    return format === 'csv'
      ? new Blob([exportCsv(deck.columns, cards, deck.templates)], { type: 'text/csv;charset=utf-8' })
      : new Blob([exportJson(deckName, deck.columns, cards, deck.templates)], { type: 'application/json' });
  }

  /*********************************************************************
   * Actions on a selection of cards
   *********************************************************************/

  async deleteCards(ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.cards.delete(id);
    }
  }

  /**
   * Copies of the cards, named "<name> (copie)". Identifier-like attributes
   * (CardID...) are emptied: two cards must not share an identifier.
   */
  async duplicateCards(deckId: number, ids: number[], suffix: string): Promise<number> {
    const deck = await this.load(deckId);
    const identifiers = deck.columns.filter(column => ['cardid', 'id', 'code', 'ref', 'reference']
      .includes(column.header.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')));
    let created = 0;
    for (const id of ids) {
      const card = deck.cards.find(c => c.id === id);
      if (!card) {
        continue;
      }
      const copy = { ...card } as unknown as Record<string, unknown>;
      delete copy['id'];
      copy['name'] = `${card.name ?? ''} ${suffix}`.trim();
      identifiers.forEach(column => copy[column.field] = '');
      await this.cards.create(copy as unknown as Card, true);
      created++;
    }
    return created;
  }

  /** Gives the same value to one field of several cards */
  async setField(ids: number[], field: string, value: unknown): Promise<void> {
    for (const id of ids) {
      const card = (await this.cards.getAllUnfiltered({ id }))[0];
      if (card) {
        await this.cards.update(id, { ...card, [field]: value } as Card, true);
      }
    }
  }
}
