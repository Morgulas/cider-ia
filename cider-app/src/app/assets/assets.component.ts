import { Component } from '@angular/core';
import { AssetsService } from '../data-services/services/assets.service';
import { Bind } from 'primeng/bind';
import { Card } from 'primeng/card';
import { EntityTableComponent } from '../entity-table/entity-table.component';

@Component({
    selector: 'app-assets',
    templateUrl: './assets.component.html',
    styleUrls: ['./assets.component.scss'],
    imports: [Bind, Card, EntityTableComponent]
})
export class AssetsComponent {

  constructor(public assetsService: AssetsService) { }

}
