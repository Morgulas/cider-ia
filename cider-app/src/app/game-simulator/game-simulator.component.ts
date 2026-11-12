import { Component, HostListener, ElementRef, NgZone, ViewChild, OnDestroy, OnInit, AfterViewInit, inject } from '@angular/core';
import { DecksService } from '../data-services/services/decks.service';
import { CardsService } from '../data-services/services/cards.service';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { Card } from '../data-services/types/card.type';
import { FieldType } from '../data-services/types/field-type.type';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ContextMenu } from 'primeng/contextmenu';
import { CdkDragEnd, CdkDragStart, DragRef, Point, CdkDropListGroup, CdkDrag } from '@angular/cdk/drag-drop';
import MathUtils from '../shared/utils/math-utils';
import { EntityField } from '../data-services/types/entity-field.type';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { GameSimulatorStateService } from './game-simulator-state.service';
import { GameSimulatorMenus } from './game-simulator-menus';
import GameSimulatorActions from './game-simulator-actions';
import { CardStack, GameCard, GameComponent, Player, PlayerCounter, Position, Positionable, SimulatorSave, TableZone } from './game-simulator.types';
import { BoostersService } from '../data-services/services/boosters.service';
import { SimulatorSavesService } from '../data-services/services/simulator-saves.service';
import { Booster } from '../data-services/types/booster.type';
import { openBooster, poolOf } from '../boosters/booster-logic';
import { findFoilField } from '../card-binder/foil';
import StringUtils from '../shared/utils/string-utils';
import { CardFitComponent } from '../card-binder/card-fit.component';
import { TieredMenu } from 'primeng/tieredmenu';
import { Tooltip } from 'primeng/tooltip';
import { Checkbox } from 'primeng/checkbox';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Toast } from 'primeng/toast';
import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { NgStyle, AsyncPipe } from '@angular/common';
import { CardPreviewComponent } from '../card-preview/card-preview.component';
import { Bind } from 'primeng/bind';
import { Dialog } from 'primeng/dialog';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { Button } from 'primeng/button';
import { EntityPipe } from '../data-services/pipes/entity.pipe';



/** A position scaled to the zoom, with the position it was computed from */
interface ScaledPos extends Point {
  sourceX: number;
  sourceY: number;
}

@Component({
    selector: 'app-game-simulator',
    templateUrl: './game-simulator.component.html',
    styleUrls: ['./game-simulator.component.scss', './game-simulator-table.component.scss'],
    imports: [CdkDropListGroup, NgStyle, CdkDrag, CdkDragHandle, CardPreviewComponent, CardFitComponent, Bind, Dialog, FormsModule, InputText, Button, ContextMenu, TieredMenu, Tooltip, Checkbox, ConfirmDialog, Toast, AsyncPipe, EntityPipe, TranslatePipe],
    providers: [ConfirmationService, MessageService]
})
export class GameSimulatorComponent implements OnInit, OnDestroy, AfterViewInit {
  public static readonly BASE_CARD_WIDTH = 825; // Approximated from visual reference or default - Fallback only
  public static readonly BASE_CARD_HEIGHT = 1125;
  static readonly TABLE_MIN = -5000;
  static readonly TABLE_MAX = 5000;

  public readonly baseCardWidth = GameSimulatorComponent.BASE_CARD_WIDTH;
  public readonly baseCardHeight = GameSimulatorComponent.BASE_CARD_HEIGHT;

  @ViewChild('gameBoundary') gameBoundary!: ElementRef;

  get stacks() { return this.gameStateService.stacks; }
  get field() { return this.gameStateService.field; }
  get components() { return this.gameStateService.components; }
  get discard() { return this.gameStateService.discard; }

  get simulatorPan() { return this.gameStateService.simulatorPan; }
  set simulatorPan(value: Position) { this.gameStateService.simulatorPan = value; }
  get simulatorZoom() { return this.gameStateService.simulatorZoom; }
  set simulatorZoom(value: number) { this.gameStateService.simulatorZoom = value; }
  get dragScale() { return this.simulatorZoom; }

  get tableStyle() {
    const size = GameSimulatorComponent.TABLE_MAX - GameSimulatorComponent.TABLE_MIN;
    return {
      top: GameSimulatorComponent.TABLE_MIN + 'px',
      left: GameSimulatorComponent.TABLE_MIN + 'px',
      width: size + 'px',
      height: size + 'px'
    };
  }

  offScreenIndicators = { top: 0, bottom: 0, left: 0, right: 0 };
  private isPanning = false;
  public isShiftPressed = false;

  private _scaledPosMap = new Map<string, ScaledPos>();
  private _lastZoomForScaledPos = 1;

  public getScaledPos(item: Positionable): Point {
    if (this._lastZoomForScaledPos !== this.simulatorZoom) {
      this._lastZoomForScaledPos = this.simulatorZoom;
      this._scaledPosMap.clear();
    }

    const key = (item as Partial<GameCard>).uniqueId ?? '';
    let cached = this._scaledPosMap.get(key);
    if (!cached || cached.sourceX !== item.pos.x || cached.sourceY !== item.pos.y) {
      cached = {
        x: item.pos.x * this.simulatorZoom,
        y: item.pos.y * this.simulatorZoom,
        sourceX: item.pos.x,
        sourceY: item.pos.y
      };
      this._scaledPosMap.set(key, cached);
    }
    return cached;
  }
  private lastPanPos = { x: 0, y: 0 };

  zoomMagnifiedLevel = 0.40;
  contextMenuItems: MenuItem[] = [];
  private readonly menus: GameSimulatorMenus;
  hoveredItem: Positionable | undefined;
  draggingCard = false;
  draggingStack = false;
  draggingComponent = false;

  renameDialogVisible = false;
  renameStackName = '';
  shortcutsVisible = false;
  stackToRename: { name: string } | undefined;
  renameTitleKey = 'simulator.rename-stack';
  isZooming = false;
  private zoomTimeout?: ReturnType<typeof setTimeout>;

  saveStackName() {
    if (this.stackToRename && this.renameStackName.trim().length > 0) {
      this.stackToRename.name = this.renameStackName;
      this.renameDialogVisible = false;
      this.renameTitleKey = 'simulator.rename-stack';
    }
  }

  cancelRename() {
    this.renameDialogVisible = false;
    this.stackToRename = undefined;
    this.renameStackName = '';
  }

  showShortcuts() {
    this.shortcutsVisible = true;
  }

  drawSpecificCardDialogVisible = false;
  drawSpecificCardSearchQuery = '';
  drawSpecificCardStack: CardStack | undefined;
  filteredCards: GameCard[] = [];

  openDrawSpecificCardDialog(stack: CardStack) {
    this.drawSpecificCardStack = stack;
    this.drawSpecificCardSearchQuery = '';
    this.filterCards();
    this.drawSpecificCardDialogVisible = true;
  }

  filterCards() {
    if (!this.drawSpecificCardStack) {
      this.filteredCards = [];
      return;
    }
    if (!this.drawSpecificCardSearchQuery.trim()) {
      this.filteredCards = [...this.drawSpecificCardStack.cards];
    } else {
      const query = this.drawSpecificCardSearchQuery.toLowerCase();
      this.filteredCards = this.drawSpecificCardStack.cards.filter(gameCard =>
        gameCard.card.name.toLowerCase().includes(query)
      );
    }
  }

  onDrawSpecificCardSelect(card: GameCard) {
    if (this.drawSpecificCardStack) {
      this.drawSpecificCardFromStack(this.drawSpecificCardStack, card);
      this.drawSpecificCardDialogVisible = false;
      this.drawSpecificCardStack = undefined;
    }
  }

  constructor(
    private decksService: DecksService,
    private cardsService: CardsService,
    private translate: TranslateService,
    public cardTemplatesService: CardTemplatesService,
    public gameStateService: GameSimulatorStateService,
    private ngZone: NgZone
  ) {
    void this.loadBoosters();
    this.menus = new GameSimulatorMenus(this, translate);
    if (!this.gameStateService.initialized) {
      this.gameStateService.resetGame();
    }
  }

  private mouseMoveListener!: (e: MouseEvent) => void;
  private mouseUpListener!: (e: MouseEvent) => void;

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      this.mouseMoveListener = (event: MouseEvent) => this.onWindowMouseMove(event);
      this.mouseUpListener = (event: MouseEvent) => this.onWindowMouseUpCombined(event);
      window.addEventListener('mousemove', this.mouseMoveListener);
      window.addEventListener('mouseup', this.mouseUpListener);
    });
  }

  ngOnDestroy() {
    window.removeEventListener('mousemove', this.mouseMoveListener);
    window.removeEventListener('mouseup', this.mouseUpListener);
  }

  ngAfterViewInit() {
    // Only center if it's the first time initializing layout positions
    if (this.simulatorPan.x === 0 && this.simulatorPan.y === 0 && this.gameBoundary?.nativeElement) {
      // Small timeout guarantees DOM bounding boxes are rendered
      setTimeout(async () => {
        const rect = this.gameBoundary.nativeElement.getBoundingClientRect();
        this.simulatorPan = {
          x: rect.width / 2,
          y: rect.height / 2
        };

        // Wait for the async resetGame to finish loading stacks from the DB
        if (!this.gameStateService.initialized) {
          await this.gameStateService.resetGame();
        }

        // Mathematically translate the top-left screen pixel (with a 50px visual padding) into logical board coordinates
        const startLogicalX = -(rect.width / 2) / this.simulatorZoom + (50 / this.simulatorZoom);
        const startLogicalY = -(rect.height / 2) / this.simulatorZoom + (50 / this.simulatorZoom);

        const COLS = 5;
        const COL_SPACING = 1000;
        const ROW_PADDING = 200; // Extra gap between rows

        if (this.gameStateService.stacks.length > 0) {
          // Collect non-discard stacks in order
          const orderedStacks = this.gameStateService.stacks.filter(
            s => s.uniqueId !== this.gameStateService.discard.uniqueId
          );

          // First pass: place with default spacing so DOM can render
          let deckIndex = 0;
          orderedStacks.forEach(s => {
            s.pos = {
              x: startLogicalX + (deckIndex % COLS) * COL_SPACING,
              y: startLogicalY + Math.floor(deckIndex / COLS) * 1300
            };
            deckIndex++;
          });
          this.gameStateService.discard.pos = {
            x: startLogicalX + (deckIndex % COLS) * COL_SPACING,
            y: startLogicalY + Math.floor(deckIndex / COLS) * 1300
          };

          // Second pass: after DOM renders, measure actual heights and reflow rows
          setTimeout(() => {
            const allStacks = [...orderedStacks, this.gameStateService.discard];
            const rows: typeof allStacks[] = [];
            for (let i = 0; i < allStacks.length; i += COLS) {
              rows.push(allStacks.slice(i, i + COLS));
            }

            let currentY = startLogicalY;
            rows.forEach((row) => {
              // Position each stack in this row at currentY
              row.forEach((stack, colIndex) => {
                stack.pos = {
                  x: startLogicalX + colIndex * COL_SPACING,
                  y: currentY
                };
              });

              // Measure the tallest rendered element in this row
              let maxHeight = GameSimulatorComponent.BASE_CARD_HEIGHT;
              row.forEach(stack => {
                const el = document.getElementById(stack.uniqueId);
                if (el) {
                  const renderedHeight = el.getBoundingClientRect().height / this.simulatorZoom;
                  if (renderedHeight > maxHeight) {
                    maxHeight = renderedHeight;
                  }
                }
              });

              // Advance Y by the tallest stack in this row plus padding
              currentY += maxHeight + ROW_PADDING;
            });
          }, 100); // Allow DOM to render the initial placement before measuring
        }
      }, 0);
    }
  }

  // resetGame is now handled by GameSimulatorStateService


  public shuffleCards(cards: GameCard[]) {
    GameSimulatorActions.shuffleCards(cards);
  }



  public rotateStack(stack: CardStack, angle: number) {
    GameSimulatorActions.rotateStack(stack, angle);
  }

  public rotateCard(card: GameCard, angle: number) {
    GameSimulatorActions.rotateCard(card, angle);
  }

  public flipStack(stack: CardStack) {
    if (stack.cards.length === 0 || stack.flipping) {
      return;
    }

    stack.flipping = true;
    setTimeout(() => {
      stack.cards = stack.cards.reverse();
      stack.faceUp = !stack.faceUp;
    }, 200);

    setTimeout(() => {
      stack.flipping = false;
    }, 400);
  }

  public drawCard(stack: CardStack, faceUp = true) {
    if (stack.cards.length > 0) {
      const drawnCard = stack.cards.pop();
      if (drawnCard) {
        // change position to deck position + offset
        // Reverted to bottom-right offset
        const newX = stack.pos.x + 600 + (Math.random() * 200 - 100);
        const newY = stack.pos.y + 300 + (Math.random() * 200 - 100);

        let width = GameSimulatorComponent.BASE_CARD_WIDTH;
        let height = GameSimulatorComponent.BASE_CARD_HEIGHT;

        const stackEl = document.getElementById(stack.uniqueId);
        const startX = stack.pos.x;
        const startY = stack.pos.y;

        if (stackEl && this.gameBoundary) {
          const rect = stackEl.getBoundingClientRect();
          width = rect.width / this.simulatorZoom;
          height = rect.height / this.simulatorZoom;
        }

        const clampedPos = this.clampPosition({ x: newX, y: newY }, width, height);

        // Animation logic
        // Assign NEW object to trigger change detection
        drawnCard.pos = { x: startX, y: startY };
        drawnCard.faceUp = faceUp;
        drawnCard.rotation = stack.rotation || 0;
        // drawnCard.drawing = true; // Moved down to prevent animating from 0,0

        this.gameStateService.bringToFront(drawnCard);
        this.field.cards.push(drawnCard);
        this.say(faceUp ? 'simulator.log.draw' : 'simulator.log.draw-hidden',
          { player: this.gameStateService.activePlayer?.name ?? '', stack: stack.name, card: drawnCard.card.name });

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            drawnCard.drawing = true; // Enable transition
            // Assign NEW object for target
            drawnCard.pos = { x: clampedPos.x, y: clampedPos.y };

            setTimeout(() => {
              drawnCard.drawing = false;
            }, 300);
          });
        });
      }
    }
  }

  /** Click, or Enter on the focused draw button (Angular types key events as Event) */
  public onDrawClick(event: Event, stack: CardStack) {
    event.stopPropagation();
    const input = event as MouseEvent | KeyboardEvent;
    // Left click only (button 0), or Enter
    if (!(input instanceof MouseEvent) || input.button === 0) {
      const faceUp = !input.shiftKey;
      this.drawCard(stack, faceUp);
    }
  }

  public onDrawAuxClick(event: MouseEvent, stack: CardStack) {
    // Middle click only (button 1)
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      this.drawCard(stack, false);
    }
  }

  public drawSpecificCardFromStack(stack: CardStack, cardToDraw: GameCard) {
    const cardIndex = stack.cards.findIndex(c => c.uniqueId === cardToDraw.uniqueId);

    if (cardIndex > -1) {
      // Remove the specific card from the stack array
      const [drawnCard] = stack.cards.splice(cardIndex, 1);

      // Set its properties for being on the field
      drawnCard.faceUp = true;
      drawnCard.rotation = stack.rotation || 0;
      // Position it near the stack it came from for a better user experience
      // Reverted to bottom-right offset
      const newX = stack.pos.x + 50 + (Math.random() * 20 - 10);
      const newY = stack.pos.y + 50 + (Math.random() * 20 - 10);

      let width = GameSimulatorComponent.BASE_CARD_WIDTH;
      let height = GameSimulatorComponent.BASE_CARD_HEIGHT;

      const stackEl = document.getElementById(stack.uniqueId);
      const startX = stack.pos.x;
      const startY = stack.pos.y;

      if (stackEl) {
        const rect = stackEl.getBoundingClientRect();
        width = rect.width / this.simulatorZoom;
        height = rect.height / this.simulatorZoom;
      }

      const clampedPos = this.clampPosition({ x: newX, y: newY }, width, height);

      // Animation logic
      drawnCard.pos = { x: startX, y: startY };
      // drawnCard.drawing = true; // Moved to prevent animating from 0,0

      this.gameStateService.bringToFront(drawnCard);
      // Add the card to the field
      this.field.cards.push(drawnCard);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          drawnCard.drawing = true; // Enable transition
          drawnCard.pos = { x: clampedPos.x, y: clampedPos.y };

          setTimeout(() => {
            drawnCard.drawing = false;
          }, 300);
        });
      });
    }
  }

  public playCard(cards: GameCard[], card: GameCard) {
    const index = cards.indexOf(card);
    if (index > -1) {
      cards.splice(index, 1);
      this.gameStateService.bringToFront(card);
      this.field.cards.push(card);
    }
  }

  public discardCard(cards: GameCard[], card: GameCard) {
    const index = cards.indexOf(card);
    if (index > -1) {
      card.discarding = true;
      card.faceUp = true; // Ensure face up while confirming discard

      // Animate to discard pile
      let width = GameSimulatorComponent.BASE_CARD_WIDTH;
      let height = GameSimulatorComponent.BASE_CARD_HEIGHT;
      const stackEl = document.getElementById(this.discard.uniqueId);
      if (stackEl) {
        width = stackEl.getBoundingClientRect().width;
        height = stackEl.getBoundingClientRect().height;
      }

      // Target position
      const targetPos = this.clampPosition(
        { x: this.discard.pos.x, y: this.discard.pos.y },
        width,
        height
      );

      // Apply position (CDK Drag will follow this if bound correctly, 
      // otherwise angular binding [cdkDragScale]="simulatorZoom"
      card.pos = targetPos;

      // Wait for animation
      setTimeout(() => {
        // Double check index in case it changed (unlikely in single threaded JS but good practice if async intervened)
        const idx = cards.indexOf(card);
        if (idx > -1) {
          cards.splice(idx, 1);
          card.discarding = false; // Reset state so it's interactable if drawn again
          this.discard.cards.push(card);
          this.say('simulator.log.discard', { player: this.gameStateService.activePlayer?.name ?? '', card: card.card.name });
        }
      }, 500);
    }
  }

  public flipCard(card: GameCard) {
    if (card.flipping) return; // Prevent double trigger

    card.flipping = true;
    setTimeout(() => {
      card.faceUp = !card.faceUp;
    }, 200); // Half of animation duration

    setTimeout(() => {
      card.flipping = false;
    }, 400); // Full animation duration
  }

  public deleteItem(items: Positionable[], item: Positionable) {
    GameSimulatorActions.removeItem(items, item);
  }

  public async onStackContextMenu(event: MouseEvent, cm: ContextMenu, stack: CardStack) {
    cm.hide();
    event.preventDefault();
    event.stopPropagation();
    const deckIds = stack.cards.map((card) => card.card.deckId)
      .filter((value, index, array) => array.indexOf(value) === index);
    const optionAttributes = await Promise.all(deckIds.map((deckId) => this.cardsService.getFieldsUnfiltered({ deckId: deckId })))
      .then((fieldArrays) => {
        const allFields = fieldArrays.flatMap((fieldArray) => fieldArray);
        const uniqueFields: EntityField<Card>[] = [];
        const seenFields = new Set<string>();
        for (const field of allFields) {
          if (field.field === 'id' || field.field === 'deckId' ||
            field.field === 'frontCardTemplateId' || field.field === 'backCardTemplateId') {
            continue;
          }
          if (field.type !== FieldType.dropdown && field.type !== FieldType.text && field.type !== FieldType.numeric && field.type !== FieldType.dropdownOptions) {
            continue;
          }
          if (!seenFields.has(field.field as string)) {
            seenFields.add(field.field as string);
            uniqueFields.push(field);
          }
        }
        return uniqueFields;
      });

    this.contextMenuItems = this.menus.stack(stack, optionAttributes);
    const x = event.pageX;
    const y = event.pageY;
    setTimeout(() => cm.show(menuEvent(x, y)));
  }

  /*********************************************************************
   * Joueurs, mains, zones, boosters, journal et parties enregistrées
   *********************************************************************/

  private readonly boostersService = inject(BoostersService);
  private readonly savesService = inject(SimulatorSavesService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messages = inject(MessageService);

  get players() { return this.gameStateService.players; }
  get zones() { return this.gameStateService.zones; }
  get log() { return this.gameStateService.log; }

  boosters: Booster[] = [];
  private foilField: string | undefined;
  playersPanelOpen = true;
  logPanelOpen = false;
  savesDialogVisible = false;
  saves: SimulatorSave[] = [];
  saveName = '';
  shuffleOnLoad = true;
  /** Joueur dont la main est affichée en bas (par défaut : le joueur actif). */
  handPlayerId: string | undefined;
  handHidden = false;
  /** Carte de la main en cours de glissé vers la table. */
  handDrag: { player: Player; card: GameCard; startX: number; startY: number; x: number; y: number; moved: boolean } | null = null;
  handMenuItems: MenuItem[] = [];
  /** Zone déplacée : position de départ et cartes qui la suivent. */
  private zoneDrag: { zone: TableZone; start: Position; cards: GameCard[] } | null = null;
  private zoneResize: { zone: TableZone; startX: number; startY: number; width: number; height: number } | null = null;

  static readonly ZONE_HEADER = 120;
  readonly zoneHeader = GameSimulatorComponent.ZONE_HEADER;
  static readonly ZONE_PAD = 50;

  private async loadBoosters() {
    const [boosters, fields] = await Promise.all([this.boostersService.getAll(), this.cardsService.getFieldsUnfiltered()]);
    this.boosters = boosters;
    this.foilField = findFoilField(fields);
  }

  private say(key: string, params: Record<string, unknown> = {}, player = this.gameStateService.activePlayer, logKey?: string) {
    this.gameStateService.addLog(this.translate.instant(key, params), player, logKey);
  }

  get handPlayer(): Player | undefined {
    return this.gameStateService.playerById(this.handPlayerId) ?? this.gameStateService.activePlayer;
  }

  /** Point de la table (coordonnées logiques) sous un point de l'écran. */
  public screenToLogical(clientX: number, clientY: number): Position {
    const rect = this.gameBoundary?.nativeElement.getBoundingClientRect() ?? { left: 0, top: 0 };
    return {
      x: (clientX - rect.left - this.simulatorPan.x) / this.simulatorZoom,
      y: (clientY - rect.top - this.simulatorPan.y) / this.simulatorZoom,
    };
  }

  /** Centre de la vue, en coordonnées de la table. */
  private viewCenter(): Position {
    const rect = this.gameBoundary?.nativeElement.getBoundingClientRect();
    return rect ? this.screenToLogical(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 0, y: 0 };
  }

  /** Taille d'une carte sur la table (mesurée sur une carte posée, sinon taille par défaut). */
  public cardSize(): { w: number; h: number } {
    // mesure coûteuse (mise en page) : gardée deux secondes
    const now = Date.now();
    if (this.cardSizeCache && now - this.cardSizeCache.at < 2000) {
      return this.cardSizeCache.size;
    }
    const size = this.measureCardSize();
    this.cardSizeCache = { at: now, size };
    return size;
  }

  private cardSizeCache: { at: number; size: { w: number; h: number } } | null = null;

  private measureCardSize(): { w: number; h: number } {
    // une carte posée, sinon le dessus d'une pile
    const el = document.querySelector<HTMLElement>('.simulator-content .field-card')
      ?? document.querySelector<HTMLElement>('.simulator-content .card-stack');
    if (el && this.simulatorZoom) {
      const rect = el.getBoundingClientRect();
      if (rect.width && rect.height) {
        return { w: rect.width / this.simulatorZoom, h: rect.height / this.simulatorZoom };
      }
    }
    return { w: GameSimulatorComponent.BASE_CARD_WIDTH, h: GameSimulatorComponent.BASE_CARD_HEIGHT };
  }

  // ----- Journal et dés -----

  public rollDie(component: GameComponent) {
    component.rolling = true;
    setTimeout(() => {
      component.face = MathUtils.randomInt(1, 6);
      component.rolling = false;
      this.say('simulator.log.die', { value: component.face });
    }, 600);
  }

  public tossCoin(component: GameComponent) {
    component.rolling = true;
    setTimeout(() => {
      component.faceUp = Math.random() < 0.5;
      component.rolling = false;
      this.say(component.faceUp ? 'simulator.log.coin-heads' : 'simulator.log.coin-tails');
    }, 600);
  }

  public clearLog() {
    this.gameStateService.log = [];
  }

  public logTime(at: number): string {
    return new Date(at).toLocaleTimeString(this.translate.currentLang || 'fr', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ----- Joueurs et compteurs -----

  public addPlayer() {
    const player = GameSimulatorStateService.newPlayer(this.players.length + 1);
    // mêmes compteurs que le premier joueur
    if (this.players[0]) {
      player.counters = this.players[0].counters.map(counter => ({
        id: StringUtils.generateRandomString(), name: counter.name, value: counter.start, start: counter.start,
      }));
    }
    this.players.push(player);
  }

  public removePlayer(player: Player) {
    const index = this.players.indexOf(player);
    if (index < 0) {
      return;
    }
    // ses cartes en main retournent sur la table, près du centre de la vue
    player.hand.slice().forEach(card => this.playFromHand(player, card));
    this.players.splice(index, 1);
    if (this.gameStateService.currentPlayer >= this.players.length) {
      this.gameStateService.currentPlayer = 0;
    }
    this.zones.filter(zone => zone.ownerId === player.id).forEach(zone => zone.ownerId = undefined);
  }

  public setActivePlayer(index: number) {
    this.gameStateService.currentPlayer = index;
    this.handPlayerId = undefined;
  }

  public changeCounter(player: Player, counter: PlayerCounter, delta: number) {
    const before = counter.value;
    counter.value += delta;
    this.say('simulator.log.counter', { player: player.name, counter: counter.name, value: counter.value, before: this.counterStart(player, counter, before) },
      player, `counter-${counter.id}`);
  }

  /** Valeur avant la série de clics en cours (la ligne du journal est mise à jour, pas répétée). */
  private counterStarts = new Map<string, { value: number; at: number }>();
  private counterStart(player: Player, counter: PlayerCounter, before: number): number {
    const known = this.counterStarts.get(counter.id);
    const now = Date.now();
    if (!known || now - known.at > 4000) {
      this.counterStarts.set(counter.id, { value: before, at: now });
      return before;
    }
    known.at = now;
    return known.value;
  }

  public addCounter(player: Player) {
    player.counters.push({ id: StringUtils.generateRandomString(), name: this.translate.instant('simulator.players.counter'), value: 0, start: 0 });
  }

  public removeCounter(player: Player, counter: PlayerCounter) {
    player.counters = player.counters.filter(c => c !== counter);
  }

  public endTurn() {
    this.gameStateService.endTurn();
    this.handPlayerId = undefined;
  }

  // ----- Main des joueurs -----

  private removeFromField(card: GameCard) {
    const index = this.field.cards.indexOf(card);
    if (index > -1) {
      this.field.cards.splice(index, 1);
    }
  }

  public takeToHand(card: GameCard, player = this.gameStateService.activePlayer) {
    if (!player) {
      return;
    }
    const zone = this.zoneAt(card);
    this.removeFromField(card);
    card.faceUp = true;
    card.rotation = 0;
    player.hand.push(card);
    this.handPlayerId = player.id;
    this.say('simulator.log.take', { player: player.name, card: card.card.name }, player);
    if (zone) {
      this.arrangeZone(zone);
    }
  }

  public drawToHand(stack: CardStack, count: number, player = this.gameStateService.activePlayer) {
    if (!player) {
      return;
    }
    let drawn = 0;
    for (let i = 0; i < count && stack.cards.length; i++) {
      const card = stack.cards.pop()!;
      card.faceUp = true;
      card.rotation = 0;
      player.hand.push(card);
      drawn++;
    }
    if (drawn) {
      this.handPlayerId = player.id;
      this.say('simulator.log.draw-hand', { player: player.name, n: drawn, stack: stack.name }, player);
    }
  }

  public deal(stack: CardStack, count: number) {
    for (let round = 0; round < count; round++) {
      for (const player of this.players) {
        const card = stack.cards.pop();
        if (!card) {
          break;
        }
        card.faceUp = true;
        card.rotation = 0;
        player.hand.push(card);
      }
    }
    this.say('simulator.log.deal', { n: count, stack: stack.name, players: this.players.length }, undefined);
  }

  /** Pose une carte de la main sur la table : au point donné, sinon au centre de la vue. */
  public playFromHand(player: Player, card: GameCard, at?: Position, faceUp = true) {
    const index = player.hand.indexOf(card);
    if (index < 0) {
      return;
    }
    player.hand.splice(index, 1);
    const size = this.cardSize();
    const target = at ?? this.viewCenter();
    card.faceUp = faceUp;
    card.pos = this.clampPosition({ x: target.x - size.w / 2, y: target.y - size.h / 2 }, size.w, size.h);
    this.gameStateService.bringToFront(card);
    this.field.cards.push(card);
    this.say(faceUp ? 'simulator.log.play' : 'simulator.log.play-hidden', { player: player.name, card: card.card.name }, player);
    const zone = this.zoneAt(card);
    if (zone) {
      setTimeout(() => this.arrangeZone(zone));
    }
  }

  public discardFromHand(player: Player, card: GameCard) {
    const index = player.hand.indexOf(card);
    if (index < 0) {
      return;
    }
    player.hand.splice(index, 1);
    card.faceUp = true;
    this.discard.cards.push(card);
    this.say('simulator.log.discard-hand', { player: player.name, card: card.card.name }, player);
  }

  public handCardMenu(event: MouseEvent, menu: { toggle: (e: Event) => void }, player: Player, card: GameCard) {
    this.handMenuItems = [
      { label: this.translate.instant('simulator.hand.play'), icon: 'pi pi-arrow-up', command: () => this.playFromHand(player, card) },
      { label: this.translate.instant('simulator.hand.play-hidden'), icon: 'pi pi-eye-slash', command: () => this.playFromHand(player, card, undefined, false) },
      { label: this.translate.instant('simulator.discard-card'), icon: 'pi pi-trash', command: () => this.discardFromHand(player, card) },
      {
        label: this.translate.instant('simulator.hand.give'), icon: 'pi pi-send',
        disabled: this.players.length < 2,
        items: this.players.filter(p => p !== player).map(other => ({
          label: other.name,
          command: () => {
            player.hand.splice(player.hand.indexOf(card), 1);
            other.hand.push(card);
            this.say('simulator.log.give', { player: player.name, other: other.name }, player);
          }
        }))
      },
    ];
    menu.toggle(event);
  }

  /** Glisser une carte de la main vers la table (pointeur : souris ou doigt). */
  public onHandPointerDown(event: PointerEvent, player: Player, card: GameCard) {
    if (event.button !== 0) {
      return;
    }
    // pas de sélection de texte pendant le glissé
    event.preventDefault();
    this.handDrag = { player, card, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
    const move = (e: PointerEvent) => {
      if (!this.handDrag) {
        return;
      }
      this.handDrag.x = e.clientX;
      this.handDrag.y = e.clientY;
      if (Math.hypot(e.clientX - this.handDrag.startX, e.clientY - this.handDrag.startY) > 8) {
        this.handDrag.moved = true;
      }
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const drag = this.handDrag;
      this.handDrag = null;
      if (!drag?.moved) {
        return;
      }
      this.suppressHandClick = true;
      setTimeout(() => this.suppressHandClick = false);
      if (!this.overHandBar(e.clientX, e.clientY)) {
        this.playFromHand(drag.player, drag.card, this.screenToLogical(e.clientX, e.clientY), !e.shiftKey);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  suppressHandClick = false;

  private overHandBar(clientX: number, clientY: number): boolean {
    const bar = document.getElementById('simulator-hand-bar');
    if (!bar) {
      return false;
    }
    const rect = bar.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  // ----- Zones -----

  public addZone(x: number, y: number) {
    const size = this.cardSize();
    const zone: TableZone = {
      uniqueId: StringUtils.generateRandomString(),
      name: this.translate.instant('simulator.zones.default-name', { n: this.zones.length + 1 }),
      pos: { x, y },
      width: Math.round(size.w * 4 + GameSimulatorComponent.ZONE_PAD * 5),
      height: Math.round(size.h + GameSimulatorComponent.ZONE_HEADER + GameSimulatorComponent.ZONE_PAD * 2),
      layout: 'ligne',
      face: 'garder',
      color: GameSimulatorMenus.ZONE_COLORS[0].value,
    };
    this.zones.push(zone);
  }

  public renameZone(zone: TableZone) {
    this.stackToRename = zone;
    this.renameStackName = zone.name;
    this.renameTitleKey = 'simulator.zones.rename';
    this.renameDialogVisible = true;
  }

  public deleteZone(zone: TableZone) {
    const index = this.zones.indexOf(zone);
    if (index > -1) {
      this.zones.splice(index, 1);
    }
  }

  public zoneOwner(zone: TableZone): Player | undefined {
    return this.gameStateService.playerById(zone.ownerId);
  }

  private cardCenter(card: GameCard, size = this.cardSize()): Position {
    return { x: card.pos.x + size.w / 2, y: card.pos.y + size.h / 2 };
  }

  private inZone(zone: TableZone, point: Position): boolean {
    return point.x >= zone.pos.x && point.x <= zone.pos.x + zone.width
      && point.y >= zone.pos.y && point.y <= zone.pos.y + zone.height;
  }

  /** La zone (la plus haute) qui contient le centre de la carte. */
  public zoneAt(card: GameCard): TableZone | undefined {
    const center = this.cardCenter(card);
    for (let i = this.zones.length - 1; i >= 0; i--) {
      if (this.inZone(this.zones[i], center)) {
        return this.zones[i];
      }
    }
    return undefined;
  }

  public cardsInZone(zone: TableZone): GameCard[] {
    const size = this.cardSize();
    return this.field.cards.filter(card => this.inZone(zone, this.cardCenter(card, size)) && this.zoneAt(card) === zone);
  }

  /** Nombre de cartes de chaque zone, pour l'étiquette (calculé une fois par affichage). */
  zoneCount(zone: TableZone): number {
    return this.cardsInZone(zone).length;
  }

  /**
   * Range les cartes d'une zone selon sa disposition et applique sa règle de face.
   * En disposition libre, seule la face change, sauf si on demande de ranger (en grille).
   */
  public arrangeZone(zone: TableZone, force = false) {
    const cards = this.cardsInZone(zone);
    for (const card of cards) {
      if (zone.face === 'visible') {
        card.faceUp = true;
      } else if (zone.face === 'cachee') {
        card.faceUp = false;
      }
    }
    const layout = zone.layout === 'libre' ? (force ? 'grille' : null) : zone.layout;
    if (!layout || !cards.length) {
      return;
    }
    const { w, h } = this.cardSize();
    const pad = GameSimulatorComponent.ZONE_PAD;
    const top = zone.pos.y + GameSimulatorComponent.ZONE_HEADER;
    const innerW = Math.max(w, zone.width - pad * 2);
    const gap = pad / 2;
    const sorted = layout === 'cascade'
      ? cards.slice().sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
      : cards.slice().sort((a, b) => (layout === 'grille' ? Math.round((a.pos.y - b.pos.y) / h) * 10000 : 0) + a.pos.x - b.pos.x);
    sorted.forEach((card, i) => {
      let x = zone.pos.x + pad;
      let y = top;
      if (layout === 'ligne') {
        const step = sorted.length > 1 ? Math.min(w + gap, (innerW - w) / (sorted.length - 1)) : 0;
        x += i * step;
      } else if (layout === 'grille') {
        const cols = Math.max(1, Math.floor((innerW + gap) / (w + gap)));
        x += (i % cols) * (w + gap);
        y += Math.floor(i / cols) * (h + gap);
      } else {
        const innerH = Math.max(h, zone.height - GameSimulatorComponent.ZONE_HEADER - pad);
        const step = sorted.length > 1 ? Math.min(h * 0.22, (innerH - h) / (sorted.length - 1)) : 0;
        y += i * step;
      }
      card.pos = { x, y };
      card.rotation = 0;
      this.gameStateService.bringToFront(card);
    });
  }

  /** Réunit les cartes d'une zone en une pile, posée dans la zone. */
  public gatherZone(zone: TableZone) {
    const cards = this.cardsInZone(zone);
    if (!cards.length) {
      return;
    }
    cards.forEach(card => this.removeFromField(card));
    const stack: CardStack = {
      uniqueId: StringUtils.generateRandomString(),
      name: zone.name,
      cards: cards.map(card => ({ ...card, faceUp: true })),
      faceUp: zone.face !== 'cachee',
      pos: { x: zone.pos.x + GameSimulatorComponent.ZONE_PAD, y: zone.pos.y + GameSimulatorComponent.ZONE_HEADER },
      deletable: true,
      rotation: 0,
    };
    this.addStack(stack);
  }

  public onZoneContextMenu(event: MouseEvent, cm: ContextMenu, zone: TableZone) {
    cm.hide();
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuItems = this.menus.zone(zone);
    const x = event.pageX;
    const y = event.pageY;
    setTimeout(() => cm.show(menuEvent(x, y)));
  }

  public onZoneDragStarted(zone: TableZone) {
    this.zoneDrag = { zone, start: { ...zone.pos }, cards: this.cardsInZone(zone) };
  }

  public onZoneDragEnded(event: CdkDragEnd<unknown>, zone: TableZone) {
    const raw = event.source.getFreeDragPosition();
    zone.pos = { x: raw.x / this.simulatorZoom, y: raw.y / this.simulatorZoom };
    const drag = this.zoneDrag;
    this.zoneDrag = null;
    if (drag?.zone === zone) {
      const dx = zone.pos.x - drag.start.x;
      const dy = zone.pos.y - drag.start.y;
      drag.cards.forEach(card => card.pos = { x: card.pos.x + dx, y: card.pos.y + dy });
    }
  }

  public onZoneResizeStart(event: PointerEvent, zone: TableZone) {
    event.preventDefault();
    event.stopPropagation();
    this.zoneResize = { zone, startX: event.clientX, startY: event.clientY, width: zone.width, height: zone.height };
    const { w, h } = this.cardSize();
    const move = (e: PointerEvent) => {
      const resize = this.zoneResize;
      if (!resize) {
        return;
      }
      this.ngZone.run(() => {
        resize.zone.width = Math.max(w + GameSimulatorComponent.ZONE_PAD * 2, resize.width + (e.clientX - resize.startX) / this.simulatorZoom);
        resize.zone.height = Math.max(h * 0.4 + GameSimulatorComponent.ZONE_HEADER, resize.height + (e.clientY - resize.startY) / this.simulatorZoom);
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const resized = this.zoneResize?.zone;
      this.zoneResize = null;
      if (resized) {
        this.ngZone.run(() => this.arrangeZone(resized));
      }
    };
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  // ----- Boosters -----

  private async boosterPulls(booster: Booster): Promise<GameCard[]> {
    const cards = await this.cardsService.getAllUnfiltered();
    const pulls = openBooster(booster, poolOf(booster, cards), this.foilField);
    return pulls.map(pull => ({ ...this.gameStateService.newGameCard(pull.card, true), holographic: !!pull.foil }));
  }

  public async openBoosterOnTable(booster: Booster, x?: number, y?: number) {
    const cards = await this.boosterPulls(booster);
    if (!cards.length) {
      this.messages.add({ severity: 'warn', summary: booster.name, detail: this.translate.instant('boosters.empty-pool') });
      return;
    }
    const at = x === undefined || y === undefined ? this.viewCenter() : { x, y };
    // la première carte tirée sur le dessus : on pioche dans l'ordre d'ouverture
    const stack: CardStack = {
      uniqueId: StringUtils.generateRandomString(),
      name: booster.name,
      cards: cards.reverse(),
      faceUp: false,
      pos: at,
      deletable: true,
      rotation: 0,
    };
    this.addStack(stack);
    this.say('simulator.log.booster-table', { player: this.gameStateService.activePlayer?.name ?? '', booster: booster.name, n: cards.length });
  }

  public async openBoosterToHand(booster: Booster, player = this.gameStateService.activePlayer) {
    if (!player) {
      return;
    }
    const cards = await this.boosterPulls(booster);
    player.hand.push(...cards);
    this.handPlayerId = player.id;
    this.say('simulator.log.booster-hand', { player: player.name, booster: booster.name, n: cards.length }, player);
  }

  boosterMenuItems: MenuItem[] = [];

  public toggleBoosterMenu(event: Event, menu: { toggle: (e: Event) => void }) {
    this.boosterMenuItems = this.boosters.map(booster => ({
      label: booster.name,
      items: [
        { label: this.translate.instant('simulator.boosters.to-table'), icon: 'pi pi-table', command: () => void this.openBoosterOnTable(booster) },
        ...this.players.map(player => ({
          label: this.translate.instant('simulator.boosters.to-hand', { player: player.name }), icon: 'pi pi-inbox',
          command: () => void this.openBoosterToHand(booster, player)
        })),
      ]
    }));
    menu.toggle(event);
  }

  // ----- Parties enregistrées -----

  public async openSaves() {
    this.saves = (await this.savesService.getAll()).sort((a, b) => b.savedAt - a.savedAt);
    this.saveName = this.translate.instant('simulator.saves.default-name', {
      date: new Date().toLocaleString(this.translate.currentLang || 'fr', { dateStyle: 'short', timeStyle: 'short' })
    });
    this.savesDialogVisible = true;
  }

  public async saveGame(existing?: SimulatorSave) {
    const name = (existing?.name ?? this.saveName).trim();
    if (!name) {
      return;
    }
    const save = { name, savedAt: Date.now(), state: this.gameStateService.toSave() } as SimulatorSave;
    if (existing) {
      await this.savesService.update(existing.id, { ...save, id: existing.id });
    } else {
      await this.savesService.create(save);
    }
    this.messages.add({ severity: 'success', summary: this.translate.instant('simulator.saves.saved', { name }) });
    await this.openSaves();
  }

  public async loadGame(save: SimulatorSave) {
    const missing = await this.gameStateService.fromSave(save.state, component => this.menus.componentActions(component), this.shuffleOnLoad);
    this._scaledPosMap.clear();
    this.handPlayerId = undefined;
    this.savesDialogVisible = false;
    this.say('simulator.log.loaded', { name: save.name }, undefined);
    if (missing) {
      this.messages.add({ severity: 'warn', summary: save.name, detail: this.translate.instant('simulator.saves.missing', { n: missing }) });
    }
    this.calculateOffScreenIndicators();
  }

  public deleteSave(save: SimulatorSave) {
    this.confirmation.confirm({
      header: this.translate.instant('simulator.saves.delete'),
      message: this.translate.instant('simulator.saves.delete-confirm', { name: save.name }),
      accept: async () => {
        await this.savesService.delete(save.id);
        this.saves = this.saves.filter(s => s.id !== save.id);
      }
    });
  }

  public saveDate(save: SimulatorSave): string {
    return new Date(save.savedAt).toLocaleString(this.translate.currentLang || 'fr', { dateStyle: 'short', timeStyle: 'short' });
  }

  public flipComponent(component: GameComponent) {
    if (component.flipping) return;

    component.flipping = true;
    setTimeout(() => {
      component.faceUp = !component.faceUp;
    }, 200);

    setTimeout(() => {
      component.flipping = false;
    }, 400);
  }

  public onCardContextMenu(event: MouseEvent, cm: ContextMenu, card: GameCard) {
    cm.hide();
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuItems = this.menus.card(card);
    const x = event.pageX;
    const y = event.pageY;
    setTimeout(() => cm.show(menuEvent(x, y)));
  }

  public onComponentContextMenu(event: MouseEvent, cm: ContextMenu,
    component: GameComponent) {
    cm.hide();
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuItems = this.menus.component(component);
    this.contextMenuItems.forEach(item => {
      item.state = component;
    })
    const x = event.pageX;
    const y = event.pageY;
    setTimeout(() => cm.show(menuEvent(x, y)));
  }

  public onFieldContextMenu(event: MouseEvent, cm: ContextMenu) {
    cm.hide();
    event.preventDefault();

    let boundaryLeft = 0;
    let boundaryTop = 0;
    if (this.gameBoundary && this.gameBoundary.nativeElement) {
      const rect = this.gameBoundary.nativeElement.getBoundingClientRect();
      boundaryLeft = rect.left;
      boundaryTop = rect.top;
    }

    // Scale client pointer coordinate natively into simulator virtual 1.0 bounding board logic.
    const logicalX = (event.clientX - boundaryLeft - this.simulatorPan.x) / this.simulatorZoom;
    const logicalY = (event.clientY - boundaryTop - this.simulatorPan.y) / this.simulatorZoom;

    this.contextMenuItems = this.menus.field(logicalX, logicalY, this.boosters);
    const x = event.pageX;
    const y = event.pageY;
    setTimeout(() => cm.show(menuEvent(x, y)));
  }

  public createStack(cards: GameCard[], card: GameCard) {
    const newStack = GameSimulatorActions.createStackFromCard(cards, card);
    if (newStack) {
      this.addStack(newStack);
    }
  }

  public splitInHalf(stack: CardStack) {
    const newStack = GameSimulatorActions.splitInHalf(stack);
    if (newStack) {
      this.addStack(newStack);
    }
  }

  public splitByAttribute(stack: CardStack, attribute: EntityField<Card>) {
    const newStacks = GameSimulatorActions.splitByAttribute(stack, attribute);
    if (newStacks.length === 0) {
      return;
    }
    // remove the original stack if it is now empty and deletable
    if (stack.cards.length < 1 && stack.deletable) {
      this.deleteItem(this.stacks, stack);
    }
    newStacks.forEach(newStack => this.addStack(newStack));
  }

  /** Puts a new stack on the board, above the other items */
  private addStack(stack: CardStack) {
    this.gameStateService.bringToFront(stack);
    this.stacks.push(stack);
  }

  public onDragStarted(event: CdkDragStart, items: Positionable[], item: Positionable) {
    this.gameStateService.bringToFront(item);
    // send card to the end of the cards array
    const index = items.indexOf(item);
    if (index > -1) {
      items.splice(index, 1);
      items.push(item);
    }
    this.hoveredItem = undefined;

    // Check if we are dragging a stack
    if (items === this.stacks) {
      this.draggingStack = true;
    }
  }

  public onCardDragStarted(event: CdkDragStart, cards: GameCard[], card: GameCard) {
    this.gameStateService.bringToFront(card);
    this.draggingCard = true;
    this.dragFromZone = this.zoneAt(card);
  }

  /** Zone d'où part la carte glissée : rangée à nouveau quand la carte en sort. */
  private dragFromZone: TableZone | undefined;

  onDragEnded(event: CdkDragEnd<unknown>, items: Positionable[], item: Positionable) {
    const rawPos = event.source.getFreeDragPosition();
    const pos = { x: rawPos.x / this.simulatorZoom, y: rawPos.y / this.simulatorZoom };

    let width = GameSimulatorComponent.BASE_CARD_WIDTH;
    let height = GameSimulatorComponent.BASE_CARD_HEIGHT;

    const rootEl = event.source.getRootElement();
    if (rootEl) {
      const rect = rootEl.getBoundingClientRect();
      width = rect.width / this.simulatorZoom;
      height = rect.height / this.simulatorZoom;
    }

    // Use consistent world-space clamping (no manual normalization needed with cdkDragScale)
    item.pos = this.clampPosition({ x: pos.x, y: pos.y }, width, height, 0);

    if (this.draggingStack && this.hoveredItem && this.hoveredItem !== item) {
      const targetStack = this.hoveredItem as CardStack;
      const sourceStack = item as CardStack;

      // Move all cards from source to target
      GameSimulatorActions.mergeStacks(targetStack, sourceStack);

      // Check if source stack is the discard pile
      if (sourceStack === this.discard) {

        // Reposition discard pile near the target stack
        // Offset by a bit so it's visible "popped out"
        const newX = targetStack.pos.x + 120; // Offset to the right
        const newY = targetStack.pos.y + 20;

        // Get dimensions for clamping
        let width = GameSimulatorComponent.BASE_CARD_WIDTH;
        let height = GameSimulatorComponent.BASE_CARD_HEIGHT;

        const stackEl = document.getElementById(targetStack.uniqueId);
        if (stackEl) {
          const rect = stackEl.getBoundingClientRect();
          width = rect.width / this.simulatorZoom;
          height = rect.height / this.simulatorZoom;
        }

        const clampedPos = this.clampPosition({ x: newX, y: newY }, width, height);
        this.gameStateService.bringToFront(sourceStack);
        sourceStack.pos = clampedPos;

      } else {
        // Remove source stack normally
        this.deleteItem(this.stacks, sourceStack);
      }

      this.hoveredItem = undefined;
    }

    this.draggingStack = false;
  }

  onCardDragEnded(event: CdkDragEnd<unknown>, cards: GameCard[], card: GameCard) {
    const rawPos = event.source.getFreeDragPosition();
    const pos = { x: rawPos.x / this.simulatorZoom, y: rawPos.y / this.simulatorZoom };

    let width = GameSimulatorComponent.BASE_CARD_WIDTH;
    let height = GameSimulatorComponent.BASE_CARD_HEIGHT;

    const rootEl = event.source.getRootElement();
    if (rootEl) {
      const rect = rootEl.getBoundingClientRect();
      width = rect.width / this.simulatorZoom;
      height = rect.height / this.simulatorZoom;
    }

    // Use consistent world-space clamping (no manual normalization needed with cdkDragScale)
    card.pos = this.clampPosition({ x: pos.x, y: pos.y }, width, height, 0);
    const fromZone = this.dragFromZone;
    this.dragFromZone = undefined;
    if (this.hoveredItem) {
      const index = cards.indexOf(card);
      cards.splice(index, 1);
      (this.hoveredItem as CardStack).cards.push(card);

      // Crucial: Clear hoveredItem to prevent ghost merging on future drops!
      this.hoveredItem = undefined;
    } else if (this.players.length && this.overHandBar(event.dropPoint.x, event.dropPoint.y)) {
      // lâchée sur la main en bas de l'écran
      this.takeToHand(card, this.handPlayer);
    } else {
      const zone = this.zoneAt(card);
      if (zone) {
        this.arrangeZone(zone);
      }
    }
    if (fromZone && fromZone !== this.zoneAt(card)) {
      this.arrangeZone(fromZone);
    }
    this.draggingCard = false;
  }

  onMouseEntered(_event: Event, item: Positionable) {
    if (this.hoveredItem == item) {
      return;
    }
    this.hoveredItem = item;
  }

  onMouseExited(_event: Event, item: Positionable) {
    if (this.hoveredItem == item) {
      this.hoveredItem = undefined;
    }
  }

  magnifiedCard: GameCard | undefined;
  magnifiedPos: Position = { x: 0, y: 0 };

  // ... (previous code)

  onCardMouseDown(event: MouseEvent, card: GameCard) {
    if (event.button == 1) {
      this.calculateMagnifiedPosition(event, card);
      this.magnifiedCard = card;
      event.preventDefault(); // Prevent default middle click scroll
    }
  }

  onCardMouseUp(event: MouseEvent, card: GameCard) {
    if (event.button == 1) {
      this.magnifiedCard = undefined;
    }
  }

  onComponentMouseDown(event: MouseEvent, component: GameComponent) {
    if (event.button == 1) {
      event.stopPropagation();
    }
  }

  onComponentAuxClick(event: MouseEvent, component: GameComponent) {
    if (event.button == 1) {
      event.preventDefault();
      event.stopPropagation();
      this.gameStateService.bringToFront(component);

      if (component.type === 'd6') {
        this.rollDie(component);
      } else if (component.type === 'coin') {
        this.tossCoin(component);
      } else if (component.type === 'cube' || component.type === 'pawn') {
        this.flipComponent(component);
      }
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onWindowMouseUp(event: MouseEvent) {
    if (event.button == 1) {
      this.magnifiedCard = undefined;
    }
  }

  public clampAllItems() {
    const defaultCardWidth = GameSimulatorComponent.BASE_CARD_WIDTH;
    const defaultCardHeight = GameSimulatorComponent.BASE_CARD_HEIGHT;

    // Clamp Stacks
    this.stacks.forEach(stack => {
      let width = defaultCardWidth;
      let height = defaultCardHeight;
      const el = document.getElementById(stack.uniqueId);
      if (el) {
        width = el.getBoundingClientRect().width;
        height = el.getBoundingClientRect().height;
      }
      const newPos = this.clampPosition(stack.pos, width, height);
      stack.pos = { x: newPos.x, y: newPos.y };
    });

    // Clamp Cards
    this.field.cards.forEach(card => {
      let width = defaultCardWidth;
      let height = defaultCardHeight;
      const el = document.getElementById(card.uniqueId);
      if (el) {
        width = el.getBoundingClientRect().width;
        height = el.getBoundingClientRect().height;
      }
      const newPos = this.clampPosition(card.pos, width, height);
      card.pos = { x: newPos.x, y: newPos.y };
    });

    // Clamp Components (Dice/Coins)
    // Approximate size 50x50
    const componentSize = 50;
    this.components.forEach(comp => {
      let width = componentSize;
      let height = componentSize;
      const el = document.getElementById(comp.uniqueId);
      if (el) {
        width = el.getBoundingClientRect().width;
        height = el.getBoundingClientRect().height;
      }
      const newPos = this.clampPosition(comp.pos, width, height);
      comp.pos = { x: newPos.x, y: newPos.y };
    });
  }

  private clampPosition(pos: Position, itemWidth: number, itemHeight: number, padding = 0): Position {
    // Clamping to a large virtual table instead of the viewport
    const TABLE_MIN = GameSimulatorComponent.TABLE_MIN;
    const TABLE_MAX = GameSimulatorComponent.TABLE_MAX;

    const maxX = TABLE_MAX - itemWidth - padding;
    const maxY = TABLE_MAX - itemHeight - padding;

    return {
      x: Math.max(TABLE_MIN + padding, Math.min(maxX, pos.x)),
      y: Math.max(TABLE_MIN + padding, Math.min(maxY, pos.y))
    };
  }

  public handleDragPosition = (proposedPosition: Point, _dragRef: DragRef, _dimensions: DOMRect, pickupPositionInElement: Point): Point => {
    // 1. Proposed position is the unscaled screen cursor `point`.
    // Calculate the screen position of the card's top-left corner
    const screenTopLeft = {
      x: proposedPosition.x - (pickupPositionInElement?.x || 0),
      y: proposedPosition.y - (pickupPositionInElement?.y || 0)
    };

    // 2. Adjust for Game Boundary offset relative to browser viewport
    let boundaryLeft = 0;
    let boundaryTop = 0;
    if (this.gameBoundary && this.gameBoundary.nativeElement) {
      const rect = this.gameBoundary.nativeElement.getBoundingClientRect();
      boundaryLeft = rect.left;
      boundaryTop = rect.top;
    }

    // 3. Map screen coordinate to local logical world-space coordinate
    const logicalX = (screenTopLeft.x - boundaryLeft - this.simulatorPan.x) / this.simulatorZoom;
    const logicalY = (screenTopLeft.y - boundaryTop - this.simulatorPan.y) / this.simulatorZoom;

    let width = GameSimulatorComponent.BASE_CARD_WIDTH;
    let height = GameSimulatorComponent.BASE_CARD_HEIGHT;

    const rootEl = _dragRef.getRootElement();
    if (rootEl) {
      const rect = rootEl.getBoundingClientRect();
      width = rect.width / this.simulatorZoom;
      height = rect.height / this.simulatorZoom;
    }

    // 4. Clamp the logical coordinates to the virtual table
    const clampedLogical = this.clampPosition({ x: logicalX, y: logicalY }, width, height, 0);

    // 5. Map the clamped logical coordinates BACK to screen space for Angular CDK
    // Since we provide a constrainPosition callback, CDK uses offset expectations relative to the top-left rather than cursor.
    const clampedScreenX = (clampedLogical.x * this.simulatorZoom) + this.simulatorPan.x + boundaryLeft;
    const clampedScreenY = (clampedLogical.y * this.simulatorZoom) + this.simulatorPan.y + boundaryTop;

    return {
      x: clampedScreenX,
      y: clampedScreenY
    };
  }


  private calculateMagnifiedPosition(event: MouseEvent, card: GameCard) {
    let width = 300; // Fallback
    let height = 420; // Fallback

    // Attempt to calculate actual target dimensions based on the source element
    const el = document.getElementById(card.uniqueId);
    if (el) {
      const rect = el.getBoundingClientRect();
      // Calculate base dimensions (unscaled)
      const baseWidth = rect.width;
      const baseHeight = rect.height;

      // Calculate target dimensions
      width = baseWidth * this.zoomMagnifiedLevel;
      height = baseHeight * this.zoomMagnifiedLevel;
    }

    const padding = 20;

    const x = event.clientX;
    const y = event.clientY;

    // Clamp to window
    const minX = width / 2 + padding;
    const maxX = window.innerWidth - (width / 2) - padding;
    const minY = height / 2 + padding;
    const maxY = window.innerHeight - (height / 2) - padding;

    this.magnifiedPos.x = Math.max(minX, Math.min(maxX, x));
    this.magnifiedPos.y = Math.max(minY, Math.min(maxY, y));
  }

  public getStackDepthStyle(rotation = 0) {
    const rad = rotation * (Math.PI / 180);
    // Target vector is (1, 1) for "Down-Right" bias
    // We want local vector (x, y) such that Rotate(x,y) = (1, 1) relative to screen axes
    // Inverse rotation:
    // x = x' cos(a) + y' sin(a)
    // y = -x' sin(a) + y' cos(a)
    // with x'=1, y'=1
    const x = Math.cos(rad) + Math.sin(rad);
    const y = -Math.sin(rad) + Math.cos(rad);


    return {
      '--depth-x': x.toFixed(2),
      '--depth-y': y.toFixed(2)
    };
  }

  public getStackCountStyle(rotation = 0) {
    // We want to keep the count at the visual "Bottom Right" corner
    // The container (.card-stack) size is fixed to the base orientation (Portrait)
    // The visual content (.card-wrapper) rotates around the center.

    // Normalized rotation (0, 90, 180, 270)
    const rot = ((rotation % 360) + 360) % 360;

    let style: Record<string, string>;

    // Base position is bottom: 5px, right: 5px
    // Center is 50%, 50%
    // If 0 deg: bottom/right is correct.
    // If 90 deg: Visual bottom-right is actually (Top, Right) of the container logic?
    // Wait, visual W becomes H.
    // Visual Bottom is Right Side of Container. Visual Right is Top Side of Container.
    // So Visual Bottom-Right is Top-Right of Container.

    // If 180 deg: Visual Bottom-Right is Top-Left of Container.
    // If 270 deg: Visual Bottom-Right is Bottom-Left of Container.

    switch (rot) {
      case 90:
        style = { top: '5px', right: '5px', bottom: 'auto', left: 'auto' };
        break;
      case 180:
        style = { top: '5px', left: '5px', bottom: 'auto', right: 'auto' };
        break;
      case 270:
        style = { bottom: '5px', left: '5px', top: 'auto', right: 'auto' };
        break;
      default: // 0
        style = { bottom: '5px', right: '5px', top: 'auto', left: 'auto' };
        break;
    }
    return style;
  }

  public onWheel(event: WheelEvent) {
    event.preventDefault();

    this.isZooming = true;
    clearTimeout(this.zoomTimeout);
    this.zoomTimeout = setTimeout(() => {
      this.isZooming = false;
    }, 150);

    // On Mac, Shift + Scroll often translates to deltaX instead of deltaY
    const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    
    // Multiplicative zoom factor (0.999^100 is approx 0.9, 0.999^-100 is approx 1.1)
    const zoomFactor = Math.pow(0.999, delta);
    const oldZoom = this.simulatorZoom;
    const newZoom = Math.max(0.1, Math.min(5, oldZoom * zoomFactor));

    if (oldZoom === newZoom) return;

    // Calculate pan adjustment to zoom at mouse position
    const rect = this.gameBoundary.nativeElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Formula for zooming at mouse point:
    // newPan = mouse - (mouse - oldPan) * (newZoom / oldZoom)
    this.simulatorPan.x = mouseX - (mouseX - this.simulatorPan.x) * (newZoom / oldZoom);
    this.simulatorPan.y = mouseY - (mouseY - this.simulatorPan.y) * (newZoom / oldZoom);
    this.simulatorZoom = newZoom;

    this.calculateOffScreenIndicators();
  }

  public onSimulatorMouseDown(event: MouseEvent) {
    // Shift + LMB or MMB
    if ((event.shiftKey && event.button === 0) || event.button === 1) {
      this.isPanning = true;
      this.lastPanPos = { x: event.clientX, y: event.clientY };
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onWindowMouseMove(event: MouseEvent) {
    if (this.isPanning) {
      this.ngZone.run(() => {
        const dx = event.clientX - this.lastPanPos.x;
        const dy = event.clientY - this.lastPanPos.y;

        this.simulatorPan.x += dx;
        this.simulatorPan.y += dy;

        this.lastPanPos = { x: event.clientX, y: event.clientY };
        this.calculateOffScreenIndicators();
      });
    }
  }

  // Update existing HostListener for window:mouseup
  onWindowMouseUpCombined(event: MouseEvent) {
    let requiresChangeDetection = false;

    // Failsafe reset if the browser dropped a `keyup` event midway
    if (!event.shiftKey && this.isShiftPressed) {
      this.isShiftPressed = false;
      requiresChangeDetection = true;
    }

    if (event.button == 1 && this.magnifiedCard) {
      this.magnifiedCard = undefined;
      requiresChangeDetection = true;
    }
    if (this.isPanning) {
      this.isPanning = false;
      requiresChangeDetection = true;
    }

    if (requiresChangeDetection) {
      this.ngZone.run(() => {
         // Change detection will fire after this block
      });
    }
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent) {
    if (event.key === 'Shift') {
      this.isShiftPressed = true;
    }
  }

  @HostListener('window:keyup', ['$event'])
  onWindowKeyUp(event: KeyboardEvent) {
    if (event.key === 'Shift') {
      this.isShiftPressed = false;
    }
  }

  private boundaryRectCache: { width: number, height: number } | null = null;

  @HostListener('window:resize')
  onWindowResize() {
    this.boundaryRectCache = null;
    this.calculateOffScreenIndicators();
  }

  private calculateOffScreenIndicators() {
    if (!this.gameBoundary) return;

    if (!this.boundaryRectCache) {
      const rect = this.gameBoundary.nativeElement.getBoundingClientRect();
      this.boundaryRectCache = { width: rect.width, height: rect.height };
    }
    const boundaryRect = this.boundaryRectCache;

    const indicators = { top: 0, bottom: 0, left: 0, right: 0 };

    const checkItem = (item: Positionable, width: number, height: number) => {
      // Calculate screen position: 
      // screenPos = pan + itemPos * zoom
      const screenX = this.simulatorPan.x + (item.pos.x * this.simulatorZoom);
      const screenY = this.simulatorPan.y + (item.pos.y * this.simulatorZoom);
      const screenWidth = width * this.simulatorZoom;
      const screenHeight = height * this.simulatorZoom;

      if (screenY + screenHeight < 0) indicators.top++;
      else if (screenY > boundaryRect.height) indicators.bottom++;

      if (screenX + screenWidth < 0) indicators.left++;
      else if (screenX > boundaryRect.width) indicators.right++;
    };

    const cardWidth = GameSimulatorComponent.BASE_CARD_WIDTH;
    const cardHeight = GameSimulatorComponent.BASE_CARD_HEIGHT;

    this.stacks.forEach(s => checkItem(s, cardWidth, cardHeight));
    this.field.cards.forEach(c => checkItem(c, cardWidth, cardHeight));
    this.components.forEach(c => checkItem(c, 50, 50));

    // Only update (and trigger change detection) when values actually changed
    const prev = this.offScreenIndicators;
    if (prev.top !== indicators.top || prev.bottom !== indicators.bottom ||
      prev.left !== indicators.left || prev.right !== indicators.right) {
      this.ngZone.run(() => {
        this.offScreenIndicators = indicators;
      });
    }
  }

  private panAnimationId: number | null = null;

  public panToDirection(direction: 'top' | 'bottom' | 'left' | 'right') {
    if (!this.gameBoundary) return;
    const rect = this.gameBoundary.nativeElement.getBoundingClientRect();
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    let found = false;

    const cardWidth = GameSimulatorComponent.BASE_CARD_WIDTH;
    const cardHeight = GameSimulatorComponent.BASE_CARD_HEIGHT;

    const checkItem = (item: Positionable, width: number, height: number, considerZoom = true) => {
      // Account for components needing unscaled width but scaled position?
      // Our logic elsewhere scales position and dimensions.
      const screenX = this.simulatorPan.x + (item.pos.x * this.simulatorZoom);
      const screenY = this.simulatorPan.y + (item.pos.y * this.simulatorZoom);
      const screenWidth = width * this.simulatorZoom;
      const screenHeight = height * this.simulatorZoom;

      let isTarget = false;
      if (direction === 'top' && screenY + screenHeight < 0) isTarget = true;
      else if (direction === 'bottom' && screenY > rect.height) isTarget = true;
      else if (direction === 'left' && screenX + screenWidth < 0) isTarget = true;
      else if (direction === 'right' && screenX > rect.width) isTarget = true;

      if (isTarget) {
        found = true;
        minX = Math.min(minX, item.pos.x);
        minY = Math.min(minY, item.pos.y);
        maxX = Math.max(maxX, item.pos.x + width);
        maxY = Math.max(maxY, item.pos.y + height);
      }
    };

    this.stacks.forEach(s => checkItem(s, cardWidth, cardHeight));
    this.field.cards.forEach(c => checkItem(c, cardWidth, cardHeight));
    this.components.forEach(c => checkItem(c, 50, 50));

    if (found) {
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // We want this local unit center to appear exactly in the middle of our view
      const targetPanX = (rect.width / 2) - (centerX * this.simulatorZoom);
      const targetPanY = (rect.height / 2) - (centerY * this.simulatorZoom);

      this.smoothPanTo(targetPanX, targetPanY);
    } else {
      this.scrollToCenter();
    }
  }

  private smoothPanTo(targetX: number, targetY: number) {
    if (this.panAnimationId) {
      cancelAnimationFrame(this.panAnimationId);
    }

    const startX = this.simulatorPan.x;
    const startY = this.simulatorPan.y;
    const duration = 250; // ms
    const startTime = performance.now();

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // easeOutCubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      
      this.ngZone.run(() => {
        this.simulatorPan.x = startX + (targetX - startX) * easeProgress;
        this.simulatorPan.y = startY + (targetY - startY) * easeProgress;
        this.calculateOffScreenIndicators();
      });
      
      if (progress < 1) {
        this.panAnimationId = requestAnimationFrame(animate);
      } else {
        this.panAnimationId = null;
      }
    };
    
    this.panAnimationId = requestAnimationFrame(animate);
  }

  public scrollToCenter() {
    this.simulatorPan = { x: 0, y: 0 };
    this.calculateOffScreenIndicators();
  }
}

/** Événement minimal pour ouvrir un menu contextuel à un point de la page, après coup. */
function menuEvent(pageX: number, pageY: number): MouseEvent {
  return { pageX, pageY, preventDefault: () => undefined, stopPropagation: () => undefined } as unknown as MouseEvent;
}
