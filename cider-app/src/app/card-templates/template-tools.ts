/**
 * Helpers of the template editor that do not need the page: CSS formatting,
 * source line marks for the inspector, CSS variables for the visual settings,
 * and the cards worth checking for text overflow.
 */

/*********************************************************************
 * CSS formatting (Handlebars expressions are kept as they are)
 *********************************************************************/

/**
 * Re-indents CSS: one declaration per line, blocks indented, a blank line
 * between top-level rules. Comments, strings and {{handlebars}} are copied
 * untouched; {{#if}}...{{/if}} blocks get their own lines.
 */
export function formatCss(source: string, indentUnit = '    '): string {
  const lines: string[] = [];
  let line = '';
  let depth = 0;
  const flush = () => {
    const text = line.trim();
    if (text) {
      lines.push(indentUnit.repeat(Math.max(depth, 0)) + text);
    }
    line = '';
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      line += source.slice(i, stop);
      i = stop;
      continue;
    }
    if (rest.startsWith('{{')) {
      const triple = rest.startsWith('{{{');
      const end = source.indexOf(triple ? '}}}' : '}}', i + 2);
      const stop = end === -1 ? source.length : end + (triple ? 3 : 2);
      const expression = source.slice(i, stop);
      if (/^\{\{~?\s*([#/^]|else\b)/.test(expression)) {
        // block tags on their own line
        flush();
        line = expression;
        flush();
      } else {
        line += expression;
      }
      i = stop;
      continue;
    }
    const char = source[i];
    if (char === '"' || char === '\'') {
      let j = i + 1;
      while (j < source.length && source[j] !== char) {
        j += source[j] === '\\' ? 2 : 1;
      }
      line += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (char === '{') {
      line = line.trim() + ' {';
      flush();
      depth++;
    } else if (char === '}') {
      flush();
      depth--;
      line = '}';
      flush();
      if (depth <= 0) {
        lines.push('');
      }
    } else if (char === ';') {
      line += ';';
      flush();
    } else if (/\s/.test(char)) {
      if (line && !line.endsWith(' ')) {
        line += ' ';
      }
    } else {
      line += char;
    }
    i++;
  }
  flush();
  // no blank lines in a row, none at the end
  return lines.filter((text, index) => text !== '' || (index > 0 && lines[index - 1] !== '')).join('\n').trim() + '\n';
}

/*********************************************************************
 * Inspector: each HTML tag remembers its source line
 *********************************************************************/

export const LINE_ATTRIBUTE = 'data-cider-line';

/**
 * Adds data-cider-line="<line>" to every opening tag of the template, so a
 * click on the preview can find the line of the element. Comments and
 * {{handlebars}} expressions are left alone.
 */
export function annotateLines(html: string): string {
  if (!html) {
    return html;
  }
  let line = 1;
  let last = 0;
  return html.replace(/<!--[\s\S]*?-->|\{\{[\s\S]*?\}\}|<([a-zA-Z][\w-]*)(?=[\s/>])/g, (match, tag: string | undefined, offset: number) => {
    for (let i = last; i < offset; i++) {
      if (html.charCodeAt(i) === 10) {
        line++;
      }
    }
    last = offset;
    return tag ? `<${tag} ${LINE_ATTRIBUTE}="${line}"` : match;
  });
}

/*********************************************************************
 * CSS variables, edited with color pickers and sliders
 *********************************************************************/

export interface CssVariable {
  name: string;
  value: string;
  /** offsets of the value in the CSS */
  start: number;
  end: number;
  kind: 'color' | 'length' | 'text';
  /** for a length: the number and its unit (px, em, %...) */
  number?: number;
  unit?: string;
}

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([^()]*\)|[a-z]+)$/i;
const LENGTH_VALUE = /^(-?\d*\.?\d+)(px|em|rem|%|vh|vw|deg|pt|mm|cm|in|s|ms)?$/i;
const NOT_COLORS = ['inherit', 'initial', 'unset', 'none', 'auto', 'normal', 'bold', 'italic', 'center', 'left', 'right',
  'solid', 'dashed', 'dotted', 'cover', 'contain', 'block', 'flex', 'grid', 'hidden', 'visible', 'uppercase', 'lowercase'];

/**
 * The CSS custom properties (--name: value) of a template, first declaration
 * of each name, with what kind of control fits their value.
 */
export function findCssVariables(css: string): CssVariable[] {
  const variables: CssVariable[] = [];
  const seen = new Set<string>();
  // comments are blanked (same length) so offsets stay right
  const text = css.replace(/\/\*[\s\S]*?\*\//g, comment => ' '.repeat(comment.length));
  const pattern = /(--[\w-]+)(\s*:\s*)([^;{}]*?)\s*(?=[;}])/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    const value = match[3];
    if (seen.has(name) || !value) {
      continue;
    }
    seen.add(name);
    const start = (match.index ?? 0) + name.length + match[2].length;
    const variable: CssVariable = { name, value, start, end: start + value.length, kind: 'text' };
    const length = LENGTH_VALUE.exec(value);
    if (length) {
      variable.kind = 'length';
      variable.number = Number(length[1]);
      variable.unit = length[2] ?? '';
    } else if (COLOR_VALUE.test(value) && !NOT_COLORS.includes(value.toLowerCase())) {
      variable.kind = 'color';
    }
    variables.push(variable);
  }
  return variables;
}

/** Writes a color picked as #rrggbb in the format the value used (hsl, rgb or hex) */
export function formatColorLike(previous: string, hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (/^hsl/i.test(previous)) {
    const [h, s, l] = rgbToHsl(r, g, b);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  if (/^rgb/i.test(previous)) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return hex;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === red) {
      h = (green - blue) / d + (green < blue ? 6 : 0);
    } else if (max === green) {
      h = (blue - red) / d + 2;
    } else {
      h = (red - green) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** Range of a slider for a length value */
export function sliderRange(variable: CssVariable): { min: number; max: number; step: number } {
  const value = variable.number ?? 0;
  const unit = (variable.unit ?? '').toLowerCase();
  if (unit === '%') {
    return { min: 0, max: Math.max(100, Math.ceil(value * 1.5)), step: 1 };
  }
  if (unit === 'deg') {
    return { min: -180, max: 360, step: 1 };
  }
  if (['em', 'rem', 's'].includes(unit) || (Math.abs(value) < 5 && !Number.isInteger(value))) {
    return { min: Math.min(0, value), max: Math.max(5, Math.ceil(Math.abs(value) * 3)), step: 0.05 };
  }
  return { min: Math.min(0, value), max: Math.max(100, Math.ceil(Math.abs(value) * 3)), step: 1 };
}

/*********************************************************************
 * Overflow test: the cards most likely to overflow
 *********************************************************************/

export interface OverflowCandidate<C> {
  card: C;
  /** why the card was picked: current, longest:<field label>, total, shortest */
  reasons: { kind: 'current' | 'longest' | 'total' | 'shortest'; field?: string }[];
}

/** Length of a value as shown (markup left out) */
export function textLength(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  return String(value).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim().length;
}

/**
 * Picks the cards worth checking for overflow: the current one, the one with
 * the longest value of each text field, the longest text overall and the
 * shortest one (empty fields can break a layout too). At most `limit` cards.
 */
export function pickOverflowCards<C extends { id: number }>(cards: C[], fields: { key: string; label: string }[],
  current: C | undefined, limit = 6): OverflowCandidate<C>[] {
  const picked = new Map<number, OverflowCandidate<C>>();
  const add = (card: C | undefined, reason: OverflowCandidate<C>['reasons'][number]) => {
    if (!card) {
      return;
    }
    const entry = picked.get(card.id);
    if (entry) {
      entry.reasons.push(reason);
    } else if (picked.size < limit) {
      picked.set(card.id, { card, reasons: [reason] });
    }
  };
  const value = (card: C, key: string) => textLength((card as unknown as Record<string, unknown>)[key]);
  const total = (card: C) => fields.reduce((sum, field) => sum + value(card, field.key), 0);
  const maxBy = (score: (card: C) => number) => cards.reduce<C | undefined>((best, card) =>
    !best || score(card) > score(best) ? card : best, undefined);

  if (current && cards.some(card => card.id === current.id)) {
    add(current, { kind: 'current' });
  }
  for (const field of fields) {
    const card = maxBy(candidate => value(candidate, field.key));
    if (card && value(card, field.key) > 0) {
      add(card, { kind: 'longest', field: field.label });
    }
  }
  add(maxBy(total), { kind: 'total' });
  add(maxBy(card => -total(card)), { kind: 'shortest' });
  return [...picked.values()];
}

/*********************************************************************
 * Inspector: CSS rules of an element
 *********************************************************************/

export interface CssRule {
  /** selector as written (a list may hold several: ".a, .b") */
  selector: string;
  /** 1-based lines of the selector and of the closing brace */
  line: number;
  endLine: number;
}

/** At-rules whose blocks hold no element selectors */
const NON_STYLE_AT_RULES = /^@(font-face|keyframes|-webkit-keyframes|page|property|counter-style|import|charset)/i;

/**
 * The style rules of a CSS text with their lines, rules inside @media or
 * @supports included. Comments are skipped; {{handlebars}} braces are not
 * taken for CSS blocks.
 */
export function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  // comments and {{ }} blanked, same length (line numbers stay right)
  const text = css
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\{\{[\s\S]*?\}\}/g, match => match.replace(/[^\n]/g, ' '));
  const lineAt = (index: number) => text.slice(0, index).split('\n').length;
  const stack: { rule?: CssRule; skip: boolean }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{') {
      const prelude = text.slice(start, i);
      const selector = prelude.trim();
      const parentSkips = stack.some(entry => entry.skip || entry.rule);
      if (selector.startsWith('@')) {
        stack.push({ skip: NON_STYLE_AT_RULES.test(selector) });
      } else if (selector && !parentSkips) {
        const offset = start + prelude.indexOf(selector);
        // shown as written (a {{handlebars}} part of a selector included)
        const written = css.slice(offset, offset + selector.length).replace(/\s+/g, ' ');
        const rule: CssRule = { selector: written, line: lineAt(offset), endLine: lineAt(offset) };
        rules.push(rule);
        stack.push({ rule, skip: false });
      } else {
        stack.push({ skip: true });
      }
      start = i + 1;
    } else if (char === '}') {
      const entry = stack.pop();
      if (entry?.rule) {
        entry.rule.endLine = lineAt(i);
      }
      start = i + 1;
    } else if (char === ';' && !stack.some(entry => entry.rule)) {
      // @import ...; at the top level
      start = i + 1;
    }
  }
  return rules;
}

/** Splits "a, b:not(.c, .d)" at the top-level commas */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth--;
    }
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * The selector to test against an element: pseudo-elements (::before) and
 * state pseudo-classes (:hover...) are removed, so the rule is found even
 * when the state is not active. Undefined if nothing is left to match.
 */
export function matchableSelector(selector: string): string | undefined {
  const cleaned = selector
    .replace(/::?(before|after|first-line|first-letter|marker|placeholder|selection|backdrop)\b/gi, '')
    .replace(/:(hover|active|focus|focus-within|focus-visible|visited|link|target)\b/gi, '')
    .trim();
  return cleaned || undefined;
}
