import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import JSZip from 'jszip';
import { of } from 'rxjs';

import { ExportCardsComponent } from './export-cards.component';
import { CardsService } from '../data-services/services/cards.service';
import { DecksService } from '../data-services/services/decks.service';
import { BoostersService } from '../data-services/services/boosters.service';
import { CardTransferService } from '../cards-transfer/card-transfer.service';
import { CurrentProjectService } from '../server/current-project.service';
import { ImageRendererService } from '../data-services/services/image-renderer.service';
import { DeckColumn, exportJson } from '../cards-transfer/card-transfer';
import { FieldType } from '../data-services/types/field-type.type';
import { Card } from '../data-services/types/card.type';
import { Booster } from '../data-services/types/booster.type';
import { Deck } from '../data-services/types/deck.type';
import FileUtils from '../shared/utils/file-utils';
import GeneralUtils from '../shared/utils/general-utils';

/** 1×1 transparent PNG */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const columns: DeckColumn[] = [
  { field: 'name', header: 'Name', type: FieldType.text },
  { field: 'frontCardTemplateId', header: 'Front Template', type: FieldType.dropdown, template: true },
  { field: 'cardid', header: 'CardID', type: FieldType.text },
  { field: 'rarete', header: 'Rareté', type: FieldType.dropdown, options: ['Commune', 'Rare'] },
];

const card = (id: number, name: string, cardid: string, rarete: string) =>
  ({ id, name, count: 1, frontCardTemplateId: 1, deckId: 7, cardid, rarete }) as unknown as Card;

describe('ExportCardsComponent', () => {
  let component: ExportCardsComponent;
  let fixture: ComponentFixture<ExportCardsComponent>;
  let cards: Card[];
  let deck: Deck;
  let boosters: Booster[];
  let decks: jasmine.SpyObj<DecksService>;
  let transfer: jasmine.SpyObj<CardTransferService>;
  let renderer: jasmine.SpyObj<ImageRendererService>;
  let saved: { blob: Blob; name: string } | undefined;

  beforeEach(async () => {
    cards = [card(11, 'Grimoire', 'LDF001', 'Rare'), card(12, 'Dague', 'LDF002', 'Commune')];
    deck = { id: 7, name: 'Livres de Fangh' } as Deck;
    boosters = [];
    saved = undefined;

    decks = jasmine.createSpyObj<DecksService>('DecksService', ['get', 'update', 'getSelectedDeck']);
    // other deck-scoped services (templates...) ask for the selected deck
    decks.getSelectedDeck.and.callFake(() => of(deck));
    decks.get.and.callFake(async () => ({ ...deck }));
    decks.update.and.callFake(async (_id, entity) => {
      deck = entity as Deck;
      return deck;
    });
    transfer = jasmine.createSpyObj<CardTransferService>('CardTransferService', ['export']);
    // same order as asked, cards unknown to the deck left out (as the real service does)
    transfer.export.and.callFake(async (_deckId, deckName, _format, ids) => {
      const selected = (ids ?? []).map(id => cards.find(c => c.id === id)).filter(c => !!c);
      return new Blob([exportJson(deckName, columns, selected as unknown as Record<string, unknown>[],
        [{ id: 1, name: 'Recto' }])]);
    });
    renderer = jasmine.createSpyObj<ImageRendererService>('ImageRendererService', ['toPng']);
    renderer.toPng.and.resolveTo(PNG);

    await TestBed.configureTestingModule({
      imports: [ExportCardsComponent],
      providers: [
        ...appTestProviders,
        {
          provide: ActivatedRoute, useValue: {
            snapshot: { paramMap: convertToParamMap({ deckId: '7' }), queryParamMap: convertToParamMap({}) },
          },
        },
        { provide: CardsService, useValue: { getAll: async () => [...cards] } },
        { provide: DecksService, useValue: decks },
        { provide: BoostersService, useValue: { getAll: async () => boosters } },
        { provide: CardTransferService, useValue: transfer },
        { provide: ImageRendererService, useValue: renderer },
        { provide: CurrentProjectService, useValue: { project: signal({ id: 'p1', name: 'Terre de Fangh' }) } },
      ],
    }).compileComponents();

    spyOn(FileUtils, 'saveAs').and.callFake((blob: Blob, name: string) => {
      saved = { blob, name };
    });
    spyOn(GeneralUtils, 'delay').and.resolveTo();
  });

  /** Creates the component without rendering it: card images come from a stub */
  const create = async () => {
    fixture = TestBed.createComponent(ExportCardsComponent);
    component = fixture.componentInstance;
    // constructor loads (cards, boosters, deck settings)
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve));
    spyOn(component as unknown as { renderSingularImages: () => Promise<File[]> }, 'renderSingularImages')
      .and.callFake((async (fileName: (card: Card, side: 'front' | 'back') => string) => component.cards
        .flatMap(c => [new File(['front'], fileName(c, 'front')), new File(['back'], fileName(c, 'back'))])) as never);
  };

  const zipContent = async () => {
    expect(saved).toBeDefined();
    const zip = await JSZip.loadAsync(saved!.blob);
    const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();
    const setJson = JSON.parse(await zip.file('set.json')!.async('string'));
    return { names, setJson };
  };

  it('suggests the set settings from the deck name', async () => {
    await create();
    expect(component.collector).toEqual({ code: 'LIVRES-DE-FANGH', nom: 'Livres de Fangh', univers: '', publication: 1 });
  });

  it('publishes a ZIP with set.json and one image per side, named by CardID', async () => {
    await create();
    await component.exportCollectorSet();

    expect(component.collectorErrors).toEqual([]);
    expect(transfer.export).toHaveBeenCalledOnceWith(7, 'Livres de Fangh', 'json', [11, 12]);
    expect(saved!.name).toBe('LIVRES-DE-FANGH_p1.zip');
    const { names, setJson } = await zipContent();
    expect(names).toEqual([
      'cards/LDF001_back.png', 'cards/LDF001_front.png', 'cards/LDF002_back.png', 'cards/LDF002_front.png', 'set.json',
    ]);
    // the universe is the project name, imposed
    expect(setJson.set).toEqual({ code: 'LIVRES-DE-FANGH', nom: 'Livres de Fangh', univers: 'Terre de Fangh', publication: 1 });
    expect(setJson.cartes.map((c: Record<string, unknown>) => c['CardID'])).toEqual(['LDF001', 'LDF002']);
    expect(component.collectorDone).toContain('2 cartes');
  });

  it('raises the publication number and keeps the settings in the deck', async () => {
    deck = { ...deck, collectorSet: { code: 'FANGH-S1', nom: 'Série 1', univers: 'ancien', publication: 4 } };
    await create();
    await component.exportCollectorSet();

    expect(saved!.name).toBe('FANGH-S1_p4.zip');
    expect((await zipContent()).setJson.set.publication).toBe(4);
    expect(component.collector.publication).toBe(5);
    expect(deck.collectorSet).toEqual(jasmine.objectContaining({ code: 'FANGH-S1', publication: 5, univers: 'Terre de Fangh' }));
  });

  it('publishes only the cards of the selection, in their order', async () => {
    await create();
    component.cards = [cards[1]];
    await component.exportCollectorSet();

    expect(transfer.export).toHaveBeenCalledOnceWith(7, 'Livres de Fangh', 'json', [12]);
    const { names, setJson } = await zipContent();
    expect(names).toEqual(['cards/LDF002_back.png', 'cards/LDF002_front.png', 'set.json']);
    expect(setJson.cartes.length).toBe(1);
  });

  it('shows the errors and publishes nothing when a card has no valid CardID', async () => {
    cards[1] = card(12, 'Dague', 'LDF001', 'Commune');
    await create();
    await component.exportCollectorSet();

    expect(component.collectorErrors.join('\n')).toContain('en double');
    expect(saved).toBeUndefined();
    expect(decks.update).not.toHaveBeenCalled();
    expect(component.collector.publication).toBe(1);
  });

  it('refuses to publish when a card was deleted since the page was opened', async () => {
    await create();
    // deleted from another tab: the export no longer has it, every later name would shift
    cards.splice(0, 1);
    await component.exportCollectorSet();

    expect(component.collectorErrors.length).toBe(1);
    expect(component.collectorErrors[0]).toContain('rechargez');
    expect(saved).toBeUndefined();
  });

  it('adds the booster pack and its draws, weights taken by card', async () => {
    boosters = [{
      id: 3, name: 'Booster Fangh', deckIds: [7], cardsPerPack: 5, allowDuplicates: false,
      weights: { 12: 10 }, defaultWeight: 2, foilChance: 0, foilEffect: 'holo',
      design: { finish: 'holo', crimped: true },
    } as unknown as Booster];
    await create();
    component.collector = { ...component.collector, boosterId: 3, boosterWeights: true };
    const packs = [document.createElement('div'), document.createElement('div')];
    component.packRender = { toArray: () => packs.map(nativeElement => ({ nativeElement })) } as never;
    await component.exportCollectorSet();

    const { names, setJson } = await zipContent();
    expect(names).toContain('pack.png');
    expect(names).toContain('pack-back.png');
    expect(renderer.toPng).toHaveBeenCalledTimes(2);
    expect(setJson.set.paquet).toBe('pack.png');
    expect(setJson.set.paquet_dos).toBe('pack-back.png');
    expect(setJson.set.paquet_style).toEqual({ finition: 'holo', dentele: true });
    // card 11 has no weight of its own (default 2), card 12 weighs 10
    expect(setJson.cartes.map((c: Record<string, unknown>) => c['Poids'])).toEqual([2, 10]);
    expect(setJson.set.booster).toEqual({ slots: [{ nom: 'Cartes', nombre: 5, raretes: { Rare: 2, Commune: 10 } }] });
  });

  it('leaves the draws out unless asked', async () => {
    boosters = [{
      id: 3, name: 'Booster Fangh', deckIds: [7], cardsPerPack: 5, allowDuplicates: false,
      weights: {}, defaultWeight: 1, foilChance: 0, foilEffect: 'holo', design: { finish: 'mat', crimped: false },
    } as unknown as Booster];
    await create();
    component.collector = { ...component.collector, boosterId: 3, boosterWeights: false };
    component.packRender = { toArray: () => [] } as never;
    await component.exportCollectorSet();

    const { setJson } = await zipContent();
    expect(setJson.set.booster).toBeUndefined();
    expect(setJson.cartes[0]['Poids']).toBeUndefined();
    expect(setJson.set.paquet_style).toEqual({ finition: 'mat', dentele: false });
  });
});
