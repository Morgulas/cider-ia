import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Card as Card_1 } from 'primeng/card';
import { CardImportDialogComponent } from '../cards-transfer/card-import-dialog/card-import-dialog.component';
import { CardTransferService } from '../cards-transfer/card-transfer.service';
import { DecksService } from '../data-services/services/decks.service';
import { EntitySpreadsheetComponent } from '../entity-spreadsheet/entity-spreadsheet.component';
import FileUtils from '../shared/utils/file-utils';

@Component({
    selector: 'app-cards',
    templateUrl: './cards.component.html',
    styleUrls: ['./cards.component.scss'],
    imports: [Card_1, Button, TranslatePipe, EntitySpreadsheetComponent, CardImportDialogComponent]
})
export class CardsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly transfer = inject(CardTransferService);
  private readonly decks = inject(DecksService);

  protected readonly deckId = Number(this.route.snapshot.paramMap.get('deckId'));
  protected importVisible = false;
  /** the spreadsheet loads its rows once: it is rebuilt after an import */
  protected readonly showSheet = signal(true);

  protected reload(): void {
    this.showSheet.set(false);
    setTimeout(() => this.showSheet.set(true));
  }

  /** Card rows of the deck as CSV (spreadsheet) or JSON (cartes-fangh, for another program) */
  protected async export(format: 'csv' | 'json'): Promise<void> {
    const deck = await this.decks.get(this.deckId);
    const name = deck?.name ?? 'cartes';
    const blob = await this.transfer.export(this.deckId, name, format);
    FileUtils.saveAs(blob, `${name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'cartes'}.${format}`);
  }
}
