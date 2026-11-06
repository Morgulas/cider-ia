import { FoilEffect } from '../../card-binder/foil';

/** Finition de l'emballage du booster. */
export type BoosterFinish = 'mat' | 'brillant' | FoilEffect;

/** Fond de l'emballage. */
export type BoosterBackground = 'degrade' | 'radial' | 'rayures' | 'uni';

/** Apparence du booster scellé : réglages du formulaire, ou modèle HTML/CSS. */
export interface BoosterDesign {
    mode: 'form' | 'template';
    title: string;
    subtitle: string;
    colorA: string;
    colorB: string;
    textColor: string;
    background: BoosterBackground;
    /** Illustration de l'emballage : chemin d'une image du projet (assets). */
    art?: string;
    /** Logo au-dessus du titre : chemin d'une image du projet. */
    logo?: string;
    finish: BoosterFinish;
    /** Bords dentelés en haut et en bas, comme un sachet scellé. */
    crimped: boolean;
    /** Mode modèle : HTML et CSS Handlebars (contexte : booster, assets). */
    html?: string;
    css?: string;
}

/**
 * Un booster : un pool de cartes avec un poids chacune. Une carte de poids 10 sort
 * en moyenne 10 fois plus souvent qu'une carte de poids 1 ; poids 0 = jamais.
 */
export interface Booster {
    id: number;
    name: string;
    /** Decks dont les cartes forment le pool. */
    deckIds: number[];
    cardsPerPack: number;
    /** Une même carte peut-elle sortir deux fois dans un booster ? */
    allowDuplicates: boolean;
    /** Poids des cartes réglées une à une, par id de carte. */
    weights: Record<number, number>;
    /** Poids des cartes non réglées (dont les cartes ajoutées plus tard). */
    defaultWeight: number;
    /** Chance (%) qu'une carte tirée soit foil, en plus de l'attribut « Foil ». */
    foilChance: number;
    /** Effet des cartes rendues foil par la chance ci-dessus. */
    foilEffect: FoilEffect;
    design: BoosterDesign;
}
