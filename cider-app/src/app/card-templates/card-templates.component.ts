import { Component, OnInit, HostListener, ViewChild, ElementRef, AfterViewInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { ConfirmationService, MessageService, PrimeTemplate } from 'primeng/api';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { CardsService } from '../data-services/services/cards.service';
import { CardTemplate } from '../data-services/types/card-template.type';
import { Card } from '../data-services/types/card.type';
import { Subject, debounceTime } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { LocalStorageService, PreviewSettings } from '../data-services/local-storage/local-storage.service';
import { Bind } from 'primeng/bind';
import { Toast } from 'primeng/toast';
import { Splitter } from 'primeng/splitter';
import { Card as Card_1 } from 'primeng/card';
import { Select } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { ButtonGroup } from 'primeng/buttongroup';
import { ButtonDirective } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { CardPreviewComponent } from '../card-preview/card-preview.component';
import { EditorComponent } from 'ngx-monaco-editor-v2';
import { EntityDialogComponent } from '../entity-dialog/entity-dialog.component';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { Checkbox } from 'primeng/checkbox';
import { InputNumber } from 'primeng/inputnumber';
import { DecksComponent } from '../decks/decks.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputText } from 'primeng/inputtext';
import { CardAttributesService } from '../data-services/services/card-attributes.service';
import { AssetsService } from '../data-services/services/assets.service';
import { DecksService } from '../data-services/services/decks.service';
import { CardAttribute } from '../data-services/types/card-attribute.type';
import MonacoLanguages from '../shared/extensions/monaco-languages';
import StringUtils from '../shared/utils/string-utils';
import { checkTemplate, TemplateIssue } from './template-check';
import { ChatbotAnswer, TemplateVariable } from './template-chatbot';
import { TemplateChatbotDialogComponent } from './template-chatbot-dialog.component';

type EditorKind = 'html' | 'css';
type EditorLayout = 'tabs' | 'split';

/** A ready-made Handlebars block of the "Insert" panel (Monaco snippet syntax) */
interface InsertBlock {
  key: string;
  snippet: string;
  preview: string;
}

const LAYOUT_KEY = 'cider.template-editor.layout';
const INSERT_PANEL_KEY = 'cider.template-editor.insert-panel';
const PREVIEW_CARD_KEY = 'cider.template-editor.card.';
/** delay before the code is checked and the preview refreshed */
const CHECK_DELAY_MS = 700;

/** Choices of a dropdown attribute, whatever the way they were stored */
function optionValues(options: CardAttribute['options']): string[] {
  if (Array.isArray(options)) {
    return options.map(option => typeof option === 'string' ? option : String(option?.value ?? '')).filter(Boolean);
  }
  if (typeof options === 'string' && options.trim()) {
    try {
      const parsed = JSON.parse(options);
      if (Array.isArray(parsed)) {
        return optionValues(parsed);
      }
    } catch {
      // comma-separated list
    }
    return options.split(',').map(option => option.trim()).filter(Boolean);
  }
  return [];
}

/** A card value as plain text, for examples */
function exampleText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim() || undefined;
}

const templateCssFront  = 
`.card {
    width: 825px;
    height: 1125px;
    border-radius: 25px;
    text-align: center;
    display: flex;
    flex-direction: column;
    background-color: hsl(0, 0%, 40%);
    border: 45px solid hsl(0, 0%, 10%);
    color: hsl(0, 0%, 90%);
    font-weight: 600;
    font-size: 50px;
}
.card .header {
    height: 300px;
    font-size: 80px;
    font-weight: 600;
    padding: 10px;
    padding-top: 60px;
}
.card .content {
    flex: 1;
    padding: 50px;
    padding-top: 60px;
}
.card .footer {
    height: 200px;
    text-align: right;
    padding: 100px;
    padding-right: 50px;
}`;

const templateHtmlFront = 
`<div class="card">
    <div class="header">{{card.name}}</div>
    <div class="content">Card description</div>
    <div class="footer">A{{#padZeros card.id 3}}{{/padZeros}}</div>
</div>`;

@Component({
    selector: 'app-card-templates',
    templateUrl: './card-templates.component.html',
    styleUrls: ['./card-templates.component.scss'],
    providers: [MessageService, ConfirmationService],
    imports: [Bind, Toast, Splitter, PrimeTemplate, Card_1, Select, FormsModule, ButtonGroup, ButtonDirective, Tooltip, CardPreviewComponent, EditorComponent, EntityDialogComponent, ConfirmDialog, Dialog, Checkbox, InputNumber, DecksComponent, TranslatePipe, InputText, TemplateChatbotDialogComponent]
})
export class CardTemplatesComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('previewSpace') previewSpace!: ElementRef;
  static readonly DEFAULT_HTML: string = templateHtmlFront;
  static readonly DEFAULT_CSS: string = templateCssFront;
  // have to be non-static
  readonly ZOOM_UP: number = 1.5;
  readonly ZOOM_DOWN: number = 1/1.5;
  readonly DEFAULT_ZOOM: number = Math.pow(this.ZOOM_DOWN, 2);

  htmlEditorOptions: any = { theme: 'vs-dark-extended', language: 'handlebars', 
    automaticLayout: true, minimap: { enabled: false } };
  cssEditorOptions: any = { theme: 'vs-dark-extended', language: 'css-handlebars', 
    automaticLayout: true, minimap: { enabled: false } };
  templates: CardTemplate[] = [];
  cards: Card[] = [];
  selectedCard: Card = {} as Card;
  selectedTemplate: CardTemplate = {} as CardTemplate;
  editTemplate: CardTemplate = {} as CardTemplate;
  dialogVisible = false;
  infoVisible = false;
  infoText = '';
  zoom: number = this.DEFAULT_ZOOM;
  previewPanelWidth = 40;
  disablePanels = false;
  templateChanges: Subject<boolean>;
  disableSplitter = false;
  windowResizing$: Subject<boolean>;
  templateVersion = 0;
  isPanning = false;
  settingsVisible = false;
  previewSettings: PreviewSettings = {
    tiltEnabled: false,
    trimLinesEnabled: false,
    trimOffset: 0.125,
    trimUnit: 'in',
    safeLinesEnabled: false,
    safeOffset: 0.25,
    safeUnit: 'in'
  };
  unitOptions = [
    { label: 'Inches', value: 'in' },
    { label: 'Pixels', value: 'px' },
    { label: 'mm', value: 'mm' }
  ];

  private panStartX = 0;
  private panStartY = 0;
  private scrollLeftStart = 0;
  private scrollTopStart = 0;
  private resizeObserver: ResizeObserver | null = null;

  /** template shown in the preview: the last version without errors */
  previewTemplate: CardTemplate = {} as CardTemplate;
  readonly editorKinds: EditorKind[] = ['html', 'css'];
  layout: EditorLayout = 'tabs';
  activeTab: EditorKind = 'html';
  insertPanelVisible = true;
  chatbotVisible = false;
  issues: Record<EditorKind, TemplateIssue | null> = { html: null, css: null };
  attributes: CardAttribute[] = [];
  variables: TemplateVariable[] = [];
  assetEntries: { path: string; label: string }[] = [];
  assetFilter = '';
  deckName = '';
  blocks: InsertBlock[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly editors: Partial<Record<EditorKind, any>> = {};
  private lastFocused: EditorKind = 'html';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private assetUrls: any;
  private readonly checks = new Subject<void>();
  private readonly cardAttributesService = inject(CardAttributesService);
  private readonly assetsService = inject(AssetsService);
  private readonly decksService = inject(DecksService);
  private readonly translate = inject(TranslateService);


  constructor(private domSanitizer: DomSanitizer, 
    public service: CardTemplatesService,
    private cardsService: CardsService,
    private messageService: MessageService, 
    private confirmationService: ConfirmationService,
    private localStorage: LocalStorageService,
    private route: ActivatedRoute) {
      this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
        const templateIdString = params.get('templateId') || '';
        const templateId = parseInt(templateIdString, 10);
        if (!isNaN(templateId)) {
          this.service.get(templateId).then((template) => {
            this.selectedTemplate = template;
            this.previewTemplate = { ...template };
            this.restorePreviewCard();
            this.runCheck();
          }).catch(error => {
            console.error(`Error fetching template with ID ${templateId}:`, error);
          });
        }
      });
      this.templateChanges = new Subject();
      this.windowResizing$ = new Subject();
      this.windowResizing$.pipe(debounceTime(200)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.disablePanels = false;
        setTimeout(() => this.centerPreview(), 100);
      });
      if (!this.localStorage.getDarkMode()) {
        this.htmlEditorOptions.theme = 'vs';
        this.cssEditorOptions.theme = 'vs';
      }
    }

  ngOnInit(): void {
    const savedSettings = this.localStorage.getPreviewSettings();
    if (savedSettings) {
      this.previewSettings = savedSettings;
    }

    this.service.getAll().then(templates => {
      this.templates = templates;
      // if (this.templates.length > 0) {
      //   this.selectedTemplate = this.templates[0];
      // }
    });
    this.cardsService.getAll().then(cards => {
      this.cards = cards;
      if (this.cards.length > 0) {
        this.selectedCard = this.cards[0];
      }
      this.restorePreviewCard();
      this.updateVariables();
      this.runCheck();
    });
    this.templateChanges.asObservable().pipe(debounceTime(1000))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.save(this.selectedTemplate));

    this.layout = localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'tabs';
    this.insertPanelVisible = localStorage.getItem(INSERT_PANEL_KEY) !== 'hidden';
    this.checks.pipe(debounceTime(CHECK_DELAY_MS), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.runCheck());
    this.cardAttributesService.getAll().then(attributes => {
      this.attributes = attributes;
      this.updateVariables();
    });
    this.loadAssets();
    this.assetsService.onChange().pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadAssets());
    this.assetsService.getAssetUrls().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(urls => {
      this.assetUrls = urls;
      this.checks.next();
    });
    this.decksService.getSelectedDeck().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(deck => this.deckName = deck?.name ?? '');
    this.translate.onLangChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.updateCompletionContext());
  }

  public saveSettings() {
    this.localStorage.setPreviewSettings(this.previewSettings);
  }

  public getTrimOffsetPx(): number {
    return this.convertToPx(this.previewSettings.trimOffset, this.previewSettings.trimUnit);
  }

  public getSafeOffsetPx(): number {
    return this.convertToPx(this.previewSettings.safeOffset, this.previewSettings.safeUnit);
  }

  private convertToPx(value: number, unit: 'in' | 'px' | 'mm'): number {
    if (unit === 'px') return value;
    if (unit === 'in') return value * 300;
    if (unit === 'mm') return (value / 25.4) * 300;
    return value;
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.centerPreview(), 500);

    if (this.previewSpace) {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.disablePanels) {
          this.centerPreview();
        }
      });
      this.resizeObserver.observe(this.previewSpace.nativeElement);
    }
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    MonacoLanguages.completionContext = { variables: [], assets: [], helperDocs: {} };
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.disablePanels = true;
    this.windowResizing$.next(true);
  }

  public updateTemplatesList() {
    this.service.getAll().then(templates => this.templates = templates);
  }

  public changeZoom(change: number) {
    this.zoom *= change;
    this.clampZoom();
  }

  private clampZoom() {
    if (this.zoom < Math.pow(this.ZOOM_DOWN, 5)) {
      this.zoom = Math.pow(this.ZOOM_DOWN, 5);
    } else if (this.zoom > Math.pow(this.ZOOM_UP, 5)) {
      this.zoom = Math.pow(this.ZOOM_UP, 5);
    }
    this.zoom = parseFloat(this.zoom.toFixed(3));
  }

  public onMouseDown(event: MouseEvent, container: HTMLElement) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panStartY = event.clientY;
    this.scrollLeftStart = container.scrollLeft;
    this.scrollTopStart = container.scrollTop;
  }

  public onMouseMove(event: MouseEvent, container: HTMLElement) {
    if (!this.isPanning) return;
    const dx = event.clientX - this.panStartX;
    const dy = event.clientY - this.panStartY;
    container.scrollLeft = this.scrollLeftStart - dx;
    container.scrollTop = this.scrollTopStart - dy;
  }

  public onMouseUp(event: MouseEvent) {
    this.isPanning = false;
  }

  public onMouseLeave(event: MouseEvent) {
    this.isPanning = false;
  }

  public onWheel(event: WheelEvent) {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    this.zoom *= zoomFactor;
    this.clampZoom();
  }

  public resetZoomAndPan() {
    this.zoom = this.DEFAULT_ZOOM;
    this.centerPreview();
  }

  public centerPreview() {
    if (this.previewSpace) {
      const container = this.previewSpace.nativeElement;
      const scrollHeight = container.scrollHeight;
      const scrollWidth = container.scrollWidth;
      const clientHeight = container.clientHeight;
      const clientWidth = container.clientWidth;

      container.scrollTop = (scrollHeight - clientHeight) / 2;
      container.scrollLeft = (scrollWidth - clientWidth) / 2;
    }
  }

  public debounceSave() {
    this.templateChanges.next(true);
    this.checks.next();
  }

  /*********************************************************************
   * Preview card
   *********************************************************************/

  /** Shows the previous or next card of the deck */
  public stepCard(delta: number) {
    if (this.cards.length === 0) {
      return;
    }
    const index = this.cards.findIndex(card => card.id === this.selectedCard?.id);
    this.selectedCard = this.cards[(index + delta + this.cards.length) % this.cards.length];
    this.onCardChange();
  }

  public onCardChange() {
    if (this.selectedTemplate?.id && this.selectedCard?.id !== undefined) {
      localStorage.setItem(PREVIEW_CARD_KEY + this.selectedTemplate.id, String(this.selectedCard.id));
    }
    this.updateVariables();
    this.runCheck();
  }

  /** The card last shown with this template */
  private restorePreviewCard() {
    if (!this.selectedTemplate?.id || this.cards.length === 0) {
      return;
    }
    const saved = Number(localStorage.getItem(PREVIEW_CARD_KEY + this.selectedTemplate.id));
    const card = this.cards.find(candidate => candidate.id === saved);
    if (card) {
      this.selectedCard = card;
    }
  }

  /*********************************************************************
   * Errors: the preview keeps the last valid version
   *********************************************************************/

  public hasIssue(): boolean {
    return !!(this.issues.html || this.issues.css);
  }

  private runCheck() {
    if (!this.selectedTemplate?.id) {
      return;
    }
    const card = this.selectedCard?.id !== undefined ? this.selectedCard : undefined;
    this.issues = {
      html: checkTemplate(this.selectedTemplate.html, card, this.assetUrls),
      css: checkTemplate(this.selectedTemplate.css, card, this.assetUrls),
    };
    this.updateMarkers();
    if (!this.hasIssue() && (this.previewTemplate.html !== this.selectedTemplate.html
      || this.previewTemplate.css !== this.selectedTemplate.css || this.previewTemplate.id !== this.selectedTemplate.id)) {
      this.previewTemplate = { ...this.selectedTemplate };
      this.templateVersion++;
    }
  }

  public issueMessage(issue: TemplateIssue): string {
    if (issue.code === 'syntax' || issue.code === 'render') {
      return `${this.translate.instant('template-editor.issue.' + issue.code)} ${issue.detail}`;
    }
    return this.translate.instant('template-editor.issue.' + issue.code, issue.params);
  }

  /** Underlines the faulty line in the editor */
  private updateMarkers() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monaco = (window as any).monaco;
    for (const kind of this.editorKinds) {
      const model = this.editors[kind]?.getModel();
      if (!monaco || !model) {
        continue;
      }
      const issue = this.issues[kind];
      const line = issue ? Math.min(Math.max(issue.line ?? 1, 1), model.getLineCount()) : 1;
      monaco.editor.setModelMarkers(model, 'cider-template', issue ? [{
        severity: monaco.MarkerSeverity.Error,
        message: this.issueMessage(issue),
        startLineNumber: line, startColumn: 1,
        endLineNumber: line, endColumn: model.getLineMaxColumn(line),
      }] : []);
    }
  }

  /** Shows the faulty line (first problem if no editor is given) */
  public goToIssue(kind?: EditorKind) {
    const target = kind ?? (this.issues.html ? 'html' : 'css');
    const issue = this.issues[target];
    if (!issue) {
      return;
    }
    if (this.layout === 'tabs') {
      this.activeTab = target;
    }
    setTimeout(() => {
      const editor = this.editors[target];
      if (!editor) {
        return;
      }
      const line = issue.line ?? 1;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    });
  }

  /*********************************************************************
   * Code editors
   *********************************************************************/

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public onEditorInit(kind: EditorKind, editor: any) {
    this.editors[kind] = editor;
    editor.onDidFocusEditorText(() => this.lastFocused = kind);
    this.updateMarkers();
  }

  public selectTab(kind: EditorKind) {
    this.activeTab = kind;
    this.lastFocused = kind;
    setTimeout(() => this.editors[kind]?.focus());
  }

  public toggleLayout() {
    this.layout = this.layout === 'tabs' ? 'split' : 'tabs';
    localStorage.setItem(LAYOUT_KEY, this.layout);
    if (this.layout === 'tabs') {
      this.activeTab = this.lastFocused;
    }
  }

  public toggleInsertPanel() {
    this.insertPanelVisible = !this.insertPanelVisible;
    localStorage.setItem(INSERT_PANEL_KEY, this.insertPanelVisible ? 'shown' : 'hidden');
  }

  /** Editor that receives insertions: the visible tab, or the last one used side by side */
  private targetKind(): EditorKind {
    return this.layout === 'tabs' ? this.activeTab : this.lastFocused;
  }

  public insertTargetLabel(): string {
    return this.targetKind() === 'html' ? 'HTML' : 'CSS';
  }

  /** Inserts text at the cursor; Monaco snippet syntax ($1, ${1:default}, $0) */
  private insertAtCursor(text: string) {
    const editor = this.editors[this.targetKind()];
    if (!editor) {
      return;
    }
    editor.focus();
    const snippets = editor.getContribution('snippetController2');
    if (snippets) {
      snippets.insert(text);
    } else {
      editor.trigger('insert', 'type', { text });
    }
  }

  /** $ and } are special in snippets */
  private literal(text: string): string {
    return text.replace(/[$}\\]/g, match => '\\' + match);
  }

  public insertVariable(token: string) {
    this.insertAtCursor(this.literal(token));
  }

  public insertBlock(snippet: string) {
    this.insertAtCursor(snippet);
  }

  public assetToken(path: string): string {
    return `{{assets.${path}}}`;
  }

  public insertAsset(path: string) {
    const token = this.literal(this.assetToken(path));
    this.insertAtCursor(this.targetKind() === 'css' ? `url("${token}")` : `<img src="${token}" alt="">`);
  }

  public filteredAssets() {
    const filter = this.assetFilter.trim().toLowerCase();
    return filter ? this.assetEntries.filter(asset => asset.label.toLowerCase().includes(filter)) : this.assetEntries;
  }

  /*********************************************************************
   * What the template can use: attributes, images, helpers
   *********************************************************************/

  private loadAssets() {
    this.assetsService.getAllMetadata().then(assets => {
      this.assetEntries = assets
        .filter(asset => asset?.name)
        .map(asset => {
          const folders = (asset.path || '').split('/').filter(Boolean);
          return {
            path: [...folders, asset.name].map((part: string) => StringUtils.toKebabCase(part)).join('.'),
            label: [...folders, asset.name].join('/'),
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
      this.updateCompletionContext();
    });
  }

  /** The card values a template can show, with the preview card's value */
  private updateVariables() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const card = (this.selectedCard ?? {}) as any;
    const sorted = [...this.attributes].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    const name = sorted.find(attribute => attribute.isSystem && attribute.name === 'Name');
    this.variables = [
      { token: '{{card.name}}', label: name?.name ?? 'Name', type: 'text', example: exampleText(card.name) },
      ...sorted.filter(attribute => !attribute.isSystem).map(attribute => {
        const field = StringUtils.toKebabCase(attribute.name);
        const options = attribute.type === 'dropdown' ? optionValues(attribute.options) : [];
        return {
          token: `{{card.${field}}}`,
          label: attribute.name,
          type: String(attribute.type),
          options: options.length > 0 ? options : undefined,
          example: exampleText(card[field]),
        } as TemplateVariable;
      }),
    ];
    const first = this.variables[1]?.token.slice(2, -2) ?? 'card.name';
    const choice = this.variables.find(variable => variable.options)?.token.slice(2, -2) ?? first;
    const option = this.variables.find(variable => variable.options)?.options?.[0] ?? 'valeur';
    this.blocks = [
      { key: 'if', snippet: `{{#if \${1:${first}}}}\n\t$0\n{{/if}}`, preview: `{{#if ${first}}}…{{/if}}` },
      { key: 'if-else', snippet: `{{#if \${1:${first}}}}\n\t$2\n{{else}}\n\t$0\n{{/if}}`, preview: `{{#if ${first}}}…{{else}}…{{/if}}` },
      { key: 'equals', snippet: `{{#if (eq \${1:${choice}} "\${2:${this.literal(option)}}")}}\n\t$0\n{{/if}}`, preview: `{{#if (eq ${choice} "${option}")}}…{{/if}}` },
      { key: 'repeat', snippet: `{{#repeat \${1:${first}}}}$0{{/repeat}}`, preview: `{{#repeat ${first}}}★{{/repeat}}` },
      { key: 'image-from-field', snippet: `<img src="{{index assets \${1:${first}}}}" alt="">`, preview: `{{index assets ${first}}}` },
      { key: 'text-with-icons', snippet: `{{compile \${1:${first}}}}`, preview: `{{compile ${first}}}` },
    ];
    this.updateCompletionContext();
  }

  /** Gives the editors' autocompletion the deck's attributes, the images and the helpers' help */
  private updateCompletionContext() {
    const helperDocs = this.translate.instant('template-editor.helpers');
    MonacoLanguages.completionContext = {
      variables: this.variables.map(variable => ({
        path: variable.token.slice(2, -2),
        label: variable.label,
        detail: variable.type,
        documentation: [variable.options?.length ? variable.options.join(', ') : '', variable.example ? `${this.translate.instant('template-editor.example')} ${variable.example}` : '']
          .filter(Boolean).join('\n') || undefined,
      })),
      assets: this.assetEntries.map(asset => ({ path: `assets.${asset.path}`, label: asset.label })),
      helperDocs: helperDocs && typeof helperDocs === 'object' ? helperDocs : {},
    };
  }

  /*********************************************************************
   * Edit with a chatbot
   *********************************************************************/

  public promptAssets(): string[] {
    return this.assetEntries.map(asset => this.assetToken(asset.path));
  }

  public promptHelpers(): string[] {
    const helpers = this.translate.instant('template-editor.chatbot.prompt.helpers');
    return Array.isArray(helpers) ? helpers : [];
  }

  /** Replaces the code with the chatbot's version; Ctrl+Z in the editor brings back the previous one */
  public applyChatbotAnswer(answer: ChatbotAnswer) {
    for (const kind of this.editorKinds) {
      const code = answer[kind];
      if (code === undefined) {
        continue;
      }
      const editor = this.editors[kind];
      const model = editor?.getModel();
      if (model) {
        editor.pushUndoStop();
        editor.executeEdits('chatbot', [{ range: model.getFullModelRange(), text: code }]);
        editor.pushUndoStop();
      } else {
        this.selectedTemplate[kind] = code;
      }
    }
    this.debounceSave();
    this.messageService.add({
      severity: 'success', life: 5000,
      summary: this.translate.instant('template-editor.chatbot.applied'),
      detail: this.translate.instant('template-editor.chatbot.applied-detail'),
    });
  }

  
  public save(entity : CardTemplate) {
    const id = (this.selectedTemplate as any)[this.service?.getIdField()];
    if (id) {
      this.updateExisting(id, this.selectedTemplate);
    }
  }

  public updateExisting(id: number, entity: CardTemplate) {
    this.service?.update(id, entity, true).then(result => {}).catch(error => {});
  }

  public openCreateNew() {
    this.editTemplate = {
      name: '',
      description: '',
      css: CardTemplatesComponent.DEFAULT_CSS,
      html: CardTemplatesComponent.DEFAULT_HTML
    } as CardTemplate;
    this.dialogVisible = true;
  }

  public openCssInfo() {
    this.infoVisible = true;
    this.infoText = "CSS Guide";
  }

  public openHtmlInfo() {
    this.infoVisible = true;
    this.infoText = "HTML/Handlebars Guide"
      + "\n\ncard attributes: {{card.name}}"
      + "\ntimes helper: {{#times card.strength}}o{{/times}}";
  }

  public openEditDialog(entity : CardTemplate) {
    this.editTemplate = entity;
    this.dialogVisible = true;
  }

  public openDeleteDialog(entity : CardTemplate) {
    this.confirmationService.confirm({
      message: 'Are you sure you want to delete?',
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.service?.delete((entity as any)[this.service?.getIdField()]).then(deleted => {
          this.updateTemplatesList();
          this.messageService.add({severity:'success', summary: 'Successful', detail: 'Entity Deleted', life: 3000});
        });
      }
    });
  }

  public onResizeStart(event: any) {
    this.disablePanels = true;
  }

  public onResizeEnd(event: any) {
    this.disablePanels = false;
    this.previewPanelWidth = event.sizes[0];
    setTimeout(() => this.centerPreview(), 100);
  }

}
