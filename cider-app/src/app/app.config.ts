import { ApplicationConfig, importProvidersFrom, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { HttpClient, provideHttpClient, withInterceptors, withInterceptorsFromDi } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';
import { provideMarkdown } from 'ngx-markdown';
import { routes } from './app.routes';
import { CiderTheme } from './cider-theme';
import { LocalStorageService } from './data-services/local-storage/local-storage.service';
import { CardToHtmlPipe } from './shared/pipes/template-to-html.pipe';
import { HandlebarsPipe } from './shared/pipes/handlebars.pipe';
import MonacoExtension from './shared/extensions/monaco-extension';
import { apiInterceptor } from './server/api.interceptor';
import { AuthService } from './server/auth.service';

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection(),
    provideRouter(routes, withRouterConfig({ onSameUrlNavigation: 'reload' })),
    provideHttpClient(withInterceptorsFromDi(), withInterceptors([apiInterceptor])),
    // know who is logged in before the first route is resolved
    provideAppInitializer(() => inject(AuthService).refresh()),
    provideAnimationsAsync(),
    importProvidersFrom(MonacoEditorModule.forRoot(MonacoExtension.monacoConfig)),
    provideMarkdown(),
    // injected as services by components that render cards and global styles
    CardToHtmlPipe,
    HandlebarsPipe,
    providePrimeNG({
      ripple: true,
      theme: {
        preset: CiderTheme,
        options: {
          darkModeSelector: '.' + LocalStorageService.DARK_MODE,
        }
      }
    }),
    provideTranslateService({
      loader: {
        provide: TranslateLoader,
        useFactory: HttpLoaderFactory,
        deps: [HttpClient]
      },
      defaultLanguage: 'en',
    })
  ]
};
