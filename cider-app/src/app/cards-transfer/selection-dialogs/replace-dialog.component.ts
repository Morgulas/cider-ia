import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { MultiSelect } from 'primeng/multiselect';
import { FieldType } from '../../data-services/types/field-type.type';
import { DeckColumn } from '../card-transfer';
import { CardTransferService } from '../card-transfer.service';
import { TrackedChangeService } from '../../server/tracked-change.service';

/** Search and replace in the text fields of the selected cards, with a count before applying */
@Component({
  selector: 'app-replace-dialog',
  templateUrl: './replace-dialog.component.html',
  styleUrl: './selection-dialogs.scss',
  imports: [FormsModule, Dialog, Button, Checkbox, InputText, Message, MultiSelect, TranslatePipe]
})
export class ReplaceDialogComponent {
  private readonly transfer = inject(CardTransferService);
  private readonly translate = inject(TranslateService);
  private readonly tracked = inject(TrackedChangeService);

  readonly visible = model(false);
  readonly deckId = input.required<number>();
  readonly ids = input.required<number[]>();
  readonly done = output<string>();

  protected columns: DeckColumn[] = [];
  protected fields: string[] = [];
  protected search = '';
  protected replacement = '';
  protected caseSensitive = false;
  protected wholeWord = false;
  protected readonly found = signal<{ cards: number; replacements: number } | null>(null);
  protected readonly busy = signal(false);
  private previewRun = 0;

  protected async onShow(): Promise<void> {
    const deck = await this.transfer.load(this.deckId());
    this.columns = deck.columns.filter(c => c.type === FieldType.text || c.type === FieldType.dropdown && !c.template);
    this.fields = this.columns.filter(c => c.type === FieldType.text).map(c => c.field);
    this.found.set(null);
  }

  /** Counts the matches (nothing is written) */
  protected async count(): Promise<void> {
    const run = ++this.previewRun;
    if (!this.search) {
      this.found.set(null);
      return;
    }
    const result = await this.transfer.replaceInCards(this.ids(), this.fields, this.search, this.replacement,
      { caseSensitive: this.caseSensitive, wholeWord: this.wholeWord }, false);
    if (run === this.previewRun) {
      this.found.set(result);
    }
  }

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      const label = this.translate.instant('cards-selection.replace-label', { search: this.search, replacement: this.replacement });
      const result = await this.tracked.run('replace', label, () => this.transfer.replaceInCards(this.ids(), this.fields,
        this.search, this.replacement, { caseSensitive: this.caseSensitive, wholeWord: this.wholeWord }, true));
      this.visible.set(false);
      this.done.emit(this.translate.instant('cards-selection.replaced', { n: result.replacements, cards: result.cards }));
    } finally {
      this.busy.set(false);
    }
  }
}
