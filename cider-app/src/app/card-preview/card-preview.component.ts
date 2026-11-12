import { AssetUrls } from '../data-services/types/asset.type';
import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, QueryList, SimpleChanges, ViewChildren, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AssetsService } from '../data-services/services/assets.service';
import { CardTemplate } from '../data-services/types/card-template.type';
import { Card } from '../data-services/types/card.type';
import { v4 as uuid } from 'uuid';
import { AsyncSubject, lastValueFrom } from 'rxjs';
import { RenderCacheService } from '../data-services/services/render-cache.service';
import { CardToHtmlPipe } from '../shared/pipes/template-to-html.pipe';
import { ImageRendererService } from '../data-services/services/image-renderer.service';
import { DomSanitizer } from '@angular/platform-browser';
import { SafeUrlPipe } from '../shared/pipes/safe-url.pipe';

@Component({
    selector: 'app-card-preview',
    templateUrl: './card-preview.component.html',
    styleUrls: ['./card-preview.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CardToHtmlPipe, SafeUrlPipe]
})
export class CardPreviewComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  @ViewChildren('cardElement') cardElement: QueryList<ElementRef<HTMLElement>> = {} as QueryList<ElementRef<HTMLElement>>;
  @Input() card: Card = {} as Card;
  /** null or undefined (template still loading, e.g. through the async pipe): nothing to show yet */
  @Input({ transform: (template: CardTemplate | null | undefined) => template ?? ({} as CardTemplate) })
  template: CardTemplate = {} as CardTemplate;
  @Input() scale = 1.0;
  @Input() lowInk = false;
  @Input() cache = false;
  @Input() tiltable = false;
  @Input() holographic: boolean | undefined = false;
  @Input() version = 0;
  @Input() showTrimLines = false;
  @Input() trimOffsetPx = 37.5;
  @Input() showSafeLines = false;
  @Input() safeOffsetPx = 75;

  initialWidth = 0;
  initialHeight = 0;
  assetUrls?: AssetUrls;
  uuid: string = uuid();
  cachedImageUrl?: string;
  invalidTemplate = false;
  private isLoadedSubject: AsyncSubject<boolean>;
  private isCacheLoadedSubject: AsyncSubject<boolean>;
  private resizeObserver?: ResizeObserver;

  constructor(
    private assetsService: AssetsService,
    private renderCacheService: RenderCacheService,
    private imageRendererService: ImageRendererService,
    public readonly element: ElementRef<HTMLElement>,
    private changeDetectorRef: ChangeDetectorRef,
    private cardToHtmlPipe: CardToHtmlPipe,
    private sanitizer: DomSanitizer) {
    this.isLoadedSubject = new AsyncSubject();
    this.isCacheLoadedSubject = new AsyncSubject();
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = entry.contentRect.width || (entry.target as HTMLElement).offsetWidth;
        const height = entry.contentRect.height || (entry.target as HTMLElement).offsetHeight;

        if (width > 0 && height > 0) {
          this.initialWidth = width;
          this.initialHeight = height;
          this.isLoadedSubject.next(true);
          this.isLoadedSubject.complete();
          this.changeDetectorRef.detectChanges();
          this.resizeObserver?.disconnect();
        }
      }
    });
    this.resizeObserver.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  ngOnInit(): void {
    this.assetsService.getAssetUrls().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(assetUrls => {
      this.assetUrls = assetUrls;
      this.changeDetectorRef.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    const cardChange = changes['card'];
    const templateChange = changes['template'];

    if ((cardChange && !cardChange.isFirstChange()) || (templateChange && !templateChange.isFirstChange())) {
      this.isLoadedSubject = new AsyncSubject();
      this.isCacheLoadedSubject = new AsyncSubject();
      this.initialWidth = 0;
      this.initialHeight = 0;
      this.cachedImageUrl = undefined;
      this.invalidTemplate = false;
      // Re-observe to get new dimensions if template changed
      this.resizeObserver?.observe(this.element.nativeElement);
    }

    if (this.cache && this.assetUrls) {
      lastValueFrom(this.isLoadedSubject).then(() => {
        this.renderCacheService.getOrSet(this.getHash(),
          () => this.whenRenderable().then(() => this.toImageUrl()))
          // completes by itself (AsyncSubject), and may run after the preview is destroyed:
          // no takeUntilDestroyed here
          .subscribe({
            next: (cachedImageUrl) => {
              this.cachedImageUrl = cachedImageUrl;
              // shown once the browser has decoded the image (the page is captured right after)
              whenImageDecoded(cachedImageUrl).then(() => {
                this.isCacheLoadedSubject.next(true);
                this.isCacheLoadedSubject.complete();
              });
              this.changeDetectorRef.markForCheck();
            },
            error: (error) => {
              this.invalidTemplate = true;
              this.isCacheLoadedSubject.error('Failed to generate card image');
              this.isCacheLoadedSubject.complete();
              this.changeDetectorRef.markForCheck();
            }
          });
      });
    }
  }

  /**
   * The card is ready to be captured: displayed, its images decoded and its fonts loaded
   * (instead of a fixed wait, which was both slower and not always enough).
   */
  private async whenRenderable(): Promise<void> {
    await nextFrame();
    const root = this.cardElement.get(0)?.nativeElement;
    if (root) {
      await Promise.all(Array.from(root.querySelectorAll('img')).map(img => img.decode().catch(() => undefined)));
    }
    await document.fonts?.ready;
    await nextFrame();
  }

  public getHash(): number {
    const html = this.cardToHtmlPipe.transform(this.template, this.card, this.assetUrls);
    // the HTML string inside Angular's SafeHtml wrapper
    return this.renderCacheService.calculateHash((html as unknown as { changingThisBreaksApplicationSecurity: string }).changingThisBreaksApplicationSecurity);
  }

  /**
   * What the card shows (its HTML with the assets): two previews with the same key give
   * the same image, e.g. the back shared by every card of a deck.
   */
  public renderKey(): string {
    const html = this.cardToHtmlPipe.transform(this.template, this.card, this.assetUrls);
    return (html as unknown as { changingThisBreaksApplicationSecurity: string }).changingThisBreaksApplicationSecurity;
  }

  /**
   * The card rendered as a PNG data URL from its live HTML (cache off), at the given
   * scale: a scale of 2 gives a sharp image twice as large, not an enlarged one.
   * Waits for the images and fonts of the card first.
   */
  public async renderPng(pixelRatio: number): Promise<string> {
    if (!this.cardElement.get(0)) {
      throw new Error('card not displayed');
    }
    await this.whenRenderable();
    const root = this.cardElement.get(0)!.nativeElement;
    return this.imageRendererService.toPng(root, { pixelRatio, filter: (node: HTMLElement) => 'style' !== node.localName });
  }

  public toImageUrl(): Promise<string> {
    const filter = (node: HTMLElement) => {
      return 'style' !== node.localName;
    };
    return this.imageRendererService.toPng(this.cardElement.get(0)!.nativeElement, { pixelRatio: 1.0, filter: filter });
  }

  /**
   * Calques de la carte (export « avec calques » vers l'appli de collection), sur le rendu en direct
   * (cache désactivé) : chaque élément marqué data-calque="nom" donne
   *  - sa zone, en % de la carte : [x, y, largeur, hauteur] (union des éléments de même nom) ;
   *  - son image seule : un PNG de la taille de la carte, transparent ailleurs (les autres éléments sont
   *    masqués par visibility, voir .cc-layer-pass dans styles.scss).
   */
  public async captureLayers(pixelRatio: number): Promise<Record<string, { zone: number[]; image: string }>> {
    const root = this.cardElement.get(0)?.nativeElement;
    if (!root) {
      return {};
    }
    const box = root.getBoundingClientRect();
    if (!box.width || !box.height) {
      return {};
    }
    const groups = layerGroups(root);
    const out: Record<string, { zone: number[]; image: string }> = {};
    const filter = (node: HTMLElement) => 'style' !== node.localName;
    for (const [name, elements] of groups) {
      const zone = layerZone(box, elements.map(e => e.getBoundingClientRect()));
      if (!zone) {
        continue;
      }
      root.classList.add('cc-layer-pass');
      elements.forEach(e => e.setAttribute('data-calque-on', ''));
      try {
        const image = await this.imageRendererService.toPng(root, { pixelRatio, filter });
        out[name] = { zone, image };
      } finally {
        root.classList.remove('cc-layer-pass');
        elements.forEach(e => e.removeAttribute('data-calque-on'));
      }
    }
    return out;
  }

  public isLoaded() {
    return this.isLoadedSubject.asObservable();
  }

  public isCacheLoaded() {
    return this.isCacheLoadedSubject.asObservable();
  }
}

/** nom de calque accepté par l'appli de collection */
export const LAYER_NAME = /^[a-z0-9_-]{1,20}$/;

/** Éléments marqués data-calque, regroupés par nom (minuscules ; noms invalides ignorés, 6 calques au plus) */
export function layerGroups(root: HTMLElement): Map<string, HTMLElement[]> {
  const groups = new Map<string, HTMLElement[]>();
  root.querySelectorAll<HTMLElement>('[data-calque]').forEach(element => {
    const name = (element.getAttribute('data-calque') ?? '').trim().toLowerCase();
    if (!LAYER_NAME.test(name) || (!groups.has(name) && groups.size >= 6)) {
      return;
    }
    groups.set(name, [...(groups.get(name) ?? []), element]);
  });
  return groups;
}

/** Zone [x, y, largeur, hauteur] en % de la carte, union des rectangles (bornée à la carte) ; null si vide */
export function layerZone(card: { left: number; top: number; width: number; height: number },
  rects: { left: number; top: number; right: number; bottom: number }[]): number[] | null {
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const pct = (v: number, origin: number, size: number) => clamp((v - origin) / size * 100);
  const visible = rects.filter(r => r.right > r.left && r.bottom > r.top);
  if (!visible.length) {
    return null;
  }
  const x0 = pct(Math.min(...visible.map(r => r.left)), card.left, card.width);
  const y0 = pct(Math.min(...visible.map(r => r.top)), card.top, card.height);
  const x1 = pct(Math.max(...visible.map(r => r.right)), card.left, card.width);
  const y1 = pct(Math.max(...visible.map(r => r.bottom)), card.top, card.height);
  if (x1 <= x0 || y1 <= y0) {
    return null;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return [r2(x0), r2(y0), r2(x1 - x0), r2(y1 - y0)];
}

/** After the next paint */
function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)));
}

/** Once an image URL is decoded by the browser (errors ignored: the capture shows what it can) */
function whenImageDecoded(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  return image.decode().catch(() => undefined).then(() => nextFrame());
}
