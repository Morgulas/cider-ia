import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { DocumentComponent } from './document.component';
import { AppDB } from '../data-services/indexed-db/db';
import { Document } from '../data-services/types/document.type';

describe('DocumentComponent', () => {
  let component: DocumentComponent;
  let fixture: ComponentFixture<DocumentComponent>;
  let db: AppDB;
  let params: BehaviorSubject<ParamMap>;

  const documents = () => db.table<Document>(AppDB.DOCUMENTS_TABLE);
  const stored = (id: number) => documents().get(id) as Promise<Document>;
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const opened = async (id: number) => {
    for (let i = 0; i < 100 && (component.textDocument as Document & { id?: number }).id !== id; i++) {
      await wait(10);
    }
  };
  /** typing in the editor (ngModel then ngModelChange) */
  const type = (content: string) => {
    component.textDocument.content = content;
    component.debounceSave();
  };

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ documentId: '101' }));
    await TestBed.configureTestingModule({
      imports: [DocumentComponent],
      providers: [...appTestProviders, { provide: ActivatedRoute, useValue: { paramMap: params } }],
    }).compileComponents();
    db = TestBed.inject(AppDB);
    await db.loadProject(null);
    await documents().bulkAdd([
      { id: 101, name: 'README', content: '# Fangh' },
      { id: 102, name: 'Règles', mime: 'text/markdown', content: '# Règles' },
    ] as Document[]);
    // not rendered: the editor is not needed to test the saves
    fixture = TestBed.createComponent(DocumentComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
    await opened(101);
  });

  afterEach(async () => {
    fixture.destroy();
    await wait(20);
    await db.loadProject(null);
  });

  it('shows a document saved without a type as Markdown', () => {
    expect(component.isMarkdown).toBeTrue();
  });

  it('saves nothing when the editor reports a change on opening', async () => {
    const changes = jasmine.createSpy('change');
    const subscription = db.onChange().subscribe(changes);
    type('# Fangh');
    await component.flushSave();
    subscription.unsubscribe();
    expect(changes).not.toHaveBeenCalled();
  });

  it('saves the last changes when the page is left before the delay', async () => {
    type('# Fangh\n\nTapé juste avant de partir');
    fixture.destroy();
    await wait(50);
    expect((await stored(101)).content).toBe('# Fangh\n\nTapé juste avant de partir');
  });

  it('saves the changes of a document to that document when another one is opened', async () => {
    type('# Fangh modifié');
    params.next(convertToParamMap({ documentId: '102' }));
    await opened(102);
    await wait(1200);
    expect((await stored(101)).content).toBe('# Fangh modifié');
    expect((await stored(102)).content).toBe('# Règles');
  });

  it('keeps a name changed meanwhile, and does not bring back a deleted document', async () => {
    type('# Fangh modifié');
    await documents().update(101, { name: 'LISEZMOI' });
    await component.flushSave();
    expect(await stored(101)).toEqual(jasmine.objectContaining({ name: 'LISEZMOI', content: '# Fangh modifié' }));

    type('# encore');
    await documents().delete(101);
    await component.flushSave();
    expect(await stored(101)).toBeUndefined();
  });
});
