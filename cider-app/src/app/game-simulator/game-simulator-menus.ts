import { TranslateService } from '@ngx-translate/core';
import { MenuItem } from 'primeng/api';
import { Card } from '../data-services/types/card.type';
import { EntityField } from '../data-services/types/entity-field.type';
import StringUtils from '../shared/utils/string-utils';
import MathUtils from '../shared/utils/math-utils';
import type { GameSimulatorComponent } from './game-simulator.component';
import { CardStack, GameCard, GameComponent } from './game-simulator.types';

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
        command: (event: any) => {
          stack.shuffling = true;
          setTimeout(() => {
            this.sim.shuffleCards(stack.cards);
            stack.shuffling = false;
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

  /** Menu of the empty field: add components, reset, shortcuts */
  field(logicalX: number, logicalY: number): MenuItem[] {
    return [
      {
        label: this.translate.instant('simulator.add-coin'),
        icon: 'pi pi-plus',
        items: GameSimulatorMenus.COLORS.map(color => ({
          label: StringUtils.kebabToTitleCase(color),
          command: () => {
            const component: GameComponent = {
              uniqueId: 'coin-' + StringUtils.generateRandomString(),
              type: 'coin',
              className: 'game-coin color-' + color,
              faceUp: true,
              pos: {
                x: logicalX,
                y: logicalY
              },
              contextMenu: [],
            };
            component.contextMenu = [
              {
                label: this.translate.instant('simulator.flip-randomly'),
                icon: 'pi pi-percentage',
                command: (event: any) => {
                  const componentState: GameComponent | undefined =
                    event.item?.state as GameComponent;
                  if (componentState) {
                    componentState.rolling = true;
                    setTimeout(() => {
                      // Also use flipComponent if desired, but rolling is distinct.
                      // Let's keep rolling as is for random, but if we want 3D flip for strict flip:
                      // Random flip implies "tossing". 
                      componentState.faceUp = Math.random() < 0.5;
                      componentState.rolling = false;
                    }, 600);
                  }
                }
              },
              {
                label: this.translate.instant('simulator.flip-over'),
                icon: 'pi pi-refresh',
                command: (event: any) => {
                  const componentState: GameComponent | undefined =
                    event.item?.state as GameComponent;
                  if (componentState) {
                    this.sim.flipComponent(componentState);
                  }
                }
              },
            ];
            this.sim.gameStateService.bringToFront(component);
            this.sim.components.push(component);
          }
        }))
      },
      {
        label: this.translate.instant('simulator.add-cube'),
        icon: 'pi pi-plus',
        items: GameSimulatorMenus.COLORS.map(color => ({
          label: StringUtils.kebabToTitleCase(color),
          command: () => {
            const component: GameComponent = {
              uniqueId: 'cube-' + StringUtils.generateRandomString(),
              type: 'cube',
              className: `game-cube color-${color}`,
              faceUp: true,
              pos: {
                x: logicalX,
                y: logicalY
              },
              contextMenu: [
                {
                  label: this.translate.instant('simulator.flip-over'),
                  icon: 'pi pi-refresh',
                  command: (event: any) => {
                    const componentState: GameComponent | undefined =
                      event.item?.state as GameComponent;
                    if (componentState) {
                      this.sim.flipComponent(componentState);
                    }
                  }
                },
              ],
            };
            this.sim.gameStateService.bringToFront(component);
            this.sim.components.push(component);
          }
        }))
      },
      {
        label: this.translate.instant('simulator.add-die') + ' (D6)',
        icon: 'pi pi-plus',
        items: GameSimulatorMenus.COLORS.map(color => ({
          label: StringUtils.kebabToTitleCase(color),
          command: () => {
            const component: GameComponent = {
              uniqueId: 'd6-' + StringUtils.generateRandomString(),
              type: 'd6',
              className: `game-d6 color-${color}`,
              faceUp: true,
              face: 6,
              pos: {
                x: logicalX,
                y: logicalY
              },
              contextMenu: [
                {
                  label: this.translate.instant('simulator.roll-die'),
                  icon: 'pi pi-percentage',
                  command: (event: any) => {
                    const componentState: GameComponent | undefined =
                      event.item?.state as GameComponent;
                    if (componentState) {
                      componentState.rolling = true;
                      setTimeout(() => {
                        componentState.face = MathUtils.randomInt(1, 6);
                        componentState.rolling = false;
                      }, 600);
                    }
                  }
                },
              ],
            };
            this.sim.gameStateService.bringToFront(component);
            this.sim.components.push(component);
          }
        }))
      },
      {
        label: this.translate.instant('simulator.add-pawn'),
        icon: 'pi pi-plus',
        items: GameSimulatorMenus.COLORS.map(color => ({
          label: StringUtils.kebabToTitleCase(color),
          command: () => {
            const component: GameComponent = {
              uniqueId: 'pawn-' + StringUtils.generateRandomString(),
              type: 'pawn',
              className: `game-pawn color-${color}`,
              faceUp: true,
              pos: {
                x: logicalX,
                y: logicalY
              },
              contextMenu: [
                {
                  label: this.translate.instant('simulator.flip-over'),
                  icon: 'pi pi-refresh',
                  command: (event: any) => {
                    const componentState: GameComponent | undefined =
                      event.item?.state as GameComponent;
                    if (componentState) {
                      this.sim.flipComponent(componentState);
                    }
                  }
                },
              ],
            };
            this.sim.gameStateService.bringToFront(component);
            this.sim.components.push(component);
          }
        }))
      },
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
}
