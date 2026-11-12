import type * as Monaco from 'monaco-editor';
import type { SplitterResizeEndEvent, SplitterResizeStartEvent } from 'primeng/types/splitter';
import { Component, OnInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Document } from '../data-services/types/document.type';
import { DocumentsService } from '../data-services/services/documents.service';
import { debounceTime, Subject, Subscription } from 'rxjs';
import { ThemeService } from '../data-services/theme/theme.service';
import { Bind } from 'primeng/bind';
import { Splitter } from 'primeng/splitter';
import { PrimeTemplate } from 'primeng/api';
import { Card } from 'primeng/card';
import { MarkdownComponent, provideMarkdown } from 'ngx-markdown';
import { EditorComponent } from 'ngx-monaco-editor-v2';
import { FormsModule } from '@angular/forms';
import ScriptLoader from '../shared/utils/script-loader';

@Component({
    selector: 'app-document',
    templateUrl: './document.component.html',
    styleUrl: './document.component.scss',
    imports: [Bind, Splitter, PrimeTemplate, Card, MarkdownComponent, EditorComponent, FormsModule],
    // Markdown (marked) is only needed here: not loaded with the rest of the application
    providers: [provideMarkdown()]
})
export class DocumentComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  editorOptions: { theme: string; language: string; automaticLayout: boolean; minimap: { enabled: boolean } } = {
    theme: 'vs-dark-extended', language: 'markdown',
    automaticLayout: true, minimap: { enabled: false }
  };
  mermaidOptions: Record<string, unknown> = {
    theme: 'dark'
  };
  /** Mermaid is downloaded only when a markdown document is opened */
  mermaidReady = false;

  /** Markdown, also for documents saved without a type (older projects, samples), as the export assumes */
  get isMarkdown(): boolean {
    return !this.textDocument?.mime || this.textDocument.mime === 'text/markdown';
  }
  textDocument: Document = {
    name: "",
    mime: "text/markdown",
    content: ""
  } as Document;
  disablePanels = false;
  documentChanges: Subject<boolean>;
  private editor?: Monaco.editor.IStandaloneCodeEditor;
  private monaco?: typeof Monaco;
  private themeSubscription: Subscription | null = null;
  /** document whose text changed and is not saved yet */
  private pendingDocument: Document | null = null;
  /** text of each document as saved, to skip saves that change nothing */
  private readonly savedContent = new WeakMap<Document, string>();

  constructor(private route: ActivatedRoute,
    private themeService: ThemeService,
    private documentsService: DocumentsService,
  ) {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const documentIdString = params.get('documentId') || '';
      const documentId = parseInt(documentIdString, 10);
      // the document left keeps its last changes (typed less than a second ago)
      void this.flushSave();
      if (!isNaN(documentId)) {
        this.documentsService.get(documentId).then((textDocument) => {
          this.textDocument = textDocument;
          this.savedContent.set(textDocument, textDocument.content);
          this.updateEditorType();
        }).catch(error => {
          console.error(`Error fetching document with ID ${documentId}:`, error);
        });
      } else {
        this.textDocument = {
          name: "New Document",
          mime: "text/markdown",
          content: ""
        } as Document;
      }
    });
    this.documentChanges = new Subject();

    // Set initial theme based on current theme
    const isDark = this.themeService.isDarkMode();
    this.editorOptions.theme = isDark ? 'vs-dark-extended' : 'vs';
    this.mermaidOptions = {
      theme: isDark ? 'dark' : 'default',
    };
  }

  protected editorInitialized(editor: Monaco.editor.IStandaloneCodeEditor) {
    this.editor = editor;
    this.monaco = (window as unknown as { monaco: typeof Monaco }).monaco;
    this.updateEditorType();
  }

  private updateEditorType() {
    if (this.textDocument.mime === 'text/html') {
      this.editorOptions.language = 'html';
    } else if (this.textDocument.mime === 'text/css') {
      this.editorOptions.language = 'css-handlebars';
    } else if (this.textDocument.mime === 'application/javascript') {
      this.editorOptions.language = 'javascript';
    } else {
      this.editorOptions.language = 'markdown';
    }

    if (this.editor && this.monaco) {
      const model = this.editor.getModel();
      if (model) {
        this.monaco.editor.setModelLanguage(model, this.editorOptions.language);
      }
    }
  }

  ngOnInit(): void {
    ScriptLoader.load('assets/mermaid/mermaid.min.js')
      .catch(error => console.error('Mermaid could not be loaded, diagrams will not render', error))
      .finally(() => this.mermaidReady = true);

    this.documentChanges.asObservable().pipe(debounceTime(1000))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.flushSave());

    // Subscribe to theme changes for Monaco editor
    this.themeSubscription = this.themeService.currentTheme$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(theme => {
      const isDark = theme.colorScheme === 'dark';
      const monacoTheme = isDark ? 'vs-dark-extended' : 'vs';
      this.editorOptions = { ...this.editorOptions, theme: monacoTheme };
      this.mermaidOptions = {
        theme: isDark ? 'dark' : 'default',
      };
      if (this.monaco && this.editor) {
        this.monaco.editor.setTheme(monacoTheme);
      }
    });
  }

  ngOnDestroy(): void {
    // last changes, typed less than a second before leaving the page
    void this.flushSave();
    if (this.themeSubscription) {
      this.themeSubscription.unsubscribe();
    }
  }

  /** Saves now the text changed and not saved yet (only if it really changed) */
  public async flushSave(): Promise<void> {
    const document = this.pendingDocument;
    this.pendingDocument = null;
    if (!document?.id || document.content === this.savedContent.get(document)) {
      // the editor reports a change when it opens: nothing to save, no new version on the server
      return;
    }
    const content = document.content;
    try {
      if (await this.documentsService.saveContent(document.id, content)) {
        this.savedContent.set(document, content);
      }
    } catch (error) {
      console.error('document not saved', error);
    }
  }

  public debounceSave() {
    // the document object edited: still the right one if another document is opened meanwhile
    this.pendingDocument = this.textDocument;
    this.documentChanges.next(true);
  }


  public onResizeStart(_event: SplitterResizeStartEvent) {
    this.disablePanels = true;
  }

  public onResizeEnd(_event: SplitterResizeEndEvent) {
    this.disablePanels = false;
  }

}
