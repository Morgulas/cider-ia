import { Injectable } from '@angular/core';
import { CardStack, CardZone, GameCard, GameComponent, LogEntry, Player, Position, Positionable, SavedGameCard, SimulatorSave, TableZone } from './game-simulator.types';
import { DecksService } from '../data-services/services/decks.service';
import { CardsService } from '../data-services/services/cards.service';
import { Card } from '../data-services/types/card.type';
import StringUtils from '../shared/utils/string-utils';
import { AppDB } from '../data-services/indexed-db/db';

@Injectable({
    providedIn: 'root'
})
export class GameSimulatorStateService {

    public stacks: CardStack[] = [];
    public field: CardZone = { name: 'Field', cards: [] };
    public components: GameComponent[] = [];
    public simulatorPan: Position = { x: 0, y: 0 };
    public simulatorZoom = 0.20;
    public topZIndex = 100;
    public discard: CardStack = {
        name: 'Discard', cards: [], faceUp: true,
        uniqueId: 'discard-pile', // Fixed ID for discard? Or random? Component used random. Let's stick to component logic or init.
        pos: { x: 0, y: 0 },
        deletable: false
    };

    public zones: TableZone[] = [];
    public players: Player[] = GameSimulatorStateService.defaultPlayers();
    public currentPlayer = 0;
    public turn = 1;
    public log: LogEntry[] = [];

    static readonly PLAYER_COLORS = ['#e0a33a', '#4f9be8', '#d9534f', '#4caf7d', '#a77be0', '#e07ab8'];
    private static readonly MAX_LOG = 300;

    private _initialized = false;
    get initialized() { return this._initialized; }

    constructor(
        private decksService: DecksService,
        private cardsService: CardsService,
        db: AppDB
    ) {
        // another project was loaded: the next visit to the simulator deals a new game
        db.onLoad().subscribe(() => this._initialized = false);
        // Initialize default discard if needed, though resetGame will overwrite
        this.discard.uniqueId = StringUtils.generateRandomString();
    }

    public async resetGame() {
        const stacks: CardStack[] = [];
        const decks = await this.decksService.getAll();

        // Process decks sequentially or promise.all. Component used forEach/then which is a bit mixy.
        // Let's use clean async/await
        let deckIndex = 0;
        for (const deck of decks) {
            const cards = await this.cardsService.getAll({ deckId: deck.id });
            const expandedCards: GameCard[] = [];

            cards.forEach(card => {
                for (let i = 0; i < card.count; i++) {
                    expandedCards.push({
                        uniqueId: StringUtils.generateRandomString(),
                        card: card,
                        faceUp: true,
                        pos: { x: 0, y: 0 }
                    } as GameCard);
                }
            });

            this.shuffleCards(expandedCards);

            const dropPos: Position = {
                x: (deckIndex % 5) * 1000 - 2000,
                y: Math.floor(deckIndex / 5) * 1300 - 650
            };

            stacks.push({
                uniqueId: StringUtils.generateRandomString(),
                name: deck.name,
                cards: expandedCards,
                faceUp: false,
                pos: dropPos,
                deletable: true,
                rotation: 0
            });

            deckIndex++;
        }

        // Setup Discard
        this.discard = {
            name: 'Discard',
            cards: [],
            uniqueId: StringUtils.generateRandomString(),
            faceUp: true,
            pos: { x: 3500, y: -650 },
            deletable: false,
        };
        stacks.push(this.discard);

        // Apply state
        this.stacks = stacks;
        this.field = { name: 'Field', cards: [] };
        this.components = []; // Or keep components on reset? Usually reset clears everything.

        this.topZIndex = 100;
        // nouvelle partie : mains vidées, compteurs à leur valeur de départ ; zones et joueurs gardés
        this.players.forEach(player => {
            player.hand = [];
            player.counters.forEach(counter => counter.value = counter.start);
        });
        this.currentPlayer = 0;
        this.turn = 1;
        this.log = [];
        this._initialized = true;
    }

    static defaultPlayers(): Player[] {
        return [1, 2].map(n => GameSimulatorStateService.newPlayer(n));
    }

    static newPlayer(n: number): Player {
        return {
            id: StringUtils.generateRandomString(),
            name: `Joueur ${n}`,
            color: GameSimulatorStateService.PLAYER_COLORS[(n - 1) % GameSimulatorStateService.PLAYER_COLORS.length],
            counters: [{ id: StringUtils.generateRandomString(), name: 'PV', value: 20, start: 20 }],
            hand: [],
        };
    }

    get activePlayer(): Player | undefined {
        return this.players[this.currentPlayer] ?? this.players[0];
    }

    playerById(id: string | undefined): Player | undefined {
        return id ? this.players.find(player => player.id === id) : undefined;
    }

    /**
     * Ajoute une ligne au journal. Avec une clé, une ligne récente de même clé est
     * remplacée (clics successifs sur un compteur : une seule ligne).
     */
    public addLog(text: string, player?: Player, key?: string) {
        const now = Date.now();
        const last = this.log[this.log.length - 1];
        if (key && last?.key === key && now - last.at < 4000) {
            last.text = text;
            last.at = now;
            return;
        }
        this.log.push({ at: now, text, color: player?.color, key });
        if (this.log.length > GameSimulatorStateService.MAX_LOG) {
            this.log.splice(0, this.log.length - GameSimulatorStateService.MAX_LOG);
        }
    }

    public endTurn() {
        if (!this.players.length) {
            return;
        }
        this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
        if (this.currentPlayer === 0) {
            this.turn++;
        }
        this.addLog(`Tour ${this.turn} : à ${this.activePlayer?.name}`, this.activePlayer);
    }

    public newGameCard(card: Card, faceUp = true): GameCard {
        return { uniqueId: StringUtils.generateRandomString(), card, faceUp, pos: { x: 0, y: 0 } };
    }

    // ----- Parties enregistrées -----

    public toSave(): SimulatorSave['state'] {
        const saveCard = (card: GameCard): SavedGameCard => ({
            uniqueId: card.uniqueId, cardId: card.card.id, faceUp: card.faceUp, pos: { ...card.pos },
            zIndex: card.zIndex, rotation: card.rotation, holographic: card.holographic, matchId: card.matchId,
        });
        return {
            version: 1,
            stacks: this.stacks.map(stack => ({
                uniqueId: stack.uniqueId, name: stack.name, faceUp: stack.faceUp, deletable: stack.deletable,
                pos: { ...stack.pos }, zIndex: stack.zIndex, rotation: stack.rotation, cards: stack.cards.map(saveCard),
            })),
            discardId: this.discard.uniqueId,
            field: this.field.cards.map(saveCard),
            components: this.components.map(c => ({
                uniqueId: c.uniqueId, type: c.type, className: c.className, faceUp: c.faceUp, face: c.face,
                pos: { ...c.pos }, zIndex: c.zIndex,
            })),
            zones: this.zones.map(zone => ({ ...zone, pos: { ...zone.pos } })),
            players: this.players.map(player => ({
                ...player, counters: player.counters.map(counter => ({ ...counter })), hand: player.hand.map(saveCard),
            })),
            currentPlayer: this.currentPlayer,
            turn: this.turn,
            log: this.log.map(entry => ({ ...entry })),
            pan: { ...this.simulatorPan },
            zoom: this.simulatorZoom,
        };
    }

    /**
     * Rétablit une partie enregistrée. Les cartes supprimées du projet depuis sont
     * ignorées ; les composants reçoivent leur menu par `componentMenu`.
     * @returns le nombre de cartes qui n'existent plus
     */
    public async fromSave(state: SimulatorSave['state'], componentMenu: (component: GameComponent) => void,
        shuffleStacks = false): Promise<number> {
        const cards = await this.cardsService.getAllUnfiltered();
        const byId = new Map(cards.map(card => [card.id, card]));
        let missing = 0;
        const loadCards = (saved: SavedGameCard[]): GameCard[] => saved.flatMap(entry => {
            const card = byId.get(entry.cardId);
            if (!card) {
                missing++;
                return [];
            }
            const { cardId: _cardId, ...rest } = entry;
            return [{ ...rest, pos: { ...entry.pos }, card }];
        });
        this.stacks = state.stacks.map(stack => {
            const loaded: CardStack = { ...stack, pos: { ...stack.pos }, cards: loadCards(stack.cards) };
            if (shuffleStacks && !loaded.faceUp) {
                this.shuffleCards(loaded.cards);
            }
            return loaded;
        });
        this.discard = this.stacks.find(stack => stack.uniqueId === state.discardId)
            ?? { name: 'Discard', cards: [], uniqueId: StringUtils.generateRandomString(), faceUp: true, pos: { x: 3500, y: -650 }, deletable: false };
        if (!this.stacks.includes(this.discard)) {
            this.stacks.push(this.discard);
        }
        this.field = { name: 'Field', cards: loadCards(state.field) };
        this.components = state.components.map(saved => {
            const component = { ...saved, pos: { ...saved.pos }, contextMenu: [] } as GameComponent;
            componentMenu(component);
            return component;
        });
        this.zones = (state.zones ?? []).map(zone => ({ ...zone, pos: { ...zone.pos } }));
        this.players = (state.players ?? []).map(player => ({
            ...player, counters: player.counters.map(counter => ({ ...counter })), hand: loadCards(player.hand),
        }));
        if (!this.players.length) {
            this.players = GameSimulatorStateService.defaultPlayers();
        }
        this.currentPlayer = Math.min(state.currentPlayer ?? 0, this.players.length - 1);
        this.turn = state.turn ?? 1;
        this.log = (state.log ?? []).map(entry => ({ ...entry }));
        this.simulatorPan = { ...state.pan };
        this.simulatorZoom = state.zoom;
        this.recalculateTopZIndex();
        this._initialized = true;
        return missing;
    }

    public async updateGameState() {
        if (!this._initialized) {
            return this.resetGame();
        }

        // 1. Fetch all current Decks and Cards
        const decks = await this.decksService.getAll();

        const allCards: Card[] = [];
        for (const deck of decks) {
            const deckCards = await this.cardsService.getAll({ deckId: deck.id });
            allCards.push(...deckCards);
        }
        const cardMap = new Map(allCards.map(c => [c.id, c]));

        // 2. Update existing GameCards in Stacks, Field, Discard
        const allGameCards = [
            ...this.stacks.flatMap(s => s.cards),
            ...this.field.cards,
            ...this.players.flatMap(player => player.hand),
            // Discard is in stacks? Component logic put discard in stored stacks list.
            // If discard is separate property but also in stacks array, we need to be careful not to duplicate.
            // In this service implementation I kept them separate properties but component pushed discard to stacks. 
            // Let's ensure consistency: in resetGame I pushed discard to stacks.
            // So checking this.stacks covers discard if it's in there.
        ];

        // Check if discard is in stacks, if not add its cards to check list (though it should be in stacks)
        if (!this.stacks.find(s => s === this.discard)) {
            allGameCards.push(...this.discard.cards);
        }

        const gameCardsToRemove: GameCard[] = [];
        const countInSimulator = new Map<number, number>(); // cardId -> count

        for (const gameCard of allGameCards) {
            const latestCard = cardMap.get(gameCard.card.id);
            if (!latestCard) {
                // Card deleted from project
                gameCardsToRemove.push(gameCard);
            } else {
                // Update data
                gameCard.card = latestCard;
                countInSimulator.set(latestCard.id, (countInSimulator.get(latestCard.id) || 0) + 1);
            }
        }

        // Remove deleted cards
        this.removeGameCards(gameCardsToRemove);

        // 3. Add Missing Cards (Cards present in project but 0 instances in simulator)
        const cardsToAdd: Card[] = [];
        for (const card of allCards) {
            if (!countInSimulator.has(card.id) && card.count > 0) {
                cardsToAdd.push(card);
            }
        }

        if (cardsToAdd.length > 0) {
            this.addNewCardsStack(cardsToAdd);
        }

        this.recalculateTopZIndex();
    }

    private removeGameCards(cardsToRemove: GameCard[]) {
        const set = new Set(cardsToRemove);

        // Remove from Stacks
        this.stacks.forEach(stack => {
            stack.cards = stack.cards.filter(c => !set.has(c));
        });
        // Remove from Field
        this.field.cards = this.field.cards.filter(c => !set.has(c));
        // Remove from the hands
        this.players.forEach(player => player.hand = player.hand.filter(c => !set.has(c)));

        // Remove from Discard if not in stacks
        if (!this.stacks.includes(this.discard)) {
            this.discard.cards = this.discard.cards.filter(c => !set.has(c));
        }
    }

    private addNewCardsStack(cards: Card[]) {
        const newGameCards: GameCard[] = [];
        cards.forEach(card => {
            // Add 'count' number of instances? 
            // Requirement: "Create new instances for cards that have zero representation... Add to new cards stack"
            // "If a card exists ... but count changed ... do NOT automatically add/remove"
            // Implies if 0 exist, we probably want to respect the 'count' property for the initial add? 
            // "create new instances for cards that have zero representation" -> likely defaults to 'count' since it's a fresh add.
            for (let i = 0; i < card.count; i++) {
                newGameCards.push({
                    uniqueId: StringUtils.generateRandomString(),
                    card: card,
                    faceUp: true,
                    pos: { x: 0, y: 0 }
                });
            }
        });

        if (newGameCards.length === 0) return;

        this.shuffleCards(newGameCards);

        const newStack: CardStack = {
            uniqueId: StringUtils.generateRandomString(),
            name: 'New Cards',
            cards: newGameCards,
            faceUp: false,
            pos: { x: 50, y: 50 }, // Top left
            deletable: true,
            rotation: 0
        };

        this.bringToFront(newStack);
        this.stacks.push(newStack);
    }

    public shuffleCards(cards: GameCard[]) {
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
    }

    public bringToFront(item: Positionable) {
        item.zIndex = ++this.topZIndex;
    }

    public recalculateTopZIndex() {
        let maxZ = 100;
        const scan = (items: Positionable[]) => {
            items.forEach(item => {
                if (item.zIndex && item.zIndex > maxZ) {
                    maxZ = item.zIndex;
                }
            });
        };

        scan(this.stacks);
        scan(this.field.cards);
        scan(this.components);

        this.topZIndex = maxZ;
    }
}
