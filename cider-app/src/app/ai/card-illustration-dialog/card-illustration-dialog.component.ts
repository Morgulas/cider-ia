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
import { Asset } from '../../data-services/types/asset.type';
import { Card } from '../../data-services/types/card.type';
import { CurrentProjectService } from '../../server/current-project.service';
import { apiErrorMessage } from '../../server/server.types';
import StringUtils from '../../shared/utils/string-utils';
import { AiService } from '../ai.service';
import { renderPrompt, suggestedSubject } from '../illustration-prompt';

interface Proposal {
  blob: Blob;
  url: string;
}

/**
 * Generates an illustration for a card with the server's image service, and
 * saves the chosen image as a project asset named after the card: templates
 * that use {{index assets card.name}} show it right away.
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
  private readonly currentProject = inject(CurrentProjectService);
  private readonly translate = inject(TranslateService);

  readonly visible = model(false);
  readonly card = input<Card | null>(null);

  protected style = '';
  protected subject = '';
  protected noText = true;
  protected aspectRatio = '3:4';
  protected count = 2;
  protected provider: string | null = null;
  protected assetName = '';

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

  ngOnDestroy(): void {
    this.clearProposals();
  }

  /** Called when the dialog opens: fresh status, suggested texts */
  protected async onShow(): Promise<void> {
    const card = this.card();
    this.error.set(null);
    this.clearProposals();
    this.style = this.loadStyle();
    this.subject = card ? suggestedSubject(card) : '';
    this.assetName = StringUtils.toKebabCase(card?.name ?? '') || 'illustration';
    await this.checkExistingAsset();
    const status = await this.ai.refreshStatus();
    this.provider = status?.defaultImageProvider ?? null;
    this.count = Math.min(this.count, status?.maxImagesPerRequest ?? 1);
  }

  protected onHide(): void {
    this.clearProposals();
  }

  protected async generate(): Promise<void> {
    this.error.set(null);
    this.generating.set(true);
    this.saveStyle();
    try {
      const result = await this.ai.generateImages({
        subject: this.subject,
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

  /** The prompt that will be sent: the administrator's template filled with the fields */
  protected promptPreview(): string {
    const status = this.ai.status();
    if (!status) {
      return '';
    }
    return renderPrompt(status.promptTemplate, {
      subject: this.subject,
      style: this.style,
      card_name: this.card()?.name ?? '',
      no_text: this.noText ? status.noTextInstruction : '',
    });
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
    return key ? localStorage.getItem(key) ?? '' : '';
  }

  private saveStyle(): void {
    const key = this.styleKey();
    if (key) {
      localStorage.setItem(key, this.style);
    }
  }
}
