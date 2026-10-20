import { AfterViewInit, Component, HostListener, OnInit, ViewChild, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Splitter } from 'primeng/splitter';
import { debounceTime, Subject } from 'rxjs';
import { SiteMenuComponent } from '../site-menu/site-menu.component';
import { SiteActivitybarComponent } from '../site-activitybar/site-activitybar.component';
import { Bind } from 'primeng/bind';
import { PrimeTemplate } from 'primeng/api';
import { SiteSidebarComponent } from '../site-sidebar/site-sidebar.component';
import { SiteContentComponent } from '../site-content/site-content.component';
import { SiteFooterComponent } from '../site-footer/site-footer.component';
import { DecksComponent } from '../decks/decks.component';

@Component({
    selector: 'app-site-template',
    templateUrl: './site-template.component.html',
    styleUrls: ['./site-template.component.scss'],
    imports: [SiteMenuComponent, SiteActivitybarComponent, Bind, Splitter, PrimeTemplate, SiteSidebarComponent, SiteContentComponent, SiteFooterComponent, DecksComponent]
})
export class SiteTemplateComponent {
  private readonly destroyRef = inject(DestroyRef);
  splitterPanels: any[] = []
  selectedActivity: string = 'explorer';
  disablePanels: boolean = false;
  windowResizing$: Subject<boolean>;

  constructor() {
    this.windowResizing$ = new Subject();
    this.windowResizing$.pipe(debounceTime(200)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.disablePanels = false;
    });
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.disablePanels = true;
    this.windowResizing$.next(true);
  }

  public onResizeStart(event: any) {
    this.disablePanels = true;
  }

  public onResizeEnd(event: any) {
    this.disablePanels = false;
  }
}
