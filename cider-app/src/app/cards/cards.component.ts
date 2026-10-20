import { Component, OnInit } from '@angular/core';
import { CardsService } from '../data-services/services/cards.service';
import { Card } from '../data-services/types/card.type';
import { DecksService } from '../data-services/services/decks.service';
import { Bind } from 'primeng/bind';
import { Card as Card_1 } from 'primeng/card';
import { EntitySpreadsheetComponent } from '../entity-spreadsheet/entity-spreadsheet.component';

@Component({
    selector: 'app-cards',
    templateUrl: './cards.component.html',
    styleUrls: ['./cards.component.scss'],
    imports: [Bind, Card_1, EntitySpreadsheetComponent]
})
export class CardsComponent implements OnInit {

  constructor(public cardsService: CardsService) { }

  ngOnInit(): void {
  }

}
