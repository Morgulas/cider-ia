import { Component } from '@angular/core';
import { CardAttributesService } from '../data-services/services/card-attributes.service';
import { Bind } from 'primeng/bind';
import { Card } from 'primeng/card';
import { EntityTableComponent } from '../entity-table/entity-table.component';

@Component({
    selector: 'app-card-attributes',
    templateUrl: './card-attributes.component.html',
    styleUrls: ['./card-attributes.component.scss'],
    imports: [Bind, Card, EntityTableComponent]
})
export class CardAttributesComponent {

  constructor(public attributesService: CardAttributesService) { }

}
