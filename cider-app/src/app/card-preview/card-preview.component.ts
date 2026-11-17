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
import { EMBOSS_LAYER_PREFIX, FOIL_LAYER_PREFIX, GILDING_LAYER_PREFIX, clearFoilZones, drawFoilZones, zoneGroups, zoneOptions } from './foil-zones';

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
  /**
   * Montre les zones foil du modèle (éléments data-foil) : classeur, vignettes, éditeur...
   * Jamais pour les exports d'images (le reflet serait dans l'image).
   */
  @Input() foils = false;
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
  private foilObserver?: MutationObserver;
  private foilFrame = 0;
  private foilRoot?: HTMLElement;

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
    this.watchFoils();
    this.cardElement.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.watchFoils());
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.stopFoils();
  }

  // ----- Zones foil du modèle (aperçu) -----

  /** Suit le rendu de la carte pour reposer les reflets quand il change (modèle, images, polices) */
  private watchFoils(): void {
    const root = this.foils ? this.cardElement?.get(0)?.nativeElement : undefined;
    if (root === this.foilRoot) {
      return;
    }
    this.stopFoils();
    if (!root) {
      return;
    }
    this.foilRoot = root;
    this.foilObserver = new MutationObserver(records => {
      // les reflets eux-mêmes ne comptent pas
      if (records.some(r => !(r.target as Element).closest?.('.cc-foil-piece')
        && ![...r.addedNodes, ...r.removedNodes].every(n => (n as Element).classList?.contains('cc-foil-piece')))) {
        this.scheduleFoils();
      }
    });
    this.foilObserver.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-foil', 'src', 'style', 'class'] });
    root.addEventListener('load', this.onFoilImageLoad, true);
    void document.fonts?.ready.then(() => this.scheduleFoils());
    this.scheduleFoils();
  }

  private readonly onFoilImageLoad = () => this.scheduleFoils();

  private scheduleFoils(): void {
    if (this.foilFrame || !this.foilRoot) {
      return;
    }
    this.foilFrame = requestAnimationFrame(() => {
      this.foilFrame = 0;
      if (this.foilRoot) {
        drawFoilZones(this.foilRoot);
      }
    });
  }

  private stopFoils(): void {
    this.foilObserver?.disconnect();
    this.foilObserver = undefined;
    cancelAnimationFrame(this.foilFrame);
    this.foilFrame = 0;
    if (this.foilRoot) {
      this.foilRoot.removeEventListener('load', this.onFoilImageLoad, true);
      clearFoilZones(this.foilRoot);
      this.foilRoot = undefined;
    }
  }

  ngOnInit(): void {
    // the images of the card's deck and the common ones
    this.assetsService.getAssetUrls().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.assetUrls = this.assetsService.urlsFor(this.card?.deckId);
      this.changeDetectorRef.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['foils'] && !changes['foils'].isFirstChange()) {
      this.watchFoils();
    }
    const cardChange = changes['card'];
    const templateChange = changes['template'];

    if (cardChange && this.assetUrls) {
      this.assetUrls = this.assetsService.urlsFor(this.card?.deckId);
    }

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
   * Les zones foil et dorure (data-foil) donnent un calque « foil-<effet> » ou « dorure-<effet> », même sans `calques`.
   */
  public async captureLayers(pixelRatio: number, calques = true): Promise<Record<string, { zone: number[]; image: string }>> {
    const root = this.cardElement.get(0)?.nativeElement;
    if (!root) {
      return {};
    }
    const box = root.getBoundingClientRect();
    if (!box.width || !box.height) {
      return {};
    }
    const groups = layerGroups(root, calques);
    const out: Record<string, { zone: number[]; image: string }> = {};
    for (const [name, elements] of groups) {
      const zone = layerZone(box, elements.map(e => e.getBoundingClientRect()));
      if (!zone) {
        continue;
      }
      elements.forEach(e => e.setAttribute('data-calque-on', ''));
      try {
        out[name] = { zone, image: isZoneLayer(name)
          ? await this.visibleMask(root, pixelRatio, !name.startsWith(FOIL_LAYER_PREFIX),
            name.startsWith(EMBOSS_LAYER_PREFIX) ? [] : elements)
          : await this.layerImage(root, pixelRatio) };
      } finally {
        elements.forEach(e => e.removeAttribute('data-calque-on'));
      }
    }
    return out;
  }

  /** Image d'un calque data-calque : ses éléments seuls, le reste caché */
  private async layerImage(root: HTMLElement, pixelRatio: number): Promise<string> {
    const filter = (node: HTMLElement) => 'style' !== node.localName;
    root.classList.add('cc-layer-pass');
    try {
      return await this.imageRendererService.toPng(root, { pixelRatio, filter });
    } finally {
      root.classList.remove('cc-layer-pass');
    }
  }

  /**
   * Masque d'une zone foil ou dorure : la part de ses éléments qui se voit vraiment sur la carte.
   * La carte entière est rendue deux fois, les éléments de la zone peints en blanc puis en noir :
   * là où ils se voient, les deux rendus diffèrent ; là où un autre élément les recouvre (un bandeau
   * sur l'illustration), ils sont identiques. L'écart donne l'opacité du masque.
   * Une dorure ou un gaufrage : sans l'ombre du texte (les lettres seules). Le masque peint et la force
   * des éléments (data-foil-masque, data-foil-force) s'y appliquent.
   */
  private async visibleMask(root: HTMLElement, pixelRatio: number, gilding: boolean,
    elements: HTMLElement[] = []): Promise<string> {
    const filter = (node: HTMLElement) => 'style' !== node.localName;
    root.classList.toggle('cc-dorure-pass', gilding);
    try {
      root.classList.add('cc-zone-white');
      const white = await this.imageRendererService.toPng(root, { pixelRatio, filter });
      root.classList.replace('cc-zone-white', 'cc-zone-black');
      const black = await this.imageRendererService.toPng(root, { pixelRatio, filter });
      // masque peint et force de chaque élément (data-foil-masque, data-foil-force)
      const box = root.getBoundingClientRect();
      const factors = elements
        .map(element => ({ element, ...zoneOptions(element) }))
        .filter(z => z.masque || z.force < 1)
        .map(z => {
          const r = z.element.getBoundingClientRect();
          return { masque: z.masque, force: z.force,
            rect: [(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height] };
        });
      return await differenceMask(white, black, factors);
    } finally {
      root.classList.remove('cc-zone-white', 'cc-zone-black', 'cc-dorure-pass');
    }
  }

  /**
   * Plaque foil pour l'impression (dorure à chaud, vernis sélectif) : noir là où la carte a un foil ou une
   * dorure (data-foil) visible, blanc ailleurs ; null si le modèle n'en a pas. Masques peints et forces
   * comptent ; tout ce qui dépasse la moitié devient noir (une plaque n'a pas de demi-teinte).
   */
  public async captureFoilPlate(pixelRatio: number): Promise<string | null> {
    const root = this.cardElement.get(0)?.nativeElement;
    if (!root) {
      return null;
    }
    const elements = [...zoneGroups(root).entries()]
      .filter(([name]) => !name.startsWith(EMBOSS_LAYER_PREFIX))
      .flatMap(([, group]) => group.elements);
    if (!elements.length) {
      return null;
    }
    elements.forEach(e => e.setAttribute('data-calque-on', ''));
    try {
      const mask = await this.visibleMask(root, pixelRatio, true, elements);
      return await maskToPlate(mask);
    } finally {
      elements.forEach(e => e.removeAttribute('data-calque-on'));
    }
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

/**
 * Éléments marqués data-calque (si `calques`), regroupés par nom (minuscules ; noms invalides ignorés),
 * après les zones foil et dorure (data-foil) regroupées en « foil-<effet> » et « dorure-<effet> » ; 6 calques au plus.
 */
export function layerGroups(root: HTMLElement, calques = true): Map<string, HTMLElement[]> {
  const groups = new Map<string, HTMLElement[]>();
  for (const [name, { elements }] of zoneGroups(root)) {
    if (groups.size < 6) {
      groups.set(name, elements);
    }
  }
  root.querySelectorAll<HTMLElement>(calques ? '[data-calque]' : ':not(*)').forEach(element => {
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

/** Calque d'une zone foil ou dorure (masque de la part visible), et non d'un data-calque */
function isZoneLayer(name: string): boolean {
  return [FOIL_LAYER_PREFIX, GILDING_LAYER_PREFIX, EMBOSS_LAYER_PREFIX].some(prefix => name.startsWith(prefix));
}

/** Plaque d'impression : noir là où le masque est au moins à moitié opaque, blanc ailleurs */
export async function maskToPlate(mask: string): Promise<string> {
  const image = await loadImage(mask);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i + 3] >= 128 ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Masque peint ou force d'un élément, sur sa zone (en fraction de la carte : x, y, largeur, hauteur) */
export interface MaskFactor {
  masque: string | null;
  force: number;
  rect: number[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image illisible'));
    image.src = src;
  });
}

/**
 * Masque blanc dont l'opacité est l'écart entre deux rendus (PNG, data URL), multiplié sur la zone de
 * chaque élément par sa force et la luminosité de son masque peint (étiré sur l'élément).
 */
export async function differenceMask(a: string, b: string, factors: MaskFactor[] = []): Promise<string> {
  const [ia, ib] = await Promise.all([loadImage(a), loadImage(b)]);
  const w = ia.naturalWidth, h = ia.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(ia, 0, 0);
  const da = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(ib, 0, 0, w, h);
  const db = ctx.getImageData(0, 0, w, h).data;
  const px = da.data;
  for (let i = 0; i < px.length; i += 4) {
    const diff = Math.max(Math.abs(px[i] - db[i]), Math.abs(px[i + 1] - db[i + 1]), Math.abs(px[i + 2] - db[i + 2]));
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = diff;
  }
  for (const factor of factors) {
    const [x, y, fw, fh] = [Math.round(factor.rect[0] * w), Math.round(factor.rect[1] * h),
      Math.max(1, Math.round(factor.rect[2] * w)), Math.max(1, Math.round(factor.rect[3] * h))];
    let lum: Uint8ClampedArray | null = null;
    if (factor.masque) {
      try {
        const m = await loadImage(factor.masque);
        const c = document.createElement('canvas');
        c.width = fw;
        c.height = fh;
        const mc = c.getContext('2d', { willReadFrequently: true })!;
        mc.drawImage(m, 0, 0, fw, fh);
        lum = mc.getImageData(0, 0, fw, fh).data;
      } catch { /* masque illisible : sans masque */ }
    }
    for (let yy = Math.max(0, y); yy < Math.min(h, y + fh); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(w, x + fw); xx++) {
        const i = (yy * w + xx) * 4;
        let k = factor.force;
        if (lum) {
          const j = ((yy - y) * fw + (xx - x)) * 4;
          // luminosité du masque peint (et sa transparence : transparent = pas de foil)
          k *= (0.2126 * lum[j] + 0.7152 * lum[j + 1] + 0.0722 * lum[j + 2]) / 255 * (lum[j + 3] / 255);
        }
        px[i + 3] = Math.round(px[i + 3] * k);
      }
    }
  }
  ctx.putImageData(da, 0, 0);
  return canvas.toDataURL('image/png');
}
