import { Component, Input } from '@angular/core';
import { Bind } from 'primeng/bind';
import { Card } from 'primeng/card';

@Component({
    selector: 'app-page-header',
    templateUrl: './page-header.component.html',
    styleUrls: ['./page-header.component.scss'],
    imports: [Bind, Card]
})
export class PageHeaderComponent {
  @Input() header: string | undefined;
  @Input() subheader: string | undefined;

}
