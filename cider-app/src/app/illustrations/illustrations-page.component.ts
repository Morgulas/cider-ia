import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { Button } from 'primeng/button';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { ContextMenu } from 'primeng/contextmenu';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Slider } from 'primeng/slider';
import { Tooltip } from 'primeng/tooltip';
import { debounceTime, merge } from 'rxjs';
import { AssetFolderError, AssetsService } from '../data-services/services/assets.service';
import { DecksService } from '../data-services/services/decks.service';
import { Asset, AssetLibrary, AssetUrls, StoredAsset } from '../data-services/types/asset.type';
import { EntityDialogComponent } from '../entity-dialog/entity-dialog.component';
import StringUtils from '../shared/utils/string-utils';

/** A folder shown in the grid */
export interface FolderTile {
  path: string;
  name: string;
  count: number;
}

/** An image (or other file) shown in the grid */
export interface AssetTile {
  id: number;
  name: string;
  path: string;
  type: string;
  url: string | null;
}

const SIZE_KEY = 'cider.illustrations.size';

/** Name of a new file: its name without the extension, unique in its folder */
export function uniqueName(fileName: string, taken: Set<string>): string {
  const base = StringUtils.splitNameAndExtension(fileName).name.trim() || 'image';
  let name = base;
  for (let i = 2; taken.has(StringUtils.toKebabCase(name)); i++) {
    name = `${base}-${i}`;
  }
  taken.add(StringUtils.toKebabCase(name));
  return name;
}

/**
 * Illustrations of a library, on the whole page: the common library of the project
 * (/illustrations) or the library of a deck (/decks/:deckId/illustrations).
 */
@Component({
  selector: 'app-illustrations-page',
  templateUrl: './illustrations-page.component.html',
  styleUrls: ['./illustrations-page.component.scss'],
  providers: [ConfirmationService, MessageService],
  imports: [FormsModule, TranslatePipe, Button, ConfirmDialog, ContextMenu, Dialog, InputText, Slider, Tooltip,
    EntityDialogComponent]
})
export class IllustrationsPageComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly messages = inject(MessageService);
  private readonly decksService = inject(DecksService);
  readonly assetsService = inject(AssetsService);

  /** The deck whose library is shown, or null: the common library */
  library: AssetLibrary = null;
  libraryName = '';
  /** Other libraries, for « Move to » */
  private libraries: { library: AssetLibrary; name: string }[] = [];

  folder = '';
  query = '';
  /** Width of the thumbnails, in pixels */
  size = 160;
  dropping = false;
  uploading = false;

  private assets: StoredAsset[] = [];
  private folders: string[] = [];
  private urls: AssetUrls = {};

  folderTiles: FolderTile[] = [];
  assetTiles: AssetTile[] = [];
  crumbs: { label: string; path: string }[] = [];

  menuItems: MenuItem[] = [];

  // folder name dialog (new folder, rename)
  folderDialog = false;
  folderDialogTitle = '';
  folderName = '';
  private folderDialogAction: (name: string) => Promise<unknown> = async () => undefined;

  // asset dialog (rename, replace the file)
  assetDialog = false;
  assetDialogTitle = '';
  assetEntity: Partial<Asset> = {};

  ngOnInit(): void {
    try {
      this.size = Number(localStorage.getItem(SIZE_KEY)) || this.size;
    } catch { /* no storage */ }
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const deckId = Number(params.get('deckId')) || null;
      this.library = deckId;
      this.folder = '';
      this.query = '';
      // new images (generator) go to the library shown
      this.assetsService.setCurrentLibrary(deckId);
      void this.load();
    });
    merge(this.assetsService.onChange(), this.assetsService.getAssetUrls())
      .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
  }

  async load(): Promise<void> {
    const decks = await this.decksService.getAll();
    this.libraries = [
      { library: null, name: this.translate.instant('sidebar.library-common') },
      ...decks.map(deck => ({ library: deck.id as AssetLibrary, name: deck.name })),
    ];
    if (this.library !== null && !decks.some(deck => deck.id === this.library)) {
      // a deck that no longer exists: back to the common library
      void this.router.navigateByUrl('/illustrations');
      return;
    }
    this.libraryName = this.nameOf(this.library);
    const library = this.library;
    const [assets, folders] = await Promise.all([
      this.assetsService.getAllMetadata(),
      this.assetsService.getFolders(library),
    ]);
    this.assets = assets.filter(asset => this.assetsService.inLibrary(asset, library));
    this.folders = folders;
    this.urls = this.assetsService.urlsFor(library);
    if (this.folder && !folders.includes(this.folder)) {
      this.folder = '';
    }
    this.refresh();
  }

  /** Rebuilds the tiles of the folder shown, or of the search */
  refresh(): void {
    const query = this.query.trim().toLowerCase();
    const parentOf = (path: string) => path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
    const tile = (asset: StoredAsset): AssetTile => ({
      id: asset.id, name: asset.name, path: asset.path ?? '', type: asset.type ?? asset.file?.type ?? '',
      url: this.urlOf(asset),
    });
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    if (query) {
      this.folderTiles = [];
      this.assetTiles = this.assets.filter(asset => (asset.name ?? '').toLowerCase().includes(query)).map(tile).sort(byName);
    } else {
      this.folderTiles = this.folders.filter(path => parentOf(path) === this.folder).map(path => ({
        path,
        name: path.split('/').pop() ?? path,
        count: this.folders.filter(other => parentOf(other) === path).length
          + this.assets.filter(asset => (asset.path ?? '') === path).length,
      })).sort(byName);
      this.assetTiles = this.assets.filter(asset => (asset.path ?? '') === this.folder).map(tile).sort(byName);
    }
    const parts = this.folder ? this.folder.split('/') : [];
    this.crumbs = [{ label: this.libraryName, path: '' },
      ...parts.map((part, i) => ({ label: part, path: parts.slice(0, i + 1).join('/') }))];
  }

  get total(): number {
    return this.assets.length;
  }

  private nameOf(library: AssetLibrary): string {
    return this.libraries.find(entry => entry.library === library)?.name ?? '';
  }

  /** URL of an asset, from its folders and name ({{assets.dossier.nom}}) */
  private urlOf(asset: StoredAsset): string | null {
    let level: string | AssetUrls | undefined = this.urls;
    for (const key of [...(asset.path ? asset.path.split('/') : []), asset.name ?? '']) {
      if (!level || typeof level === 'string') return null;
      level = level[StringUtils.toKebabCase(key)];
    }
    return typeof level === 'string' ? level : null;
  }

  isImage(tile: AssetTile): boolean {
    return StringUtils.mimeToTypeCategory(tile.type) === 'image';
  }

  iconOf(tile: AssetTile): string {
    switch (StringUtils.mimeToTypeCategory(tile.type)) {
      case 'font': return 'pi pi-language';
      case 'audio': return 'pi pi-volume-up';
      case 'video': return 'pi pi-video';
      default: return 'pi pi-file';
    }
  }

  /** How a template calls the asset */
  usage(tile: AssetTile): string {
    return '{{assets.' + [...(tile.path ? tile.path.split('/') : []), tile.name].map(p => StringUtils.toKebabCase(p)).join('.') + '}}';
  }

  setSize(size: number): void {
    this.size = size;
    try {
      localStorage.setItem(SIZE_KEY, String(size));
    } catch { /* no storage */ }
  }

  openFolder(path: string): void {
    this.folder = path;
    this.query = '';
    this.refresh();
  }

  openAsset(tile: AssetTile): void {
    void this.router.navigateByUrl('/assets/' + tile.id);
  }

  generate(): void {
    this.assetsService.setCurrentLibrary(this.library);
    void this.router.navigateByUrl('/assets/generator');
  }

  // ----- Upload -----

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.upload(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    const types = event.dataTransfer?.types ?? [];
    if (types.includes('Files')) {
      event.preventDefault();
      this.dropping = true;
    }
  }

  onDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) {
      this.dropping = false;
    }
  }

  onDropFiles(event: DragEvent): void {
    this.dropping = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) {
      event.preventDefault();
      void this.upload(files);
    }
  }

  /** Adds files to the folder shown, each under its name (made unique in the folder) */
  async upload(files: File[]): Promise<void> {
    if (!files.length) return;
    this.uploading = true;
    try {
      const taken = new Set(this.assets.filter(asset => (asset.path ?? '') === this.folder)
        .map(asset => StringUtils.toKebabCase(asset.name)));
      for (const file of files) {
        const name = uniqueName(file.name, taken);
        await this.assetsService.create({ name, path: this.folder, file,
          ...(this.library === null ? {} : { deckId: this.library }) } as unknown as Asset, true);
      }
      if (this.folder) {
        await this.assetsService.createFolder(this.folder, this.library);
      }
      this.assetsService.updateAssetUrls();
      this.messages.add({ severity: 'success', summary: this.translate.instant('illustrations.added', { n: files.length }), life: 2500 });
    } finally {
      this.uploading = false;
    }
  }

  // ----- Moves (drag a tile onto a folder or a crumb) -----

  onTileDragStart(event: DragEvent, tile: AssetTile): void {
    event.dataTransfer?.setData('application/x-cider-asset', String(tile.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onFolderDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('application/x-cider-asset')) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  async onFolderDrop(event: DragEvent, path: string): Promise<void> {
    const id = Number(event.dataTransfer?.getData('application/x-cider-asset'));
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    const asset = await this.assetsService.get(id);
    if (!asset || (asset.path || '') === path) return;
    await this.attempt(async () => {
      await this.assetsService.moveAsset(asset, path);
      this.done(this.translate.instant('sidebar.asset-moved',
        { name: asset.name, folder: path || this.translate.instant('sidebar.top-level') }));
    });
  }

  // ----- Context menus -----

  private moveToLibraryMenu(move: (target: AssetLibrary) => Promise<void>): MenuItem {
    const targets = this.libraries.filter(entry => entry.library !== this.library);
    return {
      label: this.translate.instant('sidebar.move-to-library'),
      icon: 'pi pi-arrow-right-arrow-left',
      disabled: targets.length === 0,
      items: targets.map(entry => ({
        label: entry.name,
        icon: entry.library === null ? 'pi pi-globe' : 'pi pi-clone',
        command: () => void move(entry.library),
      })),
    };
  }

  showAssetMenu(event: MouseEvent, tile: AssetTile, menu: ContextMenu): void {
    event.preventDefault();
    this.menuItems = [
      { label: this.translate.instant('illustrations.open'), icon: 'pi pi-eye', command: () => this.openAsset(tile) },
      { label: this.translate.instant('illustrations.copy-usage'), icon: 'pi pi-copy', command: () => this.copyUsage(tile) },
      { label: this.translate.instant('sidebar.edit-rename-asset'), icon: 'pi pi-pencil', command: () => this.editAsset(tile) },
      this.moveToLibraryMenu(target => this.moveAssetToLibrary(tile, target)),
      { separator: true },
      { label: this.translate.instant('sidebar.delete-asset'), icon: 'pi pi-trash', styleClass: 'danger-item',
        command: () => this.deleteAsset(tile) },
    ];
    menu.show(event);
  }

  showFolderMenu(event: MouseEvent, folder: FolderTile, menu: ContextMenu): void {
    event.preventDefault();
    this.menuItems = [
      { label: this.translate.instant('illustrations.open'), icon: 'pi pi-folder-open', command: () => this.openFolder(folder.path) },
      { label: this.translate.instant('sidebar.edit-rename-folder'), icon: 'pi pi-pencil', command: () => this.renameFolder(folder) },
      this.moveToLibraryMenu(target => this.moveFolderToLibrary(folder, target)),
      { separator: true },
      { label: this.translate.instant('sidebar.delete-folder'), icon: 'pi pi-trash', styleClass: 'danger-item',
        command: () => this.deleteFolder(folder) },
    ];
    menu.show(event);
  }

  copyUsage(tile: AssetTile): void {
    void navigator.clipboard?.writeText(this.usage(tile)).then(() =>
      this.done(this.translate.instant('illustrations.usage-copied', { usage: this.usage(tile) })));
  }

  // ----- Actions -----

  newFolder(): void {
    this.openFolderDialog(this.translate.instant('sidebar.create-new-folder'), '', async name => {
      const path = this.folder ? `${this.folder}/${name}` : name;
      if (this.folders.some(folder => folder.toLowerCase() === path.toLowerCase())) {
        throw new AssetFolderError('exists', path);
      }
      await this.assetsService.createFolder(path, this.library);
      this.openFolder(path);
    });
  }

  renameFolder(folder: FolderTile): void {
    this.openFolderDialog(this.translate.instant('sidebar.edit-rename-folder'), folder.name, async name => {
      const parent = folder.path.includes('/') ? folder.path.substring(0, folder.path.lastIndexOf('/')) : '';
      await this.assetsService.renameFolder(folder.path, parent ? `${parent}/${name}` : name, this.library);
    });
  }

  private openFolderDialog(title: string, name: string, action: (name: string) => Promise<unknown>): void {
    this.folderDialogTitle = title;
    this.folderName = name;
    this.folderDialogAction = action;
    this.folderDialog = true;
  }

  async confirmFolderDialog(): Promise<void> {
    await this.attempt(async () => {
      const name = AssetsService.checkFolderName(this.folderName);
      await this.folderDialogAction(name);
      this.folderDialog = false;
    });
  }

  deleteFolder(folder: FolderTile): void {
    this.confirmation.confirm({
      header: this.translate.instant('sidebar.delete-folder'),
      message: this.translate.instant('sidebar.confirm-folder-delete-message', { folderPath: folder.path }),
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.attempt(async () => {
        await this.assetsService.deleteFolder(folder.path, this.library);
        this.done(this.translate.instant('sidebar.folder-deleted'));
      }),
    });
  }

  async editAsset(tile: AssetTile): Promise<void> {
    this.assetDialogTitle = this.translate.instant('sidebar.edit-rename-asset');
    this.assetEntity = await this.assetsService.get(tile.id);
    this.assetDialog = true;
  }

  deleteAsset(tile: AssetTile): void {
    this.confirmation.confirm({
      header: this.translate.instant('sidebar.delete-asset'),
      message: this.translate.instant('illustrations.confirm-delete', { name: tile.name }),
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.attempt(async () => {
        await this.assetsService.delete(tile.id);
        this.done(this.translate.instant('sidebar.entity-deleted'));
      }),
    });
  }

  async moveAssetToLibrary(tile: AssetTile, target: AssetLibrary): Promise<void> {
    await this.attempt(async () => {
      const asset = await this.assetsService.get(tile.id);
      await this.assetsService.moveAsset(asset, asset.path || '', target);
      this.done(this.translate.instant('sidebar.moved-to-library', { name: tile.name, library: this.nameOf(target) }));
    });
  }

  async moveFolderToLibrary(folder: FolderTile, target: AssetLibrary): Promise<void> {
    await this.attempt(async () => {
      await this.assetsService.moveFolderToLibrary(folder.path, this.library, target);
      this.done(this.translate.instant('sidebar.moved-to-library', { name: folder.path, library: this.nameOf(target) }));
    });
  }

  /** Runs an action, explains a refusal (name taken, folder exists...), then shows the result */
  private async attempt(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const problem = error instanceof AssetFolderError ? error.problem : 'failed';
      const name = error instanceof AssetFolderError ? error.target : '';
      this.messages.add({
        severity: 'warn', summary: this.translate.instant('sidebar.not-done'), life: 5000,
        detail: this.translate.instant(`sidebar.folder-error.${problem}`, { name }),
      });
    }
    await this.load();
  }

  private done(detail: string): void {
    this.messages.add({ severity: 'success', summary: detail, life: 2500 });
  }
}
