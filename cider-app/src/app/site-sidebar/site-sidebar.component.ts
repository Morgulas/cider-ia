import { Component, Input, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmationService, MenuItem, MessageService, TreeDragDropService, TreeNode, PrimeTemplate } from 'primeng/api';
import { DecksService } from '../data-services/services/decks.service';
import { AssetsService } from '../data-services/services/assets.service';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { CardAttributesService } from '../data-services/services/card-attributes.service';
import { debounceTime, filter, firstValueFrom } from 'rxjs';
import StringUtils from '../shared/utils/string-utils';
import { TreeNodeContextMenuSelectEvent, TreeNodeSelectEvent, TreeNodeDropEvent, Tree } from 'primeng/tree';
import { NavigationEnd, Router } from '@angular/router';
import { AnyEntityService } from '../data-services/types/entity-service.type';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { Select } from 'primeng/select';
import { Menu } from 'primeng/menu';
import { Tooltip } from 'primeng/tooltip';

/** The entity edited in the dialog: any table, its id and name when it has them */
interface DialogEntity {
  id?: number | string;
  name?: string;
  [field: string]: unknown;
}

/** A deck as the picker lists it */
export interface DeckOption {
  id: number;
  name: string;
  cards: number;
}

/** What the sidebar shows: the project and the selected deck, or the illustrations */
export type SidebarActivity = 'explorer' | 'assets';

import { DocumentsService } from '../data-services/services/documents.service';
import { HttpClient } from '@angular/common/http';
import { AppDB } from '../data-services/indexed-db/db';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { Asset, StoredAsset } from '../data-services/types/asset.type';
import { Bind } from 'primeng/bind';
import { ContextMenu } from 'primeng/contextmenu';
import { EntityDialogComponent } from '../entity-dialog/entity-dialog.component';
import { ConfirmDialog } from 'primeng/confirmdialog';

import { CurrentProjectService } from '../server/current-project.service';

/** Remembered deck of the picker, per project, so a reload lands on the same deck */
const DECK_STORAGE_KEY = 'cider.sidebar.deck.';

/**
 * Where to go when the picker switches deck: the same page of the other deck,
 * or its card list when the page belongs to the previous deck (a template)
 */
export function deckSwitchUrl(currentUrl: string, deckId: number): string {
  const match = /^\/decks\/\d+(\/[^?#]*)?/.exec(currentUrl);
  const rest = match?.[1] ?? '';
  const keep = ['/cards/listing', '/cards/thumbnails', '/cards/attributes', '/prompt', '/export-cards', '/templates/generator'];
  return `/decks/${deckId}` + (keep.includes(rest) ? rest : '/cards/listing');
}

@Component({
    selector: 'app-site-sidebar',
    templateUrl: './site-sidebar.component.html',
    styleUrls: ['./site-sidebar.component.scss'],
    providers: [MessageService, ConfirmationService, TreeDragDropService],
    imports: [Bind, Tree, PrimeTemplate, ContextMenu, EntityDialogComponent, ConfirmDialog, TranslatePipe,
      FormsModule, NgTemplateOutlet, Select, Menu, Tooltip]
})
export class SiteSidebarComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentProject = inject(CurrentProjectService);

  /** Explorer (project + selected deck) or illustrations */
  @Input() activity: SidebarActivity | string = 'explorer';

  /** Project home and documents */
  projectFiles: TreeNode[] = [];
  /** Pages and templates of the selected deck */
  deckFiles: TreeNode[] = [];
  /** Illustrations and other assets */
  assetFiles: TreeNode[] = [];

  decks: DeckOption[] = [];
  currentDeckId: number | null = null;
  deckMenuItems: MenuItem[] = [];

  selectedFile: TreeNode | null = null;
  menuItems: MenuItem[] = [];
  updatingFiles = false;
  pendingUpdate = false;
  dialogVisible = false;
  dialogTitle = '';
  service: AnyEntityService;
  entity: DialogEntity = {};

  constructor(private decksService: DecksService,
    private cardAttributesService: CardAttributesService,
    private assetsService: AssetsService,
    private templatesService: CardTemplatesService,
    private documentsService: DocumentsService,
    private confirmationService: ConfirmationService,
    private messageService: MessageService,
    private translate: TranslateService,
    private httpClient: HttpClient,
    public router: Router,
    private db: AppDB) {
    this.service = {} as AnyEntityService;
  }

  ngOnInit() {
    // update menu on language change
    this.translate.stream('welcome.title').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateFiles();
    });

    // Database ready or reloaded: full tree rebuild
    this.db.onLoad().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.currentDeckId = null;
      this.updateFiles();
    });

    // Structural changes (create/delete/reset): full tree rebuild
    this.db.onChange().pipe(debounceTime(500)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(change => {
      // only what the sidebar shows: a card edit (and its journal entry, written at
      // every save) used to rebuild the whole tree; cards count in the deck picker
      const treeTables = [AppDB.DECKS_TABLE, AppDB.CARD_TEMPLATES_TABLE, AppDB.DOCUMENTS_TABLE,
        AppDB.ASSETS_TABLE, AppDB.ASSET_FOLDERS_TABLE, AppDB.CARDS_TABLE];
      if (!change || change.type === 'reset'
        || ((change.type === 'create' || change.type === 'delete') && treeTables.includes(change.tableName))) {
        this.updateFiles();
      }
    });

    // A page of another deck was opened (link, history): the picker follows
    this.decksService.getSelectedDeck().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(deck => {
      if (deck?.id != null && deck.id !== this.currentDeckId) {
        this.setCurrentDeck(deck.id);
        this.updateFiles();
      }
    });

    // Highlight the page being shown
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncSelection());
  }

  get currentDeck(): DeckOption | undefined {
    return this.decks.find(deck => deck.id === this.currentDeckId);
  }

  private storageKey(): string {
    return DECK_STORAGE_KEY + (this.currentProject.project()?.name ?? '');
  }

  private setCurrentDeck(deckId: number | null) {
    this.currentDeckId = deckId;
    try {
      if (deckId != null) localStorage.setItem(this.storageKey(), String(deckId));
    } catch { /* storage unavailable: the picker just forgets */ }
  }

  /** The deck picked in the list: show its pages, and the same page of it */
  onDeckChange(deckId: number | null) {
    if (deckId == null) return;
    this.setCurrentDeck(deckId);
    this.updateFiles();
    if (this.router.url.startsWith('/decks/')) {
      this.router.navigateByUrl(deckSwitchUrl(this.router.url, deckId));
    }
  }

  createDeck() {
    this.openCreateDialog(this.decksService, this.translate.instant('sidebar.create-new-deck'), {
      name: `${this.translate.instant('sidebar.deck')}-${Math.random().toString(36).substr(2, 9)}`
    });
  }

  async updateFiles() {
    if (!this.db.isOpen()) {
      console.warn('Database is closed, skipping sidebar update');
      return;
    }
    if (this.updatingFiles) {
      // rebuild again once the running one is done, so the last change is shown
      this.pendingUpdate = true;
      return;
    }
    this.updatingFiles = true;
    try {
      this.projectFiles = await this.buildProjectNodes();
      await this.loadDecks();
      this.deckMenuItems = this.buildDeckMenu();
      this.deckFiles = await this.buildDeckNodes();
      this.assetFiles = [await this.buildAssetsRoot()];
      this.syncSelection();
    } catch (e) {
      console.error('Error updating sidebar files:', e);
    } finally {
      this.updatingFiles = false;
      if (this.pendingUpdate) {
        this.pendingUpdate = false;
        this.updateFiles();
      }
    }
  }

  /** Select the node of the page shown, in whichever tree has it */
  syncSelection() {
    const url = this.router.url.split('?')[0];
    const find = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.data?.url === url) return node;
        const child = find(node.children ?? []);
        if (child) return child;
      }
      return null;
    };
    // /decks/1 and /decks/1/cards show the card list
    const listing = /^\/decks\/\d+(\/cards)?$/.test(url) ? find(this.deckFiles.filter(n => n.styleClass === 'card-listing')) : null;
    this.selectedFile = listing ?? find(this.projectFiles) ?? find(this.deckFiles) ?? find(this.assetFiles);
  }

  // -----------------------------------------------
  // Project home and documents
  // -----------------------------------------------
  private async buildProjectNodes(): Promise<TreeNode[]> {
    const nodes: TreeNode[] = [];
    const projectName = this.currentProject.project()?.name ?? this.translate.instant('sidebar.unknown-project');
    const newDocument: MenuItem = {
      label: this.translate.instant('sidebar.add-new-document'),
      icon: 'pi pi-file-plus',
      command: () => this.openCreateDocumentDialog(this.documentsService,
        this.translate.instant('sidebar.create-new-document'))
    };
    const home: TreeNode = {
      label: projectName,
      data: {
        url: '/project',
        actions: [newDocument],
        contextMenu: [
          { label: this.translate.instant('sidebar.add-new-deck'), icon: 'pi pi-plus', command: () => this.createDeck() },
          newDocument,
        ],
      },
      icon: 'pi pi-home',
      styleClass: 'project-home',
      expanded: true,
      children: [],
      draggable: false,
      droppable: false
    };
    nodes.push(home);

    const styles = await this.documentsService.getAll({ mime: 'text/css' });
    styles.forEach(document => home.children!.push({
      label: document.name,
      data: { url: '/documents/' + document.id, id: document.id, type: 'document' },
      icon: 'pi pi-receipt',
      styleClass: 'document-file',
      draggable: false,
      droppable: false
    }));

    const documents = await this.documentsService.getAll({ mime: 'text/markdown' });
    documents.forEach(document => home.children!.push({
      label: document.name,
      data: {
        url: '/documents/' + document.id,
        id: document.id,
        type: 'document',
        contextMenu: [
          newDocument,
          {
            label: this.translate.instant('sidebar.edit-rename-document'),
            icon: 'pi pi-pencil',
            command: () => this.openEditDialog(this.documentsService, document.id,
              this.translate.instant('sidebar.edit-rename-document'))
          },
          {
            label: this.translate.instant('sidebar.delete-document'),
            icon: 'pi pi-trash',
            command: () => this.openDeleteDialog(document.id, this.documentsService)
          }
        ],
      },
      icon: 'pi pi-file',
      styleClass: 'document-file',
      draggable: false,
      droppable: false
    }));
    return nodes;
  }

  // -----------------------------------------------
  // Deck picker
  // -----------------------------------------------
  private async loadDecks() {
    const decks = await this.decksService.getAll();
    const cards = this.db.table(AppDB.CARDS_TABLE);
    this.decks = await Promise.all(decks.map(async deck => ({
      id: deck.id,
      name: deck.name,
      cards: await cards.where('deckId').equals(deck.id).count().catch(() => 0)
    })));

    // keep the deck shown if it still exists, else the deck being edited,
    // the one remembered for this project, or the first one
    if (!this.decks.some(deck => deck.id === this.currentDeckId)) {
      let remembered: number | null = null;
      try {
        remembered = Number(localStorage.getItem(this.storageKey())) || null;
      } catch { /* no storage */ }
      const selected = this.decksService.selectedDeck.getValue()?.id;
      const candidate = [selected, remembered].find(id => this.decks.some(deck => deck.id === id));
      this.currentDeckId = candidate ?? this.decks[0]?.id ?? null;
    }
  }

  private buildDeckMenu(): MenuItem[] {
    const deck = this.currentDeck;
    if (!deck) return [{ label: this.translate.instant('sidebar.add-new-deck'), icon: 'pi pi-plus', command: () => this.createDeck() }];
    return [
      {
        label: this.translate.instant('sidebar.add-new-deck'),
        icon: 'pi pi-plus',
        command: () => this.createDeck()
      },
      { separator: true },
      {
        label: this.translate.instant('sidebar.add-new-card-template'),
        icon: 'pi pi-plus',
        command: () => this.router.navigateByUrl(`/decks/${deck.id}/templates/generator`)
      },
      {
        label: this.translate.instant('sidebar.edit-rename-deck'),
        icon: 'pi pi-pencil',
        command: () => this.openEditDialog(this.decksService, deck.id, this.translate.instant('sidebar.edit-rename-deck'))
      },
      {
        label: this.translate.instant('sidebar.all-decks'),
        icon: 'pi pi-clone',
        command: () => this.router.navigateByUrl('/decks')
      },
      { separator: true },
      {
        label: this.translate.instant('sidebar.delete-deck'),
        icon: 'pi pi-trash',
        styleClass: 'danger-item',
        command: () => this.openDeleteDialog(deck.id, this.decksService)
      },
    ];
  }

  // -----------------------------------------------
  // Pages and templates of the selected deck
  // -----------------------------------------------
  private async buildDeckNodes(): Promise<TreeNode[]> {
    const deck = this.currentDeck;
    if (!deck) return [];
    const base = '/decks/' + deck.id;
    const page = (label: string, url: string, icon: string, styleClass: string, extra: Partial<TreeNode> = {}): TreeNode => ({
      label: this.translate.instant(label),
      data: { url: base + url },
      icon, styleClass, draggable: false, droppable: false, ...extra
    });

    const nodes: TreeNode[] = [
      page('sidebar.cards', '/cards/listing', 'pi pi-list', 'card-listing', { data: { url: base + '/cards/listing', badge: deck.cards } }),
      page('sidebar.thumbnails', '/cards/thumbnails', 'pi pi-th-large', 'card-thumbnails'),
      page('sidebar.attributes', '/cards/attributes', 'pi pi-tags', 'card-attributes'),
      page('sidebar.illustration-prompt', '/prompt', 'pi pi-sparkles', 'deck-prompt'),
      page('sidebar.export-cards', '/export-cards', 'pi pi-file-export', 'card-export'),
    ];

    const newTemplate: MenuItem = {
      label: this.translate.instant('sidebar.add-new-card-template'),
      icon: 'pi pi-plus',
      command: () => this.router.navigateByUrl(`${base}/templates/generator`)
    };
    const otherDecks = this.decks.filter(other => other.id !== deck.id);
    const templates = await this.templatesService.getAllUnfiltered({ deckId: deck.id });
    templates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    nodes.push({
      label: this.translate.instant('sidebar.templates'),
      data: { type: 'template-folder', badge: templates.length, actions: [newTemplate], contextMenu: [newTemplate] },
      icon: 'pi pi-folder',
      styleClass: 'template-folder',
      expanded: true,
      selectable: false,
      draggable: false,
      droppable: false,
      children: templates.map(template => ({
        label: template.name,
        data: {
          url: `${base}/templates/${template.id}`,
          id: template.id,
          type: 'template',
          contextMenu: [
            newTemplate,
            {
              label: this.translate.instant('sidebar.edit-rename-card-template'),
              icon: 'pi pi-pencil',
              command: () => this.openEditDialog(this.templatesService, template.id,
                this.translate.instant('sidebar.edit-rename-card-template'))
            },
            {
              label: this.translate.instant('sidebar.duplicate-card-template'),
              icon: 'pi pi-copy',
              command: () => this.openDuplicateDialog(this.templatesService, template.id,
                this.translate.instant('sidebar.duplicate-card-template'))
            },
            // drag and drop needed both decks on screen: a submenu does it now
            ...(otherDecks.length ? [{
              label: this.translate.instant('sidebar.move-card-template'),
              icon: 'pi pi-arrow-right-arrow-left',
              items: otherDecks.map(other => ({
                label: other.name,
                icon: 'pi pi-folder',
                command: () => this.moveTemplate(template.id, other.id)
              }))
            }] : []),
            {
              label: this.translate.instant('sidebar.delete-card-template'),
              icon: 'pi pi-trash',
              command: () => this.openDeleteDialog(template.id, this.templatesService)
            }
          ],
        },
        icon: 'pi pi-id-card',
        styleClass: 'card-template',
        draggable: false,
        droppable: false
      }))
    });
    return nodes;
  }

  async moveTemplate(templateId: number, deckId: number) {
    const template = await this.templatesService.get(templateId);
    if (!template || template.deckId === deckId) return;
    template.deckId = deckId;
    await this.templatesService.update(template.id, template);
    const deckName = this.decks.find(deck => deck.id === deckId)?.name ?? '';
    this.messageService.add({
      severity: 'success', summary: this.translate.instant('sidebar.moved'),
      detail: this.translate.instant('sidebar.template-moved', { deck: deckName }), life: 3000
    });
    if (this.router.url.startsWith(`/decks/${this.currentDeckId}/templates/${templateId}`)) {
      this.router.navigateByUrl(`/decks/${this.currentDeckId}/cards/listing`);
    }
    this.updateFiles();
  }

  // -----------------------------------------------
  // Illustrations: assets tree (folders + files)
  // -----------------------------------------------
  private async buildAssetsRoot(): Promise<TreeNode> {
    const assets = await this.assetsService.getAllMetadata();
    const folders = await this.assetsService.getFolders();

    const assetsRoot: TreeNode = {
      label: this.translate.instant('sidebar.assets'),
      data: {
        url: '/assets',
        type: 'asset-root',
        path: '',
        // shown on the node itself, so folders can be created without a right click
        actions: [
          {
            label: this.translate.instant('sidebar.create-new-folder'),
            icon: 'pi pi-folder-plus',
            command: () => this.openCreateFolderDialog('')
          },
          {
            label: this.translate.instant('sidebar.add-new-asset'),
            icon: 'pi pi-plus',
            command: () => this.openCreateDialog(this.assetsService,
              this.translate.instant('sidebar.create-new-asset'), {
              name: `asset-${Math.random().toString(36).substr(2, 9)}`
            })
          }
        ],
        contextMenu: [
          {
            label: this.translate.instant('sidebar.add-new-asset'),
            icon: 'pi pi-plus',
            command: () => {
              this.openCreateDialog(this.assetsService,
                this.translate.instant('sidebar.create-new-asset'), {
                name: `asset-${Math.random().toString(36).substr(2, 9)}`
              });
            }
          },
          {
            label: this.translate.instant('sidebar.create-new-folder'),
            icon: 'pi pi-folder',
            command: () => {
              this.openCreateFolderDialog('');
            }
          },
          {
            label: this.translate.instant('sidebar.generate-new-asset'),
            icon: 'pi pi-sparkles',
            command: () => {
              this.router.navigateByUrl(`/assets/generator`);
            }
          }
        ],
      },
      icon: 'pi pi-images',
      expanded: true,
      children: [],
      droppable: true,
      draggable: false,
      selectable: true
    };
    // Helper to find or create folder nodes
    const folderNodes = new Map<string, TreeNode>();

    // 1. Create nodes for all folders
    // Sort folders by length so we create parents first? 
    // Actually getFolders returns recursive traversal, so parents come first usually? 
    // But better be safe: sort by path segments length.
    folders.sort((a, b) => a.split('/').length - b.split('/').length);

    folders.forEach(folderPath => {
      const parts = folderPath.split('/');
      const folderName = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');

      const folderNode: TreeNode = {
        label: folderName,
        data: {
          type: 'asset-folder',
          path: folderPath,
          actions: [
            {
              label: this.translate.instant('sidebar.create-new-folder'),
              icon: 'pi pi-folder-plus',
              command: () => this.openCreateFolderDialog(folderPath)
            },
            {
              label: this.translate.instant('sidebar.add-new-asset'),
              icon: 'pi pi-plus',
              command: () => this.openCreateDialog(this.assetsService,
                this.translate.instant('sidebar.create-new-asset'), {
                name: `asset-${Math.random().toString(36).substr(2, 9)}`,
                path: folderPath
              })
            }
          ],
          contextMenu: [
            {
              label: this.translate.instant('sidebar.add-new-asset'),
              icon: 'pi pi-plus',
              command: () => {
                this.openCreateDialog(this.assetsService,
                  this.translate.instant('sidebar.create-new-asset'), {
                  name: `asset-${Math.random().toString(36).substr(2, 9)}`,
                  path: folderPath
                });
              }
            },
            {
              label: this.translate.instant('sidebar.create-new-folder'),
              icon: 'pi pi-folder',
              command: () => {
                this.openCreateFolderDialog(folderPath);
              }
            },
            {
              label: this.translate.instant('sidebar.edit-rename-folder'),
              icon: 'pi pi-pencil',
              command: () => {
                this.openRenameFolderDialog(folderPath);
              }
            },
            {
              label: this.translate.instant('sidebar.delete-folder'),
              icon: 'pi pi-trash',
              command: () => {
                this.openDeleteFolderDialog(folderPath);
              }
            }
          ]
        },
        icon: 'pi pi-folder',
        expanded: true,
        children: [],
        droppable: true,
        draggable: true
      };

      folderNodes.set(folderPath, folderNode);

      if (parentPath === '') {
        assetsRoot.children?.push(folderNode);
      } else {
        const parentNode = folderNodes.get(parentPath);
        if (parentNode) {
          parentNode.children?.push(folderNode);
        } else {
          // Should not happen if sorted correctly and getFolders is consistent
          console.warn('Parent folder not found for', folderPath);
          assetsRoot.children?.push(folderNode); // Fallback
        }
      }
    });

    // 2. Add assets to their folders
    assets.forEach(asset => {
      const assetNode: TreeNode = {
        label: asset.name,
        data: {
          url: '/assets/' + asset.id,
          id: asset.id,
          type: 'asset',
          path: asset.path,
          contextMenu: [
            // ... same context menu as before but maybe 'Move'? 
            // Drag and drop covers move. 
            {
              label: this.translate.instant('sidebar.edit-rename-asset'),
              icon: 'pi pi-pencil',
              command: () => {
                this.openEditDialog(this.assetsService, asset.id,
                  this.translate.instant('sidebar.edit-rename-asset'));
              }
            },
            {
              label: this.translate.instant('sidebar.generate-new-asset'),
              icon: 'pi pi-sparkles',
              command: () => {
                this.router.navigateByUrl(`/assets/generator`);
              }
            },
            {
              label: this.translate.instant('sidebar.delete-asset'),
              icon: 'pi pi-trash',
              command: () => {
                this.openDeleteDialog(asset.id, this.assetsService);
              }
            }
          ],
        },
        icon: this.getAssetIcon(asset),
        styleClass: 'asset-file',
        draggable: true,
        droppable: false,
      };

      if (asset.path && folderNodes.has(asset.path)) {
        folderNodes.get(asset.path)?.children?.push(assetNode);
      } else {
        assetsRoot.children?.push(assetNode);
      }
    });

    // Sort children: Folders first, then Files. Alphabetical.
    const sortNodes = (nodes: TreeNode[] | undefined) => {
      if (!nodes) return;
      nodes.sort((a, b) => {
        const typeA = a.data.type === 'asset-folder' ? 0 : 1;
        const typeB = b.data.type === 'asset-folder' ? 0 : 1;
        if (typeA !== typeB) return typeA - typeB;
        return (a.label || '').localeCompare(b.label || '');
      });
      nodes.forEach(n => sortNodes(n.children));
    };
    sortNodes(assetsRoot.children);

    return assetsRoot;
  }

  getAssetIcon(asset: Asset | StoredAsset): string {
    const rawType = ('type' in asset ? asset.type : undefined) || asset.file?.type || '';
    const fileType = StringUtils.mimeToTypeCategory(rawType);
    switch (fileType) {
      case 'image':
        return 'pi pi-image';
      case 'font':
        return 'pi pi-language';
      case 'audio':
        return 'pi pi-volume-up';
      case 'video':
        return 'pi pi-video';
      case 'document':
        return 'pi pi-file';
      case 'archive':
        return 'pi pi-folder';
      default:
        return 'pi pi-file';
    }
  }

  onNodeContextMenuSelect(event: TreeNodeContextMenuSelectEvent) {
    const selectedNode = event.node;
    const newMenuItems: MenuItem[] = [];
    if (selectedNode.data && selectedNode.data?.contextMenu) {
      // If the node has a context menu, use it
      newMenuItems.push(...selectedNode.data.contextMenu);
    } else {
      newMenuItems.push({
        label: this.translate.instant('sidebar.no-actions-available'),
        icon: 'pi pi-info-circle',
        disabled: true
      });
    }
    this.menuItems = newMenuItems;
  }

  onNodeSelect(event: TreeNodeSelectEvent) {
    const selectedNode = event.node;
    if (selectedNode.data && typeof selectedNode.data === 'object' && 'url' in selectedNode.data) {
      // If the node has a URL, open it
      this.router.navigateByUrl(selectedNode.data.url, { skipLocationChange: false });
    }
  }

  public openDeleteDialog(entityId: string | number, service: AnyEntityService) {
    this.confirmationService.confirm({
      message: this.translate.instant('sidebar.confirm-entity-delete-message'),
      header: this.translate.instant('sidebar.delete-entity'),
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        service?.delete(entityId).then(deleted => {
          this.messageService.add({
            severity: 'success', summary: 'Successful',
            detail: this.translate.instant('sidebar.entity-deleted'), life: 3000
          });
        });
      }
    });
  }

  public async openCreateDocumentDialog(service: AnyEntityService, dialogTitle: string) {
    // Create a random name for the new document
    const randomName = `README-${Math.random().toString(36).substr(2, 9)}`;
    const blob = await firstValueFrom(this.httpClient.get('assets/README-TEMPLATE.md', { responseType: 'blob' }));
    const defaultContent = await blob.text();
    this.entity = {
      name: randomName,
      mime: 'text/markdown',
      content: defaultContent,
    };
    this.openCreateDialog(service, dialogTitle, this.entity);
  }

  public openCreateDialog(service: AnyEntityService, dialogTitle: string, entity?: DialogEntity) {
    this.service = service;
    this.dialogTitle = dialogTitle || 'Create New Entity';
    if (entity) {
      this.entity = entity;
    } else {
      this.entity = {};
    }
    this.dialogVisible = true;
  }

  public onEntityCreated(entity: { id: number }) {
    if (this.service === this.decksService) {
      console.log('Deck created, creating system attributes for deck ' + entity.id);
      this.cardAttributesService.createSystemAttributes(entity.id);
    }
  }

  public onDialogVisibleChange(visible: boolean) {
    if (!visible) {
      // Refresh sidebar when dialog closes (covers renames/updates)
      this.updateFiles();
    }
  }

  public openEditDialog(service: AnyEntityService, entityId: string | number, dialogTitle: string) {
    this.service = service;
    this.dialogTitle = dialogTitle || 'Edit Entity';
    this.entity = {};
    service.get(entityId).then(entity => {
      this.entity = entity;
    });
    this.dialogVisible = true;
  }

  public openDuplicateDialog(service: AnyEntityService, entityId: string | number, dialogTitle: string) {
    this.service = service;
    this.dialogTitle = dialogTitle || 'Duplicate Entity';
    this.entity = {};
    service.get(entityId).then(entity => {
      // Create a new entity with the same properties but without the ID
      this.entity = { ...entity };
      delete this.entity.id; // Remove the ID to create a new entity
      // Optionally, you can modify the name to indicate it's a duplicate
      if (this.entity.name) {
        this.entity.name = `Copy of ${this.entity.name}`;
      } else {
        this.entity.name = `Copy of Entity-${Math.random().toString(36).substr(2, 9)}`;
      }
    });
    this.dialogVisible = true;
  }

  validateDrop(dragNode: TreeNode, dropNode: TreeNode): boolean {
    if (!dragNode.data || !dropNode.data) return false;

    if (dragNode.data.type === 'asset') {
      // Assets can go to folders, root, or other assets (sibling drop)
      return ['asset-folder', 'asset-root', 'asset'].includes(dropNode.data.type);
    }
    if (dragNode.data.type === 'asset-folder') {
      // Folders can go to other folders, root, or sibling assets
      return ['asset-folder', 'asset-root', 'asset'].includes(dropNode.data.type);
    }
    return false;
  }

  async onNodeDrop(event: TreeNodeDropEvent) {
    console.log('onNodeDrop', event);
    const dragNode = event.dragNode;
    const dropNode = event.dropNode;

    if (!dragNode || !dropNode) return;

    if (!this.validateDrop(dragNode, dropNode)) {
      console.warn('Invalid drop, reverting');
      this.updateFiles(); // Revert UI
      return;
    }

    // 1. Handle Asset Move
    if (dragNode.data.type === 'asset') {
      const asset = await this.assetsService.get(dragNode.data.id);
      let targetPath = '';

      if (dropNode.data.type === 'asset-root') {
        targetPath = '';
      } else if (dropNode.data.type === 'asset-folder') {
        targetPath = dropNode.data.path;
      } else if (dropNode.data.type === 'asset') {
        // Dropped on sibling asset -> same folder
        targetPath = dropNode.data.path || '';
      }

      if (asset) {
        // Prevent moving to same location (reordering)
        if ((asset.path || '') === targetPath) {
          console.log('Dropped in same location, ignoring (reorder prevention)');
          this.updateFiles(); // Revert any UI reordering
          return;
        }

        const success = await this.assetsService.moveAsset(asset, targetPath);
        if (success) {
          this.messageService.add({ severity: 'success', summary: 'Moved', detail: `Moved ${asset.name} to ${targetPath || 'root'}` });
        } else {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to move asset' });
          this.updateFiles();
        }
      }
    }

    // 3. Handle Asset Folder Move
    if (dragNode.data.type === 'asset-folder') {
      console.log('onNodeDrop: Handling Asset Folder Move');
      const folderPath = dragNode.data.path;
      const folderName = folderPath.split('/').pop();
      let targetParentPath = '';

      if (dropNode.data.type === 'asset-root') {
        targetParentPath = '';
      } else if (dropNode.data.type === 'asset-folder') {
        targetParentPath = dropNode.data.path;
      } else if (dropNode.data.type === 'asset') {
        // Dropped on sibling asset -> same parent folder
        targetParentPath = dropNode.data.path || '';
      }

      const newPath = targetParentPath ? targetParentPath + '/' + folderName : folderName;
      console.log(`onNodeDrop: Moving folder from ${folderPath} to ${newPath}`);

      // Prevent moving into itself or its own subfolder
      if (newPath === folderPath || newPath.startsWith(folderPath + '/')) {
        console.warn('Cannot move folder into itself or child');
        this.updateFiles();
        return;
      }

      this.assetsService.renameFolder(folderPath, newPath).then(success => {
        if (success) {
          this.messageService.add({ severity: 'success', summary: 'Moved', detail: `Moved folder to ${newPath}` });
          // UI should update via DB watcher
        } else {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to move folder' });
          this.updateFiles();
        }
      });
    }
  }

  public openCreateFolderDialog(parentPath: string) {
    // We repurpose the entity dialog but we need to supply a "Service" that has a create method.
    // Or we create a dummy service / override the behavior.
    // Simplified: Just use prompt() for now? No, better UX.
    // Use openCreateDialog with a proxy object having a create method.
    // only what the entity dialog calls
    const folderService = {
      create: (entity: DialogEntity) => {
        const folderName = entity.name ?? '';
        const fullPath = parentPath ? parentPath + '/' + folderName : folderName;
        return this.assetsService.createFolder(fullPath);
      },
      getFields: () => Promise.resolve([
        { field: 'name', header: 'Name', type: 'text' }
      ]),
      getLookups: () => Promise.resolve([]),
      getIdField: () => 'id',
    } as unknown as AnyEntityService;

    this.openCreateDialog(folderService, this.translate.instant('sidebar.create-new-folder'), { name: 'New Folder' });
  }

  public openRenameFolderDialog(currentPath: string) {
    const currentName = currentPath.split('/').pop() || '';
    const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));

    // Proxy service for rename
    const renameService = {
      create: (entity: DialogEntity) => { // we hijack create to mean "save rename"
        const newName = entity.name ?? '';
        // If generic rename (just name change), new path is parent + newName
        let newPath = newName;
        if (parentPath) {
          newPath = parentPath + '/' + newName;
        }
        return this.assetsService.renameFolder(currentPath, newPath);
      },
      getFields: () => Promise.resolve([
        { field: 'name', header: 'Name', type: 'text' }
      ]),
      getLookups: () => Promise.resolve([]),
      getIdField: () => 'id'
    } as unknown as AnyEntityService;

    this.openCreateDialog(renameService, this.translate.instant('sidebar.edit-rename-folder'), { name: currentName });
  }

  public openDeleteFolderDialog(folderPath: string) {
    this.confirmationService.confirm({
      message: this.translate.instant('sidebar.confirm-folder-delete-message', { folderPath }),
      header: this.translate.instant('sidebar.delete-folder'),
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.assetsService.deleteFolder(folderPath).then(success => {
          if (success) {
            this.messageService.add({
              severity: 'success', summary: 'Successful',
              detail: this.translate.instant('sidebar.folder-deleted'), life: 3000
            });
            // Update files is automatic via DB sub? Or manual?
            // DB change triggers updateFiles, so we should be good.
          } else {
            this.messageService.add({
              severity: 'error', summary: 'Error',
              detail: 'Failed to delete folder', life: 3000
            });
          }
        });
      }
    });
  }

}
