import type { SplitterResizeEndEvent, SplitterResizeStartEvent } from 'primeng/types/splitter';
import { Component, HostListener, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Splitter } from 'primeng/splitter';
import { debounceTime, filter, Subject } from 'rxjs';
import { NavigationEnd, Router } from '@angular/router';
import { SiteMenuComponent } from '../site-menu/site-menu.component';
import { SiteActivitybarComponent } from '../site-activitybar/site-activitybar.component';
import { Bind } from 'primeng/bind';
import { PrimeTemplate } from 'primeng/api';
import { SiteSidebarComponent } from '../site-sidebar/site-sidebar.component';
import { SiteContentComponent } from '../site-content/site-content.component';
import { SiteFooterComponent } from '../site-footer/site-footer.component';

@Component({
    selector: 'app-site-template',
    templateUrl: './site-template.component.html',
    styleUrls: ['./site-template.component.scss'],
    imports: [SiteMenuComponent, SiteActivitybarComponent, Bind, Splitter, PrimeTemplate, SiteSidebarComponent, SiteContentComponent, SiteFooterComponent]
})
export class SiteTemplateComponent {
  private readonly destroyRef = inject(DestroyRef);
  splitterPanels: number[] = []
  /** phones and narrow windows: the sidebar opens over the page instead of beside it */
  static readonly NARROW_QUERY = '(max-width: 768px)';
  private readonly narrowQuery = window.matchMedia(SiteTemplateComponent.NARROW_QUERY);
  narrow = this.narrowQuery.matches;
  // closed at first on a phone: the page gets the whole width
  selectedActivity = this.narrow ? '' : 'explorer';
  disablePanels = false;
  windowResizing$: Subject<boolean>;

  constructor() {
    const onNarrowChange = (event: MediaQueryListEvent) => {
      this.narrow = event.matches;
      if (this.narrow) {
        this.selectedActivity = '';
      }
    };
    this.narrowQuery.addEventListener('change', onNarrowChange);
    this.destroyRef.onDestroy(() => this.narrowQuery.removeEventListener('change', onNarrowChange));
    // on a phone, choosing a page in the sidebar closes it
    inject(Router).events.pipe(filter(event => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.narrow) {
          this.selectedActivity = '';
        }
      });
    this.windowResizing$ = new Subject();
    this.windowResizing$.pipe(debounceTime(200)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.disablePanels = false;
    });
  }

  @HostListener('window:resize', ['$event'])
  onResize(_event: UIEvent) {
    this.disablePanels = true;
    this.windowResizing$.next(true);
  }

  public onResizeStart(_event: SplitterResizeStartEvent) {
    this.disablePanels = true;
  }

  public onResizeEnd(_event: SplitterResizeEndEvent) {
    this.disablePanels = false;
  }
}
