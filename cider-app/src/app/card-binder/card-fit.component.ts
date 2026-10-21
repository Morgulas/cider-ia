import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';
import { CardPreviewComponent } from '../card-preview/card-preview.component';
import { Card } from '../data-services/types/card.type';
import { CardTemplate } from '../data-services/types/card-template.type';

/**
 * Affiche une carte à sa taille réelle, puis la réduit (ou l'agrandit) pour qu'elle
 * tienne entière dans son conteneur, centrée. La taille réelle dépend du modèle,
 * qui fixe lui-même ses dimensions : elle est mesurée et non supposée.
 */
@Component({
  selector: 'app-card-fit',
  template: `
    <div class="fit-inner" #inner>
      <app-card-preview [card]="card" [template]="$any(template)" [cache]="false" [scale]="1"></app-card-preview>
    </div>`,
  styles: [`
    :host { display: block; position: relative; width: 100%; height: 100%; overflow: hidden; }
    .fit-inner { position: absolute; top: 0; left: 0; transform-origin: 0 0; visibility: hidden; }
    .fit-inner.ready { visibility: visible; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardPreviewComponent]
})
export class CardFitComponent implements AfterViewInit, OnDestroy {
  @Input() card: Card = {} as Card;
  @Input() template: CardTemplate | null | undefined = null;
  /** Agrandissement maximal permis (1 = jamais plus grand que la taille réelle). */
  @Input() maxScale = 1;
  /** Taille réelle de la carte, émise à chaque changement (pour régler les pochettes). */
  @Output() measured = new EventEmitter<{ width: number; height: number }>();
  @ViewChild('inner', { static: true }) inner!: ElementRef<HTMLElement>;

  private lastW = 0;
  private lastH = 0;

  private observer?: ResizeObserver;

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) { }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(() => this.fit());
      this.observer.observe(this.host.nativeElement);
      this.observer.observe(this.inner.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private fit(): void {
    const host = this.host.nativeElement;
    const inner = this.inner.nativeElement;
    // offsetWidth/offsetHeight ignorent la transformation : c'est la taille réelle
    const w = inner.offsetWidth;
    const h = inner.offsetHeight;
    const hw = host.clientWidth;
    const hh = host.clientHeight;
    if (!w || !h) {
      return;
    }
    if (w !== this.lastW || h !== this.lastH) {
      this.lastW = w;
      this.lastH = h;
      if (this.measured.observed) {
        this.zone.run(() => this.measured.emit({ width: w, height: h }));
      }
    }
    if (!hw || !hh) {
      return;
    }
    const scale = Math.min(hw / w, hh / h, this.maxScale);
    const x = (hw - w * scale) / 2;
    const y = (hh - h * scale) / 2;
    inner.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    inner.classList.add('ready');
  }
}
