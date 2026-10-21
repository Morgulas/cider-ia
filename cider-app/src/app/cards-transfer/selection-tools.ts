/**
 * Helpers of the actions on a selection of cards: numbering identifiers and
 * search and replace in card texts.
 */

export interface Numbering {
  prefix: string;
  /** minimum number of digits (zeros added in front) */
  digits: number;
  /** first free number after the existing ones */
  next: number;
}

const NUMBERED = /^(.*?)(\d+)$/;

/**
 * Numbering proposed from the identifiers already in the deck: their most
 * common prefix, their number of digits, the number after the highest one.
 */
export function suggestNumbering(existing: unknown[], fallbackPrefix = ''): Numbering {
  const prefixes = new Map<string, { count: number; digits: number; max: number }>();
  for (const value of existing) {
    const match = NUMBERED.exec(String(value ?? '').trim());
    if (!match) {
      continue;
    }
    const entry = prefixes.get(match[1]) ?? { count: 0, digits: 0, max: 0 };
    entry.count++;
    entry.digits = Math.max(entry.digits, match[2].length);
    entry.max = Math.max(entry.max, Number.parseInt(match[2], 10));
    prefixes.set(match[1], entry);
  }
  let best: [string, { count: number; digits: number; max: number }] | undefined;
  for (const entry of prefixes.entries()) {
    if (!best || entry[1].count > best[1].count) {
      best = entry;
    }
  }
  return best
    ? { prefix: best[0], digits: best[1].digits, next: best[1].max + 1 }
    : { prefix: fallbackPrefix, digits: 3, next: 1 };
}

export function numberedIds(numbering: Numbering, count: number): string[] {
  return Array.from({ length: count },
    (_, i) => numbering.prefix + String(numbering.next + i).padStart(numbering.digits, '0'));
}

export interface ReplaceOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function searchPattern(search: string, options: ReplaceOptions): RegExp | null {
  if (!search) {
    return null;
  }
  const body = escapeRegExp(search);
  // \b does not know accented letters: words are bounded by anything but a letter or a digit
  const pattern = options.wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body;
  return new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu');
}

/** Replaces every occurrence; returns the new text and the number of replacements */
export function replaceInText(text: string, search: string, replacement: string,
  options: ReplaceOptions): { text: string; count: number } {
  const pattern = searchPattern(search, options);
  if (!pattern || !text) {
    return { text, count: 0 };
  }
  let count = 0;
  const result = text.replace(pattern, () => {
    count++;
    return replacement;
  });
  return { text: result, count };
}
