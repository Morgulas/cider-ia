import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CardPreviewComponent, layerGroups, layerZone } from './card-preview.component';

describe('CardPreviewComponent', () => {
  let component: CardPreviewComponent;
  let fixture: ComponentFixture<CardPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
    imports: [CardPreviewComponent],
    providers: [...appTestProviders]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CardPreviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('layers of a card (export to the collection app)', () => {
  it('groups the elements marked data-calque by valid name', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-calque="Illustration"></div><span data-calque="texte"></span>'
      + '<b data-calque="texte"></b><i data-calque="pas valide!"></i>';
    const groups = layerGroups(root);
    expect([...groups.keys()]).toEqual(['illustration', 'texte']);
    expect(groups.get('texte')?.length).toBe(2);
  });

  it('gives the zone in percent of the card, union of the elements, clamped', () => {
    const card = { left: 100, top: 50, width: 200, height: 400 };
    expect(layerZone(card, [{ left: 110, top: 90, right: 290, bottom: 250 }])).toEqual([5, 10, 90, 40]);
    expect(layerZone(card, [{ left: 90, top: 50, right: 200, bottom: 100 }, { left: 150, top: 400, right: 320, bottom: 500 }]))
      .toEqual([0, 0, 100, 100]);
    expect(layerZone(card, [{ left: 10, top: 10, right: 10, bottom: 30 }])).toBeNull();
  });
});
