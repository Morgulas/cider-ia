import { Routes } from '@angular/router';
import { DeckGuard } from './shared/guards/deck.guard';

/**
 * Every page is loaded on demand: the initial bundle only holds the application
 * shell (menu, sidebar, footer), the editor, simulator and export code are
 * downloaded the first time their page is opened.
 */
export const routes: Routes = [
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
  { path: '**', loadComponent: () => import('./welcome/welcome.component').then(m => m.WelcomeComponent) }
];
