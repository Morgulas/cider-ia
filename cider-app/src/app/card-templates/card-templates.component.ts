import { Component, OnInit, HostListener, ViewChild, ElementRef, AfterViewInit, OnDestroy, DestroyRef, NgZone, inject } from '@angular/core';
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
import { annotateLines, CssVariable, findCssVariables, formatColorLike, formatCss, LINE_ATTRIBUTE, OverflowCandidate, pickOverflowCards, sliderRange } from './template-tools';
import { CurrentProjectService } from '../server/current-project.service';

type ViewMode = 'card' | 'pair' | 'overflow';
type Side = 'front' | 'back';
/** classes put on preview elements (global styles: they live inside the card's HTML) */
const OVERFLOW_CLASS = 'cider-overflow';
const HOVER_CLASS = 'cider-inspect-hover';
const SELECTED_CLASS = 'cider-inspect-selected';
/** the layout of a card changes as its images and fonts load: checked a few times */
const OVERFLOW_SCAN_DELAYS_MS = [400, 1500, 3500];

/** Elements of a rendered card whose text does not fit: innermost ones only */
function findOverflowing(root: Element): HTMLElement[] {
  const view = root.ownerDocument.defaultView ?? window;
  const flagged: HTMLElement[] = [];
  root.querySelectorAll('*').forEach(node => {
    const element = node as HTMLElement;
    if (['STYLE', 'SCRIPT', 'IMG', 'svg', 'BR'].includes(element.tagName) || element.closest('svg')) {
      return;
    }
    if (element.clientHeight === 0 || element.clientWidth === 0 || !element.textContent?.trim()) {
      return;
    }
    const style = view.getComputedStyle(element);
    if (['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflowX)) {
      return;
    }
    if (element.scrollHeight - element.clientHeight > 2 || element.scrollWidth - element.clientWidth > 2) {
      flagged.push(element);
    }
  });
  return flagged.filter(element => !flagged.some(other => other !== element && element.contains(other)));
}

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
  @ViewChild('previewContent') previewContent?: ElementRef<HTMLElement>;
  @ViewChild('popoutHost') set popoutHost(host: ElementRef<HTMLElement> | undefined) {
    if (host) {
      // after the preview measured itself in this page, it moves to the window
      setTimeout(() => this.movePopoutContent(host.nativeElement), 300);
    }
  }
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
  private readonly zone = inject(NgZone);
  private readonly currentProject = inject(CurrentProjectService);

  viewMode: ViewMode = 'card';
  /** front and back templates of the preview card, when this template is one of them */
  pair: Record<Side, CardTemplate> | null = null;
  readonly pairSides: Side[] = ['front', 'back'];
  /** previewTemplate with the source line of each tag (inspector) */
  inspectTemplate: CardTemplate = {} as CardTemplate;
  inspecting = false;
  hovered: { label: string; line: number } | null = null;
  private hoveredElement: HTMLElement | null = null;
  overflowCandidates: OverflowCandidate<Card>[] = [];
  overflowResults = new Map<number, number>();
  overflowScanned = false;
  private overflowTimers: ReturnType<typeof setTimeout>[] = [];
  sideTab: 'insert' | 'settings' = 'insert';
  cssVariables: CssVariable[] = [];
  chatbotRequest = '';
  popoutOpen = false;
  popoutScale = 0.5;
  private popup: Window | null = null;
  private colorContext: CanvasRenderingContext2D | null = null;
  private static cssFormatterRegistered = false;


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
            this.inspectTemplate = { ...template, html: annotateLines(template.html) };
            this.restorePreviewCard();
            this.runCheck();
            this.updatePair();
            this.updateOverflowCandidates();
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
      this.updatePair();
      this.updateOverflowCandidates();
    });
    this.templateChanges.asObservable().pipe(debounceTime(1000))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.save(this.selectedTemplate));

    this.layout = localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'tabs';
    this.insertPanelVisible = localStorage.getItem(INSERT_PANEL_KEY) !== 'hidden';
    this.checks.pipe(debounceTime(CHECK_DELAY_MS), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.runCheck());
    this.cardAttributesService.getAll().then(attributes => {
      this.attributes = attributes;
      this.updateVariables();
      this.updateOverflowCandidates();
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
    setTimeout(() => this.fitZoom(), 700);

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
    this.overflowTimers.forEach(timer => clearTimeout(timer));
    this.closePopout();
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
    // the inspector uses the left button: middle button still pans
    if (this.inspecting && event.button === 0) return;
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
    this.updatePair();
    this.updateOverflowCandidates();
    this.scheduleOverflowScan();
  }

  /** The card last shown with this template */
  private restorePreviewCard() {
    if (!this.selectedTemplate?.id || this.cards.length === 0) {
      return;
    }
    const templateId = this.selectedTemplate.id;
    const saved = Number(localStorage.getItem(PREVIEW_CARD_KEY + templateId));
    // the card last shown with this template, otherwise the first card that uses it
    const card = this.cards.find(candidate => candidate.id === saved)
      ?? this.cards.find(candidate => candidate.frontCardTemplateId === templateId || candidate.backCardTemplateId === templateId);
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
    this.cssVariables = findCssVariables(this.selectedTemplate.css ?? '');
    if (!this.hasIssue() && (this.previewTemplate.html !== this.selectedTemplate.html
      || this.previewTemplate.css !== this.selectedTemplate.css || this.previewTemplate.id !== this.selectedTemplate.id)) {
      this.previewTemplate = { ...this.selectedTemplate };
      this.inspectTemplate = { ...this.selectedTemplate, html: annotateLines(this.selectedTemplate.html) };
      this.templateVersion++;
      this.scheduleOverflowScan();
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monaco = (window as any).monaco;
    if (monaco) {
      CardTemplatesComponent.registerCssFormatter(monaco);
      editor.addAction({
        id: 'cider.save-now',
        label: this.translate.instant('template-editor.save-now'),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => this.zone.run(() => this.saveNow()),
      });
    }
    if (kind === 'html') {
      // inspector: the element of the line under the cursor is outlined in the preview
      editor.onDidChangeCursorPosition((event: { position: { lineNumber: number } }) => {
        if (this.inspecting) {
          this.highlightLine(event.position.lineNumber);
        }
      });
    }
    this.updateMarkers();
  }

  /** CSS formatting for the CSS + Handlebars language (Shift+Alt+F, context menu) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static registerCssFormatter(monaco: any) {
    if (CardTemplatesComponent.cssFormatterRegistered) {
      return;
    }
    CardTemplatesComponent.cssFormatterRegistered = true;
    monaco.languages.registerDocumentFormattingEditProvider('css-handlebars', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideDocumentFormattingEdits: (model: any) => [{ range: model.getFullModelRange(), text: formatCss(model.getValue()) }],
    });
  }

  /** Re-indents the code of the visible editor */
  public formatCode() {
    const editor = this.editors[this.targetKind()];
    editor?.getAction('editor.action.formatDocument')?.run();
  }

  /** Ctrl+S: saves the template and sends the project to the server now */
  public async saveNow() {
    if (!this.selectedTemplate?.id) {
      return;
    }
    await this.service.update(this.selectedTemplate.id, this.selectedTemplate, true);
    await this.currentProject.flush();
    this.messageService.add({ severity: 'success', life: 2000, summary: this.translate.instant('template-editor.saved') });
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.defaultPrevented) {
      event.preventDefault();
      void this.saveNow();
    }
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
   * Views: card, front and back, overflow test
   *********************************************************************/

  public setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    this.clearInspectorMarks();
    if (mode === 'overflow') {
      this.updateOverflowCandidates();
    }
    this.overflowResults = new Map();
    this.overflowScanned = false;
    this.scheduleOverflowScan();
    setTimeout(() => this.fitZoom(), 400);
  }

  /** Front and back of the preview card, when this template is one of them */
  private async updatePair() {
    const card = this.selectedCard;
    const template = this.selectedTemplate;
    let pair: Record<Side, CardTemplate> | null = null;
    if (card?.id !== undefined && template?.id) {
      const isFront = card.frontCardTemplateId === template.id;
      const isBack = card.backCardTemplateId === template.id;
      const otherId = isFront ? card.backCardTemplateId : isBack ? card.frontCardTemplateId : undefined;
      if (otherId && otherId !== template.id) {
        const other = this.templates.find(candidate => candidate.id === otherId)
          ?? await this.service.get(otherId).catch(() => undefined);
        if (other) {
          pair = isFront ? { front: template, back: other } : { front: other, back: template };
        }
      }
    }
    this.pair = pair;
    if (!pair && this.viewMode === 'pair') {
      this.setViewMode('card');
    }
  }

  public pairColumns(): number {
    return this.viewMode === 'pair' ? 2 : this.viewMode === 'overflow' ? Math.min(3, Math.max(1, this.overflowCandidates.length)) : 1;
  }

  /** The cards of the deck most likely to overflow with this template */
  private updateOverflowCandidates() {
    const template = this.selectedTemplate;
    if (!template?.id) {
      return;
    }
    const using = this.cards.filter(card => card.frontCardTemplateId === template.id || card.backCardTemplateId === template.id);
    const textFields = [...this.attributes]
      .filter(attribute => !attribute.isSystem && String(attribute.type) === 'text')
      .map(attribute => ({ key: StringUtils.toKebabCase(attribute.name), label: attribute.name }));
    const fields = [{ key: 'name', label: this.variables[0]?.label ?? 'Name' }, ...textFields];
    this.overflowCandidates = pickOverflowCards(using.length > 0 ? using : this.cards, fields,
      this.selectedCard?.id !== undefined ? this.selectedCard : undefined);
  }

  public reasonsText(candidate: OverflowCandidate<Card>): string {
    return candidate.reasons
      .map(reason => this.translate.instant('template-editor.reason.' + reason.kind, { field: reason.field }))
      .join(' · ');
  }

  /** Cards whose text overflows, among those shown */
  public overflowCount(): number {
    let count = 0;
    this.overflowResults.forEach(found => count += found > 0 ? 1 : 0);
    return count;
  }

  private scheduleOverflowScan() {
    this.overflowTimers.forEach(timer => clearTimeout(timer));
    this.overflowTimers = OVERFLOW_SCAN_DELAYS_MS.map(delay => setTimeout(() => this.scanOverflows(), delay));
  }

  /** Looks for text that does not fit in the cards shown; outlined in the overflow view */
  private scanOverflows() {
    const root = this.previewContent?.nativeElement;
    if (!root) {
      return;
    }
    const results = new Map<number, number>();
    root.querySelectorAll('[data-preview-card]').forEach(item => {
      const cardElement = item.querySelector('.card-element');
      if (!cardElement) {
        return;
      }
      cardElement.querySelectorAll('.' + OVERFLOW_CLASS).forEach(element => element.classList.remove(OVERFLOW_CLASS));
      const overflowing = findOverflowing(cardElement);
      if (this.viewMode === 'overflow') {
        overflowing.forEach(element => element.classList.add(OVERFLOW_CLASS));
      }
      const id = Number(item.getAttribute('data-preview-card'));
      results.set(id, Math.max(results.get(id) ?? 0, overflowing.length));
    });
    this.overflowResults = results;
    this.overflowScanned = true;
  }

  /** Zoom that shows the whole preview (one card, front and back, or the overflow test) */
  public fitZoom() {
    const space = this.previewSpace?.nativeElement as HTMLElement | undefined;
    const content = this.previewContent?.nativeElement;
    if (!space || !content || !content.offsetWidth || !content.offsetHeight) {
      return;
    }
    this.zoom = Math.min(space.clientWidth / content.offsetWidth, space.clientHeight / content.offsetHeight) * 0.92;
    this.clampZoom();
    setTimeout(() => this.centerPreview(), 50);
  }

  /*********************************************************************
   * Inspector: preview element <-> HTML line
   *********************************************************************/

  public toggleInspector() {
    this.inspecting = !this.inspecting;
    if (!this.inspecting) {
      this.clearInspectorMarks();
    }
  }

  private clearInspectorMarks() {
    this.hoveredElement?.classList.remove(HOVER_CLASS);
    this.hoveredElement = null;
    this.hovered = null;
    this.previewContent?.nativeElement.querySelectorAll('.' + SELECTED_CLASS)
      .forEach(element => element.classList.remove(SELECTED_CLASS));
  }

  private inspectedElement(event: MouseEvent): HTMLElement | null {
    const target = event.target as HTMLElement | null;
    const element = target?.closest?.(`[${LINE_ATTRIBUTE}]`) as HTMLElement | null;
    return element && this.previewContent?.nativeElement.contains(element) ? element : null;
  }

  public onInspectMove(event: MouseEvent) {
    if (!this.inspecting) {
      return;
    }
    const element = this.inspectedElement(event);
    if (element === this.hoveredElement) {
      return;
    }
    this.hoveredElement?.classList.remove(HOVER_CLASS);
    this.hoveredElement = element;
    if (!element) {
      this.hovered = null;
      return;
    }
    element.classList.add(HOVER_CLASS);
    const classes = Array.from(element.classList).filter(name => !name.startsWith('cider-')).slice(0, 2);
    this.hovered = {
      label: element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + classes.map(name => '.' + name).join(''),
      line: Number(element.getAttribute(LINE_ATTRIBUTE)),
    };
  }

  public onInspectClick(event: MouseEvent) {
    if (!this.inspecting) {
      return;
    }
    const element = this.inspectedElement(event);
    if (!element) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.goToTag(Number(element.getAttribute(LINE_ATTRIBUTE)), element.tagName.toLowerCase());
  }

  /** Shows a line of the HTML, the tag selected */
  private goToTag(line: number, tag: string) {
    if (this.layout === 'tabs') {
      this.activeTab = 'html';
    }
    this.lastFocused = 'html';
    setTimeout(() => {
      const editor = this.editors.html;
      const model = editor?.getModel();
      if (!model || line < 1 || line > model.getLineCount()) {
        return;
      }
      const index = model.getLineContent(line).toLowerCase().indexOf('<' + tag);
      const column = index >= 0 ? index + 2 : 1;
      editor.setSelection({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + (index >= 0 ? tag.length : 0) });
      editor.revealLineInCenter(line);
      editor.focus();
    });
  }

  /** Outlines in the preview the element written on (or opened before) this line */
  private highlightLine(line: number) {
    const root = this.previewContent?.nativeElement;
    if (!root) {
      return;
    }
    root.querySelectorAll('.' + SELECTED_CLASS).forEach(element => element.classList.remove(SELECTED_CLASS));
    const elements = Array.from(root.querySelectorAll<HTMLElement>(`[${LINE_ATTRIBUTE}]`));
    const best = elements.reduce((found, element) => {
      const elementLine = Number(element.getAttribute(LINE_ATTRIBUTE));
      return elementLine <= line && elementLine > found ? elementLine : found;
    }, 0);
    elements.filter(element => Number(element.getAttribute(LINE_ATTRIBUTE)) === best)
      .forEach(element => element.classList.add(SELECTED_CLASS));
  }

  /*********************************************************************
   * Visual settings: CSS variables
   *********************************************************************/

  public range(variable: CssVariable) {
    return sliderRange(variable);
  }

  /** "--couleur-titre" → "Couleur titre" */
  public variableLabel(name: string): string {
    const words = name.replace(/^--/, '').replace(/[-_]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /** Any CSS color as #rrggbb, for the color picker */
  public colorHex(value: string): string {
    this.colorContext ??= document.createElement('canvas').getContext('2d');
    const context = this.colorContext;
    if (!context) {
      return '#000000';
    }
    context.fillStyle = '#000000';
    context.fillStyle = value;
    const color = String(context.fillStyle);
    if (color.startsWith('#')) {
      return color;
    }
    const parts = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color);
    return parts ? '#' + parts.slice(1, 4).map(part => Math.round(Number(part)).toString(16).padStart(2, '0')).join('') : '#000000';
  }

  public setColor(variable: CssVariable, hex: string) {
    this.setVariable(variable.name, formatColorLike(variable.value, hex));
  }

  /** Changes a variable in the CSS editor (one undo step per change, or per slider drag) */
  public setVariable(name: string, value: string, commit = false) {
    const editor = this.editors.css;
    const model = editor?.getModel();
    const variable = findCssVariables(model ? model.getValue() : this.selectedTemplate.css ?? '').find(v => v.name === name);
    if (!variable || variable.value === value.trim() || !value.trim()) {
      return;
    }
    if (model) {
      const start = model.getPositionAt(variable.start);
      const end = model.getPositionAt(variable.end);
      editor.executeEdits('cider-settings', [{
        range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
        text: value.trim(),
      }]);
      if (commit) {
        editor.pushUndoStop();
      }
    } else {
      const css = this.selectedTemplate.css ?? '';
      this.selectedTemplate.css = css.slice(0, variable.start) + value.trim() + css.slice(variable.end);
      this.debounceSave();
    }
    // immediate preview while dragging
    this.runCheck();
  }

  public endVariableEdit() {
    this.editors.css?.pushUndoStop();
  }

  public askChatbotForVariables() {
    this.chatbotRequest = this.translate.instant('template-editor.settings-chatbot-request');
    this.chatbotVisible = true;
  }

  /*********************************************************************
   * Preview in a separate window (second screen)
   *********************************************************************/

  public openPopout() {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return;
    }
    const popup = window.open('', 'cider-template-preview', 'width=560,height=780');
    if (!popup) {
      this.messageService.add({ severity: 'warn', life: 5000, summary: this.translate.instant('template-editor.popout-blocked') });
      return;
    }
    this.popup = popup;
    const doc = popup.document;
    doc.title = this.translate.instant('template-editor.popout-title', { name: this.selectedTemplate.name ?? '' });
    doc.head.replaceChildren();
    doc.body.replaceChildren();
    // same styles as the application (theme, card preview component)
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => doc.head.appendChild(node.cloneNode(true)));
    doc.documentElement.className = document.documentElement.className;
    Object.assign(doc.body.style, {
      margin: '0', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: getComputedStyle(document.body).backgroundColor || '#18181b',
    });
    popup.addEventListener('resize', () => this.zone.run(() => this.updatePopoutScale()));
    popup.addEventListener('pagehide', () => this.zone.run(() => this.closePopout(false)));
    this.popoutOpen = true;
  }

  private movePopoutContent(host: HTMLElement) {
    const content = host.querySelector('.popout-content');
    if (!content || !this.popup || this.popup.closed) {
      return;
    }
    this.popup.document.body.appendChild(content);
    this.updatePopoutScale();
  }

  private updatePopoutScale() {
    if (!this.popup || this.popup.closed) {
      return;
    }
    const card = this.previewContent?.nativeElement.querySelector('.card-element')?.firstElementChild as HTMLElement | null;
    const width = card?.offsetWidth || 825;
    const height = card?.offsetHeight || 1125;
    this.popoutScale = parseFloat((Math.min(this.popup.innerWidth / width, this.popup.innerHeight / height) * 0.95).toFixed(3));
  }

  public closePopout(closeWindow = true) {
    const popup = this.popup;
    this.popup = null;
    this.popoutOpen = false;
    if (closeWindow && popup && !popup.closed) {
      popup.close();
    }
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
