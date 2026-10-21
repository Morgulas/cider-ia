import { Injectable, inject } from '@angular/core';
import { CardAttributesService } from '../data-services/services/card-attributes.service';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { CardsService } from '../data-services/services/cards.service';
import { CardAttribute } from '../data-services/types/card-attribute.type';
import { Card } from '../data-services/types/card.type';
import { DropdownOption } from '../data-services/types/dropdown-option.type';
import { FieldType } from '../data-services/types/field-type.type';
import { DecksService } from '../data-services/services/decks.service';
import { DeckImportSettings } from '../data-services/types/deck.type';
import {
  CardFile, DeckColumn, DefinitionType, SourceBaseline, exportCsv, exportJson, FieldDefinition, ImportPlan, planImport, PlanOptions
} from './card-transfer';
import { replaceInText, ReplaceOptions } from './selection-tools';

export interface DeckData {
  columns: DeckColumn[];
  templates: { id: number; name: string }[];
  cards: Card[];
  attributes: CardAttribute[];
}

export interface ImportResult {
  created: number;
  updated: number;
  deleted: number;
  attributesCreated: number;
  optionsAdded: number;
}

/** Reads and writes the cards of a deck for the import and export of card rows */
@Injectable({ providedIn: 'root' })
export class CardTransferService {
  private readonly cards = inject(CardsService);
  private readonly attributes = inject(CardAttributesService);
  private readonly templates = inject(CardTemplatesService);
  private readonly decks = inject(DecksService);

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

  /**
   * Creates and updates the cards; only the fields of the file are written
   * (minus kept local edits, application-managed fields and conflicts resolved
   * for the application). The file values become each card's reference for
   * the next import (__source). Cards no longer in the source can be deleted.
   */
  async applyRows(deckId: number, plan: ImportPlan, fileName: string, deleteMissing = false)
    : Promise<{ created: number; updated: number; deleted: number }> {
    let created = 0;
    let updated = 0;
    let deleted = 0;
    const at = new Date().toISOString();
    for (const row of plan.rows) {
      const source: SourceBaseline = { file: fileName, at, values: row.baseline };
      if (row.action === 'create') {
        await this.cards.create({ ...row.values, deckId, __source: source } as unknown as Card, true);
        created++;
      } else if ((row.action === 'update' || row.action === 'unchanged' && row.baselineChanged)
        && row.cardId !== undefined) {
        const card = (await this.cards.getAllUnfiltered({ id: row.cardId }))[0];
        if (card) {
          await this.cards.update(card.id, { ...card, ...row.values, __source: source } as unknown as Card, true);
          if (row.action === 'update') {
            updated++;
          }
        }
      }
    }
    if (deleteMissing) {
      for (const card of plan.missing) {
        await this.cards.delete(card.cardId);
        deleted++;
      }
    }
    return { created, updated, deleted };
  }

  /** Import settings remembered per deck (identifier column, application-managed fields) */
  async saveImportSettings(deckId: number, settings: DeckImportSettings): Promise<void> {
    const deck = await this.decks.get(deckId);
    if (deck) {
      await this.decks.update(deckId, { ...deck, importSettings: settings });
    }
  }

  async importSettings(deckId: number): Promise<DeckImportSettings> {
    return (await this.decks.get(deckId))?.importSettings ?? {};
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
      delete copy['__source'];
      delete copy['__previousIds'];
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

  /** Writes the given identifiers in a field, card by card (ids and values in the same order) */
  async renumber(ids: number[], field: string, values: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await this.setField([ids[i]], field, values[i]);
    }
  }

  /**
   * Search and replace in text fields of cards. With apply false nothing is
   * written: returns how many replacements would be made, and in how many cards.
   */
  async replaceInCards(ids: number[], fields: string[], search: string, replacement: string,
    options: ReplaceOptions, apply: boolean): Promise<{ cards: number; replacements: number }> {
    let cards = 0;
    let replacements = 0;
    for (const id of ids) {
      const card = (await this.cards.getAllUnfiltered({ id }))[0] as unknown as Record<string, unknown> | undefined;
      if (!card) {
        continue;
      }
      const changes: Record<string, unknown> = {};
      for (const field of fields) {
        const value = card[field];
        if (typeof value !== 'string') {
          continue;
        }
        const result = replaceInText(value, search, replacement, options);
        if (result.count > 0) {
          changes[field] = result.text;
          replacements += result.count;
        }
      }
      if (Object.keys(changes).length > 0) {
        cards++;
        if (apply) {
          await this.cards.update(id, { ...card, ...changes } as unknown as Card, true);
        }
      }
    }
    return { cards, replacements };
  }

  /**
   * Copies (or moves) cards to another deck. Attributes are matched by name;
   * those the target deck lacks are created there (same type and options) when
   * asked, otherwise their values are left behind. Templates are matched by
   * name; returns the template names the target deck does not have.
   */
  async transferCards(sourceDeckId: number, targetDeckId: number, ids: number[], move: boolean,
    createAttributes: boolean): Promise<{ transferred: number; attributesCreated: number; missingTemplates: string[] }> {
    const source = await this.load(sourceDeckId);
    let target = await this.load(targetDeckId);
    const key = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const attributeColumns = source.columns.filter(c => !c.template && !['name', 'count'].includes(c.field));

    let attributesCreated = 0;
    if (createAttributes) {
      const missing = attributeColumns.filter(c => !target.columns.some(t => key(t.header) === key(c.header)));
      const definitions = missing.map(c => ({
        name: c.header,
        type: (['numeric', 'dropdown', 'checkbox'].includes(c.type) ? c.type : 'text') as DefinitionType,
        options: c.options ?? [],
      }));
      attributesCreated = await this.createAttributes(targetDeckId, definitions, target.attributes);
      if (attributesCreated > 0) {
        target = await this.load(targetDeckId);
      }
    }

    const fieldMap = new Map<string, string>();
    for (const column of attributeColumns) {
      const match = target.columns.find(t => !t.template && key(t.header) === key(column.header));
      if (match) {
        fieldMap.set(column.field, match.field);
      }
    }
    const templateIds = new Map(target.templates.map(t => [key(t.name), t.id]));
    const sourceTemplateNames = new Map(source.templates.map(t => [t.id, t.name]));
    const missingTemplates = new Set<string>();
    const templateFor = (id: number | undefined) => {
      const name = id === undefined ? undefined : sourceTemplateNames.get(id);
      if (!name) {
        return undefined;
      }
      const targetId = templateIds.get(key(name));
      if (targetId === undefined) {
        missingTemplates.add(name);
      }
      return targetId;
    };

    let transferred = 0;
    for (const id of ids) {
      const card = source.cards.find(c => c.id === id) as unknown as Record<string, unknown> | undefined;
      if (!card) {
        continue;
      }
      const copy: Record<string, unknown> = {
        deckId: targetDeckId,
        name: card['name'],
        count: card['count'] ?? 1,
        frontCardTemplateId: templateFor(card['frontCardTemplateId'] as number | undefined),
        backCardTemplateId: templateFor(card['backCardTemplateId'] as number | undefined),
      };
      for (const [from, to] of fieldMap) {
        if (card[from] !== undefined) {
          copy[to] = card[from];
        }
      }
      await this.cards.create(copy as unknown as Card, true);
      if (move) {
        await this.cards.delete(id);
      }
      transferred++;
    }
    return { transferred, attributesCreated, missingTemplates: [...missingTemplates] };
  }
}
