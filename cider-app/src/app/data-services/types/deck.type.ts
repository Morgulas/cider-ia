export interface Deck {
    id: number;
    name: string;
    /** prompt template used to describe the illustration of each card (AI dialog) */
    illustrationPrompt?: string;
}
