import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SiteSidebarComponent, deckSwitchUrl } from './site-sidebar.component';

describe('SiteSidebarComponent', () => {
  let component: SiteSidebarComponent;
  let fixture: ComponentFixture<SiteSidebarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
    imports: [SiteSidebarComponent],
    providers: [...appTestProviders]
});
    fixture = TestBed.createComponent(SiteSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the same page when the deck picker switches deck', () => {
    expect(deckSwitchUrl('/decks/1/cards/thumbnails', 7)).toBe('/decks/7/cards/thumbnails');
    expect(deckSwitchUrl('/decks/1/export-cards?ids=1,2', 7)).toBe('/decks/7/export-cards');
    expect(deckSwitchUrl('/decks/1/templates/12', 7)).toBe('/decks/7/cards/listing');
    expect(deckSwitchUrl('/decks/1', 7)).toBe('/decks/7/cards/listing');
  });
});
