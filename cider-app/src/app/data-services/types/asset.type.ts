export interface Asset {
    id: number;
    name: string;
    file: Blob;
    path?: string;
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
