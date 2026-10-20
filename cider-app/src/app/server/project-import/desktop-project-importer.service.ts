import { Injectable, inject } from '@angular/core';
import { AppDB } from '../../data-services/indexed-db/db';
import { AssetsService } from '../../data-services/services/assets.service';
import { CardAttributesService } from '../../data-services/services/card-attributes.service';
import { CardTemplatesService } from '../../data-services/services/card-templates.service';
import { CardsService } from '../../data-services/services/cards.service';
import { DecksService } from '../../data-services/services/decks.service';
import { DocumentsService } from '../../data-services/services/documents.service';
import { Asset } from '../../data-services/types/asset.type';
import { CardTemplate } from '../../data-services/types/card-template.type';
import { Deck } from '../../data-services/types/deck.type';
import { Document } from '../../data-services/types/document.type';
import { EntityService } from '../../data-services/types/entity-service.type';
import StringUtils from '../../shared/utils/string-utils';
import XlsxUtils from '../../shared/utils/xlsx-utils';
import { ProjectFile } from './project-files';

export interface DesktopImportSummary {
  decks: number;
  cards: number;
  templates: number;
  assets: number;
  documents: number;
}

/**
 * Reads a project folder of the desktop version of CIDEr into the open project
 * (the local working copy), the way the desktop version opened it:
 *   *.md, *.css           documents (at the top of the folder)
 *   assets/**             images and other assets, sub-folders kept
 *   decks/<deck>/         one folder per deck:
 *     attributes.csv      card attributes
 *     cards.csv           cards
 *     <template>.html/.css card templates
 * The project must be freshly created: everything is added to it.
 */
@Injectable({ providedIn: 'root' })
export class DesktopProjectImporter {
  private readonly db = inject(AppDB);
  private readonly assets = inject(AssetsService);
  private readonly decks = inject(DecksService);
  private readonly templates = inject(CardTemplatesService);
  private readonly attributes = inject(CardAttributesService);
  private readonly cards = inject(CardsService);
  private readonly documents = inject(DocumentsService);

  async import(files: ProjectFile[]): Promise<DesktopImportSummary> {
    const summary: DesktopImportSummary = { decks: 0, cards: 0, templates: 0, assets: 0, documents: 0 };
    const byPath = new Map(files.map(entry => [entry.path, entry.file]));

    // documents: markdown and css files at the top of the folder
    for (const entry of files) {
      if (entry.path.includes('/')) {
        continue;
      }
      const { name, extension } = StringUtils.splitNameAndExtension(entry.path);
      const ext = extension.toLowerCase();
      if (!name || !['md', 'markdown', 'css'].includes(ext)) {
        continue;
      }
      const mime = ext === 'css' ? 'text/css' : 'text/markdown';
      const content = await entry.file.text();
      const existing = (await this.documents.getAll()).find(document => document.name === name);
      if (existing) {
        // the global-styles document is created with every project: keep the imported one
        await this.documents.update(existing.id, { ...existing, mime, content });
      } else {
        await this.documents.create({ name, mime, content } as Document);
      }
      summary.documents++;
    }

    // assets, with their sub-folders
    const folders = new Set<string>();
    for (const entry of files) {
      if (!entry.path.startsWith('assets/')) {
        continue;
      }
      const parts = entry.path.slice('assets/'.length).split('/');
      const fileName = parts.pop() ?? '';
      const folder = parts.join('/');
      for (let i = 1; i <= parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'));
      }
      const { name, extension } = StringUtils.splitNameAndExtension(fileName);
      if (!name) {
        continue;
      }
      const type = StringUtils.extensionToMime(extension) || entry.file.type || 'application/octet-stream';
      const file = new File([entry.file], fileName, { type });
      await this.assets.create({ name, file, path: folder } as unknown as Asset, true);
      summary.assets++;
    }
    const knownFolders = new Set((await this.db.table(AppDB.ASSET_FOLDERS_TABLE).toArray()).map(row => row.path));
    const newFolders = [...folders].filter(path => !knownFolders.has(path)).map(path => ({ path }));
    if (newFolders.length > 0) {
      await this.db.table(AppDB.ASSET_FOLDERS_TABLE).bulkAdd(newFolders);
    }

    // decks
    const deckFolders = [...new Set(files
      .map(entry => /^decks\/([^/]+)\/[^/]+$/.exec(entry.path)?.[1])
      .filter((name): name is string => !!name))].sort();
    for (const folder of deckFolders) {
      const deck = await this.decks.create({ name: StringUtils.kebabToTitleCase(folder) } as Deck);
      summary.decks++;
      const prefix = `decks/${folder}/`;

      // templates: each .html file, with the .css file of the same name
      for (const entry of files) {
        const rest = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : '';
        const { name, extension } = StringUtils.splitNameAndExtension(rest);
        if (!name || rest.includes('/') || extension.toLowerCase() !== 'html') {
          continue;
        }
        const css = byPath.get(`${prefix}${name}.css`);
        await this.templates.create({
          deckId: deck.id,
          name: StringUtils.kebabToTitleCase(name),
          html: await entry.file.text(),
          css: css ? await css.text() : '',
        } as CardTemplate, true);
        summary.templates++;
      }

      // attributes before cards: the card columns come from the attributes
      await this.importCsv(byPath.get(`${prefix}attributes.csv`), 'attributes.csv', this.attributes, deck.id);
      await this.attributes.createSystemAttributes(deck.id);
      summary.cards += await this.importCsv(byPath.get(`${prefix}cards.csv`), 'cards.csv', this.cards, deck.id);
    }

    await this.db.initializeData();
    return summary;
  }

  private async importCsv<Entity, Identity extends string | number>(csv: Blob | undefined, fileName: string,
    service: EntityService<Entity, Identity>, deckId: number): Promise<number> {
    if (!csv) {
      return 0;
    }
    const file = new File([csv], fileName, { type: 'text/csv' });
    const entities: Entity[] = await XlsxUtils.entityImport(
      await service.getFields({ deckId }),
      await service.getLookups({ deckId }),
      file);
    for (const entity of entities) {
      (entity as Record<string, unknown>)['deckId'] = deckId;
      await service.create(entity, true);
    }
    return entities.length;
  }
}
