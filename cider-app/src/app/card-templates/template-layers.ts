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

/*********************************************************************
 * Geometry: the edges of an element driven by CSS variables (level 3)
 *********************************************************************/

/** One declaration of the template CSS ("property: value") */
export interface CssDeclaration {
  property: string;
  /** as written */
  value: string;
  /** offsets of the value in the CSS */
  valueStart: number;
  valueEnd: number;
  selector: string;
  /** 1-based line of the rule */
  ruleLine: number;
  /** offset just after the "{" of the rule */
  ruleOpen: number;
  /** code order of the declaration */
  order: number;
  /** inside @media/@supports */
  atRule: boolean;
  /** inside a Handlebars block: may not be there for this card */
  conditional: boolean;
}

/** Ranges of {{#block}}...{{/block}} in a text */
function handlebarsBlockRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  const stack: number[] = [];
  for (const match of source.matchAll(/\{\{~?\s*([#^/])[\s\S]*?\}\}/g)) {
    if (match[1] === '/') {
      const start = stack.pop();
      if (start !== undefined) {
        ranges.push([start, (match.index ?? 0) + match[0].length]);
      }
    } else {
      stack.push(match.index ?? 0);
    }
  }
  return ranges;
}

/** Every declaration of the template CSS, with its rule (comments and {{ }} are not taken for CSS) */
export function cssDeclarations(css: string): CssDeclaration[] {
  const source = css ?? '';
  const conditional = handlebarsBlockRanges(source);
  const isConditional = (index: number) => conditional.some(([start, end]) => index >= start && index < end);
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\{\{[\s\S]*?\}\}/g, match => match.replace(/[^\n]/g, ' '));
  const lineAt = (index: number) => text.slice(0, index).split('\n').length;
  const declarations: CssDeclaration[] = [];
  const stack: { selector: string | null; atRule: boolean; line: number; open: number }[] = [];
  let start = 0;
  const readBody = (from: number, to: number, rule: { selector: string; line: number; open: number }, atRule: boolean) => {
    let depth = 0;
    let declarationStart = from;
    const take = (end: number) => {
      const chunk = text.slice(declarationStart, end);
      const match = /^(\s*)([-\w]+)(\s*:)/.exec(chunk);
      if (match) {
        // whitespace read in the source: {{ }} are blanked in `text`
        let valueStart = declarationStart + match[0].length;
        while (valueStart < end && /\s/.test(source[valueStart])) {
          valueStart++;
        }
        let valueEnd = end;
        while (valueEnd > valueStart && /\s/.test(source[valueEnd - 1])) {
          valueEnd--;
        }
        declarations.push({
          property: match[2].toLowerCase(), value: source.slice(valueStart, valueEnd), valueStart, valueEnd,
          selector: rule.selector, ruleLine: rule.line, ruleOpen: rule.open, order: declarations.length, atRule,
          conditional: isConditional(declarationStart + match[1].length),
        });
      }
    };
    for (let i = from; i < to; i++) {
      if (text[i] === '(') {
        depth++;
      } else if (text[i] === ')') {
        depth = Math.max(0, depth - 1);
      } else if (text[i] === ';' && depth === 0) {
        take(i);
        declarationStart = i + 1;
      }
    }
    take(to);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{') {
      const prelude = text.slice(start, i);
      const selector = prelude.trim().replace(/\s+/g, ' ');
      const offset = start + prelude.indexOf(prelude.trim());
      stack.push({ selector: selector.startsWith('@') ? null : selector, atRule: selector.startsWith('@'), line: lineAt(offset), open: i + 1 });
      start = i + 1;
    } else if (char === '}') {
      const entry = stack.pop();
      if (entry?.selector) {
        readBody(entry.open, i, { selector: entry.selector, line: entry.line, open: entry.open },
          stack.some(parent => parent.atRule));
      }
      start = i + 1;
    } else if (char === ';' && !stack.length) {
      start = i + 1;
    }
  }
  return declarations.sort((a, b) => a.valueStart - b.valueStart).map((declaration, order) => ({ ...declaration, order }));
}

/** Specificity of one selector, as a number (ids, then classes/attributes/pseudo-classes, then types) */
export function specificity(selector: string): number {
  const text = selector.replace(/::[\w-]+(\([^)]*\))?/g, ' ').replace(/"[^"]*"|'[^']*'/g, '');
  const ids = (text.match(/#[\w-]+/g) ?? []).length;
  const classes = (text.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\b|is\b|where\b)[\w-]+/g) ?? []).length;
  const types = (text.replace(/\[[^\]]*\]/g, '').match(/(^|[\s>+~(,])([a-zA-Z][\w-]*)/g) ?? []).length;
  return ids * 10000 + classes * 100 + types;
}

/** The highest specificity of the selectors of a list that match the element, or -1 */
function matchSpecificity(element: Element, selectorList: string): number {
  let best = -1;
  for (const selector of splitSelectorList(selectorList)) {
    const matchable = matchableSelector(selector);
    try {
      if (matchable && element.matches(matchable)) {
        best = Math.max(best, specificity(selector));
      }
    } catch {
      // selector the browser does not know
    }
  }
  return best;
}

/** The declaration of `property` that wins on the element (conditional ones left out), with its specificity */
export function winningDeclaration(element: Element, declarations: CssDeclaration[], property: string): CssDeclaration | null {
  let best: CssDeclaration | null = null;
  let bestSpecificity = -1;
  for (const declaration of declarations) {
    if (declaration.property !== property || declaration.conditional) {
      continue;
    }
    const found = matchSpecificity(element, declaration.selector);
    if (found >= 0 && (found > bestSpecificity || (found === bestSpecificity && (!best || declaration.order > best.order)))) {
      best = declaration;
      bestSpecificity = found;
    }
  }
  return best;
}

/** The declaration that gives its value to a variable on the element: on it, or inherited from a parent */
export function variableDeclaration(element: Element, declarations: CssDeclaration[], name: string, stopAt?: Element): CssDeclaration | null {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const found = winningDeclaration(current, declarations, name);
    if (found) {
      return found;
    }
    if (current === stopAt) {
      break;
    }
  }
  return null;
}

export type GeometryProperty = 'top' | 'bottom' | 'left' | 'right' | 'width' | 'height'
  | 'padding-top' | 'padding-bottom' | 'padding-left' | 'padding-right';

/** The edge a property moves, and in which direction a drag changes it */
export const GEOMETRY_EDGES: Record<GeometryProperty, { edge: 'top' | 'bottom' | 'left' | 'right'; box: 'border' | 'content'; sign: 1 | -1 }> = {
  'top': { edge: 'top', box: 'border', sign: 1 },
  'bottom': { edge: 'bottom', box: 'border', sign: -1 },
  'left': { edge: 'left', box: 'border', sign: 1 },
  'right': { edge: 'right', box: 'border', sign: -1 },
  'width': { edge: 'right', box: 'border', sign: 1 },
  'height': { edge: 'bottom', box: 'border', sign: 1 },
  'padding-top': { edge: 'top', box: 'content', sign: 1 },
  'padding-bottom': { edge: 'bottom', box: 'content', sign: -1 },
  'padding-left': { edge: 'left', box: 'content', sign: 1 },
  'padding-right': { edge: 'right', box: 'content', sign: -1 },
};

/** Shorthands read side by side (top, right, bottom, left) */
const SHORTHANDS: Record<string, GeometryProperty[]> = {
  'inset': ['top', 'right', 'bottom', 'left'],
  'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
};

/** Splits a value at its top-level spaces ("var(--a) calc(1px + 2px)" → 2 parts) */
function valueParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    }
    if (/\s/.test(char) && depth === 0) {
      if (current) {
        parts.push(current);
      }
      current = '';
    } else {
      current += char;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

/** Sides of a shorthand with 1 to 4 values: top, right, bottom, left */
function sides(parts: string[]): string[] | null {
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }
  const [top, right = top, bottom = top, left = right] = parts;
  return [top, right, bottom, left];
}

const LENGTH = /^(-?\d*\.?\d+)(px|%)?$/;

/** An edge of the element driven by a variable: dragging it changes the variable */
export interface GeometryBinding {
  property: GeometryProperty;
  variable: string;
  /** the declaration of the variable that applies (the one changed) */
  declaration: CssDeclaration;
  /** which declaration of this variable it is, in code order (to find it again after an edit) */
  index: number;
  value: string;
  /** number and unit when the value can be dragged (px or %) */
  number: number | null;
  unit: 'px' | '%' | null;
}

/** An edge written as a fixed length: can become a variable */
export interface FixedGeometry {
  property: GeometryProperty;
  value: string;
  declaration: CssDeclaration;
  /** side of a shorthand (0 top, 1 right, 2 bottom, 3 left), or null */
  side: number | null;
}

export interface ElementGeometry {
  bindings: GeometryBinding[];
  fixed: FixedGeometry[];
}

/** The position and size properties of an element, driven by variables or written as fixed lengths */
export function elementGeometry(element: Element, css: string, root?: Element): ElementGeometry {
  const declarations = cssDeclarations(css);
  const bindings: GeometryBinding[] = [];
  const fixed: FixedGeometry[] = [];
  const done = new Set<GeometryProperty>();
  const take = (property: GeometryProperty, part: string, declaration: CssDeclaration, side: number | null) => {
    if (done.has(property)) {
      return;
    }
    done.add(property);
    const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(part)?.[1];
    if (variable) {
      const source = variableDeclaration(element, declarations, variable, root);
      if (source) {
        const length = LENGTH.exec(source.value.trim());
        const sameName = declarations.filter(candidate => candidate.property === variable);
        bindings.push({
          property, variable, declaration: source, index: sameName.indexOf(source), value: source.value.trim(),
          number: length ? Number(length[1]) : null, unit: length ? (length[2] as 'px' | '%' | undefined) ?? 'px' : null,
        });
      }
    } else if (/^-?\d*\.?\d+(px|%)$/.test(part)) {
      fixed.push({ property, value: part, declaration, side });
    }
  };
  // the longhand wins over the shorthand when it comes later or is more specific: compared like the browser
  const candidates: { property: GeometryProperty; part: string; declaration: CssDeclaration; side: number | null; rank: number }[] = [];
  for (const property of Object.keys(GEOMETRY_EDGES) as GeometryProperty[]) {
    const own = winningDeclaration(element, declarations, property);
    if (own) {
      candidates.push({ property, part: own.value.trim(), declaration: own, side: null, rank: matchSpecificity(element, own.selector) * 1e6 + own.order });
    }
  }
  for (const [shorthand, longhands] of Object.entries(SHORTHANDS)) {
    const declaration = winningDeclaration(element, declarations, shorthand);
    const parts = declaration ? sides(valueParts(declaration.value)) : null;
    if (declaration && parts) {
      longhands.forEach((property, side) => candidates.push({
        property, part: parts[side], declaration, side, rank: matchSpecificity(element, declaration.selector) * 1e6 + declaration.order,
      }));
    }
  }
  candidates.sort((a, b) => b.rank - a.rank).forEach(candidate => take(candidate.property, candidate.part, candidate.declaration, candidate.side));
  const order = Object.keys(GEOMETRY_EDGES);
  bindings.sort((a, b) => order.indexOf(a.property) - order.indexOf(b.property));
  fixed.sort((a, b) => order.indexOf(a.property) - order.indexOf(b.property));
  return { bindings, fixed };
}

/** A change of the CSS text: [start, end) replaced by text */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** The value of the n-th declaration of a variable, replaced */
export function variableEdit(css: string, name: string, index: number, value: string): TextEdit | null {
  const declaration = cssDeclarations(css).filter(candidate => candidate.property === name)[index];
  return declaration ? { start: declaration.valueStart, end: declaration.valueEnd, text: value } : null;
}

/**
 * Turns a fixed length into a variable: the value becomes var(--name), and
 * "--name: value;" is declared at the top of the first rule styling the card
 * root (the one holding variables, if any). Null when no rule styles the root.
 */
export function createVariableEdits(css: string, fixed: FixedGeometry, root: Element, name: string): TextEdit[] | null {
  const declarations = cssDeclarations(css);
  const rootRules = [...new Map(declarations.filter(declaration => !declaration.conditional && !declaration.atRule
    && matchSpecificity(root, declaration.selector) >= 0).map(declaration => [declaration.ruleOpen, declaration])).values()];
  const target = rootRules.find(rule => declarations.some(declaration => declaration.ruleOpen === rule.ruleOpen
    && declaration.property.startsWith('--'))) ?? rootRules[0];
  if (!target) {
    return null;
  }
  const current = declarations.find(declaration => declaration.valueStart === fixed.declaration.valueStart);
  if (!current) {
    return null;
  }
  let replacement: TextEdit;
  if (fixed.side === null) {
    replacement = { start: current.valueStart, end: current.valueEnd, text: `var(${name})` };
  } else {
    const parts = sides(valueParts(current.value));
    if (!parts) {
      return null;
    }
    parts[fixed.side] = `var(${name})`;
    // written back in full (4 values): the other sides keep their value
    replacement = { start: current.valueStart, end: current.valueEnd, text: parts.join(' ') };
  }
  // indentation of the rule's first declaration
  const after = css.slice(target.ruleOpen);
  const indent = /^\s*\n([ \t]*)\S/.exec(after)?.[1] ?? '    ';
  const insert: TextEdit = { start: target.ruleOpen, end: target.ruleOpen, text: `\n${indent}${name}: ${fixed.value};` };
  return [insert, replacement].sort((a, b) => b.start - a.start);
}

/** A variable name for a property of an element, not used yet in the CSS */
export function newVariableName(element: Element, property: GeometryProperty, css: string): string {
  const base = (Array.from(element.classList).find(name => !name.startsWith('cider-') && !name.startsWith('cc-'))
    ?? element.id ?? element.tagName.toLowerCase()).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'element';
  let name = `--${base}-${property}`;
  for (let i = 2; new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:`).test(css); i++) {
    name = `--${base}-${property}-${i}`;
  }
  return name;
}
