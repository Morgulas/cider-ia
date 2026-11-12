import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import { appTestProviders } from '../testing/test-providers';
import { BoostersComponent } from './boosters.component';
import { BoostersService } from '../data-services/services/boosters.service';
import { CardsService } from '../data-services/services/cards.service';
import { DecksService } from '../data-services/services/decks.service';
import { AssetsService } from '../data-services/services/assets.service';
import { Booster } from '../data-services/types/booster.type';
import { Card } from '../data-services/types/card.type';
import { FieldType } from '../data-services/types/field-type.type';

const card = (id: number, deckId: number, name: string, rarete: string) =>
  ({ id, deckId, name, count: 1, rarete }) as unknown as Card;

describe('BoostersComponent', () => {
  let fixture: ComponentFixture<BoostersComponent>;
  let component: BoostersComponent;
  /** boosters as stored in the database */
  let stored: Map<number, Booster>;
  let boostersService: jasmine.SpyObj<BoostersService>;
  let nextId: number;

  const cards = [
    card(1, 10, 'Grimoire', 'Rare'),
    card(2, 10, 'Dague', 'Commune'),
    card(3, 10, 'Bouclier', 'Commune'),
    card(4, 20, 'Hors pool', 'Commune'),
  ];

  const booster = (id: number, name: string, extra: Partial<Booster> = {}) => ({
    id, name, deckIds: [10], cardsPerPack: 2, allowDuplicates: false, weights: {}, defaultWeight: 1,
    foilChance: 0, foilEffect: 'holo', design: { mode: 'form', title: name, finish: 'holo', crimped: true }, ...extra,
  }) as unknown as Booster;

  beforeEach(async () => {
    nextId = 100;
    stored = new Map([[1, booster(1, 'Booster A')], [2, booster(2, 'Booster B')]]);
    boostersService = jasmine.createSpyObj<BoostersService>('BoostersService', ['getAll', 'create', 'update', 'delete']);
    boostersService.getAll.and.callFake(async () => [...stored.values()].map(b => structuredClone(b)));
    boostersService.create.and.callFake(async entity => {
      const created = { ...structuredClone(entity), id: nextId++ };
      stored.set(created.id, created);
      return created;
    });
    // like Dexie put(): writes the whole booster, creating it again if it was deleted
    boostersService.update.and.callFake(async (id, entity) => {
      stored.set(id, structuredClone(entity));
      return entity;
    });
    boostersService.delete.and.callFake(async id => stored.delete(id));

    await TestBed.configureTestingModule({
      imports: [BoostersComponent],
      providers: [
        ...appTestProviders,
        { provide: BoostersService, useValue: boostersService },
        {
          provide: CardsService, useValue: {
            getAllUnfiltered: async () => cards,
            getFieldsUnfiltered: async () => [
              { field: 'name', header: 'Name', type: FieldType.text },
              { field: 'rarete', header: 'Rareté', type: FieldType.dropdown, options: ['Commune', 'Rare'] },
            ],
          },
        },
        {
          provide: DecksService, useValue: {
            getAll: async () => [{ id: 10, name: 'Livres' }, { id: 20, name: 'Autre' }],
            getSelectedDeck: () => of(undefined),
          },
        },
        { provide: AssetsService, useValue: { assetUrls: of({}), getAllMetadata: async () => [] } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoostersComponent);
    component = fixture.componentInstance;
  });

  /** Starts the component without rendering it (editors, previews) */
  const start = () => {
    component.ngOnInit();
    flushMicrotasks();
  };

  const confirmDialog = () => fixture.debugElement.injector.get(ConfirmationService);

  it('loads the boosters and groups the cards by rarity', fakeAsync(() => {
    start();
    expect(component.booster?.name).toBe('Booster A');
    expect(component.groupField).toBe('rarete');
    // only the decks of the pool
    expect(component.rows.map(row => row.card.name)).toEqual(['Grimoire', 'Dague', 'Bouclier']);
    expect(component.groupWeights).toEqual([
      { value: 'Commune', count: 2, weight: 1 },
      { value: 'Rare', count: 1, weight: 1 },
    ]);
    expect(component.rows.every(row => Math.abs(row.chance - 1 / 3) < 1e-9)).toBeTrue();
  }));

  it('saves a weight change shortly after, with the new chances', fakeAsync(() => {
    start();
    const rare = component.rows.find(row => row.card.name === 'Grimoire')!;
    component.setWeight(rare, 0);
    expect(component.rows.find(row => row.card.name === 'Grimoire')!.chance).toBe(0);
    expect(component.pool.length).toBe(2);
    expect(boostersService.update).not.toHaveBeenCalled();
    tick(400);
    expect(stored.get(1)!.weights).toEqual({ 1: 0 });
  }));

  it('gives the same weight to every card of a rarity', fakeAsync(() => {
    start();
    component.applyGroupWeight({ value: 'Commune', weight: 9 });
    tick(400);
    expect(stored.get(1)!.weights).toEqual({ 2: 9, 3: 9 });
    expect(component.groupShare('Commune')).toBeCloseTo(18 / 19, 9);
  }));

  it('keeps the changes of a booster when another one is edited right after', fakeAsync(() => {
    start();
    component.setWeight(component.rows[0], 5);
    // within the save delay: switch to B and edit it
    component.select(component.boosters[1]);
    component.setWeight(component.rows[0], 7);
    tick(400);
    flushMicrotasks();
    expect(stored.get(1)!.weights).toEqual({ 1: 5 });
    expect(stored.get(2)!.weights).toEqual({ 1: 7 });
  }));

  it('does not bring back a deleted booster with a pending save', fakeAsync(() => {
    start();
    component.setWeight(component.rows[0], 5);
    spyOn(confirmDialog(), 'confirm').and.callFake(confirmation => {
      void confirmation.accept!();
      return confirmDialog();
    });
    component.remove();
    flushMicrotasks();
    tick(400);
    flushMicrotasks();
    expect(stored.has(1)).toBeFalse();
    expect(component.boosters.map(b => b.name)).toEqual(['Booster B']);
    expect(component.booster?.name).toBe('Booster B');
  }));

  it('saves pending changes when the page is left', fakeAsync(() => {
    start();
    component.setWeight(component.rows[0], 3);
    component.ngOnDestroy();
    flushMicrotasks();
    expect(stored.get(1)!.weights).toEqual({ 1: 3 });
  }));

  it('creates a booster over every deck, and duplicates one with its weights', fakeAsync(() => {
    start();
    component.applyGroupWeight({ value: 'Rare', weight: 4 });
    component.duplicate();
    flushMicrotasks();
    const copy = component.booster!;
    expect(copy.name).toBe('Booster A (2)');
    expect(copy.weights).toEqual({ 1: 4 });
    expect(copy.id).not.toBe(1);

    component.create();
    flushMicrotasks();
    expect(component.booster!.deckIds).toEqual([10, 20]);
    expect(component.rows.length).toBe(4);
    tick(400);
  }));

  it('completes boosters saved by an earlier version', fakeAsync(() => {
    stored.set(1, { id: 1, name: 'Ancien', deckIds: [10], cardsPerPack: 3 } as unknown as Booster);
    start();
    const old = component.boosters.find(b => b.id === 1)!;
    expect(old.weights).toEqual({});
    expect(old.defaultWeight).toBe(1);
    expect(old.design.title).toBe('Ancien');
    expect(component.rows.length).toBe(3);
  }));

  it('counts the cards pulled during the session', fakeAsync(() => {
    start();
    const [grimoire, dague] = cards;
    component.onPackOpened([{ card: grimoire, foil: 'holo' }, { card: dague, foil: null }]);
    component.onPackOpened([{ card: grimoire, foil: null }]);
    expect(component.openedPacks).toBe(2);
    expect(component.collected.map(c => [c.card.name, c.copies, c.foils])).toEqual([['Dague', 1, 0], ['Grimoire', 2, 1]]);
    expect(component.collectedProgress()).toBeCloseTo(2 / 3, 9);
    component.resetSession();
    expect(component.collected).toEqual([]);
  }));
});
