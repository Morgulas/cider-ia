import { Component, OnDestroy, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, take } from 'rxjs';
import { DecksService } from '../data-services/services/decks.service';
import { EntityField } from '../data-services/types/entity-field.type';
import { Deck } from '../data-services/types/deck.type';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { Bind } from 'primeng/bind';
import { Card } from 'primeng/card';
import { EntityTableComponent } from '../entity-table/entity-table.component';

@Component({
    selector: 'app-decks',
    templateUrl: './decks.component.html',
    styleUrls: ['./decks.component.scss'],
    imports: [PageHeaderComponent, Bind, Card, EntityTableComponent]
})
export class DecksComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private destroyed$ = new Subject<boolean>();
  cols: EntityField<Deck>[];
  decks: Deck[];
  selectedDeck: Deck | Deck[] | undefined;

  constructor(public decksService: DecksService, 
    private router: Router) {
    this.cols = [];
    this.decks = [];
    this.selectedDeck = undefined;
  }

  ngOnInit(): void {
    this.decksService.getAll().then(decks => this.decks = decks);
    this.decksService.getFields().then(fields => this.cols = fields);
    this.decksService.getSelectedDeck().pipe(take(1))
    .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({next: (decks) => {
      this.selectedDeck = decks;
    }});
  }

  ngOnDestroy(): void {
    this.destroyed$.next(true);
    this.destroyed$.complete();
  }

  /**
   * Select the deck
   */
  public selectDeck() {
      if (Array.isArray(this.selectedDeck)) {
        return;
      }
      this.decksService.selectDeck(this.selectedDeck);
      this.router.navigateByUrl(`/decks/${this.selectedDeck?.id}/cards/listing`);
  }

}
