import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Button } from 'primeng/button';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { InputNumber } from 'primeng/inputnumber';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Textarea } from 'primeng/textarea';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { AiService } from '../../ai/ai.service';
import { renderPrompt } from '../../ai/illustration-prompt';
import { AiSettingsResponse, AiSettingsView, apiErrorMessage } from '../server.types';
import { TopbarComponent } from '../topbar/topbar.component';

type ProviderId = 'openai' | 'gemini' | 'comfyui';

/**
 * AI settings, for administrators: image services, keys, models, quota of new
 * accounts and the prompt template that frames every illustration request.
 * Values not changed here keep the Docker environment variables.
 */
@Component({
  selector: 'app-admin-ai',
  templateUrl: './admin-ai.component.html',
  styleUrl: './admin-ai.component.scss',
  providers: [ConfirmationService],
  imports: [TopbarComponent, FormsModule, Button, ConfirmDialog, InputNumber, InputText, Message, Password, Select, Tag,
    Textarea, ToggleSwitch, TranslatePipe]
})
export class AdminAiComponent implements OnInit {
  private readonly ai = inject(AiService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  /** values shown in the form, edited in place */
  protected form: AiSettingsView | null = null;
  /** values as saved, to send only what changed */
  private saved: AiSettingsView | null = null;
  protected activeProviders: string[] = [];
  protected placeholders: string[] = [];
  /** new keys typed by the administrator; empty = keep the current key */
  protected newKeys: Record<'openai' | 'gemini', string> = { openai: '', gemini: '' };

  protected readonly providerOptions = [
    { label: 'OpenAI', value: 'openai' },
    { label: 'Google Gemini', value: 'gemini' },
    { label: 'ComfyUI', value: 'comfyui' },
  ];
  protected readonly qualityOptions = ['low', 'medium', 'high', 'auto'].map(value => ({ label: value, value }));

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await this.ai.getSettings());
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private apply(response: AiSettingsResponse): void {
    this.saved = structuredClone(response.settings);
    this.form = structuredClone(response.settings);
    this.activeProviders = response.activeProviders;
    this.placeholders = response.placeholders;
    this.newKeys = { openai: '', gemini: '' };
  }

  protected isActive(id: ProviderId): boolean {
    return this.activeProviders.includes(id);
  }

  protected defaultProviderOptions() {
    return [{ label: this.translate.instant('server.ai-settings.automatic'), value: '' }, ...this.providerOptions];
  }

  protected insertPlaceholder(textarea: HTMLTextAreaElement, name: string): void {
    if (!this.form) {
      return;
    }
    const text = `{{${name}}}`;
    const start = textarea.selectionStart ?? this.form.promptTemplate.length;
    const end = textarea.selectionEnd ?? start;
    this.form.promptTemplate = this.form.promptTemplate.slice(0, start) + text + this.form.promptTemplate.slice(end);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
    });
  }

  protected token(name: string): string {
    return `{{${name}}}`;
  }

  protected missingSubject(): boolean {
    return !!this.form && !this.form.promptTemplate.includes(this.token('subject'));
  }

  /** Example of a prompt built from the template, to check it reads well */
  protected templateExample(): string {
    return this.form ? renderPrompt(this.form.promptTemplate, {
      style: this.translate.instant('server.ai-settings.example-style'),
      subject: this.translate.instant('server.ai-settings.example-subject'),
      card_name: this.translate.instant('server.ai-settings.example-card'),
      no_text: 'No text, letters, numbers, card frame or border in the image.',
    }) : '';
  }

  /** The fields that differ from the saved values, plus the keys typed */
  private changes(): Record<string, unknown> {
    const form = this.form!;
    const saved = this.saved!;
    const changes: Record<string, unknown> = {};
    for (const key of ['defaultImageProvider', 'timeoutSeconds', 'defaultMonthlyImages', 'promptTemplate'] as const) {
      if (form[key] !== saved[key]) {
        changes[key] = form[key];
      }
    }
    for (const provider of ['openai', 'gemini', 'comfyui'] as const) {
      const section: Record<string, unknown> = {};
      const current = form[provider] as unknown as Record<string, unknown>;
      const before = saved[provider] as unknown as Record<string, unknown>;
      for (const field of Object.keys(current)) {
        if (!['apiKeySet', 'apiKeyHint', 'workflowFile'].includes(field) && current[field] !== before[field]) {
          section[field] = current[field];
        }
      }
      if (provider !== 'comfyui' && this.newKeys[provider].trim()) {
        section['apiKey'] = this.newKeys[provider].trim();
      }
      if (Object.keys(section).length > 0) {
        changes[provider] = section;
      }
    }
    return changes;
  }

  protected hasChanges(): boolean {
    return !!this.form && !!this.saved && Object.keys(this.changes()).length > 0;
  }

  protected save(): Promise<void> {
    return this.run(() => this.ai.updateSettings(this.changes()), 'server.ai-settings.saved');
  }

  protected removeKey(provider: 'openai' | 'gemini'): void {
    this.confirmation.confirm({
      message: this.translate.instant('server.ai-settings.remove-key-confirm'),
      header: this.translate.instant('server.ai-settings.remove-key'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('server.ai-settings.remove-key'),
      rejectLabel: this.translate.instant('controls.cancel'),
      accept: () => void this.run(() => this.ai.updateSettings({ [provider]: { apiKey: '' } }), 'server.ai-settings.saved'),
    });
  }

  /** Back to the key of the Docker variables, if any */
  protected useDockerKey(provider: 'openai' | 'gemini'): Promise<void> {
    return this.run(() => this.ai.updateSettings({ [provider]: { apiKey: null } }), 'server.ai-settings.saved');
  }

  protected defaultTemplate(): Promise<void> {
    return this.run(() => this.ai.updateSettings({ promptTemplate: null }), 'server.ai-settings.saved');
  }

  protected resetAll(): void {
    this.confirmation.confirm({
      message: this.translate.instant('server.ai-settings.reset-confirm'),
      header: this.translate.instant('server.ai-settings.reset'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('server.ai-settings.reset'),
      rejectLabel: this.translate.instant('controls.cancel'),
      accept: () => void this.run(() => this.ai.resetSettings(), 'server.ai-settings.reset-done'),
    });
  }

  private async run(action: () => Promise<AiSettingsResponse>, infoKey: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      this.apply(await action());
      this.info.set(this.translate.instant(infoKey));
      // the card dialog of this browser shows the new template and providers
      void this.ai.refreshStatus();
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
