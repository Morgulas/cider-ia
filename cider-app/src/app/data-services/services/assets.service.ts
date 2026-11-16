import { Injectable } from '@angular/core';
import { Asset, AssetLibrary, AssetUrls, StoredAsset } from '../types/asset.type';
import { AppDB } from '../indexed-db/db';
import { FieldType } from '../types/field-type.type';
import { BehaviorSubject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { SearchParameters } from '../types/search-parameters.type';
import { IndexedDbService } from '../indexed-db/indexed-db.service';
import StringUtils from 'src/app/shared/utils/string-utils';

/** Why a folder operation was refused: a key of the sidebar.folder-error translations */
export type AssetFolderProblem = 'empty-name' | 'slash-in-name' | 'exists' | 'into-itself' | 'name-taken';

export class AssetFolderError extends Error {
  constructor(readonly problem: AssetFolderProblem, readonly target: string) {
    super(`${problem}: ${target}`);
  }
}

/** Key of an asset in {{assets...}}: two assets with the same key in a folder hide each other */
const assetKey = (name: string | undefined) => StringUtils.toKebabCase(name ?? '');

/** Folder rows of a library (rows without deckId: common library) */
const folderLibrary = (row: { deckId?: number | null }): AssetLibrary => row.deckId ?? null;

/** Two image trees in one: the second wins on the same path, folders are merged */
function mergeTrees(base: AssetUrls, over: AssetUrls): AssetUrls {
  const merged: AssetUrls = { ...base };
  Object.keys(over).forEach(key => {
    const a = merged[key];
    const b = over[key];
    merged[key] = a && typeof a === 'object' && typeof b === 'object' ? mergeTrees(a, b) : b;
  });
  return merged;
}

/**
 * A copy of the tree where an image in a folder stays reachable by its name alone
 * ({{assets.demon}}, {{index assets card.image}}), unless that name is taken at the
 * top level: tidying images into folders does not break templates.
 */
function withAliases(tree: AssetUrls): AssetUrls {
  const urls: AssetUrls = { ...tree };
  const addAliases = (level: AssetUrls) => {
    Object.keys(level).forEach(key => {
      const value = level[key];
      if (typeof value === 'string') {
        if (!(key in urls)) {
          urls[key] = value;
        }
      } else if (value && typeof value === 'object') {
        addAliases(value);
      }
    });
  };
  Object.keys(tree).forEach(key => {
    const value = tree[key];
    if (value && typeof value === 'object') {
      addAliases(value);
    }
  });
  return urls;
}

@Injectable({
  providedIn: 'root'
})
export class AssetsService extends IndexedDbService<Asset, number> {
  /** URLs of the common library (also emitted each time the images change: see urlsFor) */
  assetUrls: BehaviorSubject<AssetUrls>;
  private isLoadingSubject: BehaviorSubject<boolean>;
  /** Images by library, without the aliases */
  private libraryTrees = new Map<AssetLibrary, AssetUrls>();
  /** urlsFor() results, until the images change */
  private readonly mergedUrls = new Map<AssetLibrary, AssetUrls>();
  private objectUrls: string[] = [];
  private deckIds = new Set<number>();
  private readonly currentLibrary = new BehaviorSubject<AssetLibrary>(null);
  /** getAllMetadata() result, until an asset changes */
  private metadataCache: Promise<StoredAsset[]> | null = null;

  constructor(db: AppDB) {
    super(db, AppDB.ASSETS_TABLE, [
      { field: 'id', header: 'ID', type: FieldType.numeric, hidden: true },
      { field: 'name', header: 'Name', type: FieldType.text },
      { field: 'path', header: 'Path', type: FieldType.text },
      { field: 'deckId', header: 'Deck', type: FieldType.numeric, hidden: true },
      { field: 'file', header: 'File', type: FieldType.file }
    ]);
    this.assetUrls = new BehaviorSubject<AssetUrls>({});
    this.isLoadingSubject = new BehaviorSubject<boolean>(true);
    this.updateAssetUrls();

    // update asset URLs whenever the database reloads
    // the assets changed (or another project was loaded): read them again when asked
    db.onChange().pipe(filter(change => change?.tableName === AppDB.ASSETS_TABLE || change?.tableName === 'all'))
      .subscribe(() => this.metadataCache = null);
    db.onLoad().subscribe(() => {
      this.metadataCache = null;
      this.currentLibrary.next(null);
      this.updateAssetUrls();
    });
    // a deck created or deleted changes which library its images belong to
    db.onChange().pipe(filter(change => change?.tableName === AppDB.DECKS_TABLE
      && (change.type === 'create' || change.type === 'delete'))).subscribe(() => this.updateAssetUrls());
  }

  public updateAssetUrls() {
    this.isLoadingSubject.next(false);
    Promise.all([this.getAll(), this.loadDeckIds()]).then(([assets]) => {
      // release the old URLs (aliases and merged trees only repeat them)
      this.objectUrls.forEach(url => URL.revokeObjectURL(url));
      this.objectUrls = [];

      // one tree per library, without aliases: merged and aliased on demand (urlsFor)
      const trees = new Map<AssetLibrary, AssetUrls>();
      assets.forEach(asset => {
        const library = this.libraryOf(asset);
        if (!trees.has(library)) {
          trees.set(library, {});
        }
        let currentLevel = trees.get(library)!;
        if (asset.path) {
          const parts = asset.path.split('/');
          parts.forEach(part => {
            const key = StringUtils.toKebabCase(part);
            const next = currentLevel[key];
            if (!next || typeof next === 'string') {
              currentLevel[key] = {};
            }
            currentLevel = currentLevel[key] as AssetUrls;
          });
        }
        const url = URL.createObjectURL(asset.file);
        this.objectUrls.push(url);
        currentLevel[StringUtils.toKebabCase(asset.name)] = url;
      });
      this.libraryTrees = trees;
      this.mergedUrls.clear();
      return this.urlsFor(null);
    }).then(assetUrls => this.assetUrls.next(assetUrls))
      // the project was closed or reloaded meanwhile: its next load rebuilds the URLs
      .catch(error => console.warn('Asset URLs not rebuilt:', error))
      .then(() => this.isLoadingSubject.next(false));
  }

  /** Ids of the decks of the project: an image of a deck that no longer exists goes back to the common library */
  private loadDeckIds(): Promise<void> {
    return this.db.table(AppDB.DECKS_TABLE).toCollection().primaryKeys()
      .then(ids => { this.deckIds = new Set(ids as number[]); })
      .catch(() => undefined);
  }

  /** Library of an asset: its deck, or the common library (no deck, or a deleted one) */
  libraryOf(asset: { deckId?: number | null } | undefined): AssetLibrary {
    const deckId = asset?.deckId;
    return deckId != null && this.deckIds.has(deckId) ? deckId : null;
  }

  /**
   * URLs of the images a deck sees in its templates ({{assets.dossier.nom}}): the common
   * library and its own, its own taking precedence on the same path. Without a deck
   * (null / undefined, or a deck without images): the common library. The objects are
   * kept until the images change, so they can be compared by reference.
   */
  urlsFor(deckId?: number | null): AssetUrls {
    const library: AssetLibrary = deckId != null && this.libraryTrees.has(deckId) ? deckId : null;
    let urls = this.mergedUrls.get(library);
    if (!urls) {
      const common = this.libraryTrees.get(null) ?? {};
      urls = withAliases(library === null ? common : mergeTrees(common, this.libraryTrees.get(library) ?? {}));
      this.mergedUrls.set(library, urls);
    }
    return urls;
  }

  /** urlsFor(deckId), again each time the images change */
  urlsFor$(deckId?: number | null): Observable<AssetUrls> {
    return this.assetUrls.pipe(map(() => this.urlsFor(deckId)));
  }

  /** The library shown in the Illustrations panel, where new images go */
  getCurrentLibrary(): Observable<AssetLibrary> {
    return this.currentLibrary.asObservable();
  }

  currentLibraryValue(): AssetLibrary {
    return this.currentLibrary.getValue();
  }

  setCurrentLibrary(library: AssetLibrary) {
    if (this.currentLibrary.getValue() !== library) {
      this.currentLibrary.next(library);
    }
  }

  /** Does the asset belong to this library? */
  inLibrary(asset: { deckId?: number | null } | undefined, library: AssetLibrary): boolean {
    return this.libraryOf(asset) === library;
  }

  public isLoading() {
    return this.isLoadingSubject.asObservable();
  }

  override getEntityName(entity: Asset) {
    return entity.name;
  }

  getAssetUrls(): Observable<AssetUrls> {
    return this.assetUrls.asObservable();
  }

  getByName(name: string): Promise<Asset> {
    return this.getAll().then(assets => {
      const filteredAssets = assets.filter(asset => asset.name && asset.name.replace(/ /g, '').toLowerCase() === name);
      return filteredAssets && filteredAssets.length > 0 ? filteredAssets[0] : {} as Asset;
    });
  }

  getByPath(name: string, path: string): Promise<Asset> {
    return this.getAll().then(assets => {
      const filteredAssets = assets.filter(asset =>
        asset.name && asset.name.replace(/ /g, '').toLowerCase() === name.toLowerCase() &&
        (asset.path || '') === path
      );
      return filteredAssets && filteredAssets.length > 0 ? filteredAssets[0] : {} as Asset;
    });
  }

  private static arrayBufferToBlob(buffer: ArrayBuffer, type: string): Blob {
    return new Blob([buffer], { type: type });
  }

  /**
   * The asset as stored: its file kept as a file (Blob) next to its type. The database
   * reads a file only when it is used, so reading the list of assets stays fast.
   * (Older copies kept an ArrayBuffer in "buffer": still read, see insertFile.)
   */
  private static insertArrayBuffer(entity: Asset): Promise<Asset> {
    if (!entity || !entity.file) {
      return Promise.resolve(entity);
    }
    const stored = entity as StoredAsset;
    stored.type = entity.file.type;
    delete stored.buffer;
    return Promise.resolve(entity);
  }

  /**
   * Insert a file/blob into the asset
   * @param entity 
   */
  private static insertFile(entity: Asset): Asset {
    const stored = entity as StoredAsset;
    if (!stored || !stored.buffer || !stored.type) {
      return entity;
    }
    const blob: Blob = AssetsService.arrayBufferToBlob(stored.buffer, stored.type);
    entity.file = new File([blob], entity.name, { type: stored.type });
    stored.buffer = undefined;
    stored.type = undefined;
    return entity;
  }

  override search(searchParameters: SearchParameters) {
    return super.search(searchParameters).then(result => {
      result.records = result.records.map(AssetsService.insertFile);
      return result;
    });
  }

  override get(id: number) {
    return super.get(id).then(AssetsService.insertFile);
  }

  override getAll() {
    return super.getAll().then(entities => entities.map(AssetsService.insertFile));
  }

  /** The assets without their data (names, folders, types) */
  /**
   * The assets without their data (names, folders, decks...). Reading them means reading
   * every image from the database, so the list is kept until an asset changes or another
   * project is loaded: the many callers (explorer, pages, choices) share one read.
   */
  public getAllMetadata(): Promise<StoredAsset[]> {
    if (!this.metadataCache) {
      const read = this.db.table<StoredAsset>(this.tableName).toArray().then(entities => entities.map(e => {
        const copy = { ...e };
        delete copy.buffer; // Free memory immediately
        return copy;
      }));
      this.metadataCache = read;
      read.catch(() => {
        if (this.metadataCache === read) this.metadataCache = null;
      });
    }
    // copies: a caller changing one does not change the others'
    return this.metadataCache.then(assets => assets.map(asset => ({ ...asset })));
  }

  public onChange() {
    return this.db.onChange().pipe(filter(change =>
      change.tableName === AppDB.ASSETS_TABLE || change.tableName === AppDB.ASSET_FOLDERS_TABLE
    ));
  }

  override create(entity: Asset, suppressUrlUpdates?: boolean) {
    this.metadataCache = null;
    return AssetsService.insertArrayBuffer(entity).then(entity => super.create(entity)).then(entity => {
      this.metadataCache = null;
      if (!suppressUrlUpdates) {
        this.updateAssetUrls();
      }
      return entity;
    });
  }

  override update(id: number, entity: Asset, suppressUrlUpdates?: boolean) {
    this.metadataCache = null;
    return AssetsService.insertArrayBuffer(entity).then(entity => super.update(id, entity)).then(entity => {
      this.metadataCache = null;
      if (!suppressUrlUpdates) {
        this.updateAssetUrls();
      }
      return entity;
    });
  }

  override delete(id: number, suppressUrlUpdates?: boolean) {
    this.metadataCache = null;
    return super.delete(id).then(response => {
      this.metadataCache = null;
      if (!suppressUrlUpdates) {
        this.updateAssetUrls();
      }
      return response;
    });
  }

  /** Checks the name of a folder (last part of its path); throws an AssetFolderError */
  static checkFolderName(name: string): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      throw new AssetFolderError('empty-name', trimmed);
    }
    if (trimmed.includes('/')) {
      throw new AssetFolderError('slash-in-name', trimmed);
    }
    return trimmed;
  }

  /** Assets (without their data) of a library */
  private async libraryMetadata(library: AssetLibrary): Promise<StoredAsset[]> {
    await this.loadDeckIds();
    return (await this.getAllMetadata()).filter(asset => this.libraryOf(asset) === library);
  }

  /** Folder rows of a library */
  private async libraryFolderRows(library: AssetLibrary): Promise<{ id: number; path: string; deckId?: number }[]> {
    await this.loadDeckIds();
    const rows = await this.db.table(AppDB.ASSET_FOLDERS_TABLE).toArray();
    return rows.filter(row => this.libraryOf({ deckId: folderLibrary(row) }) === library);
  }

  async createFolder(resultSet: string, library: AssetLibrary = null) {
    const alreadyExists = (await this.libraryFolderRows(library)).some(row => row.path === resultSet);
    if (!alreadyExists) {
      await this.db.table(AppDB.ASSET_FOLDERS_TABLE).add(library === null ? { path: resultSet } : { path: resultSet, deckId: library });
    }
    return true;
  }

  /**
   * Renames or moves a folder of a library with its subfolders and assets. Refused (AssetFolderError)
   * when the target is the folder itself or one of its subfolders, or already exists:
   * merging two folders could put two assets with the same name side by side.
   */
  async renameFolder(oldPath: string, newPath: string, library: AssetLibrary = null) {
    if (newPath === oldPath) {
      return true;
    }
    if (newPath.startsWith(oldPath + '/')) {
      throw new AssetFolderError('into-itself', newPath);
    }
    if ((await this.getFolders(library)).some(folder => folder.toLowerCase() === newPath.toLowerCase()
      && folder.toLowerCase() !== oldPath.toLowerCase())) {
      throw new AssetFolderError('exists', newPath);
    }
    // 1. Update the assets under oldPath (URLs rebuilt once, at the end)
    const inFolder = (path?: string) => path === oldPath || !!path?.startsWith(oldPath + '/');
    const ids = (await this.libraryMetadata(library)).filter(a => inFolder(a.path)).map(a => a.id);
    for (const id of ids) {
      const asset = await this.get(id);
      asset.path = newPath + (asset.path ?? '').substring(oldPath.length);
      await this.update(asset.id, asset, true);
    }
    this.updateAssetUrls();

    // 2. Update its folder entries
    for (const folder of await this.libraryFolderRows(library)) {
      if (inFolder(folder.path)) {
        folder.path = newPath + folder.path.substring(oldPath.length);
        await this.db.table(AppDB.ASSET_FOLDERS_TABLE).put(folder);
      }
    }
    return true;
  }

  async deleteFolder(path: string, library: AssetLibrary = null) {
    const inFolder = (p?: string) => p === path || !!p?.startsWith(path + '/');
    const ids = (await this.libraryMetadata(library)).filter(a => inFolder(a.path)).map(a => a.id);
    for (const id of ids) {
      await this.delete(id, true);
    }
    this.updateAssetUrls();

    for (const folder of await this.libraryFolderRows(library)) {
      if (inFolder(folder.path)) {
        await this.db.table(AppDB.ASSET_FOLDERS_TABLE).delete(folder.id);
      }
    }
    return true;
  }

  /**
   * Moves an asset to a folder, of its library or of another one (library given).
   * Refused (AssetFolderError 'name-taken') when the folder already has an asset with
   * the same name: one would hide the other in the templates.
   */
  async moveAsset(asset: Asset, targetFolder: string, library?: AssetLibrary) {
    await this.loadDeckIds();
    const target = library === undefined ? this.libraryOf(asset) : library;
    const metadata = await this.libraryMetadata(target);
    if (metadata.some(other => other.id !== asset.id && (other.path || '') === targetFolder
      && assetKey(other.name) === assetKey(asset.name))) {
      throw new AssetFolderError('name-taken', asset.name);
    }
    asset.path = targetFolder;
    if (target === null) {
      delete asset.deckId;
    } else {
      asset.deckId = target;
    }
    await this.update(asset.id, asset);
    if (targetFolder) {
      await this.createFolder(targetFolder, target);
    }
    return true;
  }

  /**
   * Moves a folder, with its subfolders and images, to the same place in another library.
   * Refused (AssetFolderError 'name-taken') when an image would land next to one of the
   * same name: one would hide the other in the templates.
   */
  async moveFolderToLibrary(path: string, from: AssetLibrary, to: AssetLibrary) {
    if (from === to) {
      return true;
    }
    const inFolder = (p?: string) => p === path || !!p?.startsWith(path + '/');
    const moving = (await this.libraryMetadata(from)).filter(a => inFolder(a.path));
    const taken = new Set((await this.libraryMetadata(to)).map(a => `${a.path ?? ''}|${assetKey(a.name)}`));
    const clash = moving.find(a => taken.has(`${a.path ?? ''}|${assetKey(a.name)}`));
    if (clash) {
      throw new AssetFolderError('name-taken', clash.name);
    }
    for (const meta of moving) {
      const asset = await this.get(meta.id);
      if (to === null) {
        delete asset.deckId;
      } else {
        asset.deckId = to;
      }
      await this.update(asset.id, asset, true);
    }
    const targetFolders = new Set(await this.getFolders(to));
    for (const row of await this.libraryFolderRows(from)) {
      if (inFolder(row.path)) {
        if (targetFolders.has(row.path)) {
          await this.db.table(AppDB.ASSET_FOLDERS_TABLE).delete(row.id);
        } else {
          await this.db.table(AppDB.ASSET_FOLDERS_TABLE).put(to === null ? { id: row.id, path: row.path }
            : { id: row.id, path: row.path, deckId: to });
        }
      }
    }
    await this.createFolder(path, to);
    this.updateAssetUrls();
    return true;
  }

  /**
   * The images of a deck go back to the common library (the deck is being deleted),
   * in a folder named after the deck so they do not mix with the others.
   */
  async releaseDeckLibrary(deckId: number, folderName: string) {
    const name = (folderName ?? '').replace(/\//g, '-').trim() || `deck-${deckId}`;
    const folders = await this.getFolders(null);
    let base = name;
    for (let i = 2; folders.some(f => f.toLowerCase() === base.toLowerCase()); i++) {
      base = `${name} (${i})`;
    }
    const assets = (await this.getAllMetadata()).filter(asset => asset.deckId === deckId);
    for (const meta of assets) {
      const asset = await this.get(meta.id);
      asset.path = base + (asset.path ? '/' + asset.path : '');
      delete asset.deckId;
      await this.update(asset.id, asset, true);
    }
    const rows = (await this.db.table(AppDB.ASSET_FOLDERS_TABLE).toArray()).filter(row => row.deckId === deckId);
    for (const row of rows) {
      await this.db.table(AppDB.ASSET_FOLDERS_TABLE).put({ id: row.id, path: base + '/' + row.path });
    }
    if (assets.length || rows.length) {
      await this.createFolder(base, null);
    }
    this.updateAssetUrls();
    return assets.length;
  }

  /**
   * Folders of a library: explicit ones (assetFolders table) plus those derived from asset paths
   */
  async getFolders(library: AssetLibrary = null): Promise<string[]> {
    const explicitFolders = (await this.libraryFolderRows(library)).map(r => r.path);
    const derivedFolders = new Set<string>();
    (await this.libraryMetadata(library)).forEach(a => {
      if (a.path) derivedFolders.add(a.path);
    });
    const allFolders = new Set([...explicitFolders, ...derivedFolders]);
    // Expand parent paths: if "a/b/c" exists, ensure "a/b" and "a" also exist.
    const expandedFolders = new Set<string>();
    allFolders.forEach(f => {
      const parts = f.split('/');
      let current = '';
      parts.forEach((p: string, i: number) => {
        current += (i > 0 ? '/' : '') + p;
        expandedFolders.add(current);
      });
    });

    return Array.from(expandedFolders);
  }
}
