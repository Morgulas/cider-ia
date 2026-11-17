import { ComponentFixture, TestBed } from '@angular/core/testing';
import { appTestProviders } from '../../testing/test-providers';
import { Card } from '../../data-services/types/card.type';
import { CardTemplate } from '../../data-services/types/card-template.type';
import { CardViewer3dComponent } from './card-viewer-3d.component';

function pointer(el: Element, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
  el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true, ...extra }));
}

describe('CardViewer3dComponent', () => {
  let fixture: ComponentFixture<CardViewer3dComponent>;
  let component: CardViewer3dComponent;
  let stage: HTMLElement;
  let card3d: HTMLElement;

  beforeEach(() => {
    try { localStorage.removeItem('cider.viewer3d'); } catch { /* */ }
    TestBed.configureTestingModule({ providers: appTestProviders });
    fixture = TestBed.createComponent(CardViewer3dComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('card', { id: 1, name: 'Le Mariage', foil: 'or' } as unknown as Card);
    fixture.componentRef.setInput('front', { id: 1, html: '<div>recto</div>', css: '' } as unknown as CardTemplate);
    fixture.detectChanges();
    stage = fixture.nativeElement.querySelector('.stage');
    card3d = fixture.nativeElement.querySelector('.card3d');
    stage.setPointerCapture = () => undefined;
  });

  afterEach(() => fixture.destroy());

  it('tourne la carte en la faisant glisser', () => {
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 200, 100);
    pointer(stage, 'pointerup', 200, 100);
    expect(component.ry).toBeCloseTo(40, 5);
    expect(card3d.style.transform).toContain('rotateY(40deg)');
  });

  it('déplace la lumière avec Maj+glisser, sans tourner la carte', () => {
    pointer(stage, 'pointerdown', 10, 10, { shiftKey: true });
    pointer(stage, 'pointermove', 12, 12, { shiftKey: true });
    expect(component.ry).toBe(0);
    expect(component.settings.elevation).toBeLessThan(90);
  });

  it('l\'intensité règle le reflet des foils', () => {
    const range = fixture.nativeElement.querySelector('input[type=range]') as HTMLInputElement;
    range.value = '0';
    range.dispatchEvent(new Event('input'));
    expect(card3d.style.getPropertyValue('--glare-o')).toBe('0');
    range.value = '200';
    range.dispatchEvent(new Event('input'));
    expect(Number(card3d.style.getPropertyValue('--glare-o'))).toBeGreaterThan(0);
  });

  it('montre le foil de l\'attribut de la carte, et un verso vide sans modèle', () => {
    expect(component.cardFoil()).toBe('or');
    expect(fixture.nativeElement.querySelector('.face.front .foil.foil-or')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.face.back .no-back')).not.toBeNull();
  });
});
