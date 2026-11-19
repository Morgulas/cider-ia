/**
 * Layers panel of the template editor: what a rendered card is made of.
 *
 * The code stays the source of truth: everything here READS the rendered
 * preview (and the template source) and never generates the template.
 *  - the element tree, with what each element is (image, text, group),
 *    its export layer (data-calque), its foil (data-foil) and its source line;
 *  - the real painting order (stacking contexts, z-index, transform...),
 *    which is often not the order of the code;
 *  - diagnostics: z-index without effect, stacking changed by a transform,
 *    text overflow, styles inherited from the page around the card...;
 *  - the tags of the source that this card does not render, with their
 *    Handlebars condition.
 */
import { LAYER_NAME, layerGroups } from '../card-preview/card-preview.component';
import { PIECE_CLASS } from '../card-preview/foil-zones';
import { findCssVariables, LINE_ATTRIBUTE, matchableSelector, parseCssRules, splitSelectorList } from './template-tools';

/*********************************************************************
 * Marks put on elements of the rendered card (styles in styles.scss)
 *********************************************************************/

/** outlines of the inspector and of the layers panel */
export const HOVER_CLASS = 'cider-inspect-hover';
export const SELECTED_CLASS = 'cider-inspect-selected';
/** layer hidden in the preview (it and what is inside it) */
export const HIDDEN_ATTRIBUTE = 'data-cider-hidden';
/** layer shown alone: on the element, and on the card element for the rest */
export const SOLO_ATTRIBUTE = 'data-cider-solo';
export const SOLO_MODE_ATTRIBUTE = 'data-cider-solo-mode';

/*********************************************************************
 * Types
 *********************************************************************/

export type LayerKind = 'image' | 'text' | 'group' | 'box';

/** Why an element starts a stacking context (its children are painted with it, as one block) */
export type ContextReason = 'z-index' | 'position' | 'opacity' | 'transform' | 'filter' | 'blend' | 'isolation'
  | 'mask' | 'clip-path' | 'perspective' | 'will-change' | 'contain';

export type LayerIssueCode =
  /** z-index set on an element that is neither positioned nor a flex/grid item: ignored */
  | 'z-index-ignored'
  /** stacking context made by a transform/filter/opacity... without z-index: painted above the positioned elements before it */
  | 'implicit-context'
  /** same, with a transform that moves nothing (translateX(0)...): only there for its effect on stacking? */
  | 'identity-transform'
  /** text that does not fit in its box */
  | 'overflow'
  /** the card root takes these text styles from the page around it (the binder shows cards in a button) */
  | 'inherits-container'
  /** data-calque name the collection app does not accept */
  | 'invalid-calque'
  /** data-calque beyond the 6 layers exported */
  | 'export-limit'
  /** data-foil on an element that is not displayed */
  | 'hidden-foil';

export interface LayerIssue {
  code: LayerIssueCode;
  severity: 'warning' | 'info';
  params: Record<string, string>;
}

export interface LayerNode {
  element: HTMLElement;
  /** stable from one render to the next: source line, tag and occurrence */
  key: string;
  /** tag#id.class.class */
  label: string;
  /** 1-based HTML line (data-cider-line), when known */
  line: number | null;
  tag: string;
  depth: number;
  children: LayerNode[];
  kind: LayerKind;
  /** a little of the element's own text, for text elements */
  text: string;
  calque: string | null;
  foil: string | null;
  /** not displayed: display:none, visibility:hidden, or no size */
  hidden: 'display' | 'visibility' | 'empty' | null;
  positioned: boolean;
  /** computed z-index ('auto' or a number) */
  zIndex: string;
  /** z-index that really applies (positioned element or flex/grid item), else 0 */
  z: number;
  context: ContextReason | null;
  issues: LayerIssue[];
}

/** One entry of the painting order: an element painted as one block (with its non-positioned content) */
export interface PaintEntry {
  node: LayerNode;
  /** nesting of stacking contexts (0: the card itself) */
  depth: number;
  /** where the entry is painted in its context */
  step: 'context' | 'negative' | 'flow' | 'positioned' | 'positive';
  /** z-index used to sort the entry in its context */
  z: number;
}

/** A tag of the source that the rendered card does not show */
export interface AbsentTag {
  line: number;
  tag: string;
  label: string;
  /** innermost Handlebars block around it, e.g. "{{#if card.motivation}}" ("{{else}}" of it: prefixed "sinon") */
  condition: string | null;
  inElse: boolean;
  /** inside a {{!-- --}} comment: never rendered */
  commented: boolean;
}

export interface LayerAnalysis {
  roots: LayerNode[];
  /** painting order, from the bottom (painted first) to the top */
  paint: PaintEntry[];
  /** every node, in tree order */
  nodes: LayerNode[];
  issueCount: number;
}

/*********************************************************************
 * Tree
 *********************************************************************/

const SKIPPED_TAGS = new Set(['STYLE', 'SCRIPT', 'BR', 'TEMPLATE', 'LINK', 'META']);

/** Elements of the card the panel shows: not styles, not the foil pieces of the preview */
function isShown(element: Element): element is HTMLElement {
  return !SKIPPED_TAGS.has(element.tagName) && !element.classList.contains(PIECE_CLASS)
    && !(element.parentElement?.closest('svg'));
}

/** "div#card-template.header-band" (classes put by the editor left out) */
export function describeElement(element: Element): string {
  const classes = Array.from(element.classList).filter(name => !name.startsWith('cider-') && !name.startsWith('cc-')).slice(0, 2);
  return element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + classes.map(name => '.' + name).join('');
}

function ownText(element: Element): string {
  let text = '';
  element.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
    }
  });
  return text.replace(/\s+/g, ' ').trim();
}

function hasImage(element: HTMLElement, style: CSSStyleDeclaration): boolean {
  return element.tagName === 'IMG' || element.tagName === 'svg' || element.tagName === 'CANVAS'
    || /url\(/.test(style.backgroundImage);
}

const FLEX_OR_GRID = /^(inline-)?(flex|grid)$/;

/** Why the element starts a stacking context, if it does (computed styles) */
export function contextReason(style: CSSStyleDeclaration, parentStyle: CSSStyleDeclaration | null): ContextReason | null {
  const position = style.position;
  const hasZ = style.zIndex !== 'auto';
  if (position === 'fixed' || position === 'sticky') {
    return 'position';
  }
  if (hasZ && (position !== 'static' || (parentStyle && FLEX_OR_GRID.test(parentStyle.display)))) {
    return 'z-index';
  }
  if (Number(style.opacity) < 1) {
    return 'opacity';
  }
  const extra = style as CSSStyleDeclaration & { translate?: string; rotate?: string; scale?: string };
  if (style.transform !== 'none' || [extra.translate, extra.rotate, extra.scale].some(value => value && value !== 'none')) {
    return 'transform';
  }
  if (style.filter !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none')) {
    return 'filter';
  }
  if (style.mixBlendMode && style.mixBlendMode !== 'normal') {
    return 'blend';
  }
  if (style.isolation === 'isolate') {
    return 'isolation';
  }
  const maskImage = style.maskImage || style.getPropertyValue('-webkit-mask-image');
  if (maskImage && maskImage !== 'none') {
    return 'mask';
  }
  if (style.clipPath && style.clipPath !== 'none') {
    return 'clip-path';
  }
  if (style.perspective && style.perspective !== 'none') {
    return 'perspective';
  }
  if (/(transform|opacity|filter|z-index|perspective|isolation|mask|clip-path)/.test(style.willChange)) {
    return 'will-change';
  }
  if (/(paint|layout|strict|content)/.test(style.contain)) {
    return 'contain';
  }
  return null;
}

/** A transform that moves nothing: translateX(0), scale(1)... */
function isIdentityTransform(style: CSSStyleDeclaration): boolean {
  const extra = style as CSSStyleDeclaration & { translate?: string; rotate?: string; scale?: string };
  const others = [extra.translate, extra.rotate, extra.scale].filter(value => value && value !== 'none');
  if (others.length) {
    return false;
  }
  const value = style.transform.replace(/\s+/g, '');
  return value === 'matrix(1,0,0,1,0,0)' || value === 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)';
}

/** Key of an element from one render to the next: "<line>:<tag>:<occurrence>" (occurrences counted in tree order) */
function keyCounter(): (element: HTMLElement) => string {
  const occurrences = new Map<string, number>();
  return element => {
    const base = `${element.getAttribute(LINE_ATTRIBUTE) ?? '?'}:${element.tagName.toLowerCase()}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return `${base}:${occurrence}`;
  };
}

/** The elements of a rendered card by layer key (same keys as buildLayerTree) */
export function layerElements(cardElement: HTMLElement): Map<string, HTMLElement> {
  const keyOf = keyCounter();
  const elements = new Map<string, HTMLElement>();
  const walk = (element: HTMLElement) => {
    elements.set(keyOf(element), element);
    Array.from(element.children).filter(isShown).forEach(walk);
  };
  Array.from(cardElement.children).filter(isShown).forEach(walk);
  return elements;
}

/**
 * The element tree of a rendered card (the children of `cardElement`, the
 * element the template is rendered into), with stacking information.
 */
export function buildLayerTree(cardElement: HTMLElement): LayerNode[] {
  const view = cardElement.ownerDocument.defaultView ?? window;
  const keyOf = keyCounter();
  const build = (element: HTMLElement, depth: number, parentStyle: CSSStyleDeclaration | null): LayerNode => {
    const style = view.getComputedStyle(element);
    const lineValue = element.getAttribute(LINE_ATTRIBUTE);
    const line = lineValue ? Number(lineValue) : null;
    const tag = element.tagName.toLowerCase();
    const key = keyOf(element);
    const text = ownText(element);
    const childElements = Array.from(element.children).filter(isShown);
    const rect = element.getBoundingClientRect();
    const hidden = style.display === 'none' ? 'display'
      : style.visibility === 'hidden' ? 'visibility'
        : (rect.width === 0 || rect.height === 0) && !text ? 'empty' : null;
    const node: LayerNode = {
      element, key, label: describeElement(element), line, tag, depth, children: [],
      kind: hasImage(element, style) ? 'image' : text ? 'text' : childElements.length ? 'group' : 'box',
      text: text.length > 40 ? text.slice(0, 39) + '…' : text,
      calque: element.getAttribute('data-calque')?.trim() || null,
      foil: element.getAttribute('data-foil')?.trim() || null,
      hidden,
      positioned: style.position !== 'static',
      zIndex: style.zIndex,
      z: style.zIndex !== 'auto' && (style.position !== 'static' || !!(parentStyle && FLEX_OR_GRID.test(parentStyle.display)))
        ? Number(style.zIndex) || 0 : 0,
      context: contextReason(style, parentStyle),
      issues: [],
    };
    node.issues.push(...styleIssues(node, style, parentStyle));
    node.children = childElements.map(child => build(child, depth + 1, style));
    return node;
  };
  const cardStyle = view.getComputedStyle(cardElement);
  return Array.from(cardElement.children).filter(isShown).map(child => build(child, 0, cardStyle));
}

/** Diagnostics read from the element's own computed style */
function styleIssues(node: LayerNode, style: CSSStyleDeclaration, parentStyle: CSSStyleDeclaration | null): LayerIssue[] {
  const issues: LayerIssue[] = [];
  if (style.zIndex !== 'auto' && style.position === 'static' && !(parentStyle && FLEX_OR_GRID.test(parentStyle.display))) {
    issues.push({ code: 'z-index-ignored', severity: 'warning', params: { z: style.zIndex } });
  }
  if (node.context && node.context !== 'z-index' && node.context !== 'position' && !node.positioned) {
    if (node.context === 'transform' && isIdentityTransform(style)) {
      issues.push({ code: 'identity-transform', severity: 'warning', params: { transform: style.transform } });
    } else {
      issues.push({ code: 'implicit-context', severity: 'info', params: { reason: node.context } });
    }
  }
  if (node.foil && node.hidden === 'display') {
    issues.push({ code: 'hidden-foil', severity: 'info', params: { foil: node.foil } });
  }
  return issues;
}

export function flattenLayers(roots: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  const walk = (node: LayerNode) => {
    out.push(node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/*********************************************************************
 * Painting order
 *********************************************************************/

/**
 * The order in which the browser paints the card, from the bottom to the top,
 * following the CSS rules of stacking contexts (CSS 2.1 appendix E, simplified
 * to elements): in each context, its own background, then the children with a
 * negative z-index, then the non-positioned content in code order, then the
 * positioned elements (z-index auto or 0) in code order, then the positive
 * z-index ones. An element that starts a context is painted as one block with
 * everything inside it. Non-positioned content inside a positioned element is
 * painted with it (one entry).
 */
export function paintOrder(roots: LayerNode[]): PaintEntry[] {
  const zOf = (node: LayerNode) => (node.context ? node.z : 0);
  const stack = (children: LayerNode[], depth: number): PaintEntry[] => {
    const negative: LayerNode[] = [];
    const flow: LayerNode[] = [];
    const level0: LayerNode[] = [];
    const positive: LayerNode[] = [];
    const walk = (nodes: LayerNode[], collectFlow: boolean) => {
      for (const node of nodes) {
        if (node.hidden === 'display') {
          continue;
        }
        if (node.context) {
          const z = zOf(node);
          (z < 0 ? negative : z > 0 ? positive : level0).push(node);
        } else if (node.positioned) {
          level0.push(node);
          walk(node.children, false);
        } else {
          if (collectFlow) {
            flow.push(node);
          }
          walk(node.children, false);
        }
      }
    };
    walk(children, true);
    const byZ = (a: LayerNode, b: LayerNode) => zOf(a) - zOf(b);
    negative.sort(byZ);
    positive.sort(byZ);
    const expand = (node: LayerNode, step: PaintEntry['step']): PaintEntry[] => node.context
      ? [{ node, depth, step, z: zOf(node) }, ...stack(node.children, depth + 1)]
      : [{ node, depth, step, z: 0 }];
    return [
      ...negative.flatMap(node => expand(node, 'negative')),
      ...flow.map(node => ({ node, depth, step: 'flow' as const, z: 0 })),
      ...level0.flatMap(node => expand(node, node.context ? 'context' : 'positioned')),
      ...positive.flatMap(node => expand(node, 'positive')),
    ];
  };
  return stack(roots, 0);
}

interface PaintGroup {
  entry: PaintEntry;
  inside: PaintGroup[];
}

/**
 * The painting order to show from the top: siblings reversed (painted last
 * first), but each stacking context stays right above the entries painted
 * inside it, which follow it (also from the top).
 */
export function paintTopFirst(bottomFirst: PaintEntry[]): PaintEntry[] {
  let index = 0;
  const read = (depth: number): PaintGroup[] => {
    const groups: PaintGroup[] = [];
    while (index < bottomFirst.length && bottomFirst[index].depth === depth) {
      const entry = bottomFirst[index++];
      groups.push({ entry, inside: index < bottomFirst.length && bottomFirst[index].depth > depth ? read(depth + 1) : [] });
    }
    return groups;
  };
  const write = (groups: PaintGroup[]): PaintEntry[] => [...groups].reverse().flatMap(group => [group.entry, ...write(group.inside)]);
  return write(read(0));
}

/*********************************************************************
 * Diagnostics needing the whole card
 *********************************************************************/

/** Elements of a rendered card whose text does not fit: innermost ones only */
export function findOverflowing(root: Element): HTMLElement[] {
  const view = root.ownerDocument.defaultView ?? window;
  const flagged: HTMLElement[] = [];
  root.querySelectorAll('*').forEach(node => {
    const element = node as HTMLElement;
    if (['STYLE', 'SCRIPT', 'IMG', 'svg', 'BR'].includes(element.tagName) || element.closest('svg')
      || element.closest('.' + PIECE_CLASS)) {
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

/** Text styles probed on the page around the card, with a value nobody uses */
const INHERITED_PROBES: [string, string][] = [
  ['text-align', 'right'],
  ['font-size', '7px'],
  ['line-height', '3px'],
  ['letter-spacing', '3px'],
  ['font-weight', '100'],
  ['font-style', 'oblique'],
  ['white-space', 'pre'],
  ['text-transform', 'uppercase'],
  ['color', 'rgb(1, 2, 3)'],
  ['font-family', 'cider-probe'],
];

/**
 * The text styles the card root takes from the page around it: changed on the
 * element the card is rendered into, they change the card. Elsewhere (the
 * binder shows each card in a button, which centers its text) the card would
 * not look the same. The probe is undone at once.
 */
export function inheritedFromContainer(cardElement: HTMLElement, root: HTMLElement): string[] {
  const view = cardElement.ownerDocument.defaultView ?? window;
  const before = view.getComputedStyle(root);
  const values = INHERITED_PROBES.map(([name]) => before.getPropertyValue(name));
  const saved = cardElement.getAttribute('style');
  INHERITED_PROBES.forEach(([name, value]) => cardElement.style.setProperty(name, value, 'important'));
  const after = view.getComputedStyle(root);
  const changed = INHERITED_PROBES.filter(([name], i) => after.getPropertyValue(name) !== values[i]).map(([name]) => name);
  cardElement.setAttribute('style', saved ?? '');
  if (saved === null) {
    // Chrome writes the inline style back to the attribute lazily: read it first,
    // or the attribute comes back (empty) after being removed
    void cardElement.getAttribute('style');
    cardElement.removeAttribute('style');
  }
  return changed;
}

/**
 * Everything the panel shows about a rendered card. `cardElement` is the
 * element the template is rendered into (.card-element of the preview).
 */
export function analyzeCard(cardElement: HTMLElement): LayerAnalysis {
  const roots = buildLayerTree(cardElement);
  const nodes = flattenLayers(roots);
  const byElement = new Map(nodes.map(node => [node.element, node]));

  findOverflowing(cardElement).forEach(element => byElement.get(element)?.issues
    .push({ code: 'overflow', severity: 'warning', params: {} }));

  const root = roots.find(node => node.hidden !== 'display');
  if (root) {
    const inherited = inheritedFromContainer(cardElement, root.element);
    if (inherited.length) {
      root.issues.push({ code: 'inherits-container', severity: 'info', params: { properties: inherited.join(', ') } });
    }
  }

  // layers exported to the collection app (6 at most, foil zones first)
  const exported = new Set([...layerGroups(cardElement).values()].flat());
  for (const node of nodes) {
    if (!node.calque) {
      continue;
    }
    if (!LAYER_NAME.test(node.calque.toLowerCase())) {
      node.issues.push({ code: 'invalid-calque', severity: 'warning', params: { name: node.calque } });
    } else if (!exported.has(node.element)) {
      node.issues.push({ code: 'export-limit', severity: 'warning', params: { name: node.calque } });
    }
  }

  return { roots, nodes, paint: paintOrder(roots), issueCount: nodes.reduce((sum, node) => sum + node.issues.length, 0) };
}

/*********************************************************************
 * Source: tags the card does not render, and their conditions
 *********************************************************************/

/** Every opening tag of the template source, with the Handlebars block around it */
export function sourceTags(html: string): AbsentTag[] {
  const tags: AbsentTag[] = [];
  const blocks: { open: string; inElse: boolean }[] = [];
  let line = 1;
  let last = 0;
  const pattern = /<!--[\s\S]*?-->|\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}|\{\{[\s\S]*?\}\}|<([a-zA-Z][\w-]*)(?=[\s/>])([^>]*)>?/g;
  for (const match of (html ?? '').matchAll(pattern)) {
    const offset = match.index ?? 0;
    for (let i = last; i < offset; i++) {
      if (html.charCodeAt(i) === 10) {
        line++;
      }
    }
    last = offset;
    const text = match[0];
    if (text.startsWith('{{!')) {
      // tags inside a Handlebars comment are never rendered
      if (text.startsWith('{{!--')) {
        const inner = text.slice(5, -4);
        for (const commented of sourceTags(inner)) {
          tags.push({ ...commented, line: line + commented.line - 1, condition: null, inElse: false, commented: true });
        }
      }
      continue;
    }
    if (text.startsWith('<!--')) {
      continue;
    }
    if (text.startsWith('{{')) {
      const body = text.replace(/^\{\{~?\s*/, '').replace(/\s*~?\}\}$/, '');
      if (body.startsWith('#') || body.startsWith('^')) {
        blocks.push({ open: text.replace(/\s+/g, ' '), inElse: false });
      } else if (body.startsWith('/')) {
        blocks.pop();
      } else if (/^else\b/.test(body) && blocks.length) {
        blocks[blocks.length - 1].inElse = true;
      }
      continue;
    }
    const tag = (match[1] ?? '').toLowerCase();
    const attributes = match[2] ?? '';
    const classes = /\bclass\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1]
      // classes added by a condition ({{#if x}}long{{/if}}) left out
      .replace(/\{\{#([\w-]+)[\s\S]*?\{\{\/\1\s*\}\}/g, ' ')
      .replace(/\{\{[\s\S]*?\}\}/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2) ?? [];
    const id = /\bid\s*=\s*["']([^"'{}]*)["']/i.exec(attributes)?.[1];
    const block = blocks[blocks.length - 1];
    tags.push({
      line, tag, label: tag + (id ? '#' + id : '') + classes.map(name => '.' + name).join(''),
      condition: block?.open ?? null, inElse: block?.inElse ?? false, commented: false,
    });
  }
  return tags;
}

/** The tags of the source missing from the rendered card (other cards may show them) */
export function absentTags(html: string, nodes: LayerNode[]): AbsentTag[] {
  const rendered = new Set(nodes.map(node => `${node.line}:${node.tag}`));
  return sourceTags(html).filter(tag => !rendered.has(`${tag.line}:${tag.tag}`));
}

/*********************************************************************
 * CSS of the template: rules written twice, properties written twice
 *********************************************************************/

export interface CssDuplicate {
  kind: 'rule' | 'property';
  /** selector of the rule (both rules for 'rule') */
  selector: string;
  /** property declared twice in the same rule ('property') */
  property?: string;
  /** 1-based lines: first and repeated */
  line: number;
  repeatLine: number;
}

/**
 * Rules declared twice with the same selector (outside @media/@supports), and
 * properties declared twice in one rule. A declaration inside a Handlebars
 * block ({{#if}}...{{/if}}) is meant to replace the first one: not reported.
 */
export function findCssDuplicates(css: string): CssDuplicate[] {
  const source = css ?? '';
  // Handlebars blocks: their declarations are conditional overrides
  const conditional: [number, number][] = [];
  const blockStack: number[] = [];
  for (const match of source.matchAll(/\{\{~?\s*([#^/])[\s\S]*?\}\}/g)) {
    if (match[1] === '/') {
      const start = blockStack.pop();
      if (start !== undefined) {
        conditional.push([start, (match.index ?? 0) + match[0].length]);
      }
    } else {
      blockStack.push(match.index ?? 0);
    }
  }
  const isConditional = (index: number) => conditional.some(([start, end]) => index >= start && index < end);
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\{\{[\s\S]*?\}\}/g, match => match.replace(/[^\n]/g, ' '));
  const lineAt = (index: number) => text.slice(0, index).split('\n').length;

  const duplicates: CssDuplicate[] = [];
  /** top-level rules: a block of CSS variables only (a "settings" block) is not a duplicate */
  const rules: { key: string; selector: string; line: number; onlyVariables: boolean }[] = [];
  const stack: { selector: string | null; atRule: boolean; key: string | null; line: number }[] = [];
  let start = 0;
  let body: { selector: string; start: number } | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{') {
      const selector = text.slice(start, i).trim().replace(/\s+/g, ' ');
      const inAtRule = stack.some(entry => entry.atRule);
      if (selector.startsWith('@')) {
        stack.push({ selector: null, atRule: true, key: null, line: 0 });
      } else {
        const offset = start + text.slice(start, i).indexOf(selector.split(' ')[0]);
        const counted = !!selector && !inAtRule && !isConditional(offset);
        stack.push({ selector, atRule: false, key: counted ? selector.split(',').map(part => part.trim()).join(',') : null,
          line: lineAt(offset) });
        body = { selector, start: i + 1 };
      }
      start = i + 1;
    } else if (char === '}') {
      const entry = stack.pop();
      if (entry?.selector && body) {
        duplicates.push(...propertyDuplicates(text, body.start, i, entry.selector, lineAt, isConditional));
        if (entry.key) {
          const declarations = text.slice(body.start, i).split(';').map(part => part.trim()).filter(Boolean);
          rules.push({ key: entry.key, selector: entry.selector, line: entry.line,
            onlyVariables: declarations.length > 0 && declarations.every(part => part.startsWith('--')) });
        }
      }
      body = null;
      start = i + 1;
    } else if (char === ';' && !stack.length) {
      start = i + 1;
    }
  }
  const firstRule = new Map<string, number>();
  for (const rule of rules.filter(candidate => !candidate.onlyVariables)) {
    const first = firstRule.get(rule.key);
    if (first !== undefined) {
      duplicates.push({ kind: 'rule', selector: rule.selector, line: first, repeatLine: rule.line });
    } else {
      firstRule.set(rule.key, rule.line);
    }
  }
  return duplicates;
}

function propertyDuplicates(text: string, from: number, to: number, selector: string,
  lineAt: (index: number) => number, isConditional: (index: number) => boolean): CssDuplicate[] {
  const out: CssDuplicate[] = [];
  const seen = new Map<string, number>();
  let depth = 0;
  let declarationStart = from;
  const check = (end: number) => {
    const declaration = text.slice(declarationStart, end);
    const match = /^\s*([-\w]+)\s*:/.exec(declaration);
    if (match) {
      const offset = declarationStart + declaration.indexOf(match[1]);
      const property = match[1].toLowerCase();
      if (!isConditional(offset)) {
        const first = seen.get(property);
        if (first !== undefined) {
          out.push({ kind: 'property', selector, property, line: first, repeatLine: lineAt(offset) });
        } else {
          seen.set(property, lineAt(offset));
        }
      }
    }
  };
  for (let i = from; i < to; i++) {
    const char = text[i];
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      check(i);
      declarationStart = i + 1;
    }
  }
  check(to);
  return out;
}

/*********************************************************************
 * Variants: the same card with another value (rarity, foil...)
 *********************************************************************/

/** What a rendered card is made of, to compare two renders of a template */
export interface VariantSnapshot {
  /** rendered tags: "<line>:<tag>" → label */
  elements: Map<string, string>;
  /** CSS variables of the template, computed on the card root */
  variables: Map<string, string>;
  /** CSS rules (by line) that style at least one element */
  rules: Map<number, string>;
  /** foil zones: "<line>:<tag>" → effect */
  foils: Map<string, string>;
}

export interface VariantDiff {
  shown: string[];
  hidden: string[];
  variables: { name: string; from: string; to: string }[];
  rulesOn: { line: number; selector: string }[];
  rulesOff: { line: number; selector: string }[];
  foils: { label: string; from: string; to: string }[];
  /** number of differences */
  size: number;
}

/** Reads a rendered card for comparison (`css`: the template CSS, as written) */
export function snapshotCard(cardElement: HTMLElement, css: string): VariantSnapshot {
  const view = cardElement.ownerDocument.defaultView ?? window;
  const elements = new Map<string, string>();
  const foils = new Map<string, string>();
  layerElements(cardElement).forEach(element => {
    const id = `${element.getAttribute(LINE_ATTRIBUTE) ?? '?'}:${element.tagName.toLowerCase()}`;
    if (!elements.has(id)) {
      elements.set(id, describeElement(element));
    }
    const foil = element.getAttribute('data-foil')?.trim();
    if (foil && !foils.has(id)) {
      foils.set(id, foil);
    }
  });
  const root = Array.from(cardElement.children).find(isShown);
  const variables = new Map<string, string>();
  if (root) {
    const style = view.getComputedStyle(root);
    findCssVariables(css).forEach(variable => variables.set(variable.name, style.getPropertyValue(variable.name).trim()));
  }
  const rules = new Map<number, string>();
  for (const rule of parseCssRules(css)) {
    const used = splitSelectorList(rule.selector).some(selector => {
      const matchable = matchableSelector(selector);
      try {
        return !!matchable && !!cardElement.querySelector(matchable);
      } catch {
        return false;
      }
    });
    if (used) {
      rules.set(rule.line, rule.selector);
    }
  }
  return { elements, variables, rules, foils };
}

/** What changes from `base` to `other` */
export function compareSnapshots(base: VariantSnapshot, other: VariantSnapshot): VariantDiff {
  const shown = [...other.elements].filter(([id]) => !base.elements.has(id)).map(([, label]) => label);
  const hidden = [...base.elements].filter(([id]) => !other.elements.has(id)).map(([, label]) => label);
  const variables = [...other.variables].filter(([name, value]) => base.variables.get(name) !== value)
    .map(([name, to]) => ({ name, from: base.variables.get(name) ?? '', to }));
  const rulesOn = [...other.rules].filter(([line]) => !base.rules.has(line)).map(([line, selector]) => ({ line, selector }));
  const rulesOff = [...base.rules].filter(([line]) => !other.rules.has(line)).map(([line, selector]) => ({ line, selector }));
  const ids = new Set([...base.foils.keys(), ...other.foils.keys()]);
  const foils = [...ids].filter(id => (base.foils.get(id) ?? '') !== (other.foils.get(id) ?? ''))
    .map(id => ({ label: other.elements.get(id) ?? base.elements.get(id) ?? id, from: base.foils.get(id) ?? '', to: other.foils.get(id) ?? '' }));
  return { shown, hidden, variables, rulesOn, rulesOff, foils,
    size: shown.length + hidden.length + variables.length + rulesOn.length + rulesOff.length + foils.length };
}

/*********************************************************************
 * Source: the attributes of one opening tag, to change them in the code
 *********************************************************************/

export interface SourceAttribute {
  name: string;
  /** as written, {{handlebars}} included; null for an attribute without value */
  value: string | null;
  /** offsets of the whole attribute (name="value") in the source */
  start: number;
  end: number;
}

export interface SourceTag {
  tag: string;
  /** offsets of the opening tag, from "<" to ">" included */
  start: number;
  end: number;
  /** offset of the ">" (or "/>") that closes it */
  closeAt: number;
  attributes: SourceAttribute[];
}

/** End of the {{ }} (or {{{ }}}) block starting at `index` */
function handlebarsEnd(html: string, index: number): number {
  const triple = html.startsWith('{{{', index);
  const end = html.indexOf(triple ? '}}}' : '}}', index + 2);
  return end < 0 ? html.length : end + (triple ? 3 : 2);
}

/** Reads the opening tag whose "<" is at `start` */
function readTag(html: string, start: number): SourceTag | null {
  const name = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start, start + 64));
  if (!name) {
    return null;
  }
  const attributes: SourceAttribute[] = [];
  let i = start + name[0].length;
  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i])) {
      i++;
    }
    if (html.startsWith('{{', i)) {
      i = handlebarsEnd(html, i);
      continue;
    }
    if (html[i] === '>' || html.startsWith('/>', i)) {
      const end = html[i] === '>' ? i + 1 : i + 2;
      return { tag: name[1].toLowerCase(), start, end, closeAt: i, attributes };
    }
    const attributeStart = i;
    while (i < html.length && !/[\s=>/]/.test(html[i]) && !html.startsWith('{{', i)) {
      i++;
    }
    const attributeName = html.slice(attributeStart, i);
    if (!attributeName) {
      i++;
      continue;
    }
    let j = i;
    while (j < html.length && /\s/.test(html[j])) {
      j++;
    }
    let value: string | null = null;
    if (html[j] === '=') {
      j++;
      while (j < html.length && /\s/.test(html[j])) {
        j++;
      }
      const quote = html[j];
      if (quote === '"' || quote === "'") {
        let k = j + 1;
        while (k < html.length && html[k] !== quote) {
          k = html.startsWith('{{', k) ? handlebarsEnd(html, k) : k + 1;
        }
        value = html.slice(j + 1, k);
        i = Math.min(k + 1, html.length);
      } else {
        let k = j;
        while (k < html.length && !/[\s>]/.test(html[k])) {
          k = html.startsWith('{{', k) ? handlebarsEnd(html, k) : k + 1;
        }
        value = html.slice(j, k);
        i = k;
      }
    }
    attributes.push({ name: attributeName.toLowerCase(), value, start: attributeStart, end: i });
  }
  return null;
}

/**
 * The opening tag written on `line` (1-based) with this tag name; `index`:
 * which one when the line holds several (code order). Tags inside comments
 * are skipped.
 */
export function findSourceTag(html: string, line: number, tag: string, index = 0): SourceTag | null {
  const source = html ?? '';
  const found: SourceTag[] = [];
  let currentLine = 1;
  let last = 0;
  const pattern = /<!--[\s\S]*?-->|\{\{!--[\s\S]*?--\}\}|\{\{[\s\S]*?\}\}|<[a-zA-Z]/g;
  for (const match of source.matchAll(pattern)) {
    const offset = match.index ?? 0;
    for (let i = last; i < offset; i++) {
      if (source.charCodeAt(i) === 10) {
        currentLine++;
      }
    }
    last = offset;
    if (currentLine > line) {
      break;
    }
    if (match[0][0] !== '<' || match[0].startsWith('<!--') || currentLine !== line) {
      continue;
    }
    const read = readTag(source, offset);
    if (read && read.tag === tag.toLowerCase()) {
      found.push(read);
    }
  }
  return found[Math.min(index, found.length - 1)] ?? null;
}

/** Quotes a value: double quotes, single ones if it holds a double quote outside {{ }} */
function quoteValue(value: string): string {
  const outside = value.replace(/\{\{[\s\S]*?\}\}/g, '');
  return outside.includes('"') ? `'${value.replace(/'/g, '&#39;')}'` : `"${value}"`;
}

/**
 * The opening tag with these attributes set (null: removed), to put in place
 * of [tag.start, tag.end). The rest of the tag is kept as written.
 */
export function setTagAttributes(html: string, tag: SourceTag, changes: Record<string, string | null>): string {
  let text = html.slice(tag.start, tag.end);
  const relative = (offset: number) => offset - tag.start;
  const edits: { start: number; end: number; text: string }[] = [];
  const added: string[] = [];
  for (const [name, value] of Object.entries(changes)) {
    const existing = tag.attributes.find(attribute => attribute.name === name.toLowerCase());
    if (existing) {
      if (value === null) {
        // with the spaces before it
        let start = relative(existing.start);
        while (start > 0 && /[ \t]/.test(text[start - 1])) {
          start--;
        }
        edits.push({ start, end: relative(existing.end), text: '' });
      } else if (existing.value !== value) {
        edits.push({ start: relative(existing.start), end: relative(existing.end), text: `${name}=${quoteValue(value)}` });
      }
    } else if (value !== null) {
      added.push(` ${name}=${quoteValue(value)}`);
    }
  }
  if (added.length) {
    // before ">" or "/>", after the spaces already there
    let at = relative(tag.closeAt);
    while (at > 0 && /\s/.test(text[at - 1])) {
      at--;
    }
    edits.push({ start: at, end: at, text: added.join('') });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return text;
}
