import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';

import { AssetFolderError, AssetsService } from './assets.service';
import { AppDB } from '../indexed-db/db';
import { Asset, AssetUrls } from '../types/asset.type';

describe('AssetsService', () => {
  let service: AssetsService;
  let db: AppDB;

  const image = (text: string) => new File([text], 'x.png', { type: 'image/png' });

  /** Adds an asset; returns its id */
  const add = async (name: string, path: string, content = name) =>
    (await service.create({ name, path, file: image(content) } as unknown as Asset, true)).id;

  /** Assets of the database: "path/name" sorted */
  const where = async () => (await service.getAllMetadata())
    .map(asset => (asset.path ? asset.path + '/' : '') + asset.name).sort();

  const folders = async () => (await db.table(AppDB.ASSET_FOLDERS_TABLE).toArray())
    .map(folder => folder.path as string).sort();

  const problemOf = async (action: Promise<unknown>) => {
    try {
      await action;
      return 'none';
    } catch (error) {
      return error instanceof AssetFolderError ? error.problem : String(error);
    }
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    db = TestBed.inject(AppDB);
    await db.loadProject(null);
    service = TestBed.inject(AssetsService);
  });

  afterEach(async () => {
    await db.loadProject(null);
  });

  it('moves an asset into a folder, which is created, without changing its content', async () => {
    const id = await add('Grimoire', '', 'pixels du grimoire');
    const asset = await service.get(id);
    await service.moveAsset(asset, 'Illustrations/Livres');
    const moved = await service.get(id);
    expect(moved.path).toBe('Illustrations/Livres');
    expect(await moved.file.text()).toBe('pixels du grimoire');
    expect(await folders()).toEqual(['Illustrations/Livres']);
    expect(await service.getFolders()).toEqual(jasmine.arrayWithExactContents(['Illustrations', 'Illustrations/Livres']));
  });

  it('refuses to move an asset next to one with the same name', async () => {
    await add('Dague', 'Armes');
    const id = await add('dague', '');
    expect(await problemOf(service.moveAsset(await service.get(id), 'Armes'))).toBe('name-taken');
    expect(await where()).toEqual(['Armes/Dague', 'dague']);
  });

  it('renames a folder with its subfolders, and only them', async () => {
    await add('Grimoire', 'Cartes');
    await add('Dague', 'Cartes/Armes');
    await add('Autre', 'Cartes2');
    await service.createFolder('Cartes/Vide');
    await service.createFolder('Cartes2');

    await service.renameFolder('Cartes', 'Fangh');
    expect(await where()).toEqual(['Cartes2/Autre', 'Fangh/Armes/Dague', 'Fangh/Grimoire']);
    expect(await folders()).toEqual(['Cartes2', 'Fangh/Vide']);
  });

  it('moves a folder into another one', async () => {
    await add('Dague', 'Armes');
    await service.createFolder('Fangh');
    await service.renameFolder('Armes', 'Fangh/Armes');
    expect(await where()).toEqual(['Fangh/Armes/Dague']);
  });

  it('refuses to merge a folder into an existing one, or into itself', async () => {
    await add('Dague', 'Armes');
    await add('Dague', 'Objets');
    expect(await problemOf(service.renameFolder('Armes', 'Objets'))).toBe('exists');
    expect(await problemOf(service.renameFolder('Armes', 'objets'))).toBe('exists');
    expect(await problemOf(service.renameFolder('Armes', 'Armes/Sous'))).toBe('into-itself');
    expect(await where()).toEqual(['Armes/Dague', 'Objets/Dague']);
    // a change of case only is a rename
    await service.renameFolder('Armes', 'ARMES');
    expect(await where()).toEqual(['ARMES/Dague', 'Objets/Dague']);
  });

  it('deletes a folder with its subfolders, and only them', async () => {
    await add('Grimoire', 'Cartes');
    await add('Dague', 'Cartes/Armes');
    await add('Autre', 'Cartes2');
    await add('Racine', '');
    await service.createFolder('Cartes/Vide');
    await service.deleteFolder('Cartes');
    expect(await where()).toEqual(['Cartes2/Autre', 'Racine']);
    expect(await folders()).toEqual([]);
  });

  it('checks folder names', () => {
    expect(AssetsService.checkFolderName('  Livres ')).toBe('Livres');
    expect(() => AssetsService.checkFolderName('   ')).toThrowMatching(e => e.problem === 'empty-name');
    expect(() => AssetsService.checkFolderName('a/b')).toThrowMatching(e => e.problem === 'slash-in-name');
  });

  it('gives each asset a URL by folder, and by name alone unless the name is taken', async () => {
    await add('Demon', 'Monstres');
    await add('Logo', '');
    await add('Logo', 'Marques');
    service.updateAssetUrls();
    const urls = await firstValueFrom(service.assetUrls.pipe(filter((u: AssetUrls) => 'monstres' in u)));
    const monstres = urls['monstres'] as AssetUrls;
    expect(typeof monstres['demon']).toBe('string');
    // reachable as {{assets.demon}} too
    expect(urls['demon']).toBe(monstres['demon']);
    // the top-level Logo keeps the short name
    expect(urls['logo']).not.toBe((urls['marques'] as AssetUrls)['logo']);
  });

  describe('libraries (common and per deck)', () => {
    /** Adds a deck; returns its id */
    const deck = async (name: string) => await db.table(AppDB.DECKS_TABLE).add({ name }) as number;
    /** Adds an asset to a library; returns its id */
    const addIn = async (name: string, path: string, deckId: number | null, content = name) =>
      (await service.create({ name, path, file: image(content), ...(deckId === null ? {} : { deckId }) } as unknown as Asset, true)).id;
    const urlsReady = async () => {
      service.updateAssetUrls();
      await firstValueFrom(service.assetUrls.pipe(filter((u: AssetUrls) => 'commun' in u)));
    };
    const text = async (url: unknown) => (await fetch(String(url))).text();

    it('lets a deck see its images and the common ones, its own first, not those of other decks', async () => {
      const fangh = await deck('Fangh');
      const flocons = await deck('Flocons');
      await addIn('Commun', '', null);
      await addIn('Dos', '', null, 'dos commun');
      await addIn('Dos', '', fangh, 'dos de Fangh');
      await addIn('Gobelin', 'Monstres', fangh);
      await addIn('Flocon', '', flocons);
      await urlsReady();

      const common = service.urlsFor(null);
      expect(Object.keys(common).sort()).toEqual(['commun', 'dos']);
      expect(await text(common['dos'])).toBe('dos commun');

      const forFangh = service.urlsFor(fangh);
      expect(await text(forFangh['dos'])).toBe('dos de Fangh');
      expect(forFangh['commun']).toBe(common['commun']);
      expect(typeof (forFangh['monstres'] as AssetUrls)['gobelin']).toBe('string');
      expect(forFangh['gobelin']).toBe((forFangh['monstres'] as AssetUrls)['gobelin']);
      expect(forFangh['flocon']).toBeUndefined();
      // kept until the images change: comparable by reference
      expect(service.urlsFor(fangh)).toBe(forFangh);
    });

    it('keeps folders and names apart by library, and moves images between libraries', async () => {
      const fangh = await deck('Fangh');
      const commonId = await addIn('Dague', 'Armes', null);
      await addIn('Dague', 'Armes', fangh);
      await service.createFolder('Vide', fangh);
      expect((await service.getFolders(null)).sort()).toEqual(['Armes']);
      expect((await service.getFolders(fangh)).sort()).toEqual(['Armes', 'Vide']);

      // same name in the same folder of the deck: refused
      expect(await problemOf(service.moveAsset(await service.get(commonId), 'Armes', fangh))).toBe('name-taken');
      await service.moveAsset(await service.get(commonId), 'Vieilles', fangh);
      const moved = await service.get(commonId);
      expect(moved.deckId).toBe(fangh);
      expect(moved.path).toBe('Vieilles');
      expect(await service.getFolders(fangh)).toContain('Vieilles');

      // back to the common library: no deck any more
      await service.moveAsset(await service.get(commonId), '', null);
      expect('deckId' in (await service.get(commonId))).toBeFalse();
    });

    it('moves a whole folder to another library, refusing a name clash', async () => {
      const fangh = await deck('Fangh');
      await addIn('Dague', 'Armes', null);
      await addIn('Epee', 'Armes/Longues', null);
      await addIn('Racine', '', null);
      await service.moveFolderToLibrary('Armes', null, fangh);
      const inFangh = (await service.getAllMetadata()).filter(a => a.deckId === fangh).map(a => `${a.path}/${a.name}`).sort();
      expect(inFangh).toEqual(['Armes/Dague', 'Armes/Longues/Epee']);
      expect(await service.getFolders(null)).toEqual([]);
      expect((await service.getFolders(fangh)).sort()).toEqual(['Armes', 'Armes/Longues']);

      await addIn('Dague', 'Armes', null);
      expect(await problemOf(service.moveFolderToLibrary('Armes', fangh, null))).toBe('name-taken');
    });

    it('gives the images of a deleted deck back to the common library, in a folder named after it', async () => {
      const fangh = await deck('Fangh');
      await addIn('Gobelin', 'Monstres', fangh);
      await addIn('Logo', '', fangh);
      await addIn('Autre', 'Fangh', null);
      expect(await service.releaseDeckLibrary(fangh, 'Fangh')).toBe(2);
      await db.table(AppDB.DECKS_TABLE).delete(fangh);
      expect(await where()).toEqual(['Fangh (2)/Logo', 'Fangh (2)/Monstres/Gobelin', 'Fangh/Autre']);
      expect((await service.getAllMetadata()).some(a => a.deckId != null)).toBeFalse();
    });

    it('counts an image of a deck that no longer exists as common', async () => {
      await addIn('Perdue', '', 999);
      await addIn('Commun', '', null);
      await urlsReady();
      expect(service.libraryOf({ deckId: 999 })).toBeNull();
      expect(typeof service.urlsFor(null)['perdue']).toBe('string');
    });
  });
});
