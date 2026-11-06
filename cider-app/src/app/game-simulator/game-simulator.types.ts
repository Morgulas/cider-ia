import { Card } from '../data-services/types/card.type';
import { MenuItem } from 'primeng/api';

export interface CardZone {
    name: string;
    cards: GameCard[];
}

export interface CardStack extends Positionable {
    uniqueId: string;
    name: string;
    cards: GameCard[];
    faceUp: boolean;
    deletable: boolean;
    shuffling?: boolean;
    flipping?: boolean;
    rotation?: number;
}

export interface GameCard extends Positionable {
    uniqueId: string;
    card: Card;
    faceUp: boolean;
    matchId?: string;
    discarding?: boolean;
    drawing?: boolean;
    flipping?: boolean;
    rotation?: number;
    holographic?: boolean;
}

export interface GameComponent extends Positionable {
    uniqueId: string;
    type: 'coin' | 'cube' | 'd6' | 'pawn';
    className: string;
    faceUp: boolean;
    face?: number;
    rolling?: boolean;
    flipping?: boolean;
    contextMenu: MenuItem[];
}

export interface Positionable {
    pos: Position;
    zIndex?: number;
}

export interface Position {
    x: number;
    y: number;
}

/** Rangement des cartes posées dans une zone. */
export type ZoneLayout = 'libre' | 'ligne' | 'grille' | 'cascade';

/** Face des cartes posées dans une zone : inchangée, visible ou cachée. */
export type ZoneFace = 'garder' | 'visible' | 'cachee';

/** Une zone de dépôt dessinée sur la table (main posée, terrain, cimetière…). */
export interface TableZone extends Positionable {
    uniqueId: string;
    name: string;
    width: number;
    height: number;
    layout: ZoneLayout;
    face: ZoneFace;
    color: string;
    /** Joueur propriétaire (couleur et nom affichés), facultatif. */
    ownerId?: string;
}

export interface PlayerCounter {
    id: string;
    name: string;
    value: number;
    /** Valeur de départ, rétablie par « Nouvelle partie ». */
    start: number;
}

export interface Player {
    id: string;
    name: string;
    color: string;
    counters: PlayerCounter[];
    /** Cartes en main, hors de la table. */
    hand: GameCard[];
}

export interface LogEntry {
    at: number;
    text: string;
    /** Couleur du joueur à l'origine de l'action. */
    color?: string;
    /** Regroupe les changements successifs d'un même compteur sur une seule ligne. */
    key?: string;
}

/** Une carte de partie enregistrée : la carte du projet est retrouvée par son id. */
export interface SavedGameCard extends Omit<GameCard, 'card' | 'discarding' | 'drawing' | 'flipping'> {
    cardId: number;
}

export interface SavedStack extends Omit<CardStack, 'cards' | 'shuffling' | 'flipping'> {
    cards: SavedGameCard[];
}

/** Partie enregistrée dans le projet (table simulatorSaves). */
export interface SimulatorSave {
    id: number;
    name: string;
    savedAt: number;
    state: {
        version: 1;
        stacks: SavedStack[];
        discardId: string;
        field: SavedGameCard[];
        components: Omit<GameComponent, 'contextMenu' | 'rolling' | 'flipping'>[];
        zones: TableZone[];
        players: (Omit<Player, 'hand'> & { hand: SavedGameCard[] })[];
        currentPlayer: number;
        turn: number;
        log: LogEntry[];
        pan: Position;
        zoom: number;
    };
}
