import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SiteSidebarComponent, deckSwitchUrl } from './site-sidebar.component';
import { MessageService, TreeNode } from 'primeng/api';
import { TreeNodeDropEvent } from 'primeng/tree';
import { AssetFolderError, AssetsService } from '../data-services/services/assets.service';
import { Asset } from '../data-services/types/asset.type';

describe('SiteSidebarComponent', () => {
  let component: SiteSidebarComponent;
  let fixture: ComponentFixture<SiteSidebarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
    imports: [SiteSidebarComponent],
    providers: [...appTestProviders]
});
    fixture = TestBed.createComponent(SiteSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps the same page when the deck picker switches deck', () => {
    expect(deckSwitchUrl('/decks/1/cards/thumbnails', 7)).toBe('/decks/7/cards/thumbnails');
    expect(deckSwitchUrl('/decks/1/export-cards?ids=1,2', 7)).toBe('/decks/7/export-cards');
    expect(deckSwitchUrl('/decks/1/templates/12', 7)).toBe('/decks/7/cards/listing');
    expect(deckSwitchUrl('/decks/1', 7)).toBe('/decks/7/cards/listing');
  });

  describe('drag and drop of illustrations', () => {
    let assets: AssetsService;
    let messages: jasmine.Spy;

    const assetNode = (id: number, path: string): TreeNode => ({ label: `asset-${id}`, data: { type: 'asset', id, path } });
    const folderNode = (path: string): TreeNode => ({ label: path, data: { type: 'asset-folder', path } });
    const rootNode: TreeNode = { label: 'root', data: { type: 'asset-root', path: '' } };
    const drop = (dragNode: TreeNode, dropNode: TreeNode) =>
      component.onNodeDrop({ dragNode, dropNode } as TreeNodeDropEvent);

    beforeEach(() => {
      assets = TestBed.inject(AssetsService);
      messages = spyOn(fixture.debugElement.injector.get(MessageService), 'add');
      spyOn(component, 'updateFiles').and.resolveTo();
      spyOn(assets, 'get').and.callFake(async (id: number) =>
        ({ id, name: `Image ${id}`, path: id === 1 ? 'Armes' : '' }) as Asset);
      spyOn(assets, 'moveAsset').and.resolveTo(true);
      spyOn(assets, 'renameFolder').and.resolveTo(true);
    });

    const lastMessage = () => messages.calls.mostRecent()?.args[0];

    it('moves an asset into the folder it is dropped on', async () => {
      await drop(assetNode(2, ''), folderNode('Fangh/Livres'));
      expect(assets.moveAsset).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 2 }), 'Fangh/Livres');
      expect(lastMessage().severity).toBe('success');
    });

    it('moves an asset dropped on another asset into that asset\'s folder', async () => {
      await drop(assetNode(2, ''), assetNode(3, 'Monstres'));
      expect(assets.moveAsset).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 2 }), 'Monstres');
    });

    it('does nothing for an asset dropped in its own folder', async () => {
      await drop(assetNode(1, 'Armes'), folderNode('Armes'));
      expect(assets.moveAsset).not.toHaveBeenCalled();
      expect(component.updateFiles).toHaveBeenCalled();
    });

    it('explains a refused move and redraws the tree', async () => {
      (assets.moveAsset as jasmine.Spy).and.rejectWith(new AssetFolderError('name-taken', 'Image 2'));
      await drop(assetNode(2, ''), folderNode('Armes'));
      expect(lastMessage().severity).toBe('warn');
      expect(lastMessage().detail).toBe('sidebar.folder-error.name-taken');
      expect(component.updateFiles).toHaveBeenCalled();
    });

    it('moves a folder with its name into the folder it is dropped on, or to the top', async () => {
      await drop(folderNode('Fangh/Armes'), folderNode('Objets'));
      expect(assets.renameFolder).toHaveBeenCalledWith('Fangh/Armes', 'Objets/Armes');
      await drop(folderNode('Fangh/Armes'), rootNode);
      expect(assets.renameFolder).toHaveBeenCalledWith('Fangh/Armes', 'Armes');
    });

    it('does nothing for a folder dropped where it already is', async () => {
      await drop(folderNode('Fangh/Armes'), folderNode('Fangh'));
      expect(assets.renameFolder).not.toHaveBeenCalled();
    });

    it('explains a refused folder move (into itself, existing folder)', async () => {
      (assets.renameFolder as jasmine.Spy).and.rejectWith(new AssetFolderError('into-itself', 'Armes/Epees/Armes'));
      await drop(folderNode('Armes'), folderNode('Armes/Epees'));
      expect(lastMessage().detail).toBe('sidebar.folder-error.into-itself');
    });

    it('refuses drops that are not illustrations', async () => {
      await drop({ label: 'deck', data: { type: 'deck' } }, folderNode('Armes'));
      expect(assets.moveAsset).not.toHaveBeenCalled();
      expect(assets.renameFolder).not.toHaveBeenCalled();
    });
  });
});
