import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { Button } from 'primeng/button';
import { Card as Card_1 } from 'primeng/card';
import { Checkbox } from 'primeng/checkbox';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { InputNumber } from 'primeng/inputnumber';
import { Menu } from 'primeng/menu';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { defaultPromptTemplate, renderCardPrompt } from '../ai/card-prompt';
import { DeckColumn } from '../cards-transfer/card-transfer';
import { CardImportDialogComponent } from '../cards-transfer/card-import-dialog/card-import-dialog.component';
import { CardTransferService } from '../cards-transfer/card-transfer.service';
import { RenumberDialogComponent } from '../cards-transfer/selection-dialogs/renumber-dialog.component';
import { ReplaceDialogComponent } from '../cards-transfer/selection-dialogs/replace-dialog.component';
import { TransferDialogComponent } from '../cards-transfer/selection-dialogs/transfer-dialog.component';
import { DecksService } from '../data-services/services/decks.service';
import { EntitySpreadsheetComponent } from '../entity-spreadsheet/entity-spreadsheet.component';
import { copyText } from '../shared/utils/clipboard';
import FileUtils from '../shared/utils/file-utils';

/**
 * Card list of a deck: the spreadsheet, plus import/export of card rows and
 * actions on the selected rows (export, edit a field, duplicate, copy the
 * illustration prompts, delete).
 */
@Component({
    selector: 'app-cards',
    templateUrl: './cards.component.html',
    styleUrls: ['./cards.component.scss'],
    providers: [ConfirmationService],
    imports: [Card_1, Button, Menu, Message, Dialog, Select, Checkbox, InputNumber, Textarea, ConfirmDialog, FormsModule,
        TranslatePipe, EntitySpreadsheetComponent, CardImportDialogComponent, RenumberDialogComponent,
        TransferDialogComponent, ReplaceDialogComponent]
})
export class CardsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transfer = inject(CardTransferService);
  private readonly decks = inject(DecksService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);

  private readonly sheet = viewChild(EntitySpreadsheetComponent);

  protected readonly deckId = Number(this.route.snapshot.paramMap.get('deckId'));
  protected importVisible = false;
  /** the spreadsheet loads its rows once: it is rebuilt after changes made outside it */
  protected readonly showSheet = signal(true);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ severity: 'success' | 'error'; text: string } | null>(null);
  /**
   * Cards of the last selection made in the spreadsheet. Kept when the user
   * clicks elsewhere (the spreadsheet then clears its own selection), so the
   * toolbar, its menus and dialogs still act on it; cleared with the × button.
   */
  protected readonly selection = signal<number[]>([]);

  constructor() {
    this.moreItems = [
      { label: this.translate.instant('cards-selection.renumber'), icon: 'pi pi-sort-numeric-up',
        command: () => void this.openDialog(() => this.renumberVisible = true) },
      { label: this.translate.instant('cards-selection.transfer'), icon: 'pi pi-arrow-right-arrow-left',
        command: () => void this.openDialog(() => this.transferVisible = true) },
      { label: this.translate.instant('cards-selection.replace'), icon: 'pi pi-search',
        command: () => void this.openDialog(() => this.replaceVisible = true) },
      { separator: true },
      { label: this.translate.instant('cards-selection.print'), icon: 'pi pi-file-pdf',
        command: () => void this.printSelection() },
    ];
    effect(() => {
      const ids = this.sheet()?.selectedCardIds() ?? [];
      if (ids.length > 0) {
        this.selection.set(ids);
      }
    });
  }

  /** Opens a selection dialog once the pending spreadsheet edits are written */
  private async openDialog(show: () => void): Promise<void> {
    await this.sheet()?.flush();
    this.actionIds.set([...this.selection()]);
    show();
  }

  /** A dialog changed cards: message, then the spreadsheet is reloaded */
  protected afterAction(text: string): void {
    this.message.set({ severity: 'success', text });
    this.reload();
  }

  /** Card export page (PDF, images) limited to the selected cards */
  protected async printSelection(): Promise<void> {
    await this.sheet()?.flush();
    await this.router.navigate(['/decks', this.deckId, 'export-cards'], { queryParams: { ids: this.selection().join(',') } });
  }

  protected clearSelection(): void {
    this.selection.set([]);
  }

  protected readonly exportItems: MenuItem[] = [
    { label: 'CSV', icon: 'pi pi-file-excel', command: () => void this.export('csv', this.selection()) },
    { label: 'JSON', icon: 'pi pi-code', command: () => void this.export('json', this.selection()) },
  ];

  /** cards a dialog acts on, taken when it opens */
  protected readonly actionIds = signal<number[]>([]);
  protected renumberVisible = false;
  protected transferVisible = false;
  protected replaceVisible = false;
  protected moreItems: MenuItem[] = [];

  // bulk edit
  protected bulkVisible = false;
  protected bulkColumns: DeckColumn[] = [];
  protected bulkTemplates: { id: number; name: string }[] = [];
  protected bulkColumn: DeckColumn | null = null;
  protected bulkValue: unknown = null;

  protected reload(): void {
    this.selection.set([]);
    this.showSheet.set(false);
    setTimeout(() => this.showSheet.set(true));
  }

  private async deckName(): Promise<string> {
    return (await this.decks.get(this.deckId))?.name ?? 'cartes';
  }

  /** Runs an action on the cards after the pending spreadsheet edits are written */
  private async run(action: () => Promise<string | void>, reload = true): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await this.sheet()?.flush();
      const info = await action();
      if (info) {
        this.message.set({ severity: 'success', text: info });
      }
      if (reload) {
        this.reload();
      }
    } catch (error) {
      this.message.set({ severity: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      this.busy.set(false);
    }
  }

  /** Card rows as CSV (spreadsheet) or JSON (cartes-fangh): the whole deck, or the given cards */
  protected export(format: 'csv' | 'json', ids?: number[]): Promise<void> {
    return this.run(async () => {
      const name = await this.deckName();
      const blob = await this.transfer.export(this.deckId, name, format, ids);
      const base = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'cartes';
      FileUtils.saveAs(blob, `${base}${ids ? '-' + this.translate.instant('cards-selection.file-suffix') : ''}.${format}`);
    }, false);
  }

  protected confirmDelete(): void {
    const ids = [...this.selection()];
    this.confirmation.confirm({
      header: this.translate.instant('cards-selection.delete'),
      message: this.translate.instant('cards-selection.delete-confirm', { n: ids.length }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('cards-selection.delete'),
      rejectLabel: this.translate.instant('controls.cancel'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => void this.run(async () => {
        await this.transfer.deleteCards(ids);
        return this.translate.instant('cards-selection.deleted', { n: ids.length });
      }),
    });
  }

  protected duplicate(): Promise<void> {
    const ids = [...this.selection()];
    return this.run(async () => {
      const created = await this.transfer.duplicateCards(this.deckId, ids,
        this.translate.instant('cards-selection.copy-suffix'));
      return this.translate.instant('cards-selection.duplicated', { n: created });
    });
  }

  protected async openBulkEdit(): Promise<void> {
    await this.sheet()?.flush();
    const deck = await this.transfer.load(this.deckId);
    this.bulkColumns = deck.columns.filter(column => column.field !== 'name');
    this.bulkTemplates = deck.templates;
    this.bulkColumn = null;
    this.bulkValue = null;
    this.bulkVisible = true;
  }

  protected applyBulkEdit(): Promise<void> {
    const column = this.bulkColumn;
    const ids = [...this.selection()];
    if (!column) {
      return Promise.resolve();
    }
    let value = this.bulkValue;
    if (column.type === 'checkbox') {
      value = value === true;
    } else if (value === null || value === undefined) {
      value = column.type === 'numeric' || column.template ? null : '';
    }
    return this.run(async () => {
      await this.transfer.setField(ids, column.field, value);
      this.bulkVisible = false;
      return this.translate.instant('cards-selection.edited', { n: ids.length, field: column.header });
    });
  }

  /**
   * Illustration prompts of the selected cards, one after the other, to paste
   * into a chatbot in one go (it can then produce the images in turn).
   */
  protected copyPrompts(): Promise<void> {
    const ids = [...this.selection()];
    return this.run(async () => {
      const deck = await this.transfer.load(this.deckId);
      const deckEntity = await this.decks.get(this.deckId);
      const template = deckEntity?.illustrationPrompt
        || defaultPromptTemplate(this.translate.instant('server.ai.prompt-default-intro'), deck.attributes);
      const prompts = ids
        .map(id => deck.cards.find(card => card.id === id))
        .filter(card => !!card)
        .map(card => `### ${card!.name}\n\n${renderCardPrompt(template, card!, deckEntity?.name ?? '').text}`);
      const done = await copyText(prompts.join('\n\n---\n\n'));
      if (!done) {
        throw new Error(this.translate.instant('server.ai.copy-failed'));
      }
      return this.translate.instant('cards-selection.prompts-copied', { n: prompts.length });
    }, false);
  }
}
