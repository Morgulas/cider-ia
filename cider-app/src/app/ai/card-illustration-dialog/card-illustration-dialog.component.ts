import { Component, OnDestroy, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { ProgressBar } from 'primeng/progressbar';
import { Select } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { AssetsService } from '../../data-services/services/assets.service';
import { CardAttributesService } from '../../data-services/services/card-attributes.service';
import { DecksService } from '../../data-services/services/decks.service';
import { Asset } from '../../data-services/types/asset.type';
import { Card } from '../../data-services/types/card.type';
import { Deck } from '../../data-services/types/deck.type';
import { CurrentProjectService } from '../../server/current-project.service';
import { apiErrorMessage } from '../../server/server.types';
import StringUtils from '../../shared/utils/string-utils';
import { AiService } from '../ai.service';
import { defaultPromptTemplate, PromptVariable, promptVariables, renderCardPrompt } from '../card-prompt';
import { renderPrompt } from '../illustration-prompt';

interface Proposal {
  blob: Blob;
  url: string;
}

/** Largest image accepted by paste or drop (the generated images are far smaller) */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Illustration of a card:
 *  1. a prompt built from the deck's prompt template and the card's attributes,
 *     to copy into a chatbot (ChatGPT, Gemini...), or to send to the server's
 *     image service when AI is enabled for the account;
 *  2. the resulting image, pasted, dropped, chosen or generated;
 *  3. saved as a project asset named after the card: templates that use
 *     {{index assets card.name}} show it right away.
 */
@Component({
  selector: 'app-card-illustration-dialog',
  templateUrl: './card-illustration-dialog.component.html',
  styleUrl: './card-illustration-dialog.component.scss',
  imports: [FormsModule, Dialog, Button, Checkbox, InputText, Textarea, Select, Message, ProgressBar, TranslatePipe]
})
export class CardIllustrationDialogComponent implements OnDestroy {
  protected readonly ai = inject(AiService);
  private readonly assets = inject(AssetsService);
  private readonly decks = inject(DecksService);
  private readonly attributes = inject(CardAttributesService);
  private readonly currentProject = inject(CurrentProjectService);
  private readonly translate = inject(TranslateService);

  readonly visible = model(false);
  readonly card = input<Card | null>(null);

  // prompt
  private deck: Deck | null = null;
  protected template = '';
  private savedTemplate = '';
  protected prompt = '';
  protected readonly templateError = signal<string | null>(null);
  protected readonly variables = signal<PromptVariable[]>([]);
  protected readonly editingTemplate = signal(false);
  protected readonly copied = signal(false);
  protected readonly savingTemplate = signal(false);

  // server generation
  protected style = '';
  protected noText = true;
  protected aspectRatio = '3:4';
  protected count = 2;
  protected provider: string | null = null;

  protected assetName = '';
  protected readonly dragOver = signal(false);
  protected readonly generating = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly proposals = signal<Proposal[]>([]);
  protected readonly selected = signal<number | null>(null);
  /** an asset with the chosen name already exists at the root of the assets */
  protected readonly existingAsset = signal<Asset | null>(null);

  protected readonly countOptions = computed(() =>
    Array.from({ length: this.ai.status()?.maxImagesPerRequest ?? 1 }, (_, i) => ({ label: String(i + 1), value: i + 1 })));
  protected readonly ratioOptions = computed(() =>
    (this.ai.status()?.aspectRatios ?? ['1:1']).map(ratio => ({ label: ratio, value: ratio })));
  protected readonly remaining = computed(() => {
    const status = this.ai.status();
    return status ? Math.max(0, status.monthlyImages - status.imagesThisMonth) : 0;
  });

  private readonly pasteListener = (event: ClipboardEvent) => this.onPaste(event);

  ngOnDestroy(): void {
    document.removeEventListener('paste', this.pasteListener);
    this.clearProposals();
  }

  /** Called when the dialog opens: deck template, prompt of the card, status */
  protected async onShow(): Promise<void> {
    const card = this.card();
    this.error.set(null);
    this.copied.set(false);
    this.editingTemplate.set(false);
    this.clearProposals();
    document.addEventListener('paste', this.pasteListener);
    this.style = this.loadStyle();
    this.assetName = StringUtils.toKebabCase(card?.name ?? '') || 'illustration';
    if (card) {
      this.deck = (await this.decks.get(card.deckId)) ?? null;
      const attributes = await this.attributes.getAll({ deckId: card.deckId });
      this.variables.set(promptVariables(attributes));
      this.savedTemplate = this.deck?.illustrationPrompt
        || defaultPromptTemplate(this.translate.instant('server.ai.prompt-default-intro'), attributes);
      this.template = this.savedTemplate;
      this.renderPrompt();
    }
    await this.checkExistingAsset();
    const status = await this.ai.refreshStatus();
    this.provider = status?.defaultImageProvider ?? null;
    this.count = Math.min(this.count, status?.maxImagesPerRequest ?? 1);
  }

  protected onHide(): void {
    document.removeEventListener('paste', this.pasteListener);
    this.clearProposals();
  }

  /*********************************************************************
   * Prompt
   *********************************************************************/

  /** The prompt of this card, from the template (any edit of the prompt itself is replaced) */
  protected renderPrompt(): void {
    const card = this.card();
    if (!card) {
      return;
    }
    const rendered = renderCardPrompt(this.template, card, this.deck?.name ?? '');
    this.templateError.set(rendered.error ?? null);
    if (!rendered.error) {
      this.prompt = rendered.text;
      this.copied.set(false);
    }
  }

  protected templateChanged(): boolean {
    return this.template !== this.savedTemplate;
  }

  protected insertVariable(textarea: HTMLTextAreaElement, token: string): void {
    const start = textarea.selectionStart ?? this.template.length;
    const end = textarea.selectionEnd ?? start;
    this.template = this.template.slice(0, start) + token + this.template.slice(end);
    this.renderPrompt();
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  /** Saves the template in the deck: every card of the deck uses it (and it is saved with the project) */
  protected async saveTemplate(): Promise<void> {
    if (!this.deck) {
      return;
    }
    this.savingTemplate.set(true);
    try {
      this.deck = await this.decks.update(this.deck.id, { ...this.deck, illustrationPrompt: this.template });
      this.savedTemplate = this.template;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.savingTemplate.set(false);
    }
  }

  protected async resetTemplate(): Promise<void> {
    const card = this.card();
    if (!card) {
      return;
    }
    const attributes = await this.attributes.getAll({ deckId: card.deckId });
    this.template = defaultPromptTemplate(this.translate.instant('server.ai.prompt-default-intro'), attributes);
    this.renderPrompt();
  }

  /**
   * Copies the prompt. The clipboard API only exists on HTTPS (or localhost):
   * on a local network address the text is selected and copied the old way.
   */
  protected async copyPrompt(textarea: HTMLTextAreaElement): Promise<void> {
    let done = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(this.prompt);
        done = true;
      } catch {
        done = false;
      }
    }
    if (!done) {
      textarea.focus();
      textarea.select();
      // deprecated but still the only way without a secure context
      done = document.execCommand('copy');
    }
    this.copied.set(done);
    if (!done) {
      this.error.set(this.translate.instant('server.ai.copy-failed'));
    }
  }

  /*********************************************************************
   * Image: pasted, dropped, chosen or generated
   *********************************************************************/

  private onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    const image = Array.from(event.clipboardData?.items ?? [])
      .find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    // pasting text in a field stays a normal paste
    if (image) {
      event.preventDefault();
      this.addImages([image]);
    } else if (target && !['TEXTAREA', 'INPUT'].includes(target.tagName)) {
      this.error.set(this.translate.instant('server.ai.paste-no-image'));
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.addImages(Array.from(event.dataTransfer?.files ?? []));
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addImages(Array.from(input.files ?? []));
    input.value = '';
  }

  private addImages(files: Blob[]): void {
    const images = files.filter(file => file.type.startsWith('image/') && file.size <= MAX_IMAGE_BYTES);
    if (images.length === 0) {
      this.error.set(this.translate.instant('server.ai.not-an-image'));
      return;
    }
    this.error.set(null);
    const added = images.map(blob => ({ blob, url: URL.createObjectURL(blob) }));
    this.proposals.update(list => [...list, ...added]);
    this.selected.set(this.proposals().length - 1);
  }

  /** The prompt sent to the server: the administrator's template framing the card prompt */
  protected serverPromptPreview(): string {
    const status = this.ai.status();
    if (!status) {
      return '';
    }
    return renderPrompt(status.promptTemplate, {
      subject: this.prompt,
      style: this.style,
      card_name: this.card()?.name ?? '',
      no_text: this.noText ? status.noTextInstruction : '',
    });
  }

  protected async generate(): Promise<void> {
    this.error.set(null);
    this.generating.set(true);
    this.saveStyle();
    try {
      const result = await this.ai.generateImages({
        subject: this.prompt,
        style: this.style,
        cardName: this.card()?.name ?? '',
        noText: this.noText,
        aspectRatio: this.aspectRatio,
        count: this.count,
        provider: this.provider ?? undefined,
      });
      this.clearProposals();
      this.proposals.set(result.images.map(blob => ({ blob, url: URL.createObjectURL(blob) })));
      this.selected.set(result.images.length === 1 ? 0 : null);
    } catch (error) {
      this.error.set(apiErrorMessage(error, this.translate.instant('server.ai.generation-failed')));
    } finally {
      this.generating.set(false);
    }
  }

  protected select(index: number): void {
    this.selected.set(index);
  }

  protected async checkExistingAsset(): Promise<void> {
    const wanted = StringUtils.toKebabCase(this.assetName);
    const assets = await this.assets.getAll();
    this.existingAsset.set(assets.find(asset => !asset.path && StringUtils.toKebabCase(asset.name) === wanted) ?? null);
  }

  /** Saves the selected image as an asset, replacing the asset of the same name if there is one */
  protected async save(): Promise<void> {
    const index = this.selected();
    const name = StringUtils.toKebabCase(this.assetName);
    if (index === null || !name) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.checkExistingAsset();
      const proposal = this.proposals()[index];
      const existing = this.existingAsset();
      if (existing) {
        await this.assets.update(existing.id, { ...existing, file: proposal.blob });
      } else {
        await this.assets.create({ name, file: proposal.blob, path: '' } as Asset);
      }
      this.visible.set(false);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }

  private clearProposals(): void {
    this.proposals().forEach(proposal => URL.revokeObjectURL(proposal.url));
    this.proposals.set([]);
    this.selected.set(null);
  }

  /** The illustration style is remembered per project, to keep the cards consistent */
  private styleKey(): string | null {
    const project = this.currentProject.project();
    return project ? `cider.ai.style.${project.id}` : null;
  }

  private loadStyle(): string {
    const key = this.styleKey();
    try {
      return key ? localStorage.getItem(key) ?? '' : '';
    } catch {
      return '';
    }
  }

  private saveStyle(): void {
    const key = this.styleKey();
    try {
      if (key) {
        localStorage.setItem(key, this.style);
      }
    } catch {
      // the style is a convenience: not remembered if storage is unavailable
    }
  }
}
