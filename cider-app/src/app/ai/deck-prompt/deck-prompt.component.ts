import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Card as PCard } from 'primeng/card';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { CardAttributesService } from '../../data-services/services/card-attributes.service';
import { CardsService } from '../../data-services/services/cards.service';
import { DecksService } from '../../data-services/services/decks.service';
import { Card } from '../../data-services/types/card.type';
import { Deck } from '../../data-services/types/deck.type';
import { CardAttribute } from '../../data-services/types/card-attribute.type';
import { defaultPromptTemplate, PromptVariable, promptVariables, renderCardPrompt } from '../card-prompt';

/**
 * Prompt template of a deck: the text that describes the illustration of each
 * card, filled with the card's attributes. Used by the illustration window of
 * every card of the deck (copied into a chatbot or sent to the server's AI).
 */
@Component({
  selector: 'app-deck-prompt',
  templateUrl: './deck-prompt.component.html',
  styleUrl: './deck-prompt.component.scss',
  imports: [FormsModule, PCard, Button, Message, Select, Textarea, TranslatePipe]
})
export class DeckPromptComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly decks = inject(DecksService);
  private readonly attributesService = inject(CardAttributesService);
  private readonly cardsService = inject(CardsService);
  private readonly translate = inject(TranslateService);

  protected deck: Deck | null = null;
  private attributes: CardAttribute[] = [];
  protected cards: Card[] = [];
  protected template = '';
  private savedTemplate = '';
  protected previewCard: Card | null = null;

  protected readonly variables = signal<PromptVariable[]>([]);
  protected readonly preview = signal('');
  protected readonly templateError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly info = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const deckId = Number(this.route.snapshot.paramMap.get('deckId'));
    this.deck = (await this.decks.get(deckId)) ?? null;
    this.attributes = await this.attributesService.getAll({ deckId });
    this.cards = (await this.cardsService.getAll({ deckId }))
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
    this.variables.set(promptVariables(this.attributes));
    this.savedTemplate = this.deck?.illustrationPrompt || this.defaultTemplate();
    this.template = this.savedTemplate;
    this.previewCard = this.cards[0] ?? null;
    this.render();
  }

  private defaultTemplate(): string {
    return defaultPromptTemplate(this.translate.instant('server.ai.prompt-default-intro'), this.attributes);
  }

  protected render(): void {
    this.info.set(null);
    if (!this.previewCard) {
      this.preview.set('');
      return;
    }
    const rendered = renderCardPrompt(this.template, this.previewCard, this.deck?.name ?? '');
    this.templateError.set(rendered.error ?? null);
    if (!rendered.error) {
      this.preview.set(rendered.text);
    }
  }

  protected changed(): boolean {
    return this.template !== this.savedTemplate;
  }

  protected insertVariable(textarea: HTMLTextAreaElement, token: string): void {
    const start = textarea.selectionStart ?? this.template.length;
    const end = textarea.selectionEnd ?? start;
    this.template = this.template.slice(0, start) + token + this.template.slice(end);
    this.render();
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  protected useDefault(): void {
    this.template = this.defaultTemplate();
    this.render();
  }

  protected async save(): Promise<void> {
    if (!this.deck) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      this.deck = await this.decks.update(this.deck.id, { ...this.deck, illustrationPrompt: this.template });
      this.savedTemplate = this.template;
      this.info.set(this.translate.instant('server.ai.template-saved'));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }
}
