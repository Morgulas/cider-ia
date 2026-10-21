import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { ProgressBar } from 'primeng/progressbar';
import { Select } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { Tag } from 'primeng/tag';
import StringUtils from '../../shared/utils/string-utils';
import { FieldType } from '../../data-services/types/field-type.type';
import {
  CardFile, CardFileError, Conflict, DeckColumn, DefinitionType, defaultKeyColumn, FieldDefinition, ImportPlan, parseCardFile
} from '../card-transfer';
import { CardTransferService, DeckData, ImportResult } from '../card-transfer.service';
import { TrackedChangeService } from '../../server/tracked-change.service';

/** Unknown column of the file, and what to do with it */
interface NewColumn {
  column: string;
  create: boolean;
  type: DefinitionType;
  options: string[];
}

/**
 * Imports card rows from a CSV or cartes-fangh JSON file into a deck, in three
 * steps: choose the file, review what will change, apply.
 */
@Component({
  selector: 'app-card-import-dialog',
  templateUrl: './card-import-dialog.component.html',
  styleUrl: './card-import-dialog.component.scss',
  imports: [FormsModule, Dialog, Button, Checkbox, Message, ProgressBar, Select, TableModule, Tag, TranslatePipe]
})
export class CardImportDialogComponent {
  private readonly transfer = inject(CardTransferService);
  private readonly translate = inject(TranslateService);
  private readonly tracked = inject(TrackedChangeService);

  readonly visible = model(false);
  readonly deckId = input.required<number>();
  /** cards were imported: the card list should reload */
  readonly imported = output<void>();

  protected readonly step = signal<'choose' | 'review' | 'importing' | 'done'>('choose');
  protected readonly error = signal<string | null>(null);
  protected readonly dragOver = signal(false);
  protected fileName = '';
  private file: CardFile | null = null;
  private deck: DeckData | null = null;

  protected keyColumn = '';
  protected lineBreaksAsHtml = false;
  protected addMissingOptions = true;
  protected newColumns: NewColumn[] = [];
  /** fields managed in the application: never overwritten by an import (remembered per deck) */
  protected appFields = new Set<string>();
  /** conflicts resolved for the source, by "<line>:<field>" */
  protected resolutions: Record<string, 'app' | 'source'> = {};
  protected missingAction: 'ignore' | 'delete' = 'ignore';
  protected readonly plan = signal<ImportPlan | null>(null);
  protected readonly result = signal<ImportResult | null>(null);

  protected readonly typeOptions: { label: string; value: DefinitionType }[] = [];
  protected keyOptions: { label: string; value: string }[] = [];

  /** rows shown in the review: changes first */
  protected readonly reviewRows = computed(() => {
    const plan = this.plan();
    if (!plan) {
      return [];
    }
    const rank = { error: 0, update: 1, create: 2, unchanged: 3 };
    return [...plan.rows].sort((a, b) => rank[a.action] - rank[b.action] || a.line - b.line);
  });

  constructor() {
    for (const type of ['text', 'numeric', 'dropdown', 'checkbox'] as DefinitionType[]) {
      this.typeOptions.push({ label: type, value: type });
    }
  }

  protected onShow(): void {
    this.step.set('choose');
    this.error.set(null);
    this.plan.set(null);
    this.result.set(null);
    this.file = null;
    this.fileName = '';
    this.typeOptions.forEach(option => option.label = this.translate.instant(`cards-transfer.type-${option.value}`));
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.read(file);
    }
  }

  protected onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.read(file);
    }
  }

  private async read(file: File): Promise<void> {
    this.error.set(null);
    try {
      this.file = parseCardFile(await file.arrayBuffer(), file.name);
    } catch (error) {
      const detail = error instanceof CardFileError || error instanceof Error ? error.message : String(error);
      this.error.set(this.translate.instant('cards-transfer.read-failed', { error: detail }));
      return;
    }
    if (this.file.rows.length === 0) {
      this.error.set(this.translate.instant('cards-transfer.no-rows'));
      return;
    }
    this.fileName = file.name;
    this.deck = await this.transfer.load(this.deckId());
    const settings = await this.transfer.importSettings(this.deckId());
    this.keyColumn = settings.keyColumn && this.file.columns.includes(settings.keyColumn)
      ? settings.keyColumn
      : defaultKeyColumn(this.file, this.deck.columns);
    this.appFields = new Set(settings.appFields ?? []);
    this.resolutions = {};
    this.missingAction = 'ignore';
    this.keyOptions = this.file.columns.map(column => ({ label: column, value: column }));
    this.lineBreaksAsHtml = false;
    this.addMissingOptions = true;
    this.newColumns = [];
    // first plan: which columns are unknown to the deck, with a proposed attribute
    const first = this.transfer.plan(this.file, this.deck, { keyColumn: this.keyColumn, lineBreaksAsHtml: false });
    this.newColumns = first.columns
      .filter(column => column.proposal)
      .map(column => ({ column: column.column, create: true, type: column.proposal!.type, options: column.proposal!.options }));
    this.replan();
    this.step.set('review');
  }

  /** The deck columns plus the attributes about to be created, for an accurate preview */
  private previewDeck(): DeckData {
    const deck = this.deck!;
    const added: DeckColumn[] = this.newColumns.filter(c => c.create).map(c => ({
      field: StringUtils.toKebabCase(c.column),
      header: c.column,
      type: c.type as FieldType,
      options: c.type === 'dropdown' ? c.options : undefined,
    }));
    return { ...deck, columns: [...deck.columns, ...added] };
  }

  protected replan(): void {
    if (!this.file || !this.deck) {
      return;
    }
    this.plan.set(this.transfer.plan(this.file, this.previewDeck(), this.planOptions()));
  }

  private planOptions() {
    return {
      keyColumn: this.keyColumn,
      lineBreaksAsHtml: this.lineBreaksAsHtml,
      appFields: [...this.appFields],
      resolutions: this.resolutions,
    };
  }

  protected fieldOf(column: string): string | null {
    return this.plan()?.columns.find(c => c.column === column)?.target?.field ?? null;
  }

  protected isAppField(column: string): boolean {
    const field = this.fieldOf(column);
    return !!field && this.appFields.has(field);
  }

  protected toggleAppField(column: string, managed: boolean): void {
    const field = this.fieldOf(column);
    if (!field) {
      return;
    }
    if (managed) {
      this.appFields.add(field);
    } else {
      this.appFields.delete(field);
    }
    this.replan();
  }

  /** Conflicts of the plan, with their row */
  protected conflicts(): { line: number; label: string; key: string; conflict: Conflict }[] {
    return (this.plan()?.rows ?? []).flatMap(row => row.conflicts.map(conflict =>
      ({ line: row.line, label: row.label, key: row.key, conflict })));
  }

  protected resolution(line: number, field: string): 'app' | 'source' {
    return this.resolutions[`${line}:${field}`] ?? 'app';
  }

  protected resolve(line: number, field: string, choice: 'app' | 'source'): void {
    this.resolutions = { ...this.resolutions, [`${line}:${field}`]: choice };
    this.replan();
  }

  protected resolveAll(choice: 'app' | 'source'): void {
    const all: Record<string, 'app' | 'source'> = {};
    this.conflicts().forEach(c => all[`${c.line}:${c.conflict.field}`] = choice);
    this.resolutions = all;
    this.replan();
  }

  protected missingText(): string {
    const missing = this.plan()?.missing ?? [];
    return missing.slice(0, 15).map(m => `${m.key} ${m.name}`).join(' · ') + (missing.length > 15 ? ' …' : '');
  }

  protected display(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return text === '' ? '—' : text.length > 120 ? text.slice(0, 117) + '…' : text;
  }

  /** The key column is not an attribute of the deck: no card can be matched, all are created */
  protected keyNotInDeck(): boolean {
    const plan = this.plan();
    return !!plan && !plan.columns.find(c => c.column === this.keyColumn)?.target
      && !this.newColumns.some(c => c.column === this.keyColumn && c.create);
  }

  protected keyNewInDeck(): boolean {
    return this.newColumns.some(c => c.column === this.keyColumn && c.create);
  }

  protected targetOf(column: string): string | null {
    return this.plan()?.columns.find(c => c.column === column)?.target?.header ?? null;
  }

  protected newColumn(column: string): NewColumn | undefined {
    return this.newColumns.find(c => c.column === column);
  }

  protected readonly trackRow = (_: number, row: ImportPlan['rows'][number]) => row.line;

  protected changesText(row: ImportPlan['rows'][number]): string {
    if (row.action === 'error') {
      return this.translate.instant(`cards-transfer.error-${row.error}`);
    }
    if (row.action === 'create') {
      return '';
    }
    const parts = [row.changes.map(change => change.header).join(', ')];
    if (row.previousKey) {
      parts.push(this.translate.instant('cards-transfer.previous-key', { key: row.previousKey }));
    }
    if (row.kept.length) {
      parts.push(this.translate.instant('cards-transfer.kept-fields', { fields: row.kept.join(', ') }));
    }
    if (row.conflicts.length) {
      parts.push(this.translate.instant('cards-transfer.conflict-fields', { fields: row.conflicts.map(c => c.header).join(', ') }));
    }
    return parts.filter(part => part !== '').join(' · ');
  }

  protected canImport(): boolean {
    const plan = this.plan();
    return !!plan && (plan.counts.create + plan.counts.update > 0 || this.newColumns.some(c => c.create)
      || plan.rows.some(row => row.baselineChanged && row.cardId !== undefined)
      || (this.missingAction === 'delete' && plan.missing.length > 0));
  }

  protected async apply(): Promise<void> {
    if (!this.file || !this.deck) {
      return;
    }
    const deckId = this.deckId();
    const file = this.file;
    this.step.set('importing');
    this.error.set(null);
    try {
      await this.transfer.saveImportSettings(deckId, { keyColumn: this.keyColumn, appFields: [...this.appFields] });
      const label = this.translate.instant('cards-transfer.history-label', { file: this.fileName });
      const result = await this.tracked.run('import', label, async () => {
        const definitions: FieldDefinition[] = this.newColumns
          .filter(c => c.create)
          .map(c => ({ name: c.column, type: c.type, options: c.type === 'dropdown' ? c.options : [] }));
        const attributesCreated = await this.transfer.createAttributes(deckId, definitions, this.deck!.attributes);
        // plan again with the real attributes of the deck
        this.deck = await this.transfer.load(deckId);
        const plan = this.transfer.plan(file, this.deck, this.planOptions());
        const optionsAdded = this.addMissingOptions ? await this.transfer.addOptions(deckId, plan) : 0;
        const rows = await this.transfer.applyRows(deckId, plan, this.fileName, this.missingAction === 'delete');
        return { ...rows, attributesCreated, optionsAdded };
      });
      this.result.set(result);
      this.step.set('done');
      this.imported.emit();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      this.step.set('review');
      this.imported.emit();
    }
  }
}
