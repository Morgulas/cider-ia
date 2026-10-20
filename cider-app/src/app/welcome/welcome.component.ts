import { Component } from '@angular/core';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { Bind } from 'primeng/bind';
import { Card } from 'primeng/card';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-welcome',
    templateUrl: './welcome.component.html',
    styleUrls: ['./welcome.component.scss'],
    imports: [PageHeaderComponent, Bind, Card, TranslatePipe]
})
export class WelcomeComponent {
}
