import { Routes } from '@angular/router';
import { DeckGuard } from './shared/guards/deck.guard';
import { adminGuard, authGuard, guestGuard, projectGuard } from './server/guards';

/**
 * Pages outside a project (login, projects, users, account) are full-screen;
 * project pages are shown inside the editor shell (route data "shell") and need
 * an open project (projectGuard).
 *
 * Every page is loaded on demand: the initial bundle only holds the application
 * shell (menu, sidebar, footer), the editor, simulator and export code are
 * downloaded the first time their page is opened.
 */
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./server/login/login.component').then(m => m.LoginComponent), canActivate: [guestGuard] },
  { path: 'setup', loadComponent: () => import('./server/login/login.component').then(m => m.LoginComponent), canActivate: [guestGuard], data: { mode: 'setup' } },
  { path: 'projects', loadComponent: () => import('./server/projects-page/projects-page.component').then(m => m.ProjectsPageComponent), canActivate: [authGuard] },
  { path: 'account', loadComponent: () => import('./server/account/account.component').then(m => m.AccountComponent), canActivate: [authGuard] },
  { path: 'admin/ai', loadComponent: () => import('./server/admin-ai/admin-ai.component').then(m => m.AdminAiComponent), canActivate: [authGuard, adminGuard] },
  { path: 'admin/users', loadComponent: () => import('./server/admin-users/admin-users.component').then(m => m.AdminUsersComponent), canActivate: [authGuard, adminGuard] },
  {
    path: '',
    canActivate: [authGuard, projectGuard],
    data: { shell: true },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'project' },
      { path: 'decks', loadComponent: () => import('./decks/decks.component').then(m => m.DecksComponent) },
      { path: 'assets', loadComponent: () => import('./assets/assets.component').then(m => m.AssetsComponent) },
      { path: 'assets/generator', loadComponent: () => import('./asset-generator/asset-generator.component').then(m => m.AssetGeneratorComponent) },
      { path: 'assets/:assetId', loadComponent: () => import('./asset/asset.component').then(m => m.AssetComponent) },
      { path: 'documents', loadComponent: () => import('./documents/documents.component').then(m => m.DocumentsComponent) },
      { path: 'documents/:documentId', loadComponent: () => import('./document/document.component').then(m => m.DocumentComponent) },
      { path: 'decks/:deckId', loadComponent: () => import('./cards/cards.component').then(m => m.CardsComponent), canActivate: [DeckGuard] },
      { path: 'decks/:deckId/cards', loadComponent: () => import('./cards/cards.component').then(m => m.CardsComponent), canActivate: [DeckGuard] },
      { path: 'decks/:deckId/cards/listing', loadComponent: () => import('./cards/cards.component').then(m => m.CardsComponent), canActivate: [DeckGuard] },
      { path: 'decks/:deckId/cards/thumbnails', loadComponent: () => import('./card-thumbnails/card-thumbnails.component').then(m => m.CardThumbnailsComponent), canActivate: [DeckGuard] },
      { path: 'decks/:deckId/cards/attributes', loadComponent: () => import('./card-attributes/card-attributes.component').then(m => m.CardAttributesComponent), canActivate: [DeckGuard] },
      { path: 'decks/:deckId/templates/generator', loadComponent: () => import('./template-generator/template-generator.component').then(m => m.TemplateGeneratorComponent), canActivate: [DeckGuard] },
      { path: 'decks/:deckId/templates/:templateId', loadComponent: () => import('./card-templates/card-templates.component').then(m => m.CardTemplatesComponent), canActivate: [DeckGuard] },
      { path: 'decks/:deckId/export-cards', loadComponent: () => import('./export-cards/export-cards.component').then(m => m.ExportCardsComponent), canActivate: [DeckGuard] },
      { path: 'project', loadComponent: () => import('./project/project.component').then(m => m.ProjectComponent) },
      { path: 'simulator', loadComponent: () => import('./game-simulator/game-simulator.component').then(m => m.GameSimulatorComponent) },
    ]
  },
  { path: '**', redirectTo: 'projects' }
];
