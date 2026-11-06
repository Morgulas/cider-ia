import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PrimeTemplate } from 'primeng/api';
import { ButtonDirective } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { Textarea } from 'primeng/textarea';
import { CardPreviewComponent } from '../card-preview/card-preview.component';
import { CardTemplate } from '../data-services/types/card-template.type';
import { Card } from '../data-services/types/card.type';
import { copyText } from '../shared/utils/clipboard';
import { checkTemplate, TemplateIssue } from './template-check';
import { buildTemplatePrompt, ChatbotAnswer, ChatbotPromptTexts, parseChatbotAnswer, TemplateVariable } from './template-chatbot';

/** Width of the small before/after previews, in pixels */
const PREVIEW_WIDTH = 260;

/**
 * Edit a template with any chatbot: describe the change, copy the prompt,
 * paste the answer back; the new HTML/CSS is checked and shown next to the
 * current one before it replaces it (the change can then be undone with Ctrl+Z).
 */
@Component({
  selector: 'app-template-chatbot-dialog',
  templateUrl: './template-chatbot-dialog.component.html',
  styleUrls: ['./template-chatbot-dialog.component.scss'],
  imports: [Dialog, PrimeTemplate, FormsModule, ButtonDirective, Textarea, Message, CardPreviewComponent, TranslatePipe],
})
export class TemplateChatbotDialogComponent {
  private readonly translate = inject(TranslateService);

  readonly visible = model(false);
  readonly template = input.required<CardTemplate>();
  readonly card = input<Card | undefined>();
  readonly deckName = input<string>('');
  readonly variables = input<TemplateVariable[]>([]);
  readonly assets = input<string[]>([]);
  readonly helpers = input<string[]>([]);
  /** request typed in advance (e.g. "put the colors in CSS variables") */
  readonly initialRequest = input<string>('');
  /** the new code, only the parts the answer contained */
  readonly apply = output<ChatbotAnswer>();

  protected request = '';
  protected answerText = '';
  protected readonly copied = signal(false);
  protected readonly copyError = signal(false);
  protected readonly answer = signal<ChatbotAnswer>({});
  protected readonly answerRead = signal(false);

  protected readonly found = computed(() => this.answer().html !== undefined || this.answer().css !== undefined);
  /** the template once the answer is applied */
  protected readonly proposed = computed<CardTemplate>(() => ({
    ...this.template(),
    html: this.answer().html ?? this.template().html,
    css: this.answer().css ?? this.template().css,
  }));
  protected readonly issue = computed<{ part: 'HTML' | 'CSS'; issue: TemplateIssue } | null>(() => {
    const answer = this.answer();
    const card = this.card();
    const html = answer.html !== undefined ? checkTemplate(answer.html, card) : null;
    if (html) {
      return { part: 'HTML', issue: html };
    }
    const css = answer.css !== undefined ? checkTemplate(answer.css, card) : null;
    return css ? { part: 'CSS', issue: css } : null;
  });

  protected previewScale(): number {
    const width = this.cardWidth();
    return width > 0 ? PREVIEW_WIDTH / width : 0.3;
  }

  /** card width declared by the template (.card { width: 825px }), 825 otherwise */
  private cardWidth(): number {
    const match = /width\s*:\s*(\d+(?:\.\d+)?)px/.exec(this.template().css ?? '');
    return match ? Number(match[1]) : 825;
  }

  protected onShow(): void {
    if (this.initialRequest()) {
      this.request = this.initialRequest();
    }
    this.copied.set(false);
    this.copyError.set(false);
  }

  private texts(): ChatbotPromptTexts {
    const t = (key: string) => this.translate.instant(`template-editor.chatbot.prompt.${key}`);
    const rules = this.translate.instant('template-editor.chatbot.prompt.rules');
    return {
      intro: t('intro'), requestTitle: t('request-title'), rulesTitle: t('rules-title'),
      rules: Array.isArray(rules) ? rules : [String(rules)],
      attributesTitle: t('attributes-title'), optionsLabel: t('options-label'), exampleLabel: t('example-label'),
      helpersTitle: t('helpers-title'), assetsTitle: t('assets-title'), htmlTitle: t('html-title'),
      cssTitle: t('css-title'), answerFormat: t('answer-format'),
    };
  }

  protected prompt(): string {
    return buildTemplatePrompt({
      request: this.request, html: this.template().html ?? '', css: this.template().css ?? '',
      deckName: this.deckName(), variables: this.variables(), assets: this.assets(), helpers: this.helpers(),
      texts: this.texts(),
    });
  }

  protected async copyPrompt(): Promise<void> {
    const done = await copyText(this.prompt());
    this.copied.set(done);
    this.copyError.set(!done);
  }

  protected readAnswer(): void {
    this.answer.set(parseChatbotAnswer(this.answerText));
    this.answerRead.set(this.answerText.trim() !== '');
  }

  protected issueText(): string {
    const found = this.issue();
    if (!found) {
      return '';
    }
    const { issue } = found;
    const message = issue.code === 'syntax' || issue.code === 'render'
      ? `${this.translate.instant('template-editor.issue.' + issue.code)} ${issue.detail}`
      : this.translate.instant('template-editor.issue.' + issue.code, issue.params);
    const line = issue.line ? ` (${this.translate.instant('template-editor.issue.line', { line: issue.line })})` : '';
    return `${found.part} : ${message}${line}`;
  }

  protected applyAnswer(): void {
    this.apply.emit(this.answer());
    this.reset();
    this.visible.set(false);
  }

  protected close(): void {
    this.visible.set(false);
  }

  private reset(): void {
    this.answerText = '';
    this.answer.set({});
    this.answerRead.set(false);
    this.copied.set(false);
  }
}
