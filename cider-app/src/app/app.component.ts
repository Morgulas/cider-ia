import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { LocalStorageService } from './data-services/local-storage/local-storage.service';
import { TranslateService } from '@ngx-translate/core';
import { ThemeService } from './data-services/theme/theme.service';
import { SiteTemplateComponent } from './site-template/site-template.component';


@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    imports: [SiteTemplateComponent, RouterOutlet]
})
export class AppComponent implements OnInit {
  title = 'cider';
  /** project pages are shown in the editor shell; login, projects, users and account pages are full-screen */
  protected readonly showShell = signal(false);

  constructor(private router: Router,
    private localStorageService: LocalStorageService,
    private translateService: TranslateService,
    private themeService: ThemeService) {
    this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(() => {
      this.showShell.set(AppComponent.hasShellData(this.router.routerState.snapshot.root));
    });
  }

  private static hasShellData(route: ActivatedRouteSnapshot): boolean {
    return route.data['shell'] === true || route.children.some(child => AppComponent.hasShellData(child));
  }

  ngOnInit() {
    this.updateViewWidthHeightVar();
    window.addEventListener('resize', () => {
      this.updateViewWidthHeightVar();
    });

    this.initTranslateService();
  }

  private initTranslateService() {
    // French and English only: the other languages of the original Cider were
    // not kept up to date with this fork (also update settings-dialog languages)
    this.translateService.addLangs(['fr', 'en']);

    const langs = this.translateService.getLangs();
    const browserLang = this.translateService.getBrowserLang();
    const savedLang = this.localStorageService.getLanguage();
    // a language saved before it was removed falls back like a new visitor
    const langToSet = savedLang && langs.includes(savedLang) ? savedLang
      : (browserLang && langs.includes(browserLang) ? browserLang : 'fr');
    this.translateService.use(langToSet);
  }

  private updateViewWidthHeightVar() {
    const vh = window.innerHeight * 0.01;
    const vw = window.innerWidth * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    document.documentElement.style.setProperty('--vw', `${vw}px`);
  }
}
