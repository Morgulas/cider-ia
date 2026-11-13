import { newBooster } from './booster-logic';
import { designToTemplate, syncTemplate, templateSignature } from './booster-template';

describe('booster-template', () => {
  it('régénère un modèle jamais retouché pour suivre les réglages', () => {
    const design = newBooster('b', []).design;
    expect(syncTemplate(design, designToTemplate(design)).stale).toBeFalse();
    const first = design.html;
    // réglages changés en mode simple, puis retour au mode modèle
    design.showTitle = false;
    design.background = 'aucun';
    expect(syncTemplate(design, designToTemplate(design)).stale).toBeFalse();
    expect(design.html).not.toBe(first);
    expect(design.templateFrom).toBe(templateSignature(design));
  });

  it('conserve un modèle retouché à la main, et le signale si les réglages ont changé', () => {
    const design = newBooster('b', []).design;
    syncTemplate(design, designToTemplate(design));
    design.css += '\n.pack-title { color: red; }';
    const edited = design.css;
    expect(syncTemplate(design, designToTemplate(design)).stale).toBeTrue();
    expect(design.css).toBe(edited);
  });

  it('traite un ancien modèle (sans empreinte) comme retouché', () => {
    const design = { ...newBooster('b', []).design, html: '<div>ancien</div>', css: '' };
    expect(syncTemplate(design, designToTemplate(design)).stale).toBeTrue();
    expect(design.html).toBe('<div>ancien</div>');
  });
});
