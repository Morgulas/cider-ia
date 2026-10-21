export interface Deck {
    id: number;
    name: string;
    /** prompt template used to describe the illustration of each card (AI dialog) */
    illustrationPrompt?: string;
    /** choices remembered for the import of card rows */
    importSettings?: DeckImportSettings;
}

export interface DeckImportSettings {
    keyColumn?: string;
    /** fields managed in the application: an import fills them on creation only */
    appFields?: string[];
}
