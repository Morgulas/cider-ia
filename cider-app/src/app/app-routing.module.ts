import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AssetsComponent } from './assets/assets.component';
import { CardAttributesComponent } from './card-attributes/card-attributes.component';
import { CardTemplatesComponent } from './card-templates/card-templates.component';
import { CardThumbnailsComponent } from './card-thumbnails/card-thumbnails.component';
import { CardsComponent } from './cards/cards.component';
import { ExportCardsComponent } from './export-cards/export-cards.component';
import { DeckGuard } from './shared/guards/deck.guard';
import { DecksComponent } from './decks/decks.component';
import { WelcomeComponent } from './welcome/welcome.component';
import { AssetComponent } from './asset/asset.component';
import { AssetGeneratorComponent } from './asset-generator/asset-generator.component';
import { DocumentComponent } from './document/document.component';
import { DocumentsComponent } from './documents/documents.component';
import { ProjectComponent } from './project/project.component';
import { GameSimulatorComponent } from './game-simulator/game-simulator.component';
import { TemplateGeneratorComponent } from './template-generator/template-generator.component';

const routes: Routes = [
  { path: 'decks', component: DecksComponent },
  { path: 'assets', component: AssetsComponent },
  { path: 'assets/generator', component: AssetGeneratorComponent },
  { path: 'assets/:assetId', component: AssetComponent },
  { path: 'documents', component: DocumentsComponent },
  { path: 'documents/:documentId', component: DocumentComponent },
  { path: 'decks/:deckId', component: CardsComponent, canActivate: [DeckGuard] },
  { path: 'decks/:deckId/cards', component: CardsComponent, canActivate: [DeckGuard] },
  { path: 'decks/:deckId/cards/listing', component: CardsComponent, canActivate: [DeckGuard] },
  { path: 'decks/:deckId/cards/thumbnails', component: CardThumbnailsComponent, canActivate: [DeckGuard] },
  { path: 'decks/:deckId/cards/attributes', component: CardAttributesComponent, canActivate: [DeckGuard] },
  { path: 'decks/:deckId/templates/generator', component: TemplateGeneratorComponent, canActivate: [DeckGuard] },
  { path: 'decks/:deckId/templates/:templateId', component: CardTemplatesComponent, canActivate: [DeckGuard] },
  { path: 'decks/:deckId/export-cards', component: ExportCardsComponent, canActivate: [DeckGuard] },
  { path: 'project', component: ProjectComponent },
  { path: 'simulator', component: GameSimulatorComponent },
  { path: '**', component: WelcomeComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { onSameUrlNavigation: 'reload' })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
