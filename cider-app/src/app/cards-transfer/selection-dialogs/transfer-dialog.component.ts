import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { RadioButton } from 'primeng/radiobutton';
import { Select } from 'primeng/select';
import { DecksService } from '../../data-services/services/decks.service';
import { Deck } from '../../data-services/types/deck.type';
import { CardTransferService } from '../card-transfer.service';
import { TrackedChangeService } from '../../server/tracked-change.service';

/** Copies or moves the selected cards to another deck of the project */
@Component({
  selector: 'app-transfer-dialog',
  templateUrl: './transfer-dialog.component.html',
  styleUrl: './selection-dialogs.scss',
  imports: [FormsModule, Dialog, Button, Checkbox, Message, RadioButton, Select, TranslatePipe]
})
export class TransferDialogComponent {
  private readonly transfer = inject(CardTransferService);
  private readonly decks = inject(DecksService);
  private readonly translate = inject(TranslateService);
  private readonly tracked = inject(TrackedChangeService);

  readonly visible = model(false);
  readonly deckId = input.required<number>();
  readonly ids = input.required<number[]>();
  readonly done = output<string>();

  protected targets: Deck[] = [];
  protected target: Deck | null = null;
  protected mode: 'copy' | 'move' = 'copy';
  protected createAttributes = true;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async onShow(): Promise<void> {
    this.error.set(null);
    this.targets = (await this.decks.getAll()).filter(deck => deck.id !== this.deckId());
    this.target = this.targets[0] ?? null;
  }

  protected async apply(): Promise<void> {
    if (!this.target) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const target = this.target;
      const label = this.translate.instant(this.mode === 'move' ? 'cards-selection.move-label' : 'cards-selection.copy-label',
        { n: this.ids().length, deck: target.name });
      const result = await this.tracked.run('transfer', label, () => this.transfer.transferCards(this.deckId(), target.id,
        this.ids(), this.mode === 'move', this.createAttributes));
      let text = this.translate.instant(this.mode === 'move' ? 'cards-selection.moved' : 'cards-selection.copied',
        { n: result.transferred, deck: this.target.name, attributes: result.attributesCreated });
      if (result.missingTemplates.length) {
        text += ' ' + this.translate.instant('cards-selection.transfer-templates',
          { names: result.missingTemplates.join(', ') });
      }
      this.visible.set(false);
      this.done.emit(text);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}
