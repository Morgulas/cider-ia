import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CardsService } from '../data-services/services/cards.service';
import { Card } from '../data-services/types/card.type';
import { Bind } from 'primeng/bind';
import { Dialog } from 'primeng/dialog';
import { PrimeTemplate } from 'primeng/api';
import { EntityTableComponent } from '../entity-table/entity-table.component';
import { ButtonDirective } from 'primeng/button';
import { Ripple } from 'primeng/ripple';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-export-selection-dialog',
    templateUrl: './export-selection-dialog.component.html',
    styleUrls: ['./export-selection-dialog.component.scss'],
    imports: [Bind, Dialog, PrimeTemplate, EntityTableComponent, ButtonDirective, Ripple, TranslatePipe]
})
export class ExportSelectionDialogComponent implements OnInit {
  @Input() records: Card[] = [];
  @Input() visible = false;
  @Output() visibleChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() applied = new EventEmitter<Card | Card[] | undefined>();
  public cards: Card | Card[] | undefined = undefined;

  constructor(public cardsService: CardsService) {
  }

  ngOnInit(): void {
  }

  public onShow() {
    if (this.cards === undefined) {
      this.cards = this.records;
    }
  }

  public apply() {
    this.applied.emit(this.cards);
    this.hideDialog();
  }

  public hideDialog() {
    this.visible = false;
    this.visibleChange.emit(false);
  }

}
