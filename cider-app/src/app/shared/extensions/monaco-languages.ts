import * as Handlebars from 'handlebars';
// types only (Monaco itself is loaded by ngx-monaco-editor, as window.monaco)
import type * as Monaco from 'monaco-editor';

type MonacoApi = typeof Monaco;

/** Positions and edits as the CSS language service (LSP) gives them: 0-based */
interface LspPosition { line: number; character: number; }
interface LspRange { start: LspPosition; end: LspPosition; }
interface LspTextEdit { range: LspRange; newText: string; }
interface LspInsertReplaceEdit { newText: string; insert: LspRange; replace: LspRange; }
interface LspCommand { title: string; command: string; arguments?: unknown[]; }
interface LspCompletionItem {
    label: string;
    kind?: number;
    detail?: string;
    documentation?: string | Monaco.IMarkdownString;
    sortText?: string;
    filterText?: string;
    insertText?: string;
    insertTextFormat?: number;
    textEdit?: LspTextEdit | LspInsertReplaceEdit;
    additionalTextEdits?: LspTextEdit[];
    command?: LspCommand;
}
interface LspColorInformation { range: LspRange; color: Monaco.languages.IColor; }
interface LspColorPresentation { label: string; textEdit?: LspTextEdit; additionalTextEdits?: LspTextEdit[]; }

/** What the CSS worker of Monaco answers (vs/language/css/cssWorker) */
export interface CssWorkerClient {
    doComplete(uri: string, position: LspPosition): Promise<{ isIncomplete: boolean; items: LspCompletionItem[] } | null>;
    findDocumentColors(uri: string): Promise<LspColorInformation[] | null>;
    getColorPresentations(uri: string, color: Monaco.languages.IColor, range: LspRange): Promise<LspColorPresentation[] | null>;
}
export type CssWorker = Monaco.editor.MonacoWebWorker<CssWorkerClient>;
export type CssWorkerAccessor = (resource: Monaco.Uri) => Promise<CssWorkerClient>;


/** A value offered after {{ : card.niveau, @root.card.name... */
export interface CompletionVariable {
    /** inserted text, e.g. card.niveau */
    path: string;
    /** attribute name, shown next to the path */
    label: string;
    /** e.g. "numeric" */
    detail?: string;
    /** e.g. the preview card's value */
    documentation?: string;
}

export interface HandlebarsCompletionContext {
    variables: CompletionVariable[];
    /** e.g. { path: 'assets.dossier.parchemin', label: 'dossier/parchemin' } */
    assets: CompletionVariable[];
    /** helper name → short explanation with an example */
    helperDocs: Record<string, string>;
}

export default class MonacoLanguages {

    static createCssWorker(monaco: MonacoApi): CssWorker {
        return monaco.editor.createWebWorker<CssWorkerClient>({
            // module that exports the create() method and returns a `CSSWorker` instance
            moduleId: 'vs/language/css/cssWorker',
            label: 'css',

            // passed in to the create() method
            createData: {
                options: MonacoLanguages.optionsDefault,
                languageId: 'css',
            }
        });
    }

    static createWorkerPromise(worker: CssWorker): CssWorkerAccessor {
        return (resource: Monaco.Uri) => worker.getProxy()
            .then(client => worker.withSyncedResources([resource]).then(() => client));
    }

    /**
     * What the editor currently knows about the open template: the deck's card
     * attributes (with the preview card's value), the project images, and a
     * description of each helper. Filled by the template editor.
     */
    static completionContext: HandlebarsCompletionContext = { variables: [], assets: [], helperDocs: {} };

    static createHandlebarsCompletionProvider(monaco: MonacoApi): Monaco.languages.CompletionItemProvider {
        return {
            triggerCharacters: ['{', '.'],
            provideCompletionItems: (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
                if (!MonacoLanguages.isInsideHandlebars(model, position)) {
                    return { suggestions: [] };
                }
                // the whole path before the cursor (card.cl, assets.dossier.im...) is replaced
                const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
                const typed = /[\w.@#-]*$/.exec(before)?.[0] ?? '';
                const wordRange: Monaco.IRange = {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column - typed.length,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                };
                const context = MonacoLanguages.completionContext;
                const kinds = monaco.languages.CompletionItemKind;

                // card attributes of the deck (default ones until the editor gives them)
                const variables: CompletionVariable[] = context.variables.length > 0 ? context.variables
                    : ['card.name', 'card.description', 'card.count'].map(path => ({ path, label: path }));
                const variableSuggestions: Monaco.languages.CompletionItem[] = variables.map((variable, i) => ({
                    label: { label: variable.path, description: variable.label },
                    kind: kinds.Field,
                    insertText: variable.path,
                    filterText: variable.path,
                    sortText: 'a' + String(i).padStart(4, '0'),
                    detail: variable.detail,
                    documentation: variable.documentation,
                    range: wordRange
                }));

                // project images
                const assetSuggestions: Monaco.languages.CompletionItem[] = (context.assets.length > 0 ? context.assets : [{ path: 'assets', label: 'assets' }])
                    .map(asset => ({
                        label: { label: asset.path, description: asset.label },
                        kind: kinds.File,
                        insertText: asset.path,
                        filterText: asset.path,
                        sortText: 'b' + asset.path,
                        range: wordRange
                    }));

                const snippetKeys = ['if', 'unless', 'each', 'with', 'repeat'];
                const snippetSuggestions: Monaco.languages.CompletionItem[] = snippetKeys.map(snippet => ({
                    label: '#' + snippet,
                    kind: kinds.Snippet,
                    insertText: '#' + snippet + ' $1}}\n\t$0\n{{/' + snippet,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    documentation: context.helperDocs[snippet] ?? snippet,
                    sortText: 'c' + snippet,
                    range: wordRange
                }));
                snippetSuggestions.push({
                    label: 'else',
                    kind: kinds.Keyword,
                    insertText: 'else',
                    documentation: context.helperDocs['else'] ?? 'else',
                    sortText: 'celse',
                    range: wordRange
                });

                // setup handlebars helpers suggestions
                const helperExclusions = ['helperMissing', 'blockHelperMissing', 'compileImages', 'kebab-case', ...snippetKeys, 'else'];
                const helperKeys = Object.keys(Handlebars.helpers).filter(key => helperExclusions.indexOf(key) === -1);
                const helperSuggestions: Monaco.languages.CompletionItem[] = helperKeys.map(key => ({
                    label: key,
                    kind: kinds.Function,
                    insertText: key + ' ',
                    documentation: context.helperDocs[key] ?? key,
                    sortText: 'd' + key,
                    range: wordRange
                }));

                return {
                    suggestions: [
                        ...variableSuggestions,
                        ...assetSuggestions,
                        ...snippetSuggestions,
                        ...helperSuggestions,
                    ]
                };
            }
        };
    }

    static createCssCompletionProvider(monaco: MonacoApi, cssWorker: CssWorker): Monaco.languages.CompletionItemProvider {
        return {
            triggerCharacters: ['/', '-', ':'],
            provideCompletionItems: (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
                if (MonacoLanguages.isInsideHandlebars(model, position)) {
                    return { suggestions: [] };
                }

                const resource = model.uri;
                return cssWorker.getProxy().then(client => {
                    return cssWorker.withSyncedResources([resource]).then(() => {
                        return client.doComplete(resource.toString(), MonacoLanguages.fromPosition(position));
                    });
                }).then(info => {
                    if (!info) {
                        return undefined;
                    }
                    const wordInfo = model.getWordUntilPosition(position);
                    const wordRange: Monaco.IRange = {
                        startLineNumber: position.lineNumber,
                        startColumn: wordInfo.startColumn,
                        endLineNumber: position.lineNumber,
                        endColumn: wordInfo.endColumn
                    };

                    const items = info.items.map(entry => {
                        const item: Monaco.languages.CompletionItem = {
                            label: entry.label,
                            insertText: entry.insertText || entry.label,
                            sortText: entry.sortText,
                            filterText: entry.filterText,
                            documentation: entry.documentation,
                            detail: entry.detail,
                            command: MonacoLanguages.toCommand(entry.command),
                            range: wordRange,
                            kind: MonacoLanguages.toCompletionItemKind(monaco, entry.kind)
                        };
                        if (entry.textEdit) {
                            if (MonacoLanguages.isInsertReplaceEdit(entry.textEdit)) {
                                item.range = {
                                    insert: MonacoLanguages.toRange(entry.textEdit.insert),
                                    replace: MonacoLanguages.toRange(entry.textEdit.replace)
                                };
                            } else {
                                item.range = MonacoLanguages.toRange(entry.textEdit.range);
                            }
                            item.insertText = entry.textEdit.newText;
                        }
                        if (entry.additionalTextEdits) {
                            item.additionalTextEdits = entry.additionalTextEdits.map(MonacoLanguages.toTextEdit);
                        }
                        if (entry.insertTextFormat === 2) {
                            item.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
                        }
                        return item;
                    });

                    return {
                        incomplete: info.isIncomplete,
                        suggestions: items
                    };
                });

            }
        };
    }

    // Utility function to detect if the current position is inside a Handlebars block.
    static isInsideHandlebars(model: Monaco.editor.ITextModel, position: Monaco.IPosition): boolean {
        // a {{ before the cursor, not closed yet by }}
        const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const lastIndexOfOpen = before.lastIndexOf('{{');
        return lastIndexOfOpen > -1 && before.lastIndexOf('}}') < lastIndexOfOpen;
    }

    static fromPosition(position: Monaco.IPosition): LspPosition {
        return { character: position.column - 1, line: position.lineNumber - 1 };
    }

    static toTextEdit(textEdit: LspTextEdit): Monaco.languages.TextEdit {
        return {
            range: MonacoLanguages.toRange(textEdit.range),
            text: textEdit.newText
        };
    }

    static isInsertReplaceEdit(edit: LspTextEdit | LspInsertReplaceEdit): edit is LspInsertReplaceEdit {
        return 'insert' in edit && 'replace' in edit;
    }

    static fromRange(range: Monaco.IRange): LspRange {
        return {
            start: {
                line: range.startLineNumber - 1,
                character: range.startColumn - 1
            },
            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
        };
    }

    static toRange(range: LspRange): Monaco.IRange {
        return {
            startLineNumber: range.start.line + 1,
            startColumn: range.start.character + 1,
            endLineNumber: range.end.line + 1,
            endColumn: range.end.character + 1
        };
    }

    static toCommand(c: LspCommand | undefined): Monaco.languages.Command | undefined {
        return c && c.command === 'editor.action.triggerSuggest'
            ? { id: c.command, title: c.title, arguments: c.arguments }
            : undefined;
    }

    /** LSP completion kinds (0-based here) to Monaco's */
    static toCompletionItemKind(monaco: MonacoApi, kind: number | undefined): Monaco.languages.CompletionItemKind {
        const kinds = monaco.languages.CompletionItemKind;
        const byLspKind = [kinds.Text, kinds.Method, kinds.Function, kinds.Constructor, kinds.Field, kinds.Variable,
            kinds.Class, kinds.Interface, kinds.Module, kinds.Property, kinds.Unit, kinds.Value, kinds.Enum,
            kinds.Keyword, kinds.Snippet, kinds.Color, kinds.File, kinds.Reference];
        return kind !== undefined && kind >= 0 && kind < byLspKind.length ? byLspKind[kind] : kinds.Property;
    }

    static optionsDefault: Record<string, unknown> = {
        validate: true,
        lint: {
            compatibleVendorPrefixes: 'ignore',
            vendorPrefix: 'warning',
            duplicateProperties: 'warning',
            emptyRules: 'warning',
            importStatement: 'ignore',
            boxModel: 'ignore',
            universalSelector: 'ignore',
            zeroUnits: 'ignore',
            fontFaceProperties: 'warning',
            hexColorLength: 'error',
            argumentsInColorFunction: 'error',
            unknownProperties: 'warning',
            ieHack: 'ignore',
            unknownVendorSpecificProperties: 'ignore',
            propertyIgnoredDueToDisplay: 'warning',
            important: 'ignore',
            float: 'ignore',
            idSelector: 'ignore'
        },
        data: { useDefaultDataProvider: true },
        format: {
            newlineBetweenSelectors: true,
            newlineBetweenRules: true,
            spaceAroundSelectorSeparator: false,
            braceStyle: 'collapse',
            maxPreserveNewLines: undefined,
            preserveNewLines: true
        }
    };
}

export class DocumentColorAdapter implements Monaco.languages.DocumentColorProvider {
    constructor(private readonly _worker: CssWorkerAccessor) {}

    public provideDocumentColors(model: Monaco.editor.ITextModel): Promise<Monaco.languages.IColorInformation[] | undefined> {
        const resource = model.uri;

        return this._worker(resource)
            .then(worker => worker.findDocumentColors(resource.toString()))
            .then(infos => infos?.map(item => ({
                color: item.color,
                range: MonacoLanguages.toRange(item.range)
            })));
    }

    public provideColorPresentations(model: Monaco.editor.ITextModel,
        info: Monaco.languages.IColorInformation): Promise<Monaco.languages.IColorPresentation[] | undefined> {
        const resource = model.uri;

        return this._worker(resource)
            .then(worker =>
                worker.getColorPresentations(resource.toString(), info.color, MonacoLanguages.fromRange(info.range))
            )
            .then(presentations => presentations?.map(presentation => {
                const item: Monaco.languages.IColorPresentation = {
                    label: presentation.label
                };
                if (presentation.textEdit) {
                    item.textEdit = MonacoLanguages.toTextEdit(presentation.textEdit);
                }
                if (presentation.additionalTextEdits) {
                    item.additionalTextEdits = presentation.additionalTextEdits.map(MonacoLanguages.toTextEdit);
                }
                return item;
            }));
    }
}
