import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { CardTemplatesService } from '../data-services/services/card-templates.service';

/** One tab: a page of the deck */
export interface DeckTab {
  key: string;
  icon: string;
  url: string;
  /** other pages that light this tab up */
  match: RegExp;
}

/** The deck shown by a URL, or null outside the deck pages */
export function deckIdOf(url: string): number | null {
  const match = /^\/decks\/(\d+)(\/|$|\?)/.exec(url);
  return match ? Number(match[1]) : null;
}

/**
 * Tabs over the deck pages: go from cards to thumbnails, attributes,
 * prompt, templates and export without the sidebar (handy once it is folded)
 */
@Component({
  selector: 'app-deck-tabs',
  templateUrl: './deck-tabs.component.html',
  styleUrls: ['./deck-tabs.component.scss'],
  imports: [RouterLink, TranslatePipe]
})
export class DeckTabsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly templatesService = inject(CardTemplatesService);

  deckId: number | null = null;
  tabs: DeckTab[] = [];
  active = '';

  ngOnInit() {
    this.update();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.update());
  }

  private async update() {
    const url = this.router.url.split('?')[0];
    const deckId = deckIdOf(url);
    // rebuilt at each page: the templates tab follows created or deleted templates
    this.deckId = deckId;
    this.tabs = deckId == null ? [] : await this.buildTabs(deckId);
    this.active = this.tabs.find(tab => tab.match.test(url))?.key ?? '';
  }

  private async buildTabs(deckId: number): Promise<DeckTab[]> {
    const base = `/decks/${deckId}`;
    // the templates tab opens the first template, or the generator when there is none
    const templates = await this.templatesService.getAllUnfiltered({ deckId }).catch(() => []);
    templates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const templatesUrl = templates.length ? `${base}/templates/${templates[0].id}` : `${base}/templates/generator`;
    return [
      { key: 'sidebar.cards', icon: 'pi pi-list', url: `${base}/cards/listing`, match: /^\/decks\/\d+(\/cards(\/listing)?)?$/ },
      { key: 'sidebar.thumbnails', icon: 'pi pi-th-large', url: `${base}/cards/thumbnails`, match: /\/cards\/thumbnails$/ },
      { key: 'sidebar.attributes', icon: 'pi pi-tags', url: `${base}/cards/attributes`, match: /\/cards\/attributes$/ },
      { key: 'sidebar.templates', icon: 'pi pi-id-card', url: templatesUrl, match: /\/templates\// },
      { key: 'sidebar.illustration-prompt', icon: 'pi pi-sparkles', url: `${base}/prompt`, match: /\/prompt$/ },
      { key: 'sidebar.export-cards', icon: 'pi pi-file-export', url: `${base}/export-cards`, match: /\/export-cards$/ },
    ];
  }
}
