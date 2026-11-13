import { BoosterBackDesign, BoosterDesign } from '../data-services/types/booster.type';
import { BOOSTER_FONTS } from './booster-logic';

/** Fond CSS correspondant aux réglages du formulaire. */
function backgroundCss(design: Pick<BoosterDesign, 'background'>): string {
  switch (design.background) {
    case 'radial': return 'radial-gradient(circle at 50% 40%, var(--couleur-b) 0%, var(--couleur-a) 75%)';
    case 'rayures': return 'repeating-linear-gradient(135deg, var(--couleur-a) 0 22px, var(--couleur-b) 22px 44px)';
    case 'uni': return 'var(--couleur-a)';
    case 'aucun': return 'transparent';
    default: return 'linear-gradient(160deg, var(--couleur-a) 0%, var(--couleur-b) 100%)';
  }
}

/**
 * Point de départ du mode modèle : le HTML et le CSS qui redonnent le booster des
 * réglages du formulaire. Les couleurs sont des variables CSS, en tête du CSS.
 */
export function designToTemplate(design: BoosterDesign): { html: string; css: string } {
  const art = design.art ? `\n  <img class="illustration" src="{{assets.${design.art}}}" alt="">` : '';
  const logo = design.logo ? `\n    <img class="logo" src="{{assets.${design.logo}}}" alt="">` : '';
  const title = design.showTitle === false ? '' : `
    <div class="titre">{{booster.title}}</div>
    {{#if booster.subtitle}}<div class="sous-titre">{{booster.subtitle}}</div>{{/if}}`;
  const band = logo || title ? `\n  <div class="bandeau">${logo}${title}\n  </div>` : '';
  const count = design.showCount === false ? '' : '\n  <div class="nombre">{{booster.cardsPerPack}} cartes</div>';
  const html = `<div class="booster">${art}${band}${count}
</div>`;
  const pos = design.textPos || 'bas';
  const scale = (design.titleSize ?? 100) / 100;
  const bandBg = design.band === false ? 'none'
    : pos === 'haut' ? 'linear-gradient(to bottom, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0))'
      : pos === 'milieu' ? 'linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.5) 30%, rgba(0, 0, 0, 0.5) 70%, rgba(0, 0, 0, 0))'
        : 'linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0))';
  const css = `.booster {
  --couleur-a: ${design.colorA};
  --couleur-b: ${design.colorB};
  --couleur-texte: ${design.textColor};
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: ${pos === 'haut' ? 'flex-start' : pos === 'milieu' ? 'center' : 'flex-end'};
  background: ${backgroundCss(design)};
  color: var(--couleur-texte);
  font-family: ${BOOSTER_FONTS[design.font || 'classique']};
}

.illustration {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: ${design.artFit || 'cover'};
  object-position: 50% ${design.artPos ?? 50}%;
}

.bandeau {
  position: relative;
  width: 100%;
  padding: 5cqh 6cqw 4cqh;
  box-sizing: border-box;
  margin: ${pos === 'haut' ? '9cqh 0 0' : pos === 'milieu' ? '0' : '0 0 9cqh'};
  text-align: center;
  background: ${bandBg};
}

.logo {
  display: block;
  max-width: 60%;
  max-height: 18cqh;
  margin: 0 auto 2cqh;
}

.titre {
  font-size: ${+(11 * scale).toFixed(2)}cqw;
  font-weight: bold;
  line-height: 1.05;
  text-shadow: 0 0.6cqw 1.5cqw rgba(0, 0, 0, 0.6);
}

.sous-titre {
  margin-top: 1.5cqh;
  font-size: ${+(5 * scale).toFixed(2)}cqw;
  font-style: italic;
}

.nombre {
  position: absolute;
  bottom: 5cqh;
  font-size: 4cqw;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  opacity: 0.8;
}
`;
  return { html, css };
}

/**
 * Point de départ du modèle du verso : le HTML et le CSS qui redonnent le verso des réglages.
 * Contexte en plus du recto : {{booster.backTitle}}, {{booster.backText}}.
 */
export function backToTemplate(back: BoosterBackDesign, font?: BoosterDesign['font']): { html: string; css: string } {
  const art = back.art ? `\n  <img class="illustration" src="{{assets.${back.art}}}" alt="">` : '';
  const logo = back.logo ? `\n    <img class="logo" src="{{assets.${back.logo}}}" alt="">` : '';
  const count = back.showCount ? '\n    <div class="nombre">{{booster.cardsPerPack}} cartes</div>' : '';
  const barcode = back.barcode ? '\n  <div class="code-barres"></div>' : '';
  const html = `<div class="verso">${art}
  <div class="contenu">${logo}
${back.showTitle === false ? '' : '    <div class="titre">{{booster.backTitle}}</div>\n'}    {{#if booster.backText}}<div class="texte">{{booster.backText}}</div>{{/if}}${count}
  </div>${barcode}
</div>`;
  const css = `.verso {
  --couleur-a: ${back.colorA};
  --couleur-b: ${back.colorB};
  --couleur-texte: ${back.textColor};
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${backgroundCss(back)};
  color: var(--couleur-texte);
  font-family: ${BOOSTER_FONTS[font || 'classique']};
}

.illustration {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: ${back.artFit || 'cover'};
  object-position: 50% ${back.artPos ?? 50}%;
  opacity: ${(back.artOpacity ?? 25) / 100};
}

.contenu {
  position: relative;
  width: 76%;
  text-align: center;
}

.logo {
  display: block;
  max-width: 50%;
  max-height: 14cqh;
  margin: 0 auto 3cqh;
}

.titre {
  font-size: 8cqw;
  font-weight: bold;
}

.texte {
  margin-top: 3cqh;
  font-size: 4.2cqw;
  line-height: 1.35;
  white-space: pre-line;
}

.nombre {
  display: inline-block;
  margin-top: 4cqh;
  padding: 1.5cqw 4cqw;
  border: 1px solid currentColor;
  border-radius: 2cqw;
  font-size: 3.8cqw;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.code-barres {
  position: absolute;
  right: 8cqw;
  bottom: 10cqh;
  width: 26cqw;
  height: 8cqw;
  opacity: 0.75;
  background: repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 3px,
    currentColor 3px 5px, transparent 5px 6px, currentColor 6px 7px, transparent 7px 10px);
}
`;
  return { html, css };
}
