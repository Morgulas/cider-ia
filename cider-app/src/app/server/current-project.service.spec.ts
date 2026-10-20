import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { AppDB, ProjectOwner } from '../data-services/indexed-db/db';
import { AuthService } from './auth.service';
import { CurrentProjectService } from './current-project.service';
import { ProjectsApiService } from './projects-api.service';
import { ProjectMeta, PublicUser } from './server.types';
import { TabCoordinatorService } from './tab-coordinator.service';

describe('CurrentProjectService', () => {
  const meta = (id: string, revision: number): ProjectMeta => ({
    id, name: `Projet ${id}`, createdAt: '', updatedAt: '', revision, size: 0
  });
  const userA: PublicUser = { id: 'ua', username: 'alice', isAdmin: false, disabled: false, createdAt: '' };
  const userB: PublicUser = { id: 'ub', username: 'bob', isAdmin: false, disabled: false, createdAt: '' };

  let service: CurrentProjectService;
  let changes: Subject<unknown>;
  /** owner recorded in the fake local copy */
  let copyOwner: ProjectOwner | undefined;
  let db: { onChange: () => Subject<unknown>; loadProject: jasmine.Spy; exportProject: jasmine.Spy; getOwner: jasmine.Spy };
  let api: jasmine.SpyObj<ProjectsApiService>;
  let user: ReturnType<typeof signal<PublicUser | null>>;
  let otherTabOpen: boolean;
  let router: { navigateByUrl: jasmine.Spy };

  const clearStorage = () => {
    for (const id of ['ua', 'ub']) {
      localStorage.removeItem(`cider.pending.${id}`);
      localStorage.removeItem(`cider.last.${id}`);
    }
  };

  beforeEach(() => {
    jasmine.clock().install();
    clearStorage();
    changes = new Subject();
    copyOwner = undefined;
    otherTabOpen = false;
    db = {
      onChange: () => changes,
      loadProject: jasmine.createSpy('loadProject').and.callFake(async (_data: Blob | null, owner?: ProjectOwner) => {
        copyOwner = owner;
      }),
      exportProject: jasmine.createSpy('exportProject').and.resolveTo(new Blob(['{}'])),
      getOwner: jasmine.createSpy('getOwner').and.callFake(async () => copyOwner),
    };
    api = jasmine.createSpyObj<ProjectsApiService>('ProjectsApiService', ['get', 'loadData', 'saveData']);
    api.get.and.callFake(async (id: string) => meta(id, 3));
    api.loadData.and.resolveTo({ data: new Blob(['{}']), revision: 3 });
    api.saveData.and.callFake(async (id, _data, base) => meta(id, base + 1));
    user = signal<PublicUser | null>(userA);
    router = { navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true) };

    TestBed.configureTestingModule({
      providers: [
        { provide: AppDB, useValue: db },
        { provide: ProjectsApiService, useValue: api },
        { provide: AuthService, useValue: { user } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: Router, useValue: router },
        {
          provide: TabCoordinatorService,
          useValue: { setOpenProjectCheck: () => undefined, projectOpenInOtherTab: async () => otherTabOpen }
        },
      ]
    });
    service = TestBed.inject(CurrentProjectService);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    clearStorage();
  });

  /** lets pending promises run */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  };

  const changeAndWaitForSave = async () => {
    changes.next({});
    jasmine.clock().tick(CurrentProjectService.SAVE_DELAY_MS + 10);
    await settle();
  };

  it('loads the server version and records the owner of the local copy', async () => {
    await service.open('p1');
    expect(db.loadProject).toHaveBeenCalledWith(jasmine.any(Blob), { userId: 'ua', projectId: 'p1' });
    expect(service.project()?.name).toBe('Projet p1');
    expect(service.saveState()).toBe('saved');
    expect(localStorage.getItem('cider.last.ua')).toBe('p1');
  });

  it('saves a change after a short delay, from the loaded revision', async () => {
    await service.open('p1');
    changes.next({});
    expect(service.saveState()).toBe('pending');
    expect(localStorage.getItem('cider.pending.ua')).not.toBeNull();
    jasmine.clock().tick(CurrentProjectService.SAVE_DELAY_MS + 10);
    await settle();
    expect(api.saveData).toHaveBeenCalledOnceWith('p1', jasmine.any(Blob), 3);
    expect(service.saveState()).toBe('saved');
    expect(localStorage.getItem('cider.pending.ua')).toBeNull();
  });

  it('groups several quick changes into one save', async () => {
    await service.open('p1');
    changes.next({});
    jasmine.clock().tick(500);
    changes.next({});
    jasmine.clock().tick(500);
    await changeAndWaitForSave();
    expect(api.saveData).toHaveBeenCalledTimes(1);
  });

  it('does not save the rows written while loading a project', async () => {
    db.loadProject.and.callFake(async (_data: Blob | null, owner?: ProjectOwner) => {
      copyOwner = owner;
      changes.next({});
    });
    await service.open('p1');
    jasmine.clock().tick(CurrentProjectService.SAVE_DELAY_MS + 10);
    await settle();
    expect(api.saveData).not.toHaveBeenCalled();
  });

  it('never sends the local copy when it holds another project (replaced from another tab)', async () => {
    await service.open('p1');
    copyOwner = { userId: 'ua', projectId: 'p2' };
    await changeAndWaitForSave();
    expect(api.saveData).not.toHaveBeenCalled();
    expect(service.project()).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/projects');
  });

  it('refuses to open a project while another tab has one open', async () => {
    otherTabOpen = true;
    await expectAsync(service.open('p1')).toBeRejectedWithError('server.projects.other-tab');
    expect(db.loadProject).not.toHaveBeenCalled();
  });

  it('on a conflict, waits for the user, then saves from the reported revision', async () => {
    await service.open('p1');
    api.saveData.and.rejectWith(new HttpErrorResponse({ status: 409, error: { error: 'conflict', revision: 5 } }));
    await changeAndWaitForSave();
    expect(service.saveState()).toBe('conflict');
    // no automatic retry while in conflict
    jasmine.clock().tick(CurrentProjectService.RETRY_DELAY_MS + 10);
    await settle();
    expect(api.saveData).toHaveBeenCalledTimes(1);

    api.saveData.and.callFake(async (id, _data, base) => meta(id, base + 1));
    await service.keepLocalVersion();
    // not a forced write: a version saved after revision 5 would raise a new conflict
    expect(api.saveData).toHaveBeenCalledWith('p1', jasmine.any(Blob), 5);
    expect(service.saveState()).toBe('saved');
  });

  it('retries after a network error', async () => {
    await service.open('p1');
    api.saveData.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    await changeAndWaitForSave();
    expect(service.saveState()).toBe('error');
    api.saveData.and.callFake(async (id) => meta(id, 4));
    jasmine.clock().tick(CurrentProjectService.RETRY_DELAY_MS + 10);
    await settle();
    expect(service.saveState()).toBe('saved');
  });

  it('sends the local copy instead of reloading when the page was closed before saving', async () => {
    localStorage.setItem('cider.pending.ua', JSON.stringify({ projectId: 'p1', revision: 3 }));
    copyOwner = { userId: 'ua', projectId: 'p1' };
    await service.open('p1');
    expect(db.loadProject).not.toHaveBeenCalled();
    expect(api.saveData).toHaveBeenCalledOnceWith('p1', jasmine.any(Blob), 3);
    expect(localStorage.getItem('cider.pending.ua')).toBeNull();
  });

  it('saves leftover changes of another project to that project before opening a new one', async () => {
    localStorage.setItem('cider.pending.ua', JSON.stringify({ projectId: 'p1', revision: 3 }));
    copyOwner = { userId: 'ua', projectId: 'p1' };
    await service.open('p2');
    expect(api.saveData).toHaveBeenCalledOnceWith('p1', jasmine.any(Blob), 3);
    expect(db.loadProject).toHaveBeenCalledWith(jasmine.any(Blob), { userId: 'ua', projectId: 'p2' });
    expect(service.project()?.id).toBe('p2');
  });

  it('does not open another project when leftover changes cannot be saved', async () => {
    localStorage.setItem('cider.pending.ua', JSON.stringify({ projectId: 'p1', revision: 3 }));
    copyOwner = { userId: 'ua', projectId: 'p1' };
    api.saveData.and.rejectWith(new HttpErrorResponse({ status: 409, error: { revision: 4 } }));
    await expectAsync(service.open('p2')).toBeRejectedWithError('server.save.pending-other');
    expect(db.loadProject).not.toHaveBeenCalled();
    expect(localStorage.getItem('cider.pending.ua')).not.toBeNull();
  });

  it('ignores a leftover marker when the local copy holds something else', async () => {
    localStorage.setItem('cider.pending.ua', JSON.stringify({ projectId: 'p1', revision: 3 }));
    copyOwner = { userId: 'ub', projectId: 'q1' };
    await service.open('p1');
    expect(api.saveData).not.toHaveBeenCalled();
    expect(db.loadProject).toHaveBeenCalled();
    expect(localStorage.getItem('cider.pending.ua')).toBeNull();
  });

  it('closes the previous user\'s project when another user logs in', async () => {
    await service.open('p1');
    user.set(null);
    TestBed.tick();
    expect(service.project()).not.toBeNull();
    user.set(userB);
    TestBed.tick();
    expect(service.project()).toBeNull();
    expect(service.isOpenFor('ub')).toBeFalse();
  });

  it('keeps the project when the same user logs in again', async () => {
    await service.open('p1');
    user.set(null);
    TestBed.tick();
    user.set({ ...userA });
    TestBed.tick();
    expect(service.isOpenFor('ua')).toBeTrue();
  });

  it('saves pending changes, then empties the local copy when closing', async () => {
    await service.open('p1');
    changes.next({});
    expect(await service.close()).toBeTrue();
    expect(api.saveData).toHaveBeenCalledTimes(1);
    expect(db.loadProject).toHaveBeenCalledWith(null);
    expect(service.project()).toBeNull();
    expect(localStorage.getItem('cider.last.ua')).toBeNull();
  });

  it('keeps the project open when its changes cannot be saved', async () => {
    await service.open('p1');
    api.saveData.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    changes.next({});
    expect(await service.close()).toBeFalse();
    expect(service.project()).not.toBeNull();
    expect(await service.close(true)).toBeTrue();
  });
});
