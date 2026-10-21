import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { InputNumber } from 'primeng/inputnumber';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { FieldType } from '../../data-services/types/field-type.type';
import { DeckColumn, headerKey } from '../card-transfer';
import { CardTransferService, DeckData } from '../card-transfer.service';
import { numberedIds, suggestNumbering } from '../selection-tools';
import { TrackedChangeService } from '../../server/tracked-change.service';

/**
 * Gives the selected cards consecutive identifiers (LDF030, LDF031...), in
 * the order of the selection. Refused if an identifier is used by another card.
 */
@Component({
  selector: 'app-renumber-dialog',
  templateUrl: './renumber-dialog.component.html',
  styleUrl: './selection-dialogs.scss',
  imports: [FormsModule, Dialog, Button, Checkbox, InputNumber, InputText, Message, Select, TranslatePipe]
})
export class RenumberDialogComponent {
  private readonly transfer = inject(CardTransferService);
  private readonly translate = inject(TranslateService);
  private readonly tracked = inject(TrackedChangeService);

  readonly visible = model(false);
  readonly deckId = input.required<number>();
  readonly ids = input.required<number[]>();
  readonly done = output<string>();

  private deck: DeckData | null = null;
  protected columns: DeckColumn[] = [];
  protected column: DeckColumn | null = null;
  protected prefix = '';
  protected start = 1;
  protected digits = 3;
  protected readonly preview = signal<{ name: string; before: string; after: string }[]>([]);
  protected readonly conflicts = signal<string[]>([]);
  protected readonly busy = signal(false);
  /** selected cards that already have an identifier: changing it needs a confirmation */
  protected readonly alreadyNumbered = signal(0);
  protected confirmOverwrite = false;

  protected async onShow(): Promise<void> {
    this.confirmOverwrite = false;
    this.deck = await this.transfer.load(this.deckId());
    this.columns = this.deck.columns.filter(c => c.type === FieldType.text && c.field !== 'name');
    this.column = this.columns.find(c => ['cardid', 'id', 'code', 'ref', 'reference'].includes(headerKey(c.header)))
      ?? this.columns[0] ?? null;
    this.suggest();
  }

  /** Prefix, digits and first number from the identifiers already in the deck */
  protected suggest(): void {
    if (!this.deck || !this.column) {
      return;
    }
    const field = this.column.field;
    const others = this.deck.cards.filter(c => !this.ids().includes(c.id))
      .map(c => (c as unknown as Record<string, unknown>)[field]);
    const numbering = suggestNumbering(others.length ? others
      : this.deck.cards.map(c => (c as unknown as Record<string, unknown>)[field]));
    this.prefix = numbering.prefix;
    this.digits = numbering.digits;
    this.start = numbering.next;
    this.update();
  }

  protected update(): void {
    if (!this.deck || !this.column) {
      this.preview.set([]);
      return;
    }
    const field = this.column.field;
    const values = numberedIds({ prefix: this.prefix ?? '', digits: this.digits ?? 1, next: this.start ?? 1 },
      this.ids().length);
    const cards = this.ids().map(id => this.deck!.cards.find(c => c.id === id));
    this.preview.set(cards.map((card, i) => ({
      name: card?.name ?? '',
      before: String((card as unknown as Record<string, unknown> | undefined)?.[field] ?? ''),
      after: values[i],
    })));
    const used = new Set(this.deck.cards.filter(c => !this.ids().includes(c.id))
      .map(c => String((c as unknown as Record<string, unknown>)[field] ?? '')));
    this.conflicts.set(values.filter(value => used.has(value)));
    this.alreadyNumbered.set(this.preview().filter(p => p.before !== '' && p.before !== p.after).length);
  }

  protected async apply(): Promise<void> {
    if (!this.column || this.conflicts().length > 0 || (this.alreadyNumbered() > 0 && !this.confirmOverwrite)) {
      return;
    }
    this.busy.set(true);
    try {
      const column = this.column;
      const label = this.translate.instant('cards-selection.renumbered', { n: this.ids().length, field: column.header });
      await this.tracked.run('renumber', label,
        () => this.transfer.renumber(this.ids(), column.field, this.preview().map(p => p.after)));
      this.visible.set(false);
      this.done.emit(label);
    } finally {
      this.busy.set(false);
    }
  }
}
