export interface Asset {
    id: number;
    name: string;
    file: Blob;
    path?: string;
    /** Deck dont la bibliothèque contient l'image ; absent : bibliothèque commune du projet */
    deckId?: number;
}

/** An asset as stored in IndexedDB: the file as an ArrayBuffer next to its type */
export interface StoredAsset extends Omit<Asset, 'file'> {
    file?: Blob;
    buffer?: ArrayBuffer;
    type?: string;
}

/** URLs of the project images by name, folders as nested objects ({{assets.dossier.nom}}) */
export interface AssetUrls {
    [name: string]: string | AssetUrls;
}

/** Bibliothèque d'images : celle d'un deck (son id), ou la bibliothèque commune (null) */
export type AssetLibrary = number | null;
