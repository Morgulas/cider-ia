import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import * as Handlebars from 'handlebars';
import { BoosterBackDesign, BoosterDesign, BoosterEdge } from '../data-services/types/booster.type';
import { AssetUrls } from '../data-services/types/asset.type';
import HtmlSanitizer from '../shared/utils/html-sanitizer';
import { registerHandlebarsHelpers } from '../shared/utils/handlebars-helpers';
import { resolveAsset } from './booster-assets';
import { backOf, BOOSTER_FONTS, edgeClipPath, edgeOf, effectiveDesign } from './booster-logic';
import { packImageInfo } from './booster-outline';

/** Contexte des modèles HTML/CSS de booster. */
export interface BoosterTemplateContext {
  booster: {
    name: string; title: string; subtitle: string; cardsPerPack: number; colorA: string; colorB: string; textColor: string;
    /** verso : titre (ou nom du booster) et texte libre */
    backTitle: string; backText: string;
  };
  assets: AssetUrls;
}

let packCounter = 0;

/**
 * Le booster scellé : dessiné d'après les réglages du formulaire, ou d'après un
 * modèle HTML/CSS Handlebars. Remplit son conteneur (format 5:8 conseillé).
 */
@Component({
  selector: 'app-booster-pack',
  templateUrl: './booster-pack.component.html',
  styleUrls: ['./booster-pack.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
})
export class BoosterPackComponent implements OnChanges {
  @Input({ required: true }) design!: BoosterDesign;
  @Input() name = '';
  @Input() cardsPerPack = 0;
  @Input() assetUrls: AssetUrls = {};
  /** Face dessinée : recto ou verso du sachet. */
  @Input() side: 'front' | 'back' = 'front';

  readonly uid = `pack-${++packCounter}`;
  /** design tel qu'il est dessiné (sachet complet : illustration étirée, sans fond ni bords) */
  d!: BoosterDesign;
  artUrl?: string;
  logoUrl?: string;
  /** verso effectif (réglé ou tiré du recto) */
  back!: BoosterBackDesign;
  backArtUrl?: string;
  backLogoUrl?: string;
  templateHtml: SafeHtml = '';
  templateError = false;
  /** bords et découpe du sachet (clip-path), communs au recto et au verso */
  edge: BoosterEdge = 'lisse';
  clipPath: string | null = null;

  constructor(private sanitizer: DomSanitizer, private cdr: ChangeDetectorRef) {
    registerHandlebarsHelpers();
  }

  ngOnChanges(): void {
    this.d = effectiveDesign(this.design);
    this.artUrl = resolveAsset(this.assetUrls, this.design.art);
    this.logoUrl = resolveAsset(this.assetUrls, this.design.logo);
    this.back = backOf(this.design);
    this.backArtUrl = resolveAsset(this.assetUrls, this.back.art);
    this.backLogoUrl = resolveAsset(this.assetUrls, this.back.logo);
    this.edge = edgeOf(this.d);
    this.clipPath = edgeClipPath(this.edge, !!this.d.notches);
    if (this.d.fullArt) {
      this.outlineFrom(this.side === 'back' ? this.backArtUrl : this.artUrl);
    }
    if (this.templateMode) {
      this.renderTemplate();
    }
  }

  /** Sachet complet : la silhouette de l'illustration de la face devient la découpe du sachet. */
  private outlineFrom(url: string | undefined): void {
    // même illustration : même découpe (ngOnChanges repasse à chaque nouvel objet design, sans rien relancer)
    if (url === this.outlineUrl) {
      this.clipPath = this.outline;
      return;
    }
    this.outlineUrl = url;
    this.outline = null;
    this.clipPath = null;
    void packImageInfo(url).then(info => {
      // l'illustration a pu changer entre-temps
      if (url !== this.outlineUrl) {
        return;
      }
      this.outline = info?.outline ?? null;
      if (this.d.fullArt) {
        this.clipPath = this.outline;
        this.cdr.markForCheck();
      }
    });
  }
  private outlineUrl?: string | null = null;
  private outline: string | null = null;

  /** La face dessinée est-elle un modèle HTML/CSS ? */
  get templateMode(): boolean {
    return this.side === 'back' ? this.back?.mode === 'template' : this.design.mode === 'template';
  }

  /** Titre (et sous-titre) affichés au recto. */
  get showTitle(): boolean {
    return this.design.showTitle !== false;
  }

  get fontFamily(): string {
    return BOOSTER_FONTS[this.design.font || 'classique'];
  }

  get backTitle(): string {
    return this.back.title || this.design.title || this.name;
  }

  get backgroundStyle(): string {
    return BoosterPackComponent.background(this.d);
  }

  get backBackgroundStyle(): string {
    return BoosterPackComponent.background(this.back);
  }

  private static background(d: Pick<BoosterDesign, 'colorA' | 'colorB' | 'background'>): string {
    const { colorA: a, colorB: b } = d;
    switch (d.background) {
      case 'radial': return `radial-gradient(circle at 50% 40%, ${b} 0%, ${a} 75%)`;
      case 'rayures': return `repeating-linear-gradient(135deg, ${a} 0 22px, ${b} 22px 44px)`;
      case 'uni': return a;
      case 'aucun': return 'transparent';
      default: return `linear-gradient(160deg, ${a} 0%, ${b} 100%)`;
    }
  }

  /** Effet foil de l'emballage (classe foil-<effet>), ou rien pour mat/brillant. */
  get foilClass(): string | null {
    const finish = this.d.finish;
    return finish === 'mat' || finish === 'brillant' ? null : `foil foil-${finish}`;
  }

  private renderTemplate(): void {
    const context: BoosterTemplateContext = {
      booster: {
        name: this.name, title: this.design.title, subtitle: this.design.subtitle, cardsPerPack: this.cardsPerPack,
        colorA: this.design.colorA, colorB: this.design.colorB, textColor: this.design.textColor,
        backTitle: this.backTitle, backText: this.back.text,
      },
      assets: this.assetUrls,
    };
    try {
      const source = this.side === 'back' ? this.back : this.design;
      const html = Handlebars.compile(source.html || '')(context);
      const css = Handlebars.compile(source.css || '')(context)
        .replace(/([^{}]*\{)/g, `.${this.uid} $1`).replace(/!important/g, '');
      const safeHtml = HtmlSanitizer.sanitizeHtml(html);
      const safeCss = HtmlSanitizer.sanitizeCss(css);
      this.templateHtml = this.sanitizer.bypassSecurityTrustHtml(safeCss ? `${safeHtml}<style>${safeCss}</style>` : safeHtml);
      this.templateError = false;
    } catch {
      // modèle en cours d'écriture : on garde le dernier rendu valide
      this.templateError = true;
    }
  }
}
