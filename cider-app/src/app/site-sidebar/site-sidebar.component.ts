import { Component, Input, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmationService, MenuItem, MessageService, TreeDragDropService, TreeNode, PrimeTemplate } from 'primeng/api';
import { DecksService } from '../data-services/services/decks.service';
import { AssetsService } from '../data-services/services/assets.service';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { CardAttributesService } from '../data-services/services/card-attributes.service';
import { debounceTime, filter, firstValueFrom } from 'rxjs';
import { TreeNodeContextMenuSelectEvent, TreeNodeSelectEvent, Tree } from 'primeng/tree';
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
export type SidebarActivity = 'explorer';

import { DocumentsService } from '../data-services/services/documents.service';
import { BoostersService } from '../data-services/services/boosters.service';
import { boosterLibrary } from '../boosters/booster-logic';
import { HttpClient } from '@angular/common/http';
import { AppDB } from '../data-services/indexed-db/db';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { AssetLibrary } from '../data-services/types/asset.type';
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
  const keep = ['/cards/listing', '/cards/thumbnails', '/illustrations', '/boosters', '/cards/attributes', '/prompt', '/export-cards', '/templates/generator'];
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
  private readonly boostersService = inject(BoostersService);

  /** Explorer (project + selected deck) or illustrations */
  @Input() activity: SidebarActivity | string = 'explorer';

  /** Project home and documents */
  projectFiles: TreeNode[] = [];
  /** Pages and templates of the selected deck */
  deckFiles: TreeNode[] = [];
  /** Number of illustrations by library (badges of the explorer) */
  private libraryCounts = new Map<AssetLibrary, number>();
  /** Number of boosters by deck (null: the common ones) */
  private boosterCounts = new Map<number | null, number>();

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
        AppDB.ASSETS_TABLE, AppDB.ASSET_FOLDERS_TABLE, AppDB.CARDS_TABLE, AppDB.BOOSTERS_TABLE];
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
        if (typeof node.data?.url === 'string' && node.data.url.split('?')[0] === url) return node;
        const child = find(node.children ?? []);
        if (child) return child;
      }
      return null;
    };
    // /decks/1 and /decks/1/cards show the card list
    const listing = /^\/decks\/\d+(\/cards)?$/.test(url) ? find(this.deckFiles.filter(n => n.styleClass === 'card-listing')) : null;
    this.selectedFile = listing ?? find(this.projectFiles) ?? find(this.deckFiles);
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

    // the common library of illustrations, on the whole page
    const metadata = await this.assetsService.getAllMetadata().catch(() => []);
    this.libraryCounts = new Map();
    metadata.forEach(asset => {
      const library = this.assetsService.libraryOf(asset);
      this.libraryCounts.set(library, (this.libraryCounts.get(library) ?? 0) + 1);
    });
    home.children!.push({
      label: this.translate.instant('sidebar.illustrations'),
      data: { url: '/illustrations', badge: this.libraryCounts.get(null) ?? 0 },
      icon: 'pi pi-images',
      styleClass: 'project-illustrations',
      draggable: false,
      droppable: false
    });

    // the common boosters (drawing from several decks), on their page
    const decks = new Set((await this.decksService.getAll().catch(() => [])).map(deck => deck.id));
    this.boosterCounts = new Map();
    (await this.boostersService.getAll().catch(() => [])).forEach(booster => {
      const library = boosterLibrary(booster);
      const key = library !== null && decks.has(library) ? library : null;
      this.boosterCounts.set(key, (this.boosterCounts.get(key) ?? 0) + 1);
    });
    home.children!.push({
      label: this.translate.instant('sidebar.boosters'),
      data: { url: '/boosters', badge: this.boosterCounts.get(null) ?? 0 },
      icon: 'pi pi-gift',
      styleClass: 'project-boosters',
      draggable: false,
      droppable: false
    });

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
        command: () => this.openDeleteDeckDialog(deck)
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
      page('sidebar.illustrations', '/illustrations', 'pi pi-images', 'deck-illustrations',
        { data: { url: base + '/illustrations', badge: this.libraryCounts.get(deck.id) ?? 0 } }),
      page('sidebar.attributes', '/cards/attributes', 'pi pi-tags', 'card-attributes'),
      page('sidebar.illustration-prompt', '/prompt', 'pi pi-sparkles', 'deck-prompt'),
      page('sidebar.export-cards', '/export-cards', 'pi pi-file-export', 'card-export'),
    ];

    // the boosters of the deck (those drawing from it alone)
    nodes.push({
      label: this.translate.instant('sidebar.boosters'),
      data: { url: `${base}/boosters`, badge: this.boosterCounts.get(deck.id) ?? 0 },
      icon: 'pi pi-gift',
      styleClass: 'deck-boosters',
      draggable: false,
      droppable: false
    });

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

  /** Deleting a deck: its illustrations go back to the common library, in a folder named after it */
  public openDeleteDeckDialog(deck: DeckOption) {
    this.confirmationService.confirm({
      message: this.translate.instant('sidebar.confirm-deck-delete-message', { deck: deck.name }),
      header: this.translate.instant('sidebar.delete-entity'),
      icon: 'pi pi-exclamation-triangle',
      accept: async () => {
        await this.assetsService.releaseDeckLibrary(deck.id, deck.name);
        await this.decksService.delete(deck.id);
        this.messageService.add({
          severity: 'success', summary: 'Successful',
          detail: this.translate.instant('sidebar.entity-deleted'), life: 3000
        });
      }
    });
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

}
