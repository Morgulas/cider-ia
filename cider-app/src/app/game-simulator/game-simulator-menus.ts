import { TranslateService } from '@ngx-translate/core';
import { MenuItem, MenuItemCommandEvent } from 'primeng/api';
import { Card } from '../data-services/types/card.type';
import { EntityField } from '../data-services/types/entity-field.type';
import StringUtils from '../shared/utils/string-utils';
import type { GameSimulatorComponent } from './game-simulator.component';
import { CardStack, GameCard, GameComponent, TableZone, ZoneFace, ZoneLayout } from './game-simulator.types';
import { Booster } from '../data-services/types/booster.type';

/**
 * Builds the context menus of the game simulator. The simulator component
 * handles the mouse events and shows the menu; the entries and what each one
 * does on the board live here.
 */
export class GameSimulatorMenus {
  static readonly COLORS = ['copper', 'silver', 'gold', 'crimson',
    'emerald', 'azure', 'lilac', 'ivory', 'charcoal'];

  constructor(private sim: GameSimulatorComponent, private translate: TranslateService) { }

  /** Menu of a card stack */
  stack(stack: CardStack, optionAttributes: EntityField<Card>[]): MenuItem[] {
    return [
      {
        label: this.translate.instant('simulator.draw-card'),
        icon: 'pi pi-plus',
        command: () => this.sim.drawCard(stack),
        "disabled": stack.cards.length === 0
      },
      {
        label: this.translate.instant('simulator.hand.draw-to-hand', { player: this.sim.gameStateService.activePlayer?.name ?? '' }),
        icon: 'pi pi-inbox',
        command: () => this.sim.drawToHand(stack, 1),
        disabled: stack.cards.length === 0 || !this.sim.players.length
      },
      {
        label: this.translate.instant('simulator.hand.deal'),
        icon: 'pi pi-users',
        disabled: stack.cards.length === 0 || !this.sim.players.length,
        items: [1, 2, 3, 4, 5, 6, 7, 8, 10].map(n => ({
          label: this.translate.instant('simulator.hand.deal-n', { n }),
          command: () => this.sim.deal(stack, n)
        }))
      },
      {
        label: this.translate.instant('simulator.rename-stack'),
        icon: 'pi pi-pencil',
        command: () => {
          this.sim.stackToRename = stack;
          this.sim.renameStackName = stack.name;
          this.sim.renameDialogVisible = true;
        },
        disabled: stack === this.sim.discard
      },
      {
        label: this.translate.instant('simulator.draw-card-facedown'),
        icon: 'pi pi-eye-slash',
        command: () => this.sim.drawCard(stack, false),
        disabled: stack.cards.length === 0
      },
      {
        label: this.translate.instant('simulator.draw-specific-card'),
        icon: 'pi pi-id-card',
        disabled: stack.cards.length === 0,
        command: () => this.sim.openDrawSpecificCardDialog(stack)
      },
      {
        label: this.translate.instant('simulator.shuffle-stack'),
        icon: 'pi pi-arrow-right-arrow-left',
        command: () => {
          stack.shuffling = true;
          setTimeout(() => {
            this.sim.shuffleCards(stack.cards);
            stack.shuffling = false;
            this.sim.gameStateService.addLog(this.translate.instant('simulator.log.shuffle', { stack: stack.name }));
          }, 600);
        },
        disabled: stack.cards.length < 2
      },
      {
        label: this.translate.instant('simulator.flip-stack'),
        icon: 'pi pi-refresh',
        command: () => this.sim.flipStack(stack),
        disabled: stack.cards.length === 0
      },
      {
        label: this.translate.instant('simulator.rotate-left'),
        icon: 'pi pi-undo',
        command: () => this.sim.rotateStack(stack, -90)
      },
      {
        label: this.translate.instant('simulator.rotate-right'),
        icon: 'pi pi-refresh',
        command: () => this.sim.rotateStack(stack, 90)
      },
      {
        label: this.translate.instant('simulator.split-in-half'),
        icon: 'pi pi-clone',
        command: () => this.sim.splitInHalf(stack),
        disabled: stack.cards.length < 2
      },
      {
        label: this.translate.instant('simulator.split-by-attribute'),
        icon: 'pi pi-clone',
        disabled: stack.cards.length === 0 || optionAttributes.length < 1,
        // Dynamically create a submenu for each card in the stack
        // items: stack.cards.map(gameCard => ({
        //   label: gameCard.card.name,
        //   command: () => this.sim.drawSpecificCardFromStack(stack, gameCard)
        // })),
        items: optionAttributes.map(attribute => ({
          label: attribute.header,
          command: () => this.sim.splitByAttribute(stack, attribute)
        }))
      },
      {
        label: this.translate.instant('simulator.delete'),
        icon: 'pi pi-trash',
        command: () => this.sim.deleteItem(this.sim.stacks, stack),
        disabled: !stack.deletable
      },
    ];
  }

  /** Menu of a single card on the field */
  card(card: GameCard): MenuItem[] {
    return [
      {
        label: this.translate.instant('simulator.flip-card'),
        icon: 'pi pi-refresh',
        command: () => this.sim.flipCard(card)
      },
      {
        label: this.translate.instant('simulator.toggle-holographic'),
        icon: 'pi pi-star',
        command: () => card.holographic = !card.holographic
      },
      {
        label: this.translate.instant('simulator.rotate-left'),
        icon: 'pi pi-undo',
        command: () => this.sim.rotateCard(card, -90)
      },
      {
        label: this.translate.instant('simulator.rotate-right'),
        icon: 'pi pi-refresh',
        command: () => this.sim.rotateCard(card, 90)
      },
      {
        label: this.translate.instant('simulator.create-stack'),
        icon: 'pi pi-book',
        command: () => this.sim.createStack(this.sim.field.cards, card)
      },
      {
        label: this.translate.instant('simulator.discard-card'),
        icon: 'pi pi-trash',
        command: () => this.sim.discardCard(this.sim.field.cards, card)
      },
      {
        label: this.translate.instant('simulator.hand.take', { player: this.sim.gameStateService.activePlayer?.name ?? '' }),
        icon: 'pi pi-inbox',
        disabled: !this.sim.players.length,
        command: () => this.sim.takeToHand(card)
      }
    ];
  }

  /** Menu of a game component (coin, die, cube, pawn) */
  component(component: GameComponent): MenuItem[] {
    return [
      ...component.contextMenu,
      {
        label: this.translate.instant('simulator.duplicate'),
        icon: 'pi pi-clone',
        command: () => {
          const newComp = {
            ...component,
            uniqueId: component.type + '-' + StringUtils.generateRandomString(),
            pos: {
              x: component.pos.x + 100 + (Math.random() * 100 - 50),
              y: component.pos.y + 100 + (Math.random() * 100 - 50)
            },
          };
          this.sim.gameStateService.bringToFront(newComp);
          this.sim.components.push(newComp);
        },
      },
      {
        label: this.translate.instant('simulator.delete'),
        icon: 'pi pi-trash',
        command: () => this.sim.deleteItem(this.sim.components, component),
      },
    ];
  }

  /** Menu of the empty field: zones, boosters, components, reset, shortcuts */
  field(logicalX: number, logicalY: number, boosters: Booster[] = []): MenuItem[] {
    const add = (type: GameComponent['type'], labelKey: string, suffix = '') => ({
      label: this.translate.instant(labelKey) + suffix,
      icon: 'pi pi-plus',
      items: GameSimulatorMenus.COLORS.map(color => ({
        label: StringUtils.kebabToTitleCase(color),
        command: () => this.addComponent(type, color, logicalX, logicalY),
      })),
    });
    return [
      {
        label: this.translate.instant('simulator.zones.add'),
        icon: 'pi pi-stop',
        command: () => this.sim.addZone(logicalX, logicalY),
      },
      {
        label: this.translate.instant('simulator.boosters.open-here'),
        icon: 'pi pi-gift',
        disabled: !boosters.length,
        items: boosters.map(booster => ({
          label: booster.name,
          command: () => void this.sim.openBoosterOnTable(booster, logicalX, logicalY),
        })),
      },
      {
        separator: true
      },
      add('coin', 'simulator.add-coin'),
      add('cube', 'simulator.add-cube'),
      add('d6', 'simulator.add-die', ' (D6)'),
      add('pawn', 'simulator.add-pawn'),
      {
        separator: true
      },
      {
        label: this.translate.instant('simulator.zoom'),
        icon: 'pi pi-search',
        items: [
          {
            label: 'Tiny',
            command: () => { this.sim.simulatorZoom = 0.15; this.sim.clampAllItems(); }
          },
          {
            label: 'Small',
            command: () => { this.sim.simulatorZoom = 0.20; this.sim.clampAllItems(); }
          },
          {
            label: 'Regular',
            command: () => { this.sim.simulatorZoom = 0.25; this.sim.clampAllItems(); }
          },
          {
            label: 'Large',
            command: () => { this.sim.simulatorZoom = 0.30; this.sim.clampAllItems(); }
          },
          {
            label: 'Huge',
            command: () => { this.sim.simulatorZoom = 0.35; this.sim.clampAllItems(); }
          }
        ]
      },
      {
        separator: true
      },
      {
        label: this.translate.instant('simulator.reset-game'),
        icon: 'pi pi-refresh',
        command: () => this.sim.gameStateService.resetGame(),
      },
      {
        label: this.translate.instant('simulator.update-game-state'),
        icon: 'pi pi-sync',
        command: () => this.sim.gameStateService.updateGameState(),
      },
      {
        separator: true
      },
      {
        label: this.translate.instant('simulator.shortcuts'),
        icon: 'pi pi-question-circle',
        command: () => this.sim.showShortcuts(),
      },
    ];
  }
  /** Puts a new coin, cube, die or pawn on the table */
  addComponent(type: GameComponent['type'], color: string, x: number, y: number): GameComponent {
    const component: GameComponent = {
      uniqueId: type + '-' + StringUtils.generateRandomString(),
      type,
      className: `game-${type} color-${color}`,
      faceUp: true,
      face: type === 'd6' ? 6 : undefined,
      pos: { x, y },
      contextMenu: [],
    };
    this.componentActions(component);
    this.sim.gameStateService.bringToFront(component);
    this.sim.components.push(component);
    return component;
  }

  /** The actions of a component, by type (also rebuilt for a loaded game) */
  componentActions(component: GameComponent): void {
    const flip: MenuItem = {
      label: this.translate.instant('simulator.flip-over'),
      icon: 'pi pi-refresh',
      command: (event: MenuItemCommandEvent) => {
        const state = event.item?.state as GameComponent | undefined;
        if (state) {
          this.sim.flipComponent(state);
        }
      }
    };
    switch (component.type) {
      case 'coin':
        component.contextMenu = [{
          label: this.translate.instant('simulator.flip-randomly'),
          icon: 'pi pi-percentage',
          command: (event: MenuItemCommandEvent) => {
            const state = event.item?.state as GameComponent | undefined;
            if (state) {
              this.sim.tossCoin(state);
            }
          }
        }, flip];
        break;
      case 'd6':
        component.contextMenu = [{
          label: this.translate.instant('simulator.roll-die'),
          icon: 'pi pi-percentage',
          command: (event: MenuItemCommandEvent) => {
            const state = event.item?.state as GameComponent | undefined;
            if (state) {
              this.sim.rollDie(state);
            }
          }
        }];
        break;
      default:
        component.contextMenu = [flip];
    }
  }

  /** Menu of a zone drawn on the table */
  zone(zone: TableZone): MenuItem[] {
    const t = (key: string) => this.translate.instant(key);
    const layouts: ZoneLayout[] = ['libre', 'ligne', 'grille', 'cascade'];
    const faces: ZoneFace[] = ['garder', 'visible', 'cachee'];
    return [
      { label: t('simulator.zones.rename'), icon: 'pi pi-pencil', command: () => this.sim.renameZone(zone) },
      {
        label: t('simulator.zones.layout'), icon: 'pi pi-th-large',
        items: layouts.map(layout => ({
          label: t('simulator.zones.layouts.' + layout), icon: zone.layout === layout ? 'pi pi-check' : undefined,
          command: () => { zone.layout = layout; this.sim.arrangeZone(zone); }
        }))
      },
      {
        label: t('simulator.zones.face'), icon: 'pi pi-clone',
        items: faces.map(face => ({
          label: t('simulator.zones.faces.' + face), icon: zone.face === face ? 'pi pi-check' : undefined,
          command: () => { zone.face = face; this.sim.arrangeZone(zone); }
        }))
      },
      {
        label: t('simulator.zones.owner'), icon: 'pi pi-user',
        items: [
          { label: t('simulator.zones.nobody'), icon: !zone.ownerId ? 'pi pi-check' : undefined, command: () => zone.ownerId = undefined },
          ...this.sim.players.map(player => ({
            label: player.name, icon: zone.ownerId === player.id ? 'pi pi-check' : undefined,
            command: () => { zone.ownerId = player.id; zone.color = player.color; }
          }))
        ]
      },
      {
        label: t('simulator.zones.color'), icon: 'pi pi-palette',
        items: GameSimulatorMenus.ZONE_COLORS.map(color => ({
          label: t('simulator.zones.colors.' + color.key),
          icon: zone.color === color.value ? 'pi pi-check' : undefined,
          command: () => zone.color = color.value
        }))
      },
      { label: t('simulator.zones.arrange'), icon: 'pi pi-align-left', command: () => this.sim.arrangeZone(zone, true) },
      { label: t('simulator.zones.gather'), icon: 'pi pi-book', command: () => this.sim.gatherZone(zone) },
      { separator: true },
      { label: t('simulator.zones.delete'), icon: 'pi pi-trash', command: () => this.sim.deleteZone(zone) },
    ];
  }

  static readonly ZONE_COLORS = [
    { key: 'neutral', value: '#9aa4b2' }, { key: 'gold', value: '#e0a33a' }, { key: 'blue', value: '#4f9be8' },
    { key: 'red', value: '#d9534f' }, { key: 'green', value: '#4caf7d' }, { key: 'purple', value: '#a77be0' },
  ];
}
