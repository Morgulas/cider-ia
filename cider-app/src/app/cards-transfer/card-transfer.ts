import * as XLSX from 'xlsx';
import { FieldType } from '../data-services/types/field-type.type';

/**
 * Card rows in and out of a deck, as CSV (separator ";" or ",", for a
 * spreadsheet) or as JSON in the "cartes-fangh" format (for a program or an AI):
 *
 * {
 *   "format": "cartes-fangh", "version": 1, "jeu": "<deck name>",
 *   "champs": [{ "nom": "Rareté", "type": "dropdown", "options": ["Commune", "Rare"] }],
 *   "cartes": [{ "CardID": "LDF001", "Name": "...", "Count": 1, "Front Template": "...", "Rareté": "Rare" }]
 * }
 *
 * Columns are matched with the deck's attributes by name (case and accents
 * ignored). Cards are matched with the deck's cards by a key column (CardID by
 * default): matched cards are updated, only for the columns of the file; others
 * are created; cards missing from the file are left alone.
 */

export const CARD_FILE_FORMAT = 'cartes-fangh';
export const CARD_FILE_VERSION = 1;

/** A column of the deck: system field (name, count, templates) or attribute */
export interface DeckColumn {
  /** property of the card object */
  field: string;
  /** column title: the attribute name */
  header: string;
  type: FieldType;
  /** allowed values of a dropdown */
  options?: string[];
  /** front or back template: the file holds the template name */
  template?: boolean;
}

export type DefinitionType = 'text' | 'numeric' | 'dropdown' | 'checkbox';

/** Attribute definition carried by a JSON file ("champs") */
export interface FieldDefinition {
  name: string;
  type: DefinitionType;
  options: string[];
}

export interface CardFile {
  format: 'csv' | 'json';
  columns: string[];
  rows: Record<string, unknown>[];
  definitions: FieldDefinition[];
  /** deck name found in a JSON file ("jeu") */
  deckName?: string;
}

export class CardFileError extends Error { }

const DEFINITION_TYPES: DefinitionType[] = ['text', 'numeric', 'dropdown', 'checkbox'];

/** Comparison key of a column title: case, accents, spaces and punctuation ignored */
export function headerKey(header: string): string {
  return header.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/*********************************************************************
 * Reading
 *********************************************************************/

export function parseCardFile(content: ArrayBuffer, fileName: string): CardFile {
  const text = new TextDecoder('utf-8').decode(content).replace(/^\uFEFF/, '');
  const trimmed = text.trimStart();
  if (/\.json$/i.test(fileName) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJson(text);
  }
  return parseCsv(content);
}

function parseJson(text: string): CardFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new CardFileError(`JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = data as Record<string, unknown>;
  const cards = Array.isArray(data) ? data : root?.['cartes'] ?? root?.['cards'];
  if (!Array.isArray(cards) || cards.some(card => typeof card !== 'object' || card === null || Array.isArray(card))) {
    throw new CardFileError('JSON: expected a "cartes" list of objects');
  }
  const definitions: FieldDefinition[] = [];
  const fields = Array.isArray(data) ? [] : root['champs'] ?? root['fields'];
  if (Array.isArray(fields)) {
    for (const field of fields as Record<string, unknown>[]) {
      const name = String(field?.['nom'] ?? field?.['name'] ?? '').trim();
      if (!name) {
        continue;
      }
      const type = String(field['type'] ?? 'text') as DefinitionType;
      definitions.push({
        name,
        type: DEFINITION_TYPES.includes(type) ? type : 'text',
        options: Array.isArray(field['options']) ? (field['options'] as unknown[]).map(option => String(option)) : [],
      });
    }
  }
  const columns: string[] = [];
  for (const card of cards as Record<string, unknown>[]) {
    for (const key of Object.keys(card)) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }
  return {
    format: 'json',
    columns,
    rows: cards as Record<string, unknown>[],
    definitions,
    deckName: typeof root?.['jeu'] === 'string' ? root['jeu'] as string : undefined,
  };
}

function parseCsv(content: ArrayBuffer): CardFile {
  // SheetJS finds the separator (";" or ","), reads quoted multi-line cells and the UTF-8 BOM
  const workbook = XLSX.read(content, { type: 'array', codepage: 65001, raw: true, dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  if (table.length === 0) {
    throw new CardFileError('CSV: the file is empty');
  }
  const columns = (table[0] as unknown[]).map(cell => String(cell ?? '').trim());
  const rows = table.slice(1).map(line => {
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      if (column) {
        row[column] = (line as unknown[])[index] ?? '';
      }
    });
    return row;
  });
  return { format: 'csv', columns: columns.filter(column => column !== ''), rows, definitions: [] };
}

/*********************************************************************
 * Import plan
 *********************************************************************/

export interface ColumnPlan {
  column: string;
  /** deck column the file column fills; none = ignored or to create */
  target?: DeckColumn;
  /** proposed attribute for a column the deck does not have */
  proposal?: FieldDefinition;
}

export interface FieldChange {
  header: string;
  before: unknown;
  after: unknown;
}

export interface RowPlan {
  /** 1-based line of the card in the file */
  line: number;
  key: string;
  label: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  /** existing card (update, unchanged) */
  cardId?: number;
  /** card fields to write */
  values: Record<string, unknown>;
  changes: FieldChange[];
  error?: string;
  /** field values of the file: the new reference for the next import (__source) */
  baseline: Record<string, unknown>;
  /** the reference differs from the stored one: written even if nothing else changes */
  baselineChanged: boolean;
  /** fields changed in the application while the file still has the previous value: kept */
  kept: string[];
  /** fields changed both in the application and in the file */
  conflicts: Conflict[];
  /** the card was recognized by a former identifier (renumbered in the application) */
  previousKey?: string;
}

/** A field changed both in the application and in the source since the last import */
export interface Conflict {
  field: string;
  header: string;
  /** value of the last import */
  base: unknown;
  /** value in the application */
  app: unknown;
  /** value in the file */
  file: unknown;
}

/** Reference values of the last import, stored in the card */
export interface SourceBaseline {
  file: string;
  at: string;
  values: Record<string, unknown>;
}

/** A card of the deck imported earlier from a source that no longer has it */
export interface MissingCard {
  cardId: number;
  key: string;
  name: string;
}

export interface ImportPlan {
  columns: ColumnPlan[];
  keyColumn: string;
  /** values of dropdown columns that are not among the options */
  missingOptions: { header: string; field: string; values: string[] }[];
  /** template names of the file that the deck does not have */
  unknownTemplates: string[];
  /** cards imported earlier whose identifier is no longer in the file */
  missing: MissingCard[];
  rows: RowPlan[];
  counts: { create: number; update: number; unchanged: number; error: number; conflicts: number; kept: number };
}

export interface PlanOptions {
  keyColumn: string;
  /** line breaks of text cells written as <br> (card templates are HTML) */
  lineBreaksAsHtml: boolean;
  /** fields managed in the application: filled on creation, never overwritten */
  appFields?: string[];
  /** choice for each conflict, by "<line>:<field>"; the application value by default */
  resolutions?: Record<string, 'app' | 'source'>;
}

interface ExistingCard {
  id: number;
  [field: string]: unknown;
}

/** The key column proposed for a file: CardID-like if any, otherwise the name */
export function defaultKeyColumn(file: CardFile, deckColumns: DeckColumn[]): string {
  const preferred = ['cardid', 'id', 'code', 'ref', 'reference'];
  for (const wanted of preferred) {
    const column = file.columns.find(c => headerKey(c) === wanted);
    if (column) {
      return column;
    }
  }
  const nameColumn = file.columns.find(c => matchColumn(c, deckColumns)?.field === 'name');
  return nameColumn ?? file.columns[0] ?? '';
}

export function matchColumn(column: string, deckColumns: DeckColumn[]): DeckColumn | undefined {
  const key = headerKey(column);
  return deckColumns.find(deckColumn => deckColumn.header === column)
    ?? deckColumns.find(deckColumn => headerKey(deckColumn.header) === key)
    ?? deckColumns.find(deckColumn => headerKey(deckColumn.field) === key);
}

/** Proposed attribute for an unknown column: the JSON definition, or a guess from the values */
export function proposeDefinition(column: string, file: CardFile): FieldDefinition {
  const defined = file.definitions.find(d => headerKey(d.name) === headerKey(column));
  if (defined) {
    return { ...defined, name: column };
  }
  const values = file.rows.map(row => cellText(row[column])).filter(value => value !== '');
  const numeric = values.length > 0 && values.every(value => /^-?\d+([.,]\d+)?$/.test(value));
  return { name: column, type: numeric ? 'numeric' : 'text', options: [] };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\r\n?/g, '\n').trim();
}

const TRUE_VALUES = /^(true|vrai|oui|yes|x|1)$/i;

/** Value of a file cell converted for a deck column; undefined = not usable */
function convert(value: unknown, column: DeckColumn, options: PlanOptions,
  templateIds: Map<string, number>): { value?: unknown; templateName?: string } {
  const text = cellText(value);
  if (column.template) {
    if (text === '') {
      return { value: undefined };
    }
    const id = templateIds.get(headerKey(text));
    return id === undefined ? { templateName: text } : { value: id };
  }
  if (column.field === 'count') {
    const count = Number.parseInt(text, 10);
    return { value: Number.isFinite(count) && count >= 0 ? count : 1 };
  }
  switch (column.type) {
    case FieldType.numeric: {
      if (text === '') {
        return { value: null };
      }
      const number = Number(text.replace(',', '.'));
      return { value: Number.isFinite(number) ? number : text };
    }
    case FieldType.checkbox:
      return { value: typeof value === 'boolean' ? value : TRUE_VALUES.test(text) };
    default:
      return { value: options.lineBreaksAsHtml ? text.replace(/\n/g, '<br>') : text };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown) => value === null || value === undefined ? '' : String(value);
  return normalize(a) === normalize(b);
}

/**
 * What the import would do, without changing anything. Columns to create are
 * listed as proposals; their values are only applied once the attributes exist
 * (the plan is computed again with the new deck columns).
 */
export function planImport(file: CardFile, deckColumns: DeckColumn[], templates: { id: number; name: string }[],
  cards: ExistingCard[], options: PlanOptions): ImportPlan {
  const templateIds = new Map(templates.map(template => [headerKey(template.name), template.id]));
  const columns: ColumnPlan[] = file.columns.map(column => {
    const target = matchColumn(column, deckColumns);
    return target ? { column, target } : { column, proposal: proposeDefinition(column, file) };
  });
  const keyTarget = columns.find(c => c.column === options.keyColumn)?.target;

  const existing = new Map<string, ExistingCard>();
  const previous = new Map<string, ExistingCard>();
  if (keyTarget) {
    for (const card of cards) {
      const key = cellText(card[keyTarget.field]);
      if (key && !existing.has(key)) {
        existing.set(key, card);
      }
      const former = card['__previousIds'];
      if (Array.isArray(former)) {
        former.forEach(id => previous.has(String(id)) || previous.set(String(id), card));
      }
    }
  }
  const appFields = new Set(options.appFields ?? []);

  const missingOptions = new Map<string, Set<string>>();
  const unknownTemplates = new Set<string>();
  const seenKeys = new Set<string>();
  const matched = new Set<number>();
  const rows: RowPlan[] = file.rows.map((row, index) => {
    const key = cellText(row[options.keyColumn]);
    const nameColumn = columns.find(c => c.target?.field === 'name')?.column;
    const label = nameColumn ? cellText(row[nameColumn]) : key;
    const plan: RowPlan = { line: index + 1, key, label: label || key, action: 'create', values: {}, changes: [],
      baseline: {}, baselineChanged: true, kept: [], conflicts: [] };
    if (!key) {
      return { ...plan, action: 'error', error: 'missing-key' };
    }
    if (seenKeys.has(key)) {
      return { ...plan, action: 'error', error: 'duplicate-key' };
    }
    seenKeys.add(key);

    for (const column of columns) {
      if (!column.target || !(column.column in row)) {
        continue;
      }
      const converted = convert(row[column.column], column.target, options, templateIds);
      if (converted.templateName) {
        unknownTemplates.add(converted.templateName);
        continue;
      }
      if (converted.value === undefined) {
        continue;
      }
      const target = column.target;
      if (target.type === FieldType.dropdown && !target.template && target.options
        && converted.value !== '' && !target.options.includes(String(converted.value))) {
        const values = missingOptions.get(target.field) ?? new Set<string>();
        values.add(String(converted.value));
        missingOptions.set(target.field, values);
      }
      plan.values[target.field] = converted.value;
    }
    plan.baseline = { ...plan.values };

    let card = keyTarget ? existing.get(key) : undefined;
    if (!card && keyTarget) {
      card = previous.get(key);
      if (card) {
        plan.previousKey = key;
      }
    }
    if (!card || matched.has(card.id)) {
      if (plan.values['name'] === undefined || plan.values['name'] === '') {
        plan.values['name'] = key;
      }
      if (plan.values['count'] === undefined) {
        plan.values['count'] = 1;
      }
      return plan;
    }
    matched.add(card.id);
    plan.cardId = card.id;
    if (plan.previousKey && keyTarget) {
      // the application renumbered the card: its identifier is the application's
      delete plan.values[keyTarget.field];
    }
    const stored = (card['__source'] as SourceBaseline | undefined)?.values;
    plan.baselineChanged = !stored || Object.entries(plan.baseline).some(([field, value]) => !sameValue(stored[field], value));
    const header = (field: string) => deckColumns.find(c => c.field === field)?.header ?? field;
    const write: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(plan.values)) {
      const app = card[field];
      if (sameValue(app, value)) {
        continue;
      }
      if (appFields.has(field)) {
        continue;
      }
      const base = stored && field in stored ? stored[field] : undefined;
      const hasBase = !!stored && field in stored;
      if (!hasBase || sameValue(app, base)) {
        // first import of this field, or changed only in the source
        write[field] = value;
      } else if (sameValue(value, base)) {
        // changed only in the application: kept
        plan.kept.push(header(field));
      } else {
        plan.conflicts.push({ field, header: header(field), base, app, file: value });
        if (options.resolutions?.[`${plan.line}:${field}`] === 'source') {
          write[field] = value;
        }
      }
    }
    plan.values = write;
    for (const [field, value] of Object.entries(write)) {
      plan.changes.push({ header: header(field), before: card[field], after: value });
    }
    plan.action = plan.changes.length > 0 ? 'update' : 'unchanged';
    return plan;
  });

  // cards imported earlier (they have a reference) that the file no longer lists
  const missing: MissingCard[] = keyTarget
    ? cards
      .filter(card => card['__source'] && !matched.has(card.id) && cellText(card[keyTarget.field]) !== '')
      .map(card => ({ cardId: card.id, key: cellText(card[keyTarget.field]), name: cellText(card['name']) }))
    : [];

  const counts = { create: 0, update: 0, unchanged: 0, error: 0, conflicts: 0, kept: 0 };
  rows.forEach(row => {
    counts[row.action]++;
    counts.conflicts += row.conflicts.length;
    counts.kept += row.kept.length;
  });
  return {
    columns,
    keyColumn: options.keyColumn,
    missingOptions: [...missingOptions.entries()].map(([field, values]) => ({
      field,
      header: deckColumns.find(c => c.field === field)?.header ?? field,
      values: [...values],
    })),
    unknownTemplates: [...unknownTemplates],
    missing,
    rows,
    counts,
  };
}

/*********************************************************************
 * Export
 *********************************************************************/

function exportValue(card: Record<string, unknown>, column: DeckColumn, templateNames: Map<number, string>): unknown {
  const value = card[column.field];
  if (column.template) {
    return templateNames.get(value as number) ?? '';
  }
  return value === null || value === undefined ? '' : value;
}

/** CSV for a spreadsheet: ";" separator, UTF-8 with BOM (accents shown right in Excel), CRLF */
export function exportCsv(deckColumns: DeckColumn[], cards: Record<string, unknown>[],
  templates: { id: number; name: string }[]): string {
  const templateNames = new Map(templates.map(template => [template.id, template.name]));
  const quote = (value: unknown) => {
    const text = String(value ?? '');
    return /[";\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [deckColumns.map(column => quote(column.header)).join(';')];
  for (const card of cards) {
    lines.push(deckColumns.map(column => quote(exportValue(card, column, templateNames))).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/** JSON in the cartes-fangh format, with the attribute definitions */
export function exportJson(deckName: string, deckColumns: DeckColumn[], cards: Record<string, unknown>[],
  templates: { id: number; name: string }[]): string {
  const templateNames = new Map(templates.map(template => [template.id, template.name]));
  const systemFields = ['name', 'count', 'frontCardTemplateId', 'backCardTemplateId'];
  const definitionType = (type: FieldType): DefinitionType =>
    type === FieldType.numeric || type === FieldType.dropdown || type === FieldType.checkbox ? type : 'text';
  const content = {
    format: CARD_FILE_FORMAT,
    version: CARD_FILE_VERSION,
    jeu: deckName,
    champs: deckColumns
      .filter(column => !systemFields.includes(column.field))
      .map(column => ({ nom: column.header, type: definitionType(column.type), options: column.options ?? [] })),
    cartes: cards.map(card => {
      const row: Record<string, unknown> = {};
      for (const column of deckColumns) {
        row[column.header] = exportValue(card, column, templateNames);
      }
      return row;
    }),
  };
  return JSON.stringify(content, null, 2) + '\n';
}
