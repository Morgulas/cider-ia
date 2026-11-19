import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Tooltip } from 'primeng/tooltip';
import { PIECE_CLASS } from '../card-preview/foil-zones';
import {
  AbsentTag, absentTags, analyzeCard, CssDuplicate, findCssDuplicates, HIDDEN_ATTRIBUTE, HOVER_CLASS, LayerAnalysis, LayerIssue,
  LayerNode, layerElements, PaintEntry, paintTopFirst, SELECTED_CLASS, SOLO_ATTRIBUTE, SOLO_MODE_ATTRIBUTE,
} from './template-layers';

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
  imports: [NgTemplateOutlet, TranslatePipe, Tooltip],
})
export class TemplateLayersPanelComponent implements OnInit, OnChanges, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** template source, for the tags this card does not render and the CSS written twice */
  @Input() html = '';
  @Input() css = '';
  /** anything that changes what the preview shows (template version, card, view, separate window) */
  @Input() renderKey: unknown;
  /** where the previews are (this page, the separate window) */
  @Input() roots: () => HTMLElement[] = () => [];
  @Output() goToTag = new EventEmitter<{ line: number; tag: string }>();
  @Output() goToCss = new EventEmitter<number>();

  view: 'tree' | 'paint' = 'tree';
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
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.observer?.disconnect();
    // the preview goes back to normal
    this.hidden.clear();
    this.solo = null;
    this.cards().forEach(card => {
      this.applyVisibility(card);
      card.querySelectorAll('.' + HOVER_CLASS).forEach(element => element.classList.remove(HOVER_CLASS));
    });
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
        const onlyPieces = records.every(record => record.target instanceof Element && record.target.closest('.' + PIECE_CLASS)
          || [...record.addedNodes, ...record.removedNodes].every(node => node instanceof Element && node.classList.contains(PIECE_CLASS)));
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
    this.changeDetector.detectChanges();
    this.host.nativeElement.querySelector(`[data-layer-key="${key}"]`)?.scrollIntoView({ block: 'nearest' });
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
