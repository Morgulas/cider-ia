import { Injectable } from '@angular/core';
import { Asset, AssetUrls, StoredAsset } from '../types/asset.type';
import { AppDB } from '../indexed-db/db';
import { FieldType } from '../types/field-type.type';
import { BehaviorSubject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SearchParameters } from '../types/search-parameters.type';
import { IndexedDbService } from '../indexed-db/indexed-db.service';
import StringUtils from 'src/app/shared/utils/string-utils';

@Injectable({
  providedIn: 'root'
})
export class AssetsService extends IndexedDbService<Asset, number> {
  assetUrls: BehaviorSubject<AssetUrls>;
  private isLoadingSubject: BehaviorSubject<boolean>;

  constructor(db: AppDB) {
    super(db, AppDB.ASSETS_TABLE, [
      { field: 'id', header: 'ID', type: FieldType.numeric, hidden: true },
      { field: 'name', header: 'Name', type: FieldType.text },
      { field: 'path', header: 'Path', type: FieldType.text },
      { field: 'file', header: 'File', type: FieldType.file }
    ]);
    this.assetUrls = new BehaviorSubject<AssetUrls>({});
    this.isLoadingSubject = new BehaviorSubject<boolean>(true);
    this.updateAssetUrls();

    // update asset URLs whenever the database reloads
    db.onLoad().subscribe(() => {
      this.updateAssetUrls();
    });
  }

  public updateAssetUrls() {
    this.isLoadingSubject.next(false);
    this.getAll().then(assets => {
      // release the old URLs - simple cleanup might be insufficient if we have nested structure, 
      // but revokeObjectURL works on the string url, so we just need to collect all strings.
      // For now, let's just revoke everything we tracked.
      const revokeRecursive = (obj: AssetUrls) => {
        if (!obj) return;
        Object.values(obj).forEach(value => {
          if (typeof value === 'string') {
            URL.revokeObjectURL(value);
          } else if (typeof value === 'object') {
            revokeRecursive(value);
          }
        });
      };
      revokeRecursive(this.assetUrls.getValue());

      // generate the new URLs
      const assetUrls: AssetUrls = {};
      assets.forEach(asset => {
        let currentLevel = assetUrls;
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
        currentLevel[StringUtils.toKebabCase(asset.name)] = URL.createObjectURL(asset.file);
      });
      // An asset moved into a folder stays reachable by its name alone
      // ({{assets.demon}}, {{index assets card.image}}), unless that name is
      // taken at the top level: tidying assets into folders does not break templates.
      const addAliases = (level: AssetUrls) => {
        Object.keys(level).forEach(key => {
          const value = level[key];
          if (typeof value === 'string') {
            if (level !== assetUrls && !(key in assetUrls)) {
              assetUrls[key] = value;
            }
          } else if (value && typeof value === 'object') {
            addAliases(value);
          }
        });
      };
      Object.keys(assetUrls).forEach(key => {
        const value = assetUrls[key];
        if (value && typeof value === 'object') {
          addAliases(value);
        }
      });
      return assetUrls;
    }).then(assetUrls => this.assetUrls.next(assetUrls)).then(() => this.isLoadingSubject.next(false));
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
   * Insert an array buffer and type into the asset
   * @param entity 
   */
  private static insertArrayBuffer(entity: Asset): Promise<Asset> {
    if (!entity || !entity.file) {
      return Promise.resolve(entity);
    }
    return entity.file.arrayBuffer().then(buffer => {
      const stored = entity as StoredAsset;
      stored.buffer = buffer;
      stored.type = entity.file.type;
      stored.file = undefined;
      return entity;
    });
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
  public getAllMetadata(): Promise<StoredAsset[]> {
    return this.db.table<StoredAsset>(this.tableName).toArray().then(entities => entities.map(e => {
      const copy = { ...e };
      delete copy.buffer; // Free memory immediately
      return copy;
    }));
  }

  public onChange() {
    return this.db.onChange().pipe(filter(change =>
      change.tableName === AppDB.ASSETS_TABLE || change.tableName === AppDB.ASSET_FOLDERS_TABLE
    ));
  }

  override create(entity: Asset, suppressUrlUpdates?: boolean) {
    return AssetsService.insertArrayBuffer(entity).then(entity => super.create(entity)).then(entity => {
      if (!suppressUrlUpdates) {
        this.updateAssetUrls();
      }
      return entity;
    });
  }

  override update(id: number, entity: Asset) {
    return AssetsService.insertArrayBuffer(entity).then(entity => super.update(id, entity)).then(entity => {
      this.updateAssetUrls();
      return entity;
    });
  }

  override delete(id: number) {
    return super.delete(id).then(response => {
      this.updateAssetUrls();
      return response;
    });
  }

  async createFolder(resultSet: string) {
    const alreadyExists = await this.db.table(AppDB.ASSET_FOLDERS_TABLE).where('path').equals(resultSet).count();
    if (alreadyExists === 0) {
      await this.db.table(AppDB.ASSET_FOLDERS_TABLE).add({ path: resultSet });
    }
    return true;
  }

  async renameFolder(oldPath: string, newPath: string) {
    // 1. Update all assets that start with oldPath
    const allAssets = await this.getAll();
    const assetsToUpdate = allAssets.filter(a => (a.path === oldPath) || (a.path && a.path.startsWith(oldPath + '/')));
    for (const asset of assetsToUpdate) {
      if (asset.path === oldPath) {
        asset.path = newPath;
      } else if (asset.path) {
        asset.path = newPath + asset.path.substring(oldPath.length);
      }
      await this.update(asset.id, asset);
    }

    // 2. Update folder entries in assetFolders table
    const allFolders = await this.db.table(AppDB.ASSET_FOLDERS_TABLE).toArray();
    const foldersToUpdate = allFolders.filter(f => f.path === oldPath || f.path.startsWith(oldPath + '/'));
    for (const folder of foldersToUpdate) {
      if (folder.path === oldPath) {
        folder.path = newPath;
      } else {
        folder.path = newPath + folder.path.substring(oldPath.length);
      }
      await this.db.table(AppDB.ASSET_FOLDERS_TABLE).put(folder);
    }
    return true;
  }

  async deleteFolder(path: string) {
    const allAssets = await this.getAll();
    const assetsToDelete = allAssets.filter(a => (a.path === path) || (a.path && a.path.startsWith(path + '/')));
    for (const asset of assetsToDelete) {
      await this.delete(asset.id);
    }

    const allFolders = await this.db.table(AppDB.ASSET_FOLDERS_TABLE).toArray();
    const foldersToDelete = allFolders.filter(f => f.path === path || f.path.startsWith(path + '/'));
    for (const folder of foldersToDelete) {
      await this.db.table(AppDB.ASSET_FOLDERS_TABLE).where('path').equals(folder.path).delete();
    }
    return true;
  }

  async moveAsset(asset: Asset, targetFolder: string) {
    asset.path = targetFolder;
    await this.update(asset.id, asset);
    if (targetFolder) {
      await this.createFolder(targetFolder);
    }
    return true;
  }

  /**
   * All asset folders: explicit ones (assetFolders table) plus those derived from asset paths
   */
  async getFolders(): Promise<string[]> {
    const explicitFolders = await this.db.table(AppDB.ASSET_FOLDERS_TABLE).toArray().then(rows => rows.map(r => r.path));
    const assets = await this.getAll();
    const derivedFolders = new Set<string>();
    assets.forEach(a => {
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
