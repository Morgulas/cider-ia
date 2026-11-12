import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, importProvidersFrom, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';
import { provideMarkdown } from 'ngx-markdown';
import MonacoExtension from '../shared/extensions/monaco-extension';
import { CardToHtmlPipe } from '../shared/pipes/template-to-html.pipe';
import { HandlebarsPipe } from '../shared/pipes/handlebars.pipe';

/**
 * What the application provides at start-up (app.config.ts), for component
 * tests: HTTP (mocked), router, translations, PrimeNG services.
 */
export const appTestProviders: (Provider | EnvironmentProviders)[] = [
  provideHttpClient(),
  provideHttpClientTesting(),
  provideRouter([]),
  provideTranslateService({ defaultLanguage: 'en' }),
  providePrimeNG(),
  importProvidersFrom(MonacoEditorModule.forRoot(MonacoExtension.monacoConfig)),
  provideMarkdown(),
  CardToHtmlPipe,
  HandlebarsPipe,
  MessageService,
  ConfirmationService,
];
