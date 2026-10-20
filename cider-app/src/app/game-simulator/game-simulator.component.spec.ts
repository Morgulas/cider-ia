import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameSimulatorComponent } from './game-simulator.component';
import { DecksService } from '../data-services/services/decks.service';
import { CardsService } from '../data-services/services/cards.service';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { TranslateService } from '@ngx-translate/core';
import { NgZone } from '@angular/core';
import { GameSimulatorStateService } from './game-simulator-state.service';

describe('GameSimulatorComponent', () => {
  let component: GameSimulatorComponent;
  let decksServiceSpy: jasmine.SpyObj<DecksService>;
  let cardsServiceSpy: jasmine.SpyObj<CardsService>;
  let translateServiceSpy: jasmine.SpyObj<TranslateService>;
  let cardTemplatesServiceSpy: jasmine.SpyObj<CardTemplatesService>;
  // minimal game state: the component reads stacks and discard from it
  let gameState: any;

  beforeEach(() => {
    decksServiceSpy = jasmine.createSpyObj('DecksService', ['getAll']);
    cardsServiceSpy = jasmine.createSpyObj('CardsService', ['getAll', 'getFieldsUnfiltered']);
    translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);
    // not used by the drag logic under test
    cardTemplatesServiceSpy = {} as jasmine.SpyObj<CardTemplatesService>;

    decksServiceSpy.getAll.and.returnValue(Promise.resolve([]));
    cardsServiceSpy.getAll.and.returnValue(Promise.resolve([]));

    gameState = {
      initialized: true,
      stacks: [],
      discard: undefined,
      bringToFront: jasmine.createSpy('bringToFront')
    };
    const ngZone = { run: (fn: () => any) => fn() } as unknown as NgZone;

    component = new GameSimulatorComponent(
      decksServiceSpy,
      cardsServiceSpy,
      translateServiceSpy,
      cardTemplatesServiceSpy,
      gameState as GameSimulatorStateService,
      ngZone
    );

    // Manually trigger initialization if needed, but constructor called resetGame which calls services
    // Since we are unit testing logic, we can manually setup state
  });

  it('should preserve discard stack and reposition it when merged into another stack', () => {
    // Setup
    const targetStack = {
      uniqueId: 'target-1',
      name: 'Target Stack',
      cards: [{ uniqueId: 'c1' }, { uniqueId: 'c2' }],
      faceUp: false,
      pos: { x: 100, y: 100 },
      deletable: true
    } as any;

    const discardStack = {
      uniqueId: 'discard-1',
      name: 'Discard',
      cards: [{ uniqueId: 'd1' }],
      faceUp: true,
      pos: { x: 500, y: 500 },
      deletable: false
    } as any;

    gameState.stacks = [targetStack, discardStack];
    gameState.discard = discardStack;
    component['draggingStack'] = true;
    component['hoveredItem'] = targetStack;

    // Simulate drag end
    const event = {
      source: {
        getFreeDragPosition: () => ({ x: 100, y: 100 }), // Dropped near target
        getRootElement: () => null
      }
    } as any;

    // Act
    component.onDragEnded(event, component.stacks, discardStack);

    // Assert
    // 1. Cards should be moved to target stack
    expect(targetStack.cards.length).toBe(3);
    expect(targetStack.cards.find((c: any) => c.uniqueId === 'd1')).toBeTruthy();

    // 2. Discard stack should be empty
    expect(discardStack.cards.length).toBe(0);

    // 3. Discard stack should NOT be removed from stacks array
    expect(component.stacks.length).toBe(2);
    expect(component.stacks).toContain(discardStack);

    // 4. Discard stack should be repositioned
    // Since gameBoundary is not mocked, clampPosition returns input pos.
    // Logic: newX = targetStack.pos.x + 120 = 220
    // Logic: newY = targetStack.pos.y + 20 = 120
    expect(discardStack.pos.x).toBe(220);
    expect(discardStack.pos.y).toBe(120);
  });

  it('should delete normal stack when merged into another stack', () => {
    // Setup
    const targetStack = {
      uniqueId: 'target-1',
      name: 'Target Stack',
      cards: [{ uniqueId: 'c1' }],
      faceUp: false,
      pos: { x: 100, y: 100 },
      deletable: true
    } as any;

    const sourceStack = {
      uniqueId: 'source-1',
      name: 'Source Stack',
      cards: [{ uniqueId: 's1' }],
      faceUp: true,
      pos: { x: 500, y: 500 },
      deletable: true
    } as any;

    gameState.stacks = [targetStack, sourceStack];
    // gameState.discard is undefined: the source stack is a normal stack
    component['draggingStack'] = true;
    component['hoveredItem'] = targetStack;

    // Simulate drag end
    const event = {
      source: {
        getFreeDragPosition: () => ({ x: 100, y: 100 }),
        getRootElement: () => null
      }
    } as any;

    // Act
    component.onDragEnded(event, component.stacks, sourceStack);

    // Assert
    // 1. Cards should be moved
    expect(targetStack.cards.length).toBe(2);

    // 2. Source stack should be removed
    expect(component.stacks.length).toBe(1);
    expect(component.stacks).not.toContain(sourceStack);
  });
});
