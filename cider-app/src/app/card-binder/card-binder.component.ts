import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, NgZone,
  OnChanges, OnDestroy, Output, SimpleChanges, ViewChild
} from '@angular/core';
import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { Card } from '../data-services/types/card.type';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { EntityPipe } from '../data-services/pipes/entity.pipe';
import { CardFitComponent } from './card-fit.component';

/** Une carte rangée dans le classeur, vue de face ou de dos. */
export interface BinderItem {
  card: Card;
  side: 'front' | 'back';
}

interface Flip {
  /** Sens du tournage : en avant (page suivante) ou en arrière. */
  dir: 1 | -1;
  /** Page imprimée au recto de la feuille qui tourne (-1 : aucune). */
  front: number;
  /** Page imprimée au verso de la feuille qui tourne (-1 : aucune). */
  back: number;
  /** La feuille part de la page de gauche (retour en arrière en double page). */
  fromLeft: boolean;
  /** La feuille arrive depuis la gauche (retour en arrière en simple page). */
  incoming: boolean;
}

const PER_PAGE = 9;
const FLIP_MS = 700;
/** Proportion d'une carte à jouer standard, en attendant la mesure du modèle. */
const DEFAULT_RATIO = 63 / 88;

/**
 * Vue « classeur » des vignettes : les cartes sont rangées 9 par page, dans des
 * pochettes, sur une ou deux pages selon la place. Les pages se tournent avec une
 * animation ; un clic sur une carte l'agrandit.
 */
@Component({
  selector: 'app-card-binder',
  templateUrl: './card-binder.component.html',
  styleUrls: ['./card-binder.component.scss'],
  imports: [NgTemplateOutlet, AsyncPipe, TranslatePipe, Button, Tooltip, EntityPipe, CardFitComponent]
})
export class CardBinderComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() items: BinderItem[] = [];
  /** Affiche le bouton d'illustration IA dans la vue agrandie. */
  @Input() aiEnabled = true;
  @Output() illustrate = new EventEmitter<Card>();

  @ViewChild('stage', { static: true }) stage!: ElementRef<HTMLElement>;
  @ViewChild('leaf') leaf?: ElementRef<HTMLElement>;
  @ViewChild('leafShade') leafShade?: ElementRef<HTMLElement>;
  @ViewChild('zoomCard') zoomCard?: ElementRef<HTMLElement>;
  @ViewChild('zoomLayer') zoomLayer?: ElementRef<HTMLElement>;

  pages: (BinderItem | null)[][] = [];
  /** Première page visible (toujours paire en double page). */
  page = 0;
  spread = true;
  cardW = 0;
  cardH = 0;
  flip: Flip | null = null;

  zoomIndex = -1;
  zoomBack = false;
  zoomW = 0;
  zoomH = 0;

  private ratio = DEFAULT_RATIO;
  private observer?: ResizeObserver;
  private swipeStartX: number | null = null;
  private zoomOrigin?: DOMRect;

  constructor(
    public templatesService: CardTemplatesService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone,
    private host: ElementRef<HTMLElement>) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['items']) {
      this.buildPages();
    }
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(() => this.zone.run(() => this.layout()));
      this.observer.observe(this.stage.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.zoomLayer?.nativeElement.remove();
  }

  // ----- Pages -----

  private buildPages(): void {
    const pages: (BinderItem | null)[][] = [];
    for (let i = 0; i < this.items.length; i += PER_PAGE) {
      const slice: (BinderItem | null)[] = this.items.slice(i, i + PER_PAGE);
      while (slice.length < PER_PAGE) {
        slice.push(null);
      }
      pages.push(slice);
    }
    if (pages.length === 0) {
      pages.push(new Array(PER_PAGE).fill(null));
    }
    this.pages = pages;
    this.flip = null;
    this.page = this.align(Math.min(this.page, pages.length - 1));
    if (this.zoomIndex >= this.items.length) {
      this.zoomIndex = -1;
    }
  }

  /** Nombre de pages affichées à la fois. */
  get step(): number {
    return this.spread ? 2 : 1;
  }

  private align(page: number): number {
    const p = Math.max(0, page);
    return this.spread ? p - (p % 2) : p;
  }

  get lastPage(): number {
    return this.align(this.pages.length - 1);
  }

  get canPrev(): boolean {
    return this.page > 0;
  }

  get canNext(): boolean {
    return this.page < this.lastPage;
  }

  /** Page affichée à gauche (double page seulement), compte tenu d'un tournage en cours. */
  get leftPage(): number {
    if (this.flip && this.flip.dir === -1) {
      return this.target;
    }
    return this.page;
  }

  /** Page affichée à droite (ou page unique). */
  get rightPage(): number {
    const offset = this.spread ? 1 : 0;
    if (this.flip) {
      if (this.flip.dir === 1) {
        return this.target + offset;
      }
      if (!this.spread) {
        // la page qui revient se pose par-dessus la page actuelle
        return this.page;
      }
    }
    return this.page + offset;
  }

  private target = 0;

  pageLabel(): string {
    const first = this.page + 1;
    const last = Math.min(this.page + this.step, this.pages.length);
    return first === last ? `${first}` : `${first}–${last}`;
  }

  get totalCards(): number {
    return this.items.length;
  }

  // ----- Mise en page -----

  onMeasured(size: { width: number; height: number }): void {
    const ratio = size.width / size.height;
    if (Math.abs(ratio - this.ratio) > 0.005) {
      this.ratio = ratio;
      this.layout();
    }
  }

  /**
   * Calcule la taille des pochettes pour remplir la place disponible, et choisit
   * une double page si elle ne réduit pas trop les cartes.
   */
  private layout(): void {
    const el = this.stage.nativeElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!W || !H) {
      return;
    }
    // marges fixes : couverture (2×14), page (2×18), espaces entre pochettes (2×10), pied de page (26)
    const vChrome = 28 + 36 + 20 + 26;
    const hPage = 36 + 20;
    const byHeight = (H - vChrome) / 3;
    const single = Math.min(byHeight, (W - 28 - hPage) / (3 * this.ratio));
    const double = Math.min(byHeight, (W - 28 - 2 * hPage) / (6 * this.ratio));
    const spread = W >= 700 && double >= single * 0.8;
    const cardH = Math.max(60, Math.floor(spread ? double : single));
    const cardW = Math.floor(cardH * this.ratio);

    if (spread !== this.spread) {
      this.flip = null;
      this.spread = spread;
      this.page = this.align(this.page);
    }
    this.cardW = cardW;
    this.cardH = cardH;
    this.cdr.detectChanges();
  }

  // ----- Tournage des pages -----

  prev(): void {
    this.goTo(this.page - this.step);
  }

  next(): void {
    this.goTo(this.page + this.step);
  }

  first(): void {
    this.goTo(0);
  }

  last(): void {
    this.goTo(this.lastPage);
  }

  goTo(page: number, animate = true): void {
    const target = this.align(Math.min(Math.max(page, 0), this.pages.length - 1));
    if (target === this.page || this.flip) {
      return;
    }
    if (!animate || this.reducedMotion()) {
      this.page = target;
      return;
    }
    const dir: 1 | -1 = target > this.page ? 1 : -1;
    this.target = target;
    if (this.spread) {
      this.flip = dir === 1
        ? { dir, front: this.page + 1, back: target, fromLeft: false, incoming: false }
        : { dir, front: this.page, back: target + 1, fromLeft: true, incoming: false };
    } else {
      this.flip = dir === 1
        ? { dir, front: this.page, back: -1, fromLeft: false, incoming: false }
        : { dir, front: target, back: -1, fromLeft: false, incoming: true };
    }
    this.cdr.detectChanges();
    this.animateLeaf();
  }

  private animateLeaf(): void {
    const leaf = this.leaf?.nativeElement;
    const flip = this.flip;
    if (!leaf || !flip) {
      this.endFlip();
      return;
    }
    let from = 0;
    let to = -180;
    if (flip.fromLeft) {
      to = 180;
    } else if (flip.incoming) {
      from = -180;
      to = 0;
    }
    // laisse aux cartes de la feuille le temps de se mesurer avant de bouger
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const options: KeyframeAnimationOptions = { duration: FLIP_MS, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' };
      const anim = leaf.animate([
        { transform: `rotateY(${from}deg)` },
        { transform: `rotateY(${(from + to) / 2}deg) translateZ(14px)`, offset: 0.5 },
        { transform: `rotateY(${to}deg)` }
      ], options);
      this.leafShade?.nativeElement.animate([
        { opacity: 0 }, { opacity: 0.45, offset: 0.5 }, { opacity: 0 }
      ], options);
      anim.finished.then(() => this.zone.run(() => this.endFlip()), () => this.zone.run(() => this.endFlip()));
    }));
  }

  private endFlip(): void {
    if (this.flip) {
      this.page = this.target;
      this.flip = null;
      this.cdr.detectChanges();
    }
  }

  private reducedMotion(): boolean {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') {
      this.swipeStartX = event.clientX;
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this.swipeStartX === null) {
      return;
    }
    const dx = event.clientX - this.swipeStartX;
    this.swipeStartX = null;
    if (Math.abs(dx) > 60) {
      if (dx < 0) {
        this.next();
      } else {
        this.prev();
      }
    }
  }

  // ----- Agrandissement -----

  indexOf(item: BinderItem): number {
    return this.items.indexOf(item);
  }

  openZoom(item: BinderItem, event: MouseEvent): void {
    if (this.flip) {
      return;
    }
    const pocket = (event.currentTarget as HTMLElement);
    this.zoomOrigin = pocket.getBoundingClientRect();
    this.zoomIndex = this.indexOf(item);
    this.zoomBack = false;
    this.sizeZoom();
    this.cdr.detectChanges();
    // la couche d'agrandissement va dans <body> : aucun parent transformé ne la décale
    const layer = this.zoomLayer?.nativeElement;
    if (layer && layer.parentElement !== document.body) {
      document.body.appendChild(layer);
    }
    this.animateZoom(true);
  }

  closeZoom(): void {
    if (this.zoomIndex < 0) {
      return;
    }
    const index = this.zoomIndex;
    const pageOfCard = Math.floor(index / PER_PAGE);
    const visible = pageOfCard >= this.page && pageOfCard < this.page + this.step;
    if (!visible) {
      this.goTo(pageOfCard, false);
      this.cdr.detectChanges();
    }
    const pocket = this.host.nativeElement.querySelector<HTMLElement>(`.pages [data-index="${index}"]`);
    this.zoomOrigin = pocket?.getBoundingClientRect();
    this.animateZoom(false).then(() => {
      this.zoomIndex = -1;
      this.cdr.detectChanges();
    });
  }

  get zoomItem(): BinderItem | null {
    return this.zoomIndex >= 0 ? this.items[this.zoomIndex] ?? null : null;
  }

  /** Face montrée au départ par l'agrandissement, puis l'autre face au retournement. */
  zoomTemplateId(face: 'front' | 'back'): number {
    const item = this.zoomItem!;
    const showsFront = (item.side === 'front') === (face === 'front');
    return showsFront ? item.card.frontCardTemplateId : item.card.backCardTemplateId;
  }

  zoomPrev(): void {
    if (this.zoomIndex > 0) {
      this.zoomIndex--;
      this.zoomBack = false;
    }
  }

  zoomNext(): void {
    if (this.zoomIndex < this.items.length - 1) {
      this.zoomIndex++;
      this.zoomBack = false;
    }
  }

  turnZoomed(): void {
    this.zoomBack = !this.zoomBack;
  }

  private sizeZoom(): void {
    const maxH = window.innerHeight * 0.8;
    const maxW = window.innerWidth * 0.8;
    const h = Math.min(maxH, maxW / this.ratio);
    this.zoomH = Math.floor(h);
    this.zoomW = Math.floor(h * this.ratio);
  }

  private animateZoom(opening: boolean): Promise<void> {
    const card = this.zoomCard?.nativeElement;
    const layer = this.zoomLayer?.nativeElement;
    if (!card || !layer || this.reducedMotion()) {
      return Promise.resolve();
    }
    const end = card.getBoundingClientRect();
    const origin = this.zoomOrigin;
    let collapsed = 'scale(0.6)';
    if (origin && origin.width && end.width) {
      const s = Math.min(origin.width / end.width, origin.height / end.height);
      const dx = (origin.left + origin.width / 2) - (end.left + end.width / 2);
      const dy = (origin.top + origin.height / 2) - (end.top + end.height / 2);
      collapsed = `translate(${dx}px, ${dy}px) scale(${s})`;
    }
    const frames = [{ transform: collapsed, opacity: 0.4 }, { transform: 'none', opacity: 1 }];
    const options: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' };
    const backdrop = [{ opacity: 0 }, { opacity: 1 }];
    if (!opening) {
      frames.reverse();
      backdrop.reverse();
      options.duration = 240;
    }
    layer.animate(backdrop, options);
    return card.animate(frames, options).finished.then(() => undefined, () => undefined);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.zoomIndex >= 0) {
      this.sizeZoom();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.closest('input, textarea, select, [contenteditable="true"]'))) {
      return;
    }
    // une fenêtre (illustration IA…) est ouverte par-dessus : elle garde le clavier
    if (document.querySelector('.p-dialog-mask')) {
      return;
    }
    if (!this.host.nativeElement.offsetParent && this.zoomIndex < 0) {
      return;
    }
    if (this.zoomIndex >= 0) {
      switch (event.key) {
        case 'Escape': this.closeZoom(); break;
        case 'ArrowLeft': this.zoomPrev(); break;
        case 'ArrowRight': this.zoomNext(); break;
        case ' ': this.turnZoomed(); break;
        default: return;
      }
    } else {
      switch (event.key) {
        case 'ArrowLeft': case 'PageUp': this.prev(); break;
        case 'ArrowRight': case 'PageDown': this.next(); break;
        case 'Home': this.first(); break;
        case 'End': this.last(); break;
        default: return;
      }
    }
    event.preventDefault();
  }
}
