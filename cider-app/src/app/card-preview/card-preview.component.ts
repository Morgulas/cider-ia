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
import GeneralUtils from '../shared/utils/general-utils';
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
  @ViewChildren('cardElement') cardElement: QueryList<any> = {} as QueryList<any>;
  @Input() card: Card = {} as Card;
  @Input() template: CardTemplate = {} as CardTemplate;
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
  assetUrls: any;
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
    private element: ElementRef,
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
    const scaleChange = changes['scale'];

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
          () => GeneralUtils.delay(2000).then(() => this.toImageUrl()))
          // completes by itself (AsyncSubject), and may run after the preview is destroyed:
          // no takeUntilDestroyed here
          .subscribe({
            next: (cachedImageUrl) => {
              this.cachedImageUrl = cachedImageUrl;
              GeneralUtils.delay(1000).then(() => {
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

  public getHash(): number {
    const html = this.cardToHtmlPipe.transform(this.template, this.card, this.assetUrls);
    return this.renderCacheService.calculateHash((html as any).changingThisBreaksApplicationSecurity);
  }

  public toImageUrl(): Promise<string> {
    const filter = (node: HTMLElement) => {
      return 'style' !== node.localName;
    };
    return this.imageRendererService.toPng((this.cardElement.get(0) as any).nativeElement, { pixelRatio: 1.0, filter: filter });
  }

  public isLoaded() {
    return this.isLoadedSubject.asObservable();
  }

  public isCacheLoaded() {
    return this.isCacheLoadedSubject.asObservable();
  }
}

