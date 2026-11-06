/**
 * "Edit with a chatbot": the user describes a change, copies a prompt into any
 * chatbot (ChatGPT, Le Chat...), then pastes the answer back. The prompt holds
 * everything the chatbot needs (current code, the deck's attributes with an
 * example value, the project images, the helpers) and asks for the complete
 * HTML and CSS in two code blocks, which parseChatbotAnswer() reads.
 */

/** A card value usable in the template */
export interface TemplateVariable {
  /** text inserted in the template, e.g. {{card.niveau}} */
  token: string;
  /** attribute name shown to the user */
  label: string;
  /** text, numeric, dropdown, checkbox... */
  type?: string;
  /** dropdown choices */
  options?: string[];
  /** value of the preview card */
  example?: string;
}

/** Texts of the prompt, in the user's language */
export interface ChatbotPromptTexts {
  intro: string;
  requestTitle: string;
  rulesTitle: string;
  rules: string[];
  attributesTitle: string;
  optionsLabel: string;
  exampleLabel: string;
  helpersTitle: string;
  assetsTitle: string;
  htmlTitle: string;
  cssTitle: string;
  answerFormat: string;
}

export interface ChatbotPromptInput {
  request: string;
  html: string;
  css: string;
  deckName?: string;
  variables: TemplateVariable[];
  /** e.g. {{assets.fond-parchemin}} */
  assets: string[];
  /** e.g. {{#if (eq card.classe "Mage")}} */
  helpers: string[];
  texts: ChatbotPromptTexts;
}

/** Images listed in the prompt at most (a long list says nothing more) */
export const MAX_PROMPT_ASSETS = 80;
const MAX_EXAMPLE_LENGTH = 160;

const fence = (language: string, code: string) => '```' + language + '\n' + code.trim() + '\n```';

function oneLine(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_EXAMPLE_LENGTH ? flat.slice(0, MAX_EXAMPLE_LENGTH) + '…' : flat;
}

export function buildTemplatePrompt(input: ChatbotPromptInput): string {
  const t = input.texts;
  const parts: string[] = [t.intro + (input.deckName ? ` (${input.deckName})` : '')];
  parts.push(`${t.requestTitle}\n${input.request.trim()}`);
  parts.push(`${t.rulesTitle}\n${t.rules.map(rule => `- ${rule}`).join('\n')}`);

  const variables = input.variables.map(variable => {
    let line = `- ${variable.token} : ${variable.label}`;
    if (variable.type) {
      line += ` (${variable.type})`;
    }
    if (variable.options && variable.options.length > 0) {
      line += ` — ${t.optionsLabel} ${variable.options.map(option => `"${option}"`).join(', ')}`;
    }
    if (variable.example) {
      line += ` — ${t.exampleLabel} ${oneLine(variable.example)}`;
    }
    return line;
  });
  parts.push(`${t.attributesTitle}\n${variables.join('\n')}`);

  if (input.helpers.length > 0) {
    parts.push(`${t.helpersTitle}\n${input.helpers.map(helper => `- ${helper}`).join('\n')}`);
  }
  if (input.assets.length > 0) {
    const listed = input.assets.slice(0, MAX_PROMPT_ASSETS);
    const more = input.assets.length > listed.length ? `\n- … (+${input.assets.length - listed.length})` : '';
    parts.push(`${t.assetsTitle}\n${listed.map(asset => `- ${asset}`).join('\n')}${more}`);
  }
  parts.push(`${t.htmlTitle}\n${fence('html', input.html || '')}`);
  parts.push(`${t.cssTitle}\n${fence('css', input.css || '')}`);
  parts.push(t.answerFormat);
  return parts.join('\n\n');
}

export interface ChatbotAnswer {
  html?: string;
  css?: string;
}

const HTML_LANGUAGES = ['html', 'htm', 'handlebars', 'hbs', 'xml', 'xhtml', 'mustache'];
const CSS_LANGUAGES = ['css', 'scss', 'less'];

/** Kind of an unlabelled block, from its content */
function guessLanguage(code: string): 'html' | 'css' | undefined {
  const start = code.trimStart();
  if (start.startsWith('<') || start.startsWith('{{')) {
    return 'html';
  }
  if (/^[^{}<]*\{[^{}]*:[^{}]*\}/.test(start)) {
    return 'css';
  }
  return undefined;
}

/**
 * Reads the HTML and CSS out of a chatbot answer: the ```html and ```css code
 * blocks (unlabelled blocks are recognized by their content). When a kind
 * appears several times, the last block wins (chatbots often show a fragment,
 * then the complete code). A missing kind stays undefined: not changed.
 */
export function parseChatbotAnswer(answer: string): ChatbotAnswer {
  const result: ChatbotAnswer = {};
  const blocks = /```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
  for (const match of answer.matchAll(blocks)) {
    const language = match[1].toLowerCase();
    const code = match[2].replace(/\s+$/, '');
    const kind = HTML_LANGUAGES.includes(language) ? 'html'
      : CSS_LANGUAGES.includes(language) ? 'css'
        : guessLanguage(code);
    if (kind) {
      result[kind] = code;
    }
  }
  return result;
}
