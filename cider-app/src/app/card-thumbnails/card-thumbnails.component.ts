import { Component, OnInit, ViewChild, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { CardsService } from '../data-services/services/cards.service';
import { Card } from '../data-services/types/card.type';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { Bind } from 'primeng/bind';
import { Card as Card_1 } from 'primeng/card';
import { SelectButton } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import { IconField } from 'primeng/iconfield';
import { InputText } from 'primeng/inputtext';
import { InputIcon } from 'primeng/inputicon';
import { DataView as DataView_1 } from 'primeng/dataview';
import { CardPreviewComponent } from '../card-preview/card-preview.component';
import { AsyncPipe } from '@angular/common';
import { EntityPipe } from '../data-services/pipes/entity.pipe';
import { Button } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { AiService } from '../ai/ai.service';
import { CardIllustrationDialogComponent } from '../ai/card-illustration-dialog/card-illustration-dialog.component';

@Component({
    selector: 'app-card-thumbnails',
    templateUrl: './card-thumbnails.component.html',
    styleUrls: ['./card-thumbnails.component.scss'],
    imports: [Bind, Card_1, SelectButton, FormsModule, IconField, InputText, InputIcon, DataView_1, CardPreviewComponent, AsyncPipe, EntityPipe, TranslatePipe, Button, Tooltip, CardIllustrationDialogComponent]
})
export class CardThumbnailsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ai = inject(AiService);
  protected illustrationVisible = false;
  protected illustrationCard: Card | null = null;
  @ViewChild('dv') dv!: DataView;
  thumbnailCards: Card[] = [];
  zoomLevel = 0.3;
  zoomOptions: any[] = [
    { label: 's', value: 0.2 },
    { label: 'm', value: 0.3 },
    { label: 'l', value: 0.5 },
    { label: 'xl', value: 0.8 }
  ];
  sideSelected = 'fronts';
  sideOptions: any[] = [
    { label: 'Fronts', value: 'fronts' },
    { label: 'Backs', value: 'backs' },
    { label: 'Both', value: 'both' }
  ];
  filterFields = "";
  copyOptions: any[] = [
    { label: 'Singles', value: 'singles' },
    { label: 'Copies', value: 'copies' }
  ];
  copySelected = 'copies';


  constructor(public cardsService: CardsService,
    private translate: TranslateService,
    public templatesService: CardTemplatesService) { }

  ngOnInit(): void {
    this.refreshCards();
    void this.ai.refreshStatus();
    this.cardsService.getFields().then(fields => {
      this.filterFields = fields.map(field => field.field).join(',');
    });

    // update side options labels and copy options labels
    // whenever the language changes
    this.translate.stream('welcome.title').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.sideOptions[0].label = this.translate.instant('controls.fronts');
      this.sideOptions[1].label = this.translate.instant('controls.backs');
      this.sideOptions[2].label = this.translate.instant('controls.both');
      this.copyOptions[0].label = this.translate.instant('controls.singles');
      this.copyOptions[1].label = this.translate.instant('controls.copies');
    });
  }

  refreshCards() {
    this.cardsService.getAll().then(cards => {
      const expandedList: Card[] = [];
      cards.forEach(card => {
        if (this.copySelected === 'singles') {
          expandedList.push(card);
        } else {
          for (let i = 0; i < (typeof card.count === 'undefined' ? 1 : card.count); i++) {
            expandedList.push(card);
          }
        }
      });
      this.thumbnailCards = expandedList;
    });
  }

  filter(input: any) {
    (this.dv as any).filter(input.target.value, 'contains');
  }


  protected openIllustration(card: Card): void {
    this.illustrationCard = card;
    this.illustrationVisible = true;
  }

}
