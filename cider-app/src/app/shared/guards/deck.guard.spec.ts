import { TestBed } from '@angular/core/testing';

import { DeckGuard } from './deck.guard';
import { DecksService } from 'src/app/data-services/services/decks.service';

describe('DeckGuard', () => {
  let guard: DeckGuard;

  beforeEach(() => {
    // DecksService is backed by IndexedDB: replace it, the guard is only created here
    TestBed.configureTestingModule({
      providers: [{ provide: DecksService, useValue: {} }]
    });
    guard = TestBed.inject(DeckGuard);
  });

  it('should be created', () => {
    expect(guard).toBeTruthy();
  });
});
