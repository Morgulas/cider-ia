import * as Handlebars from 'handlebars';

/**
 * A problem found in a template: shown in a banner and underlined in the editor.
 * `code` picks a readable explanation (translated), `detail` is the raw
 * Handlebars message, kept for the cases without explanation.
 *  - unclosed-block: a {{#name}} block has no {{/name}} (params.name)
 *  - mismatched-block: {{/close}} ends a {{#open}} block (params.open, params.close)
 *  - unclosed-tag: a {{ is not closed by }}
 *  - render: the template reads, but fails with this card (a helper...)
 *  - syntax: any other reading error
 */
export interface TemplateIssue {
  code: 'unclosed-block' | 'mismatched-block' | 'unclosed-tag' | 'render' | 'syntax';
  params: Record<string, string>;
  detail: string;
  /** 1-based line of the problem, when known */
  line?: number;
}

const BLOCK_TAG = /\{\{~?\s*([#/^])\s*>?\s*([^\s}~()]+)/g;

const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length;

/** The innermost block opened and never closed, if any */
function unclosedBlock(source: string): { name: string; line: number } | undefined {
  const stack: { name: string; index: number }[] = [];
  for (const match of source.matchAll(BLOCK_TAG)) {
    const [, kind, name] = match;
    if (kind === '#' || kind === '^') {
      stack.push({ name, index: match.index ?? 0 });
    } else if (stack.length > 0 && stack[stack.length - 1].name === name) {
      stack.pop();
    }
  }
  const last = stack.pop();
  return last ? { name: last.name, line: lineAt(source, last.index) } : undefined;
}

/** The {{ without }} closest to the reported line */
function unclosedTagLine(source: string, reported?: number): number | undefined {
  const lines = source.split('\n');
  const candidates: number[] = [];
  lines.forEach((text, i) => {
    const opens = (text.match(/\{\{/g) ?? []).length;
    const closes = (text.match(/\}\}/g) ?? []).length;
    if (opens > closes) {
      candidates.push(i + 1);
    }
  });
  if (candidates.length === 0) {
    return reported;
  }
  return reported === undefined ? candidates[0]
    : candidates.reduce((best, line) => Math.abs(line - reported) < Math.abs(best - reported) ? line : best);
}

function describe(error: unknown, source: string): TemplateIssue {
  const detail = error instanceof Error ? error.message : String(error);
  const e = error as { lineNumber?: unknown };
  const reportedLine = typeof e?.lineNumber === 'number' ? e.lineNumber
    : (/on line (\d+)/.exec(detail) ? Number(/on line (\d+)/.exec(detail)![1]) : undefined);

  const mismatch = /^(\S+) doesn't match (\S+)/.exec(detail);
  if (mismatch) {
    return { code: 'mismatched-block', params: { open: mismatch[1], close: mismatch[2] }, detail, line: reportedLine };
  }
  if (/got 'EOF'/.test(detail)) {
    const block = unclosedBlock(source);
    if (block) {
      return { code: 'unclosed-block', params: { name: block.name }, detail, line: block.line };
    }
  }
  if (/Expecting '[^']*CLOSE/.test(detail) && /got '(INVALID|EOF|CONTENT)'/.test(detail)) {
    return { code: 'unclosed-tag', params: {}, detail, line: unclosedTagLine(source, reportedLine) };
  }
  return { code: 'syntax', params: {}, detail: detail.split('\n')[0], line: reportedLine };
}

/**
 * Checks that a template can be read (balanced blocks, closed {{ }}...) and, when
 * a card is given, that it renders with that card (a helper may fail on a value).
 * Returns null when everything is fine.
 */
export function checkTemplate(source: string | undefined, card?: unknown, assets?: unknown): TemplateIssue | null {
  if (!source) {
    return null;
  }
  let template: HandlebarsTemplateDelegate;
  try {
    // precompile reads the whole template now (compile waits for the first render)
    Handlebars.precompile(source);
    template = Handlebars.compile(source);
  } catch (error) {
    return describe(error, source);
  }
  if (card !== undefined) {
    try {
      template({ card, assets });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const e = error as { lineNumber?: unknown };
      return { code: 'render', params: {}, detail, line: typeof e?.lineNumber === 'number' ? e.lineNumber : undefined };
    }
  }
  return null;
}
