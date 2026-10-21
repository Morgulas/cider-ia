import { Component, NgZone, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmationService, MenuItem, MessageService, PrimeTemplate } from 'primeng/api';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, combineLatest, filter, lastValueFrom, startWith, timeout } from 'rxjs';
import { AppDB } from '../data-services/indexed-db/db';
import { AssetsService } from '../data-services/services/assets.service';
import { DecksService } from '../data-services/services/decks.service';
import { Deck } from '../data-services/types/deck.type';
import StringUtils from '../shared/utils/string-utils';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { Bind } from 'primeng/bind';
import { Menu } from 'primeng/menu';
import { Breadcrumb } from 'primeng/breadcrumb';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { FileUpload } from 'primeng/fileupload';
import { ButtonDirective } from 'primeng/button';
import { Ripple } from 'primeng/ripple';
import { ProgressBar } from 'primeng/progressbar';
import FileUtils from '../shared/utils/file-utils';
import { TopbarComponent } from '../server/topbar/topbar.component';
import { ProjectVersionsDialogComponent } from '../server/project-versions/project-versions-dialog.component';
import { CurrentProjectService } from '../server/current-project.service';
import { SessionActionsService } from '../server/session-actions.service';
import { DesktopProjectExporter } from '../server/project-import/desktop-project-exporter.service';

@Component({
    selector: 'app-site-menu',
    templateUrl: './site-menu.component.html',
    styleUrls: ['./site-menu.component.scss'],
    providers: [MessageService, ConfirmationService],
    imports: [TopbarComponent, ProjectVersionsDialogComponent, Menu, Bind, Breadcrumb, ConfirmDialog, Dialog, PrimeTemplate, Message, FileUpload, ButtonDirective, Ripple, ProgressBar, TranslatePipe]
})
export class SiteMenuComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  protected readonly currentProject = inject(CurrentProjectService);
  private readonly sessionActions = inject(SessionActionsService);
  private readonly desktopExporter = inject(DesktopProjectExporter);

  selectedDeck$: Observable<Deck | undefined>;
  items: MenuItem[];
  importVisible = false;
  versionsVisible = false;
  importFile: File | undefined = undefined;
  public displayLoading = false;
  public loadingIndeterminate = false;
  public loadingPercent = 0;
  public loadingInfo = '';
  public loadingHeader = '';
  public currentRoute = '';
  public breadcrumbs: MenuItem[] = [];
  public home: MenuItem | undefined;

  constructor(private decksService: DecksService,
    private confirmationService: ConfirmationService,
    private assetsService: AssetsService,
    private translate: TranslateService,
    private ngZone: NgZone,
    private router: Router,
    private db: AppDB) {
    // allow reloading of the current page
    this.router.routeReuseStrategy.shouldReuseRoute = () => {
      return false;
    };
    this.items = [];
    this.selectedDeck$ = this.decksService.getSelectedDeck();
  }

  ngOnInit(): void {
    // startWith: the shell appears when a project is opened, after the language
    // was set at startup, so onLangChange alone would never fire here
    combineLatest([this.selectedDeck$, this.translate.onLangChange.pipe(startWith(null))])
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ([selectedDeck]) => {
          this.items = [
            {
              label: this.translate.instant('menu.export-project'),
              icon: 'pi pi-download',
              command: () => this.downloadProject()
            }, {
              label: this.translate.instant('menu.export-project-folder'),
              icon: 'pi pi-box',
              command: () => this.downloadProjectFolder()
            }, {
              label: this.translate.instant('server.versions.title'),
              icon: 'pi pi-history',
              command: () => this.versionsVisible = true
            }, {
              label: this.translate.instant('menu.import-into-project'),
              icon: 'pi pi-upload',
              command: () => this.openImportDialog()
            }, {
              separator: true
            }, {
              label: this.translate.instant('menu.export-cards'),
              icon: 'pi pi-file-pdf',
              disabled: !selectedDeck,
              routerLink: [`/decks/${selectedDeck?.id}/export-cards`]
            }, {
              separator: true
            }, {
              label: this.translate.instant('menu.close-project'),
              icon: 'pi pi-times',
              command: () => void this.closeProject()
            }
          ];
        }
      });

    // use the router to update the current route
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event: any) => {
      this.ngZone.run(async () => {
        const routeUrl = event.urlAfterRedirects;
        this.currentRoute = routeUrl;
        await this.updateBreadcrumbs(routeUrl);
      }
      );
    });

  }

  /** Closes the project (saving it first) and goes back to the project list */
  public async closeProject() {
    if (await this.sessionActions.closeProject()) {
      await this.router.navigateByUrl('/projects');
    }
  }

  /** Name of the deck, template, asset or document whose id is in the address */
  private async entityName(collection: string, id: string): Promise<string | undefined> {
    const tables: Record<string, string> = {
      decks: AppDB.DECKS_TABLE, templates: AppDB.CARD_TEMPLATES_TABLE,
      assets: AppDB.ASSETS_TABLE, documents: AppDB.DOCUMENTS_TABLE,
    };
    const numericId = Number(id);
    if (!tables[collection] || !Number.isInteger(numericId)) {
      return undefined;
    }
    try {
      return (await this.db.table(tables[collection]).get(numericId))?.name;
    } catch {
      return undefined;
    }
  }

  private async updateBreadcrumbs(routeUrl: string) {
    this.home = { icon: 'pi pi-home', routerLink: '/project' };
    const breadcrumbs: MenuItem[] = [];
    const urlSegments = routeUrl.split(/[?#]/)[0].split('/').filter((segment) => segment);
    let currentPath = '';

    for (let i = 0; i < urlSegments.length; i++) {
      const segment = urlSegments[i];
      const pathSegment = `/${segment}`;
      currentPath += pathSegment;
      const name = i > 0 ? await this.entityName(urlSegments[i - 1], segment) : undefined;
      const label = name ?? await lastValueFrom(
        this.translate.get(`breadcrumbs.${segment}`).pipe(timeout(1000)))
        .then(translation => translation !== `breadcrumbs.${segment}` ? translation
          : StringUtils.kebabToTitleCase(segment));

      breadcrumbs.push({
        label: label,
        routerLink: currentPath,
        disabled: i == urlSegments.length - 1
      });
    }

    this.breadcrumbs = breadcrumbs;
  }

  public uploadFile(event: any) {
    if (event?.currentFiles?.length) {
      this.importFile = event.files[0];
    }
  }

  /** Replaces the content of the open project with a database.json file; it is then saved to the server */
  public async confirmDatabaseImport() {
    if (!this.importFile) {
      return;
    }
    this.importVisible = false;
    this.loadingIndeterminate = true;
    this.displayLoading = true;
    this.loadingHeader = this.translate.instant('menu.import-into-project');
    this.loadingInfo = '';
    try {
      await this.db.loadProject(this.importFile);
      this.assetsService.updateAssetUrls();
      this.decksService.selectDeck(undefined);
      await this.router.navigateByUrl('/decks');
    } finally {
      this.displayLoading = false;
    }
  }

  public openImportDialog() {
    this.importVisible = true;
  }

  public closeImportDialog() {
    this.importVisible = false;
  }

  /** Downloads the open project as a database.json file, after saving pending changes */
  /** Downloads the project as a folder of the desktop version, in a .zip archive */
  public async downloadProjectFolder() {
    const project = this.currentProject.project();
    if (!project) {
      return;
    }
    this.loadingIndeterminate = true;
    this.displayLoading = true;
    this.loadingHeader = this.translate.instant('menu.export-project-folder');
    this.loadingInfo = '';
    try {
      FileUtils.saveAs(await this.desktopExporter.exportZip(project.name), `${project.name}.zip`);
    } finally {
      this.displayLoading = false;
    }
  }

  public async downloadProject() {
    const project = this.currentProject.project();
    if (!project) {
      return;
    }
    this.loadingIndeterminate = true;
    this.displayLoading = true;
    this.loadingHeader = this.translate.instant('menu.export-project');
    this.loadingInfo = '';
    try {
      await this.currentProject.flush();
      FileUtils.saveAs(await this.db.exportProject(), `${project.name}.json`);
    } finally {
      this.displayLoading = false;
    }
  }

}
