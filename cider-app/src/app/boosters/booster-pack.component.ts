import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import * as Handlebars from 'handlebars';
import { BoosterDesign } from '../data-services/types/booster.type';
import { AssetUrls } from '../data-services/types/asset.type';
import HtmlSanitizer from '../shared/utils/html-sanitizer';
import { registerHandlebarsHelpers } from '../shared/utils/handlebars-helpers';
import { resolveAsset } from './booster-assets';

/** Contexte des modèles HTML/CSS de booster. */
export interface BoosterTemplateContext {
  booster: { name: string; title: string; subtitle: string; cardsPerPack: number; colorA: string; colorB: string; textColor: string };
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

  readonly uid = `pack-${++packCounter}`;
  artUrl?: string;
  logoUrl?: string;
  templateHtml: SafeHtml = '';
  templateError = false;

  constructor(private sanitizer: DomSanitizer) {
    registerHandlebarsHelpers();
  }

  ngOnChanges(): void {
    this.artUrl = resolveAsset(this.assetUrls, this.design.art);
    this.logoUrl = resolveAsset(this.assetUrls, this.design.logo);
    if (this.design.mode === 'template') {
      this.renderTemplate();
    }
  }

  get backgroundStyle(): string {
    const { colorA: a, colorB: b } = this.design;
    switch (this.design.background) {
      case 'radial': return `radial-gradient(circle at 50% 40%, ${b} 0%, ${a} 75%)`;
      case 'rayures': return `repeating-linear-gradient(135deg, ${a} 0 22px, ${b} 22px 44px)`;
      case 'uni': return a;
      default: return `linear-gradient(160deg, ${a} 0%, ${b} 100%)`;
    }
  }

  /** Effet foil de l'emballage (classe foil-<effet>), ou rien pour mat/brillant. */
  get foilClass(): string | null {
    const finish = this.design.finish;
    return finish === 'mat' || finish === 'brillant' ? null : `foil foil-${finish}`;
  }

  private renderTemplate(): void {
    const context: BoosterTemplateContext = {
      booster: {
        name: this.name, title: this.design.title, subtitle: this.design.subtitle, cardsPerPack: this.cardsPerPack,
        colorA: this.design.colorA, colorB: this.design.colorB, textColor: this.design.textColor,
      },
      assets: this.assetUrls,
    };
    try {
      const html = Handlebars.compile(this.design.html || '')(context);
      const css = Handlebars.compile(this.design.css || '')(context)
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
