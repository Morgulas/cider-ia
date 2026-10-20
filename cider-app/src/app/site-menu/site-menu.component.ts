import { Component, NgZone, OnInit, DestroyRef, Injector, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
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
import { Menubar } from 'primeng/menubar';
import { Breadcrumb } from 'primeng/breadcrumb';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { FileUpload } from 'primeng/fileupload';
import { ButtonDirective } from 'primeng/button';
import { Ripple } from 'primeng/ripple';
import { ProgressBar } from 'primeng/progressbar';
import FileUtils from '../shared/utils/file-utils';
import { AuthService } from '../server/auth.service';
import { CurrentProjectService } from '../server/current-project.service';
import { SessionActionsService } from '../server/session-actions.service';
import { DesktopProjectExporter } from '../server/project-import/desktop-project-exporter.service';

@Component({
    selector: 'app-site-menu',
    templateUrl: './site-menu.component.html',
    styleUrls: ['./site-menu.component.scss'],
    providers: [MessageService, ConfirmationService],
    imports: [Bind, Menubar, Breadcrumb, ConfirmDialog, Dialog, PrimeTemplate, Message, FileUpload, ButtonDirective, Ripple, ProgressBar, TranslatePipe]
})
export class SiteMenuComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);
  private readonly currentProject = inject(CurrentProjectService);
  private readonly sessionActions = inject(SessionActionsService);
  private readonly desktopExporter = inject(DesktopProjectExporter);

  selectedDeck$: Observable<Deck | undefined>;
  items: MenuItem[];
  importVisible = false;
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
    combineLatest([this.selectedDeck$, this.translate.onLangChange.pipe(startWith(null)),
      toObservable(this.auth.user, { injector: this.injector })])
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ([selectedDeck, , user]) => {
          this.items = [
            {
              label: this.translate.instant('menu.file'),
              icon: 'pi pi-pw pi-file',
              items: [
                {
                  label: this.translate.instant('menu.my-projects'),
                  icon: 'pi pi-pw pi-folder-open',
                  command: () => this.router.navigateByUrl('/projects')
                }, {
                  separator: true
                }, {
                  label: this.translate.instant('menu.export-project'),
                  icon: 'pi pi-pw pi-download',
                  command: () => this.downloadProject()
                }, {
                  label: this.translate.instant('menu.export-project-folder'),
                  icon: 'pi pi-pw pi-box',
                  command: () => this.downloadProjectFolder()
                }, {
                  label: this.translate.instant('menu.import-into-project'),
                  icon: 'pi pi-pw pi-upload',
                  command: () => this.openImportDialog()
                }, {
                  separator: true
                }, {
                  label: this.translate.instant("menu.export-cards"),
                  icon: 'pi pi-pw pi-file-pdf',
                  disabled: !selectedDeck,
                  routerLink: [`/decks/${selectedDeck?.id}/export-cards`]
                }
              ]
            }, {
              label: user?.username ?? '',
              icon: 'pi pi-pw pi-user',
              styleClass: 'user-menu',
              items: [
                {
                  label: this.translate.instant('server.topbar.account'),
                  icon: 'pi pi-pw pi-id-card',
                  command: () => this.router.navigateByUrl('/account')
                }, {
                  label: this.translate.instant('server.topbar.admin'),
                  icon: 'pi pi-pw pi-users',
                  visible: user?.isAdmin === true,
                  command: () => this.router.navigateByUrl('/admin/users')
                }, {
                  label: this.translate.instant('server.topbar.ai-settings'),
                  icon: 'pi pi-pw pi-sparkles',
                  visible: user?.isAdmin === true,
                  command: () => this.router.navigateByUrl('/admin/ai')
                }, {
                  separator: true
                }, {
                  label: this.translate.instant('server.topbar.logout'),
                  icon: 'pi pi-pw pi-sign-out',
                  command: () => this.sessionActions.logout()
                }
              ]
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

  private async updateBreadcrumbs(routeUrl: string) {
    this.home = { icon: 'pi pi-home', routerLink: '/project' };
    const breadcrumbs: MenuItem[] = [];
    const urlSegments = routeUrl.split('/').filter((segment) => segment);
    let currentPath = '';

    for (let i = 0; i < urlSegments.length; i++) {
      const segment = urlSegments[i];
      const pathSegment = `/${segment}`;
      currentPath += pathSegment;
      const label = await lastValueFrom(
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
