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
  CardFile, CardFileError, DeckColumn, DefinitionType, defaultKeyColumn, FieldDefinition, ImportPlan, parseCardFile
} from '../card-transfer';
import { CardTransferService, DeckData, ImportResult } from '../card-transfer.service';

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
    this.keyColumn = defaultKeyColumn(this.file, this.deck.columns);
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
    this.plan.set(this.transfer.plan(this.file, this.previewDeck(),
      { keyColumn: this.keyColumn, lineBreaksAsHtml: this.lineBreaksAsHtml }));
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
    return row.changes.map(change => change.header).join(', ');
  }

  protected canImport(): boolean {
    const plan = this.plan();
    return !!plan && (plan.counts.create + plan.counts.update > 0 || this.newColumns.some(c => c.create));
  }

  protected async apply(): Promise<void> {
    if (!this.file || !this.deck) {
      return;
    }
    const deckId = this.deckId();
    this.step.set('importing');
    this.error.set(null);
    try {
      const definitions: FieldDefinition[] = this.newColumns
        .filter(c => c.create)
        .map(c => ({ name: c.column, type: c.type, options: c.type === 'dropdown' ? c.options : [] }));
      const attributesCreated = await this.transfer.createAttributes(deckId, definitions, this.deck.attributes);
      // plan again with the real attributes of the deck
      this.deck = await this.transfer.load(deckId);
      const plan = this.transfer.plan(this.file, this.deck,
        { keyColumn: this.keyColumn, lineBreaksAsHtml: this.lineBreaksAsHtml });
      const optionsAdded = this.addMissingOptions ? await this.transfer.addOptions(deckId, plan) : 0;
      const { created, updated } = await this.transfer.applyRows(deckId, plan);
      this.result.set({ created, updated, attributesCreated, optionsAdded });
      this.step.set('done');
      this.imported.emit();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      this.step.set('review');
      this.imported.emit();
    }
  }
}
