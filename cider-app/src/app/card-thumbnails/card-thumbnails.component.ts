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
import { BinderItem, CardBinderComponent } from '../card-binder/card-binder.component';

const VIEW_KEY = 'cider.thumbnails.view';

@Component({
    selector: 'app-card-thumbnails',
    templateUrl: './card-thumbnails.component.html',
    styleUrls: ['./card-thumbnails.component.scss'],
    imports: [Bind, Card_1, SelectButton, FormsModule, IconField, InputText, InputIcon, DataView_1, CardPreviewComponent, AsyncPipe, EntityPipe, TranslatePipe, Button, Tooltip, CardIllustrationDialogComponent, CardBinderComponent]
})
export class CardThumbnailsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ai = inject(AiService);
  protected illustrationVisible = false;
  protected illustrationCard: Card | null = null;
  @ViewChild('dv') dv!: DataView;
  thumbnailCards: Card[] = [];
  /** Cartes du classeur, après filtre et choix des faces. */
  binderItems: BinderItem[] = [];
  searchText = '';
  view: 'binder' | 'grid' = CardThumbnailsComponent.loadView();
  viewOptions: any[] = [
    { icon: 'pi pi-book', value: 'binder', tooltip: 'Classeur' },
    { icon: 'pi pi-th-large', value: 'grid', tooltip: 'Grille' }
  ];
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
      this.refreshBinder();
    });

    // update side options labels and copy options labels
    // whenever the language changes
    this.translate.stream('welcome.title').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.sideOptions[0].label = this.translate.instant('controls.fronts');
      this.sideOptions[1].label = this.translate.instant('controls.backs');
      this.sideOptions[2].label = this.translate.instant('controls.both');
      this.copyOptions[0].label = this.translate.instant('controls.singles');
      this.copyOptions[1].label = this.translate.instant('controls.copies');
      this.viewOptions[0].tooltip = this.translate.instant('binder.view-binder');
      this.viewOptions[1].tooltip = this.translate.instant('binder.view-grid');
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
      this.refreshBinder();
    });
  }

  filter(input: any) {
    this.searchText = input.target.value;
    if (this.dv) {
      (this.dv as any).filter(this.searchText, 'contains');
    }
    this.refreshBinder();
  }

  /** Recalcule le contenu du classeur : même filtre que la grille, faces choisies. */
  refreshBinder(): void {
    const query = this.searchText.trim().toLocaleLowerCase();
    const fields = this.filterFields ? this.filterFields.split(',') : ['name'];
    const cards = query
      ? this.thumbnailCards.filter(card => fields.some(field => {
        const value = (card as any)[field];
        return value !== undefined && value !== null && String(value).toLocaleLowerCase().includes(query);
      }))
      : this.thumbnailCards;
    const items: BinderItem[] = [];
    for (const card of cards) {
      if (this.sideSelected !== 'backs') {
        items.push({ card, side: 'front' });
      }
      if (this.sideSelected !== 'fronts') {
        items.push({ card, side: 'back' });
      }
    }
    this.binderItems = items;
  }

  onViewChange(): void {
    try {
      localStorage.setItem(VIEW_KEY, this.view);
    } catch {
      // stockage indisponible : le choix vaut pour cette visite seulement
    }
    if (this.view === 'grid' && this.searchText) {
      // la grille se crée maintenant : on lui réapplique la recherche en cours
      setTimeout(() => this.dv && (this.dv as any).filter(this.searchText, 'contains'));
    }
  }

  private static loadView(): 'binder' | 'grid' {
    try {
      return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'binder';
    } catch {
      return 'binder';
    }
  }


  protected openIllustration(card: Card): void {
    this.illustrationCard = card;
    this.illustrationVisible = true;
  }

}
