import { DatePipe } from '@angular/common';
import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { Tag } from 'primeng/tag';
import { CardHistoryEntry } from '../../data-services/indexed-db/card-history';
import { TrackedChangeService } from '../../server/tracked-change.service';
import { CardHistoryService, HistoryGroup } from '../card-history.service';

/** Journal of the card changes of a deck (or of the selected cards), with undo of whole operations */
@Component({
  selector: 'app-card-history-dialog',
  templateUrl: './card-history-dialog.component.html',
  styleUrl: './card-history-dialog.component.scss',
  providers: [ConfirmationService],
  imports: [FormsModule, Dialog, Button, Checkbox, ConfirmDialog, Message, Tag, DatePipe, TranslatePipe]
})
export class CardHistoryDialogComponent {
  private readonly history = inject(CardHistoryService);
  private readonly tracked = inject(TrackedChangeService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);

  readonly visible = model(false);
  readonly deckId = input.required<number>();
  readonly cardIds = input<number[]>([]);
  /** an operation was undone: the card list should reload */
  readonly changed = output<string>();

  protected onlySelection = true;
  protected readonly groups = signal<HistoryGroup[]>([]);
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly info = signal<string | null>(null);

  protected async onShow(): Promise<void> {
    this.info.set(null);
    this.onlySelection = this.cardIds().length > 0;
    await this.load();
  }

  protected async load(): Promise<void> {
    const groups = await this.history.groups(this.deckId(), this.onlySelection ? this.cardIds() : []);
    this.groups.set(groups);
    this.expanded.set(new Set(groups.slice(0, 1).map(g => g.key)));
  }

  protected toggle(group: HistoryGroup): void {
    const expanded = new Set(this.expanded());
    if (expanded.has(group.key)) {
      expanded.delete(group.key);
    } else {
      expanded.add(group.key);
    }
    this.expanded.set(expanded);
  }

  protected title(group: HistoryGroup): string {
    return group.label || this.translate.instant(`card-history.origin-${group.origin}`);
  }

  protected opLabel(entry: CardHistoryEntry): string {
    return this.translate.instant(`card-history.op-${entry.op}`);
  }

  protected display(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.length > 140 ? text.slice(0, 137) + '…' : text;
  }

  protected confirmUndo(group: HistoryGroup): void {
    if (!group.batch) {
      return;
    }
    const batch = group.batch;
    this.confirmation.confirm({
      header: this.translate.instant('card-history.undo'),
      message: this.translate.instant('card-history.undo-confirm', { label: this.title(group), n: group.entries.length }),
      icon: 'pi pi-undo',
      acceptLabel: this.translate.instant('card-history.undo'),
      rejectLabel: this.translate.instant('controls.cancel'),
      accept: () => void this.undo(batch, this.title(group)),
    });
  }

  private async undo(batch: string, title: string): Promise<void> {
    this.busy.set(true);
    try {
      const label = this.translate.instant('card-history.undo-label', { label: title });
      const result = await this.tracked.run('undo', label, () => this.history.undo(batch));
      const text = this.translate.instant(result.skipped ? 'card-history.undone-partly' : 'card-history.undone',
        { label: title, n: result.undone, skipped: result.skipped });
      this.info.set(text);
      await this.load();
      this.changed.emit(text);
    } finally {
      this.busy.set(false);
    }
  }
}
