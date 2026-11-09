import { ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Booster } from '../data-services/types/booster.type';
import { AssetUrls } from '../data-services/types/asset.type';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { EntityPipe } from '../data-services/pipes/entity.pipe';
import { CardFitComponent } from '../card-binder/card-fit.component';
import { CardTiltDirective } from '../card-binder/card-tilt.directive';
import { BoosterPackComponent } from './booster-pack.component';
import { PoolEntry, PulledCard, openBooster } from './booster-logic';

type State = 'sealed' | 'tearing' | 'reveal' | 'done';

/**
 * Ouverture d'un booster : le sachet se déchire, puis les cartes se retournent une à
 * une (clic, Espace ou flèche droite), avant le récapitulatif.
 */
@Component({
  selector: 'app-booster-opening',
  templateUrl: './booster-opening.component.html',
  styleUrls: ['./booster-opening.component.scss'],
  imports: [AsyncPipe, TranslatePipe, Button, EntityPipe, CardFitComponent, CardTiltDirective, BoosterPackComponent]
})
export class BoosterOpeningComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) booster!: Booster;
  @Input() pool: PoolEntry[] = [];
  @Input() foilField?: string;
  @Input() assetUrls: AssetUrls = {};
  /** Cartes déjà obtenues pendant la session : les autres sont marquées « nouvelle ». */
  @Input() collectedIds = new Set<number>();
  @Output() opened = new EventEmitter<PulledCard[]>();

  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;
  readonly templatesService = inject(CardTemplatesService);
  private readonly cdr = inject(ChangeDetectorRef);

  state: State = 'sealed';
  pulls: PulledCard[] = [];
  /** Carte en cours de révélation. */
  index = 0;
  flipped = false;
  /** Positions (dans pulls) des cartes nouvelles pour la session : premier exemplaire seulement. */
  private newIndexes = new Set<number>();
  /** Ouverture de plusieurs boosters d'un coup : nombre ouvert, pour le titre. */
  batch = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** Le booster en cours a-t-il déjà été compté dans la session ? (à la fin de la révélation) */
  private counted = true;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['booster'] && changes['booster'].previousValue?.id !== changes['booster'].currentValue?.id) {
      this.reset();
    }
  }

  ngOnDestroy(): void {
    this.timers.forEach(clearTimeout);
    this.count();
  }

  get current(): PulledCard | undefined {
    return this.pulls[this.index];
  }

  get revealed(): PulledCard[] {
    return this.pulls.slice(0, this.index);
  }

  /** Emplacements des cartes encore à révéler (après la carte en cours), dans la rangée du bas. */
  get slots(): null[] {
    return new Array(Math.max(0, this.pulls.length - this.index - 1)).fill(null);
  }

  reset(): void {
    this.count();
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.state = 'sealed';
    this.packFlipped = false;
    this.pulls = [];
    this.index = 0;
    this.flipped = false;
    this.batch = 0;
  }

  /** Le sachet est-il retourné (verso visible) ? */
  packFlipped = false;

  /** Clic sur le sachet : retourné, il revient sur le recto ; sinon il s'ouvre. */
  packClick(): void {
    if (this.packFlipped) {
      this.packFlipped = false;
      return;
    }
    this.tear();
  }

  tear(): void {
    // on ouvre toujours par le recto
    this.packFlipped = false;
    if (this.state !== 'sealed' || !this.pool.length) {
      return;
    }
    this.pulls = openBooster(this.booster, this.pool, this.foilField);
    this.markNew(this.collectedIds);
    // compté dans la session une fois révélé : la liste ne gâche pas la surprise
    this.counted = false;
    this.index = 0;
    this.flipped = false;
    this.batch = 0;
    this.state = 'tearing';
    this.later(() => this.state = 'reveal', reducedMotion() ? 0 : 900);
  }

  /** Clic sur la carte : la retourne, puis la range et passe à la suivante. */
  advance(): void {
    if (this.state !== 'reveal' || !this.current) {
      return;
    }
    if (!this.flipped) {
      this.flipped = true;
      return;
    }
    this.index++;
    this.flipped = false;
    if (this.index >= this.pulls.length) {
      this.state = 'done';
      this.count();
    }
  }

  revealAll(): void {
    this.index = this.pulls.length;
    this.flipped = false;
    this.state = 'done';
    this.count();
    this.scrollTop();
  }

  private count(): void {
    if (!this.counted) {
      this.counted = true;
      this.opened.emit(this.pulls);
    }
  }

  /** Ouvre plusieurs boosters d'un coup et montre directement tout ce qui est sorti. */
  openMany(count: number): void {
    if (!this.pool.length) {
      return;
    }
    this.count();
    this.timers.forEach(clearTimeout);
    const known = new Set(this.collectedIds);
    const all: PulledCard[] = [];
    for (let i = 0; i < count; i++) {
      const pulls = openBooster(this.booster, this.pool, this.foilField);
      all.push(...pulls);
      this.opened.emit(pulls);
    }
    // les foils d'abord, puis par nom
    this.pulls = all.sort((a, b) => Number(!!b.foil) - Number(!!a.foil) || (a.card.name ?? '').localeCompare(b.card.name ?? ''));
    this.markNew(known);
    this.index = this.pulls.length;
    this.batch = count;
    this.state = 'done';
    this.scrollTop();
  }

  isNew(index: number): boolean {
    return this.newIndexes.has(index);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) {
      return;
    }
    if (this.state === 'reveal' && (event.key === ' ' || event.key === 'ArrowRight' || event.key === 'Enter')) {
      this.advance();
      event.preventDefault();
    } else if (this.state === 'sealed' && (event.key === ' ' || event.key === 'Enter') && target === document.body) {
      this.tear();
      event.preventDefault();
    }
  }

  private markNew(known: Set<number>): void {
    const seen = new Set(known);
    this.newIndexes = new Set();
    this.pulls.forEach((pull, index) => {
      if (!seen.has(pull.card.id)) {
        seen.add(pull.card.id);
        this.newIndexes.add(index);
      }
    });
  }

  private scrollTop(): void {
    setTimeout(() => this.scroller?.nativeElement.scrollTo({ top: 0 }));
  }

  private later(action: () => void, delay: number): void {
    this.timers.push(setTimeout(() => {
      action();
      this.cdr.markForCheck();
    }, delay));
  }
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
