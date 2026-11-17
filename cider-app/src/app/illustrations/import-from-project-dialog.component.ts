import { Component, OnDestroy, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Select } from 'primeng/select';
import { runLimited } from '../data-services/indexed-db/project-blobs';
import { AssetsService } from '../data-services/services/assets.service';
import { Asset, AssetLibrary } from '../data-services/types/asset.type';
import { CurrentProjectService } from '../server/current-project.service';
import { ProjectsApiService } from '../server/projects-api.service';
import { ProjectMeta } from '../server/server.types';
import StringUtils from '../shared/utils/string-utils';
import { readProjectImages, SourceImage, SourceLibrary, targetPath } from './project-images';

/** A folder of the other project, as listed in the dialog */
interface SourceGroup {
  key: string;
  label: string;
  images: SourceImage[];
}

const THUMB_CONCURRENCY = 6;

/** The name, or name-2, name-3... if taken in the folder (names compared as in {{assets.name}}) */
function freeName(name: string, taken: Set<string>): string {
  const base = name.trim() || 'image';
  let candidate = base;
  for (let i = 2; taken.has(StringUtils.toKebabCase(candidate)); i++) {
    candidate = `${base}-${i}`;
  }
  taken.add(StringUtils.toKebabCase(candidate));
  return candidate;
}

/**
 * Copies images of another project of the user into the library and folder shown:
 * choose the project, tick the images (or whole folders), import. The files are
 * read from the server; the other project is not changed.
 */
@Component({
  selector: 'app-import-from-project-dialog',
  templateUrl: './import-from-project-dialog.component.html',
  styleUrls: ['./import-from-project-dialog.component.scss'],
  imports: [FormsModule, TranslatePipe, Button, Checkbox, Dialog, InputText, Message, Select]
})
export class ImportFromProjectDialogComponent implements OnDestroy {
  private readonly api = inject(ProjectsApiService);
  private readonly current = inject(CurrentProjectService);
  private readonly assets = inject(AssetsService);
  private readonly translate = inject(TranslateService);

  readonly visible = model(false);
  /** Library and folder the images go to (those shown on the page) */
  readonly library = input<AssetLibrary>(null);
  readonly folder = input('');
  readonly destination = input('');
  readonly done = output<{ imported: number; skipped: number }>();

  protected projects: ProjectMeta[] = [];
  protected projectId: string | null = null;
  protected readonly loading = signal(false);
  protected readonly importing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly groups = signal<SourceGroup[]>([]);
  protected readonly selected = signal<Set<number>>(new Set());
  protected readonly thumbs = signal<Map<number, string>>(new Map());
  protected readonly query = signal('');
  protected keepFolders = true;
  /** An image whose name is already in the target folder: left out, or imported as name-2 */
  protected onConflict: 'skip' | 'rename' = 'skip';
  protected conflictOptions: { value: 'skip' | 'rename'; label: string }[] = [];

  protected readonly shownGroups = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    if (!query) {
      return this.groups();
    }
    return this.groups()
      .map(group => ({ ...group, images: group.images.filter(image => image.name.toLocaleLowerCase().includes(query)) }))
      .filter(group => group.images.length);
  });
  protected readonly selectedCount = computed(() => this.selected().size);

  private loadRun = 0;
  private objectUrls: string[] = [];

  ngOnDestroy(): void {
    this.revokeThumbs();
  }

  protected async onShow(): Promise<void> {
    this.error.set(null);
    this.conflictOptions = [
      { value: 'skip', label: this.translate.instant('illustrations.import-project.conflict-skip') },
      { value: 'rename', label: this.translate.instant('illustrations.import-project.conflict-rename') },
    ];
    try {
      const currentId = this.current.project()?.id;
      this.projects = (await this.api.list()).filter(project => project.id !== currentId)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      this.error.set(this.translate.instant('illustrations.import-project.load-error'));
    }
  }

  protected onHide(): void {
    this.loadRun++;
    this.projectId = null;
    this.groups.set([]);
    this.selected.set(new Set());
    this.query.set('');
    this.revokeThumbs();
  }

  /** Lists the images of the project chosen */
  protected async loadProject(): Promise<void> {
    const run = ++this.loadRun;
    this.groups.set([]);
    this.selected.set(new Set());
    this.revokeThumbs();
    this.error.set(null);
    if (!this.projectId) {
      return;
    }
    this.loading.set(true);
    try {
      const { data } = await this.api.loadData(this.projectId);
      const libraries = data ? readProjectImages(await data.text()) : [];
      if (run !== this.loadRun) {
        return;
      }
      this.groups.set(this.toGroups(libraries));
      void this.loadThumbs(run);
    } catch {
      if (run === this.loadRun) {
        this.error.set(this.translate.instant('illustrations.import-project.load-error'));
      }
    } finally {
      if (run === this.loadRun) {
        this.loading.set(false);
      }
    }
  }

  private toGroups(libraries: SourceLibrary[]): SourceGroup[] {
    const common = this.translate.instant('illustrations.import-project.common');
    const groups: SourceGroup[] = [];
    for (const library of libraries) {
      const libraryLabel = library.deckId === null ? common : library.name;
      for (const image of library.images) {
        const key = `${library.deckId ?? ''}|${image.path}`;
        let group = groups.find(g => g.key === key);
        if (!group) {
          group = { key, label: [libraryLabel, ...image.path.split('/').filter(p => p)].join(' › '), images: [] };
          groups.push(group);
        }
        group.images.push(image);
      }
    }
    return groups;
  }

  private async loadThumbs(run: number): Promise<void> {
    const images = this.groups().flatMap(group => group.images);
    await runLimited(images, THUMB_CONCURRENCY, async image => {
      if (run !== this.loadRun || !image.file.type.startsWith('image/')) {
        return;
      }
      try {
        const blob = await this.api.blob(image.file.$ciderBlob);
        if (run !== this.loadRun) {
          return;
        }
        const url = URL.createObjectURL(blob.type === image.file.type ? blob : blob.slice(0, blob.size, image.file.type));
        this.objectUrls.push(url);
        this.thumbs.update(map => new Map(map).set(image.id, url));
      } catch {
        // no thumbnail: the name is still shown
      }
    });
  }

  private revokeThumbs(): void {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls = [];
    this.thumbs.set(new Map());
  }

  // ----- Selection -----

  protected isSelected(image: SourceImage): boolean {
    return this.selected().has(image.id);
  }

  protected toggle(image: SourceImage): void {
    this.selected.update(set => {
      const next = new Set(set);
      if (!next.delete(image.id)) {
        next.add(image.id);
      }
      return next;
    });
  }

  protected groupState(group: SourceGroup): boolean {
    return group.images.every(image => this.selected().has(image.id));
  }

  protected toggleGroup(group: SourceGroup): void {
    const all = this.groupState(group);
    this.selected.update(set => {
      const next = new Set(set);
      group.images.forEach(image => all ? next.delete(image.id) : next.add(image.id));
      return next;
    });
  }

  protected selectAll(on: boolean): void {
    this.selected.set(on ? new Set(this.shownGroups().flatMap(group => group.images.map(image => image.id))) : new Set());
  }

  // ----- Import -----

  /** Copies the images ticked, each under its name (made unique in its folder if taken) */
  protected async import(): Promise<void> {
    const images = this.groups().flatMap(group => group.images).filter(image => this.selected().has(image.id));
    if (!images.length) {
      return;
    }
    this.importing.set(true);
    this.error.set(null);
    const library = this.library();
    let imported = 0;
    let skipped = 0;
    try {
      const existing = (await this.assets.getAllMetadata()).filter(asset => this.assets.inLibrary(asset, library));
      const taken = new Map<string, Set<string>>();
      const takenIn = (path: string) => {
        if (!taken.has(path)) {
          taken.set(path, new Set(existing.filter(asset => (asset.path ?? '') === path)
            .map(asset => StringUtils.toKebabCase(asset.name))));
        }
        return taken.get(path)!;
      };
      const folders = new Set<string>();
      for (const image of images) {
        const path = targetPath(this.folder(), image.path, this.keepFolders);
        if (this.onConflict === 'skip' && takenIn(path).has(StringUtils.toKebabCase(image.name))) {
          skipped++;
          continue;
        }
        const blob = await this.api.blob(image.file.$ciderBlob);
        const file = blob.type === image.file.type ? blob : blob.slice(0, blob.size, image.file.type);
        const name = freeName(image.name, takenIn(path));
        await this.assets.create({ name, path, file, ...(library === null ? {} : { deckId: library }) } as unknown as Asset, true);
        imported++;
        // the folder and its parents, so the folder tree shows them
        path.split('/').forEach((_, i, parts) => folders.add(parts.slice(0, i + 1).join('/')));
      }
      for (const folder of [...folders].filter(f => f)) {
        await this.assets.createFolder(folder, library);
      }
      this.visible.set(false);
      this.done.emit({ imported, skipped });
    } catch {
      this.error.set(this.translate.instant('illustrations.import-project.import-error', { n: imported }));
    } finally {
      if (imported) {
        this.assets.updateAssetUrls();
      }
      this.importing.set(false);
    }
  }
}
