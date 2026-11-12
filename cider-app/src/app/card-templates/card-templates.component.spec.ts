import { appTestProviders } from '../testing/test-providers';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap } from '@angular/router';
import { BehaviorSubject, NEVER, of } from 'rxjs';
import { MessageService } from 'primeng/api';

import { CardTemplatesComponent } from './card-templates.component';
import { AppDB } from '../data-services/indexed-db/db';
import { DecksService } from '../data-services/services/decks.service';
import { CardsService } from '../data-services/services/cards.service';
import { CardAttributesService } from '../data-services/services/card-attributes.service';
import { AssetsService } from '../data-services/services/assets.service';
import { CurrentProjectService } from '../server/current-project.service';
import { CardTemplate } from '../data-services/types/card-template.type';

describe('CardTemplatesComponent', () => {
  let component: CardTemplatesComponent;
  let fixture: ComponentFixture<CardTemplatesComponent>;
  let db: AppDB;
  let params: BehaviorSubject<ParamMap>;
  let flushProject: jasmine.Spy;

  const templates = () => db.table<CardTemplate>(AppDB.CARD_TEMPLATES_TABLE);
  const stored = (id: number) => templates().get(id) as Promise<CardTemplate>;
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  /** until the template of the route is loaded into the editor */
  const opened = async (id: number) => {
    for (let i = 0; i < 100 && component.selectedTemplate?.id !== id; i++) {
      await wait(10);
    }
    expect(component.selectedTemplate?.id).toBe(id);
  };
  /** typing in the HTML editor (ngModel then ngModelChange) */
  const typeHtml = (html: string) => {
    component.selectedTemplate.html = html;
    component.debounceSave();
  };
  const messages = () => fixture.debugElement.injector.get(MessageService);

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ templateId: '1' }));
    flushProject = jasmine.createSpy('flush').and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [CardTemplatesComponent],
      providers: [
        ...appTestProviders,
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: DecksService, useValue: { getSelectedDeck: () => of({ id: 1, name: 'Livres' }) } },
        { provide: CardsService, useValue: { getAll: async () => [] } },
        { provide: CardAttributesService, useValue: { getAll: async () => [] } },
        { provide: AssetsService, useValue: { getAllMetadata: async () => [], onChange: () => NEVER, getAssetUrls: () => of({}) } },
        { provide: CurrentProjectService, useValue: { flush: flushProject } },
      ],
    }).compileComponents();

    db = TestBed.inject(AppDB);
    await db.loadProject(null);
    await templates().bulkAdd([
      { id: 1, deckId: 1, name: 'Recto', description: '', html: '<div>A</div>', css: '.a {}' },
      { id: 2, deckId: 1, name: 'Verso', description: '', html: '<div>B</div>', css: '.b {}' },
    ] as CardTemplate[]);

    // not rendered: the code editors are not needed to test the saves
    fixture = TestBed.createComponent(CardTemplatesComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
    await opened(1);
  });

  afterEach(async () => {
    fixture.destroy();
    await wait(20);
    await db.loadProject(null);
  });

  it('saves the code a second after the last change', async () => {
    typeHtml('<div>A1</div>');
    typeHtml('<div>A2</div>');
    await wait(300);
    expect((await stored(1)).html).toBe('<div>A</div>');
    await wait(900);
    expect((await stored(1)).html).toBe('<div>A2</div>');
  });

  it('saves the last changes when the page is left before the delay', async () => {
    typeHtml('<div>A tapé juste avant de partir</div>');
    fixture.destroy();
    await wait(50);
    expect((await stored(1)).html).toBe('<div>A tapé juste avant de partir</div>');
  });

  it('saves the changes of a template to that template when another one is opened', async () => {
    typeHtml('<div>A modifié</div>');
    params.next(convertToParamMap({ templateId: '2' }));
    await opened(2);
    await wait(1200);
    expect((await stored(1)).html).toBe('<div>A modifié</div>');
    expect((await stored(2)).html).toBe('<div>B</div>');
  });

  it('keeps the deck and name changed meanwhile in the sidebar', async () => {
    typeHtml('<div>A modifié</div>');
    // moved to another deck and renamed from the sidebar while open here
    await templates().update(1, { deckId: 2, name: 'Recto déplacé' });
    await component.flushTemplateSave();
    const template = await stored(1);
    expect(template.html).toBe('<div>A modifié</div>');
    expect(template.deckId).toBe(2);
    expect(template.name).toBe('Recto déplacé');
  });

  it('does not bring back a template deleted meanwhile, and says so', async () => {
    const add = spyOn(messages(), 'add');
    typeHtml('<div>A modifié</div>');
    await templates().delete(1);
    await component.flushTemplateSave();
    expect(await stored(1)).toBeUndefined();
    expect(add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn', detail: 'template-editor.deleted' }));
  });

  it('saves at once and sends the project with Ctrl+S', async () => {
    component.selectedTemplate.css = '.a { color: red; }';
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    component.onKeydown(event);
    await wait(50);
    expect(event.defaultPrevented).toBeTrue();
    expect((await stored(1)).css).toBe('.a { color: red; }');
    expect(flushProject).toHaveBeenCalled();
  });

  it('saves a change made by the CSS variable editor or the chatbot like a typed one', async () => {
    component.applyChatbotAnswer({ html: '<div>du chatbot</div>', css: '.c {}' });
    fixture.destroy();
    await wait(50);
    const template = await stored(1);
    expect(template.html).toBe('<div>du chatbot</div>');
    expect(template.css).toBe('.c {}');
  });
});
