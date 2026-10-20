import { Component, NgZone, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmationService, MenuItem, MessageService, PrimeTemplate } from 'primeng/api';
import { NavigationEnd, Router } from '@angular/router';
import { ExportProgress } from 'dexie-export-import/dist/export';
import { ImportProgress } from 'dexie-export-import/dist/import';
import { Observable, combineLatest, filter, lastValueFrom, timeout } from 'rxjs';
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

@Component({
    selector: 'app-site-menu',
    templateUrl: './site-menu.component.html',
    styleUrls: ['./site-menu.component.scss'],
    providers: [MessageService, ConfirmationService],
    imports: [Bind, Menubar, Breadcrumb, ConfirmDialog, Dialog, PrimeTemplate, Message, FileUpload, ButtonDirective, Ripple, ProgressBar, TranslatePipe]
})
export class SiteMenuComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  selectedDeck$: Observable<Deck | undefined>;
  items: MenuItem[];
  importVisible: boolean = false;
  importFile: File | undefined = undefined;
  public displayLoading: boolean = false;
  public loadingIndeterminate: boolean = false;
  public loadingPercent: number = 0;
  public loadingInfo: string = '';
  public loadingHeader: string = '';
  public currentRoute: string = '';
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
    combineLatest([this.selectedDeck$, this.translate.onLangChange]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ([selectedDeck, langChange]) => {
        // setup the menu items
        this.items = [
          {
            label: this.translate.instant('menu.file'),
            icon: 'pi pi-pw pi-file',
            items: [
              {
                label: this.translate.instant('menu.advanced'),
                icon: 'pi pi-pw pi-database',
                items: [
                  {
                    label: this.translate.instant('menu.reset-database'),
                    icon: 'pi pi-pw pi-database',
                    command: () => this.openResetDialog()
                  }, {
                    label: this.translate.instant('menu.import-database'),
                    icon: 'pi pi-pw pi-database',
                    command: () => this.openImportDialog()
                  }, {
                    label: this.translate.instant('menu.export-database'),
                    icon: 'pi pi-pw pi-database',
                    command: () => this.openExportDialog()
                  }
                ]
              }, {
                separator: true
              }, {
                label: this.translate.instant("menu.export-cards"),
                icon: 'pi pi-pw pi-file-pdf',
                disabled: !selectedDeck,
                routerLink: [`/decks/${selectedDeck?.id}/export-cards`]
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
      let pathSegment = `/${segment}`;
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

  public confirmDatabaseImport() {
    if (this.importFile) {
      this.loadingIndeterminate = false;
      this.displayLoading = true;
      this.loadingPercent = 0;
      this.loadingHeader = 'Importing Data';
      this.loadingInfo = 'Importing database rows...';
      this.db.importDatabase(this.importFile, (progress: ImportProgress) => {
        this.loadingPercent = (progress.completedRows / (progress.totalRows || 100)) * 100;
        return true;
      }).then(() => {
        this.assetsService.updateAssetUrls();
      }).then(() => {
        this.decksService.selectDeck(undefined);
        this.router.navigateByUrl(`/decks`);
        this.loadingPercent = 100;
        this.displayLoading = false;
      });
      this.importVisible = false;
    }
  }

  public openImportDialog() {
    this.importVisible = true;
  }

  public closeImportDialog() {
    this.importVisible = false;
  }

  public openExportDialog() {
    this.confirmationService.confirm({
      message: 'Are you sure that you wish to export the entire database?',
      header: 'Export Database',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.loadingIndeterminate = false;
        this.displayLoading = true;
        this.loadingPercent = 0;
        this.loadingHeader = 'Exporting Data';
        this.loadingInfo = 'Exporting database rows...';
        this.db.exportDatabase((progress: ExportProgress) => {
          this.loadingPercent = (progress.completedRows / (progress.totalRows || 100)) * 100;
          return true;
        }).then(() => {
          this.loadingPercent = 100;
          this.displayLoading = false;
        });
      }
    });
  }

  public openResetDialog() {
    this.confirmationService.confirm({
      message: 'Are you sure that you wish to reset the entire database?'
        + ' This will delete all of your data. Export the database first to keep a copy.',
      header: 'Reset Database',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.db.resetDatabase()
    });
  }

}
