import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Tooltip } from 'primeng/tooltip';
import { FormsModule } from '@angular/forms';
import { GILDING_EFFECTS, PIECE_CLASS } from '../card-preview/foil-zones';
import { FOIL_EFFECTS } from '../card-binder/foil';
import { CardToHtmlPipe } from '../shared/pipes/template-to-html.pipe';
import { AssetsService } from '../data-services/services/assets.service';
import { Card } from '../data-services/types/card.type';
import { CardTemplate } from '../data-services/types/card-template.type';
import {
  AbsentTag, absentTags, analyzeCard, compareSnapshots, createVariableEdits, CssDuplicate, ElementGeometry, elementGeometry,
  findCssDuplicates, findSourceTag, FixedGeometry, GEOMETRY_EDGES, GeometryBinding, HIDDEN_ATTRIBUTE, HOVER_CLASS, LayerAnalysis,
  LayerIssue, LayerNode, layerElements, newVariableName, PaintEntry, paintTopFirst, SELECTED_CLASS, snapshotCard, SOLO_ATTRIBUTE,
  SOLO_MODE_ATTRIBUTE, TextEdit, VariantDiff,
} from './template-layers';
import { annotateLines } from './template-tools';

/** A card value with a list of choices: each choice is a variant of the template */
export interface VariantField {
  /** card field (card.<key>) */
  key: string;
  label: string;
  values: string[];
}

/** The preview card shown with another value (the card itself is not changed) */
export interface PreviewOverride {
  key: string;
  label: string;
  value: string;
}

/** Attributes to change on a tag of the HTML code */
export interface TagEdit {
  line: number;
  tag: string;
  index: number;
  changes: Record<string, string | null>;
}

interface VariantRow {
  value: string;
  /** the value of the card itself */
  current: boolean;
  diff: VariantDiff;
}

interface FoilDraft {
  key: string;
  line: number;
  tag: string;
  index: number;
  /** value written in the code holds {{handlebars}}: edited as text */
  raw: boolean;
  value: string;
  /** 0 to 100 */
  force: number;
}

/** A new value for one declaration of a variable (dragged in the preview, or typed) */
export interface VariableChange {
  name: string;
  /** which declaration of the variable, in code order */
  index: number;
  value: string;
  /** end of the change: one undo step */
  commit: boolean;
}

/** class of the handles and grid drawn over the preview (not part of the card) */
export const GEOMETRY_CLASS = 'cider-geometry';

/** Effects of data-foil: reflections, then gildings (the metal replaces the ink) */
export const FOIL_CHOICES: string[] = [...FOIL_EFFECTS,
  ...GILDING_EFFECTS.flatMap(metal => [`dorure-${metal}`, `dorure-${metal}-mat`])];

/** delay before the panel reads the preview again after it changed (it changes in bursts: images, fonts, foils) */
const REFRESH_DELAY_MS = 200;

/**
 * Layers panel of the template editor: the elements of the rendered card,
 * their real painting order and what looks wrong in them. It only reads the
 * preview and the code; hiding or isolating a layer only changes the preview.
 */
@Component({
  selector: 'app-template-layers-panel',
  templateUrl: './template-layers-panel.component.html',
  styleUrls: ['./template-layers-panel.component.scss'],
  imports: [NgTemplateOutlet, TranslatePipe, Tooltip, FormsModule],
})
export class TemplateLayersPanelComponent implements OnInit, OnChanges, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cardToHtml = inject(CardToHtmlPipe);
  private readonly assets = inject(AssetsService);

  /** template source, for the tags this card does not render and the CSS written twice */
  @Input() html = '';
  @Input() css = '';
  /** anything that changes what the preview shows (template version, card, view, separate window) */
  @Input() renderKey: unknown;
  /** where the previews are (this page, the separate window) */
  @Input() roots: () => HTMLElement[] = () => [];
  /** the preview card as it is (without the variant shown) */
  @Input() card: Card | null = null;
  /** card values with choices (rarity, foil...) */
  @Input() variantFields: VariantField[] = [];
  @Input() override: PreviewOverride | null = null;
  @Output() overrideChange = new EventEmitter<PreviewOverride | null>();
  @Output() goToTag = new EventEmitter<{ line: number; tag: string }>();
  @Output() goToCss = new EventEmitter<number>();
  @Output() editTag = new EventEmitter<TagEdit>();
  @Output() variableChange = new EventEmitter<VariableChange>();
  @Output() cssEdits = new EventEmitter<TextEdit[]>();

  view: 'tree' | 'paint' | 'variants' = 'tree';
  variantKey = '';
  variants: VariantRow[] = [];
  openVariant: string | null = null;
  foilDraft: FoilDraft | null = null;
  readonly foilChoices = FOIL_CHOICES;
  /** position and size of the selected layer */
  geometry: ElementGeometry | null = null;
  showGrid = false;
  /** a fixed length could not become a variable: no CSS rule styles the card root */
  noRootRule = false;
  private dragging = false;
  private variantTimer: ReturnType<typeof setTimeout> | undefined;
  private static renders = 0;
  analysis: LayerAnalysis | null = null;
  /** painting order from the top (painted last) to the bottom */
  paintTopFirst: PaintEntry[] = [];
  absent: AbsentTag[] = [];
  duplicates: CssDuplicate[] = [];
  collapsed = new Set<string>();
  hidden = new Set<string>();
  solo: string | null = null;
  selected: string | null = null;
  hovered: string | null = null;

  private observer?: MutationObserver;
  private observed: HTMLElement[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    this.schedule(0);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['css']) {
      this.duplicates = findCssDuplicates(this.css ?? '');
    }
    if (changes['html'] || changes['renderKey']) {
      this.schedule();
    }
    if (changes['variantFields'] && !this.variantFields.some(field => field.key === this.variantKey)) {
      // a field the template reads (card.<key>), else the first one
      const code = `${this.html ?? ''}\n${this.css ?? ''}`;
      const used = this.variantFields.find(field => new RegExp(`card\\.${field.key.replace(/[-]/g, '\\-')}(?![\\w-])`).test(code));
      this.variantKey = this.override?.key ?? used?.key ?? this.variantFields[0]?.key ?? '';
    }
    if (changes['html'] || changes['css'] || changes['card'] || changes['variantFields']) {
      this.scheduleVariants();
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    clearTimeout(this.variantTimer);
    this.observer?.disconnect();
    // the preview goes back to normal
    this.hidden.clear();
    this.solo = null;
    this.geometry = null;
    this.showGrid = false;
    this.cards().forEach(card => {
      this.applyVisibility(card);
      card.querySelectorAll('.' + HOVER_CLASS).forEach(element => element.classList.remove(HOVER_CLASS));
    });
    this.drawOverlay();
  }

  /*********************************************************************
   * Reading the preview
   *********************************************************************/

  /** The rendered cards of the edited template (front and back view: only its side) */
  private cards(): HTMLElement[] {
    const roots = this.roots();
    const edited = roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>('[data-preview-edited] .card-element')));
    return edited.length ? edited : roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>('.card-element')));
  }

  private schedule(delay = REFRESH_DELAY_MS): void {
    clearTimeout(this.timer);
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => this.zone.run(() => this.refresh()), delay);
    });
  }

  public refresh(): void {
    this.observe();
    const cards = this.cards();
    const card = cards[0];
    if (!card || !card.firstElementChild) {
      this.geometry = null;
      this.drawOverlay();
      this.analysis = null;
      this.paintTopFirst = [];
      this.absent = [];
      this.changeDetector.markForCheck();
      return;
    }
    this.analysis = analyzeCard(card);
    this.paintTopFirst = paintTopFirst(this.analysis.paint);
    this.absent = absentTags(this.html ?? '', this.analysis.nodes);
    // layers of another render that no longer exist
    const keys = new Set(this.analysis.nodes.map(node => node.key));
    this.hidden.forEach(key => !keys.has(key) && this.hidden.delete(key));
    if (this.solo && !keys.has(this.solo)) {
      this.solo = null;
    }
    cards.forEach(element => {
      this.applyVisibility(element);
      this.applySelection(element);
    });
    this.updateGeometry();
    this.changeDetector.markForCheck();
  }

  /** Reads the preview again when it is rendered again (template, card, images...) */
  private observe(): void {
    const roots = this.roots();
    if (roots.length === this.observed.length && roots.every((root, i) => root === this.observed[i])) {
      return;
    }
    this.observer?.disconnect();
    this.observed = roots;
    this.zone.runOutsideAngular(() => {
      this.observer = new MutationObserver(records => {
        const ours = (node: Node) => node instanceof Element && (node.classList.contains(PIECE_CLASS) || node.classList.contains(GEOMETRY_CLASS));
        const onlyPieces = records.every(record => record.target instanceof Element && record.target.closest(`.${PIECE_CLASS}, .${GEOMETRY_CLASS}`)
          || [...record.addedNodes, ...record.removedNodes].every(ours));
        if (onlyPieces) {
          // foil reflections drawn again: they take the visibility of their element
          if (this.hidden.size || this.solo) {
            this.cards().forEach(card => this.applyVisibility(card));
          }
        } else {
          this.schedule();
        }
      });
      roots.forEach(root => this.observer!.observe(root, { childList: true, subtree: true }));
    });
  }

  /*********************************************************************
   * Hide, show alone, select
   *********************************************************************/

  /** Marks an element and the foil pieces drawn right after it */
  private mark(element: HTMLElement, attribute: string): void {
    const set = (target: Element) => target.getAttribute(attribute) === null && target.setAttribute(attribute, '');
    set(element);
    for (let next = element.nextElementSibling; next?.classList.contains(PIECE_CLASS); next = next.nextElementSibling) {
      set(next);
    }
  }

  private applyVisibility(card: HTMLElement): void {
    const elements = layerElements(card);
    const wanted = new Set<Element>();
    const wantedSolo = new Set<Element>();
    const collect = (key: string, into: Set<Element>) => {
      const element = elements.get(key);
      if (!element) {
        return;
      }
      into.add(element);
      for (let next = element.nextElementSibling; next?.classList.contains(PIECE_CLASS); next = next.nextElementSibling) {
        into.add(next);
      }
    };
    this.hidden.forEach(key => collect(key, wanted));
    if (this.solo) {
      collect(this.solo, wantedSolo);
    }
    // attributes only (never classes: the foil reflections are drawn again when classes change)
    card.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`).forEach(element => !wanted.has(element) && element.removeAttribute(HIDDEN_ATTRIBUTE));
    card.querySelectorAll(`[${SOLO_ATTRIBUTE}]`).forEach(element => !wantedSolo.has(element) && element.removeAttribute(SOLO_ATTRIBUTE));
    wanted.forEach(element => this.mark(element as HTMLElement, HIDDEN_ATTRIBUTE));
    wantedSolo.forEach(element => this.mark(element as HTMLElement, SOLO_ATTRIBUTE));
    if (this.solo && card.getAttribute(SOLO_MODE_ATTRIBUTE) === null) {
      card.setAttribute(SOLO_MODE_ATTRIBUTE, '');
    } else if (!this.solo && card.getAttribute(SOLO_MODE_ATTRIBUTE) !== null) {
      card.removeAttribute(SOLO_MODE_ATTRIBUTE);
    }
  }

  private applySelection(card: HTMLElement): void {
    if (!this.selected) {
      return;
    }
    const element = layerElements(card).get(this.selected);
    if (element && !element.classList.contains(SELECTED_CLASS)) {
      element.classList.add(SELECTED_CLASS);
    }
  }

  public toggleHidden(node: LayerNode, event: Event): void {
    event.stopPropagation();
    if (this.hidden.has(node.key)) {
      this.hidden.delete(node.key);
    } else {
      this.hidden.add(node.key);
    }
    this.cards().forEach(card => this.applyVisibility(card));
  }

  public toggleSolo(node: LayerNode, event: Event): void {
    event.stopPropagation();
    this.solo = this.solo === node.key ? null : node.key;
    this.cards().forEach(card => this.applyVisibility(card));
  }

  public showAll(): void {
    this.hidden.clear();
    this.solo = null;
    this.cards().forEach(card => this.applyVisibility(card));
  }

  public toggleCollapsed(node: LayerNode, event: Event): void {
    event.stopPropagation();
    if (this.collapsed.has(node.key)) {
      this.collapsed.delete(node.key);
    } else {
      this.collapsed.add(node.key);
    }
  }

  public select(node: LayerNode): void {
    this.selected = node.key;
    this.cards().forEach(card => {
      card.querySelectorAll('.' + SELECTED_CLASS).forEach(element => element.classList.remove(SELECTED_CLASS));
      this.applySelection(card);
    });
    this.updateGeometry();
    if (node.line) {
      this.goToTag.emit({ line: node.line, tag: node.tag });
    }
  }

  public hover(node: LayerNode | null): void {
    const key = node?.key ?? null;
    if (key === this.hovered) {
      return;
    }
    this.hovered = key;
    this.cards().forEach(card => {
      card.querySelectorAll('.' + HOVER_CLASS).forEach(element => element.classList.remove(HOVER_CLASS));
      if (key) {
        layerElements(card).get(key)?.classList.add(HOVER_CLASS);
      }
    });
  }

  /** Shows in the panel an element clicked in the preview (inspector) */
  public reveal(element: HTMLElement): void {
    const card = element.closest<HTMLElement>('.card-element');
    if (!card) {
      return;
    }
    const key = [...layerElements(card)].find(([, candidate]) => candidate === element)?.[0];
    if (!key) {
      return;
    }
    this.selected = key;
    // its parents unfolded
    const path = (nodes: LayerNode[]): LayerNode[] | null => {
      for (const node of nodes) {
        if (node.key === key) {
          return [node];
        }
        const below = path(node.children);
        if (below) {
          return [node, ...below];
        }
      }
      return null;
    };
    path(this.analysis?.roots ?? [])?.forEach(node => this.collapsed.delete(node.key));
    this.updateGeometry();
    this.changeDetector.detectChanges();
    this.host.nativeElement.querySelector(`[data-layer-key="${key}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /*********************************************************************
   * Variants: the card with each value of a field, compared with itself
   *********************************************************************/

  public setView(view: 'tree' | 'paint' | 'variants'): void {
    this.view = view;
    if (view === 'variants') {
      this.scheduleVariants(0);
    }
  }

  public selectVariantField(key: string): void {
    this.variantKey = key;
    this.openVariant = null;
    this.scheduleVariants(0);
  }

  private scheduleVariants(delay = REFRESH_DELAY_MS): void {
    clearTimeout(this.variantTimer);
    if (this.view !== 'variants') {
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.variantTimer = setTimeout(() => this.zone.run(() => this.computeVariants()), delay);
    });
  }

  /** Renders the template with the card, then with each value of the field, out of sight, and compares */
  public computeVariants(): void {
    const field = this.variantFields.find(candidate => candidate.key === this.variantKey);
    const card = this.card;
    if (!field || !card || !this.html) {
      this.variants = [];
      return;
    }
    const current = String((card as unknown as Record<string, unknown>)[field.key] ?? '');
    const base = this.renderOffscreen(card);
    try {
      const baseSnapshot = snapshotCard(base.card, this.css ?? '');
      const values = field.values.includes(current) ? field.values : [current, ...field.values];
      this.variants = values.map(value => {
        if (value === current) {
          return { value, current: true, diff: compareSnapshots(baseSnapshot, baseSnapshot) };
        }
        const other = this.renderOffscreen({ ...card, [field.key]: value } as Card);
        try {
          return { value, current: false, diff: compareSnapshots(baseSnapshot, snapshotCard(other.card, this.css ?? '')) };
        } finally {
          other.host.remove();
        }
      });
    } finally {
      base.host.remove();
    }
    this.changeDetector.markForCheck();
  }

  /** The template rendered with a card in a hidden element of the page, the way the preview renders it */
  private renderOffscreen(card: Card): { host: HTMLElement; card: HTMLElement } {
    const uuid = `layers-${++TemplateLayersPanelComponent.renders}`;
    const host = document.createElement('div');
    host.className = `card-preview card-${uuid}`;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position: fixed; left: -30000px; top: 0; pointer-events: none;';
    const element = document.createElement('div');
    element.className = 'card-element';
    const template = { html: annotateLines(this.html ?? ''), css: this.css ?? '' } as CardTemplate;
    const html = this.cardToHtml.transform(template, card, this.assets.urlsFor(card.deckId), uuid);
    element.innerHTML = (html as unknown as { changingThisBreaksApplicationSecurity?: string }).changingThisBreaksApplicationSecurity ?? '';
    host.appendChild(element);
    document.body.appendChild(host);
    return { host, card: element };
  }

  public toggleVariantPreview(row: VariantRow, event: Event): void {
    event.stopPropagation();
    const field = this.variantFields.find(candidate => candidate.key === this.variantKey);
    if (!field) {
      return;
    }
    const active = this.override?.key === field.key && this.override.value === row.value;
    this.overrideChange.emit(active || row.current ? null : { key: field.key, label: field.label, value: row.value });
  }

  public isPreviewed(row: VariantRow): boolean {
    return this.override?.key === this.variantKey && this.override.value === row.value;
  }

  public variantSummary(diff: VariantDiff): string {
    if (!diff.size) {
      return this.translate.instant('template-editor.layers.variant.same');
    }
    const parts: string[] = [];
    const add = (count: number, key: string) => count && parts.push(this.translate.instant('template-editor.layers.variant.' + key, { count }));
    add(diff.shown.length, 'shown');
    add(diff.hidden.length, 'hidden');
    add(diff.variables.length, 'variables');
    add(diff.rulesOn.length + diff.rulesOff.length, 'rules');
    add(diff.foils.length, 'foils');
    return parts.join(' · ');
  }

  /*********************************************************************
   * Foil of a layer: data-foil and data-foil-force, written in the code
   *********************************************************************/

  public editFoil(node: LayerNode, event: Event): void {
    event.stopPropagation();
    if (this.foilDraft?.key === node.key) {
      this.foilDraft = null;
      return;
    }
    if (!node.line) {
      return;
    }
    const index = Number(node.key.split(':')[2]) || 0;
    const tag = findSourceTag(this.html ?? '', node.line, node.tag, index);
    const attribute = (name: string) => tag?.attributes.find(candidate => candidate.name === name)?.value ?? '';
    const value = attribute('data-foil');
    const forceText = attribute('data-foil-force').trim();
    const forceNumber = parseFloat(forceText.replace(',', '.'));
    const force = !forceText || !Number.isFinite(forceNumber) ? 100
      : Math.round(forceText.endsWith('%') || forceNumber > 1 ? forceNumber : forceNumber * 100);
    this.foilDraft = { key: node.key, line: node.line, tag: node.tag, index, raw: value.includes('{{'), value, force };
  }

  public applyFoil(remove = false): void {
    const draft = this.foilDraft;
    if (!draft) {
      return;
    }
    const value = remove ? '' : draft.value.trim();
    this.editTag.emit({
      line: draft.line, tag: draft.tag, index: draft.index,
      changes: {
        'data-foil': value || null,
        'data-foil-force': value && draft.force < 100 ? String(Math.max(0, draft.force) / 100) : null,
      },
    });
    this.foilDraft = null;
  }

  /*********************************************************************
   * Position and size: edges driven by CSS variables, dragged in the preview
   *********************************************************************/

  private selectedElement(card = this.cards()[0]): HTMLElement | null {
    return card && this.selected ? layerElements(card).get(this.selected) ?? null : null;
  }

  private updateGeometry(): void {
    this.noRootRule = false;
    const card = this.cards()[0];
    const element = this.selectedElement(card);
    this.geometry = element ? elementGeometry(element, this.css ?? '', card.firstElementChild ?? undefined) : null;
    this.drawOverlay();
  }

  public toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.drawOverlay();
  }

  /** Grid and handles over each preview of the card (in card pixels, whatever the zoom) */
  private drawOverlay(): void {
    if (this.dragging) {
      return;
    }
    for (const card of this.cards()) {
      const host = card.parentElement;
      host?.querySelectorAll(`:scope > .${GEOMETRY_CLASS}`).forEach(element => element.remove());
      const bindings = this.geometry?.bindings ?? [];
      if (!host || (!this.showGrid && !bindings.length)) {
        continue;
      }
      const cardRect = card.getBoundingClientRect();
      const zoom = card.offsetWidth ? cardRect.width / card.offsetWidth : 1;
      const hostRect = host.getBoundingClientRect();
      const overlay = host.ownerDocument.createElement('div');
      overlay.className = GEOMETRY_CLASS + (this.showGrid ? ' grid' : '');
      Object.assign(overlay.style, {
        left: `${(cardRect.left - hostRect.left) / zoom}px`, top: `${(cardRect.top - hostRect.top) / zoom}px`,
        width: `${card.offsetWidth}px`, height: `${card.offsetHeight}px`,
      });
      host.appendChild(overlay);
      const element = this.selectedElement(card);
      if (element) {
        bindings.forEach(binding => this.drawHandle(overlay, card, element, binding, zoom));
      }
    }
  }

  private drawHandle(overlay: HTMLElement, card: HTMLElement, element: HTMLElement, binding: GeometryBinding, zoom: number): void {
    const view = card.ownerDocument.defaultView ?? window;
    const style = view.getComputedStyle(element);
    const cardRect = card.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const px = (value: string) => parseFloat(value) || 0;
    // border box, in card pixels
    let left = (rect.left - cardRect.left) / zoom;
    let top = (rect.top - cardRect.top) / zoom;
    let right = left + rect.width / zoom;
    let bottom = top + rect.height / zoom;
    const { edge, box, sign } = GEOMETRY_EDGES[binding.property];
    if (box === 'content') {
      left += px(style.borderLeftWidth) + px(style.paddingLeft);
      right -= px(style.borderRightWidth) + px(style.paddingRight);
      top += px(style.borderTopWidth) + px(style.paddingTop);
      bottom -= px(style.borderBottomWidth) + px(style.paddingBottom);
    }
    const vertical = edge === 'left' || edge === 'right';
    const position = { top, bottom, left, right }[edge];
    const handle = overlay.ownerDocument.createElement('div');
    handle.className = 'cider-handle ' + (vertical ? 'x' : 'y') + (edge === 'right' || edge === 'bottom' ? ' end' : '')
      + (binding.number === null ? ' locked' : '');
    Object.assign(handle.style, vertical
      ? { left: `${position}px`, top: `${top}px`, height: `${Math.max(bottom - top, 1)}px` }
      : { top: `${position}px`, left: `${left}px`, width: `${Math.max(right - left, 1)}px` });
    const label = overlay.ownerDocument.createElement('span');
    label.textContent = `${binding.variable} ${binding.value}`;
    handle.appendChild(label);
    handle.title = this.translate.instant('template-editor.layers.geometry.drag', { variable: binding.variable });
    overlay.appendChild(handle);
    if (binding.number === null) {
      return;
    }
    // what 1 % is worth (top/bottom/height: height of the containing block; else its width)
    const container = element.offsetParent as HTMLElement | null;
    const percentBase = (binding.property === 'top' || binding.property === 'bottom' || binding.property === 'height'
      ? container?.clientHeight : container?.clientWidth) || 1;
    const stop = (event: Event) => event.stopPropagation();
    handle.addEventListener('mousedown', stop);
    handle.addEventListener('click', stop);
    handle.addEventListener('pointerdown', event => this.startDrag(event, handle, binding, vertical, sign, zoom, percentBase));
  }

  private startDrag(event: PointerEvent, handle: HTMLElement, binding: GeometryBinding, vertical: boolean, sign: number,
    zoom: number, percentBase: number): void {
    event.preventDefault();
    event.stopPropagation();
    const start = binding.number ?? 0;
    const origin = vertical ? event.clientX : event.clientY;
    const view = handle.ownerDocument.defaultView ?? window;
    let last = binding.value;
    let frame = 0;
    this.dragging = true;
    handle.classList.add('active');
    const label = handle.querySelector('span');
    const valueAt = (moveEvent: PointerEvent) => {
      const delta = ((vertical ? moveEvent.clientX : moveEvent.clientY) - origin) / zoom;
      const raw = start + sign * (binding.unit === '%' ? delta / percentBase * 100 : delta);
      const step = binding.unit === '%' ? (moveEvent.shiftKey ? 1 : 0.1) : (moveEvent.shiftKey ? 5 : 1);
      const value = Math.round(raw / step) * step;
      return { delta, text: `${parseFloat(value.toFixed(2))}${binding.unit}` };
    };
    const move = (moveEvent: PointerEvent) => {
      const { delta, text } = valueAt(moveEvent);
      handle.style.transform = vertical ? `translateX(${delta}px)` : `translateY(${delta}px)`;
      if (label) {
        label.textContent = `${binding.variable} ${text}`;
      }
      if (text !== last && !frame) {
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          this.zone.run(() => this.variableChange.emit({ name: binding.variable, index: binding.index, value: last, commit: false }));
        });
      }
      last = text;
    };
    const up = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
      view.removeEventListener('pointercancel', up);
      view.cancelAnimationFrame(frame);
      this.dragging = false;
      this.zone.run(() => this.variableChange.emit({ name: binding.variable, index: binding.index, value: last, commit: true }));
      this.schedule(0);
    };
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
  }

  /** A value typed in the panel */
  public setBindingValue(binding: GeometryBinding, value: string): void {
    const text = value.trim();
    if (text && text !== binding.value) {
      this.variableChange.emit({ name: binding.variable, index: binding.index, value: text, commit: true });
    }
  }

  /** A fixed length of the selected layer becomes a CSS variable (declared on the card root) */
  public makeVariable(fixed: FixedGeometry): void {
    const card = this.cards()[0];
    const element = this.selectedElement(card);
    const root = card?.firstElementChild;
    if (!element || !root) {
      return;
    }
    const css = this.css ?? '';
    const edits = createVariableEdits(css, fixed, root, newVariableName(element, fixed.property, css));
    if (edits) {
      this.cssEdits.emit(edits);
    } else {
      this.noRootRule = true;
    }
  }


  public propertyLabel(property: string): string {
    return this.translate.instant('template-editor.layers.geometry.' + property);
  }

  /*********************************************************************
   * Texts
   *********************************************************************/

  public issueText(issue: LayerIssue): string {
    const params = { ...issue.params };
    if (params['reason']) {
      params['reason'] = this.translate.instant('template-editor.layers.reason.' + params['reason']);
    }
    return this.translate.instant('template-editor.layers.issue.' + issue.code, params);
  }

  public stepText(entry: PaintEntry): string {
    if (entry.step === 'negative' || entry.step === 'positive') {
      return 'z ' + entry.z;
    }
    if (entry.step === 'context') {
      return this.contextText(entry.node);
    }
    return this.translate.instant('template-editor.layers.step.' + entry.step);
  }

  /** "z 3" for a z-index, else what creates the context ("transform", with its z-index if any) */
  public contextText(node: LayerNode): string {
    if (node.context === 'z-index') {
      return 'z ' + node.z;
    }
    return this.translate.instant('template-editor.layers.reason.' + node.context) + (node.z ? ' · z ' + node.z : '');
  }

  public kindIcon(node: LayerNode): string {
    return { image: 'pi pi-image', text: 'pi pi-align-left', group: 'pi pi-folder', box: 'pi pi-stop' }[node.kind];
  }

  public absentText(tag: AbsentTag): string {
    if (tag.commented) {
      return this.translate.instant('template-editor.layers.absent-commented');
    }
    if (!tag.condition) {
      return this.translate.instant('template-editor.layers.absent-unknown');
    }
    return (tag.inElse ? this.translate.instant('template-editor.layers.absent-else') + ' ' : '') + tag.condition;
  }

  public duplicateText(duplicate: CssDuplicate): string {
    return this.translate.instant('template-editor.layers.duplicate.' + duplicate.kind, {
      selector: duplicate.selector, property: duplicate.property ?? '', line: duplicate.line, repeat: duplicate.repeatLine,
    });
  }

  public warningCount(): number {
    return this.analysis?.nodes.reduce((sum, node) => sum + node.issues.filter(issue => issue.severity === 'warning').length, 0) ?? 0;
  }
}
