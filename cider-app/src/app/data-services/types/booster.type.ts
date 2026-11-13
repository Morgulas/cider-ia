import { FoilEffect } from '../../card-binder/foil';

/** Finition de l'emballage du booster. */
export type BoosterFinish = 'mat' | 'brillant' | FoilEffect;

/** Fond de l'emballage ; « aucun » : transparent (l'illustration seule). */
export type BoosterBackground = 'degrade' | 'radial' | 'rayures' | 'uni' | 'aucun';

/** Bords du sachet. */
export type BoosterEdge = 'lisse' | 'droit' | 'dentele' | 'dentele-fin' | 'crenele' | 'vague';

/** Cadrage de l'illustration : remplir le sachet (rognée) ou la montrer en entier. */
/** cover : remplit (recadre) ; contain : image entière ; fill : étirée au format du sachet (sachet complet). */
export type BoosterArtFit = 'cover' | 'contain' | 'fill';

/** Police des textes du sachet. */
export type BoosterFont = 'classique' | 'moderne' | 'impact' | 'manuscrite';

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
    /** Bords dentelés en haut et en bas (ancien réglage : remplacé par `edge`, gardé pour les designs d'avant). */
    crimped: boolean;
    /** Bords du sachet ; absent : « dentele » si crimped, sinon « lisse ». */
    edge?: BoosterEdge;
    /** Encoches de déchirure sur les côtés, sous la soudure du haut. */
    notches?: boolean;
    /**
     * Sachet complet : chaque illustration (recto, verso) est le sachet entier, forme comprise. Elle est étirée
     * sur tout le sachet, sa silhouette (transparence ou fond uni) en devient la découpe ; l'appli ne dessine plus
     * ni fond, ni bords, ni bandes scellées.
     */
    fullArt?: boolean;
    /** Calques affichés (absents : affichés) : bandeau sombre derrière le titre, titre et sous-titre,
     *  nombre de cartes, bandes scellées en haut et en bas. */
    band?: boolean;
    showTitle?: boolean;
    showCount?: boolean;
    seals?: boolean;
    /** Illustration : cadrage et position verticale (0 : haut, 100 : bas). */
    artFit?: BoosterArtFit;
    artPos?: number;
    /** Textes : position du bloc titre, taille du titre (% de la taille normale), police. */
    textPos?: 'haut' | 'milieu' | 'bas';
    titleSize?: number;
    font?: BoosterFont;
    /** Mode modèle : HTML et CSS Handlebars (contexte : booster, assets). */
    html?: string;
    css?: string;
    /** Empreinte du dernier modèle généré depuis les réglages : s'il n'a pas été retouché à la main, il est
     *  régénéré en repassant en mode modèle. */
    templateFrom?: string;
    /** Verso du sachet (finition, bords et police : ceux du recto). Absent = automatique. */
    back?: BoosterBackDesign;
}

/** Verso du booster. */
export interface BoosterBackDesign {
    /**
     * auto : tiré du recto (couleurs inversées, illustration estompée, nom, nombre de cartes) ;
     * form : réglages ci-dessous ; template : modèle HTML/CSS.
     */
    mode: 'auto' | 'form' | 'template';
    background: BoosterBackground;
    colorA: string;
    colorB: string;
    textColor: string;
    /** Illustration en fond, et son opacité (0 à 100). */
    art?: string;
    artOpacity: number;
    logo?: string;
    /** Titre ; vide = nom du booster. */
    title: string;
    /** Afficher le titre (absent : oui). */
    showTitle?: boolean;
    /** Illustration : cadrage et position verticale (0 : haut, 100 : bas). */
    artFit?: BoosterArtFit;
    artPos?: number;
    /** Texte libre (contenu, règles, mentions…), sur plusieurs lignes. */
    text: string;
    showCount: boolean;
    barcode: boolean;
    html?: string;
    css?: string;
    templateFrom?: string;
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
