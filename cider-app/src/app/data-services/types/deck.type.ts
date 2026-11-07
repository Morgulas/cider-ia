export interface Deck {
    id: number;
    name: string;
    /** prompt template used to describe the illustration of each card (AI dialog) */
    illustrationPrompt?: string;
    /** choices remembered for the import of card rows */
    importSettings?: DeckImportSettings;
    /** réglages de « Publier le set » (appli de collection) */
    collectorSet?: DeckCollectorSettings;
}

export interface DeckCollectorSettings {
    code: string;
    nom: string;
    univers: string;
    /** numéro de la prochaine publication */
    publication: number;
}

export interface DeckImportSettings {
    keyColumn?: string;
    /** fields managed in the application: an import fills them on creation only */
    appFields?: string[];
}
