import { Injectable, inject } from '@angular/core';
import JSZip from 'jszip';
import { AssetsService } from '../../data-services/services/assets.service';
import { CardAttributesService } from '../../data-services/services/card-attributes.service';
import { CardTemplatesService } from '../../data-services/services/card-templates.service';
import { CardsService } from '../../data-services/services/cards.service';
import { DecksService } from '../../data-services/services/decks.service';
import { DocumentsService } from '../../data-services/services/documents.service';
import StringUtils from '../../shared/utils/string-utils';
import XlsxUtils from '../../shared/utils/xlsx-utils';

/**
 * Writes the open project as a folder of the desktop version of CIDEr, in a
 * .zip archive: the same files the desktop version saved (documents, assets,
 * one folder per deck with cards.csv, attributes.csv and the templates). Cards
 * and attributes can then be edited in a spreadsheet and the folder imported back.
 */
@Injectable({ providedIn: 'root' })
export class DesktopProjectExporter {
  private readonly assets = inject(AssetsService);
  private readonly decks = inject(DecksService);
  private readonly templates = inject(CardTemplatesService);
  private readonly attributes = inject(CardAttributesService);
  private readonly cards = inject(CardsService);
  private readonly documents = inject(DocumentsService);

  async exportZip(folderName: string): Promise<Blob> {
    const zip = new JSZip();
    const root = zip.folder(StringUtils.toKebabCase(folderName) || 'project')!;

    for (const document of await this.documents.getAll()) {
      const mime = document.mime ?? 'text/markdown';
      const extension = StringUtils.mimeToExtension(mime);
      root.file(document.name + (document.name.endsWith('.' + extension) ? '' : '.' + extension), document.content);
    }

    const used = new Set<string>();
    for (const asset of await this.assets.getAll()) {
      const extension = StringUtils.mimeToExtension(asset.file?.type ?? '') || 'bin';
      const path = `assets/${asset.path ? asset.path + '/' : ''}${StringUtils.toKebabCase(asset.name)}.${extension}`;
      if (!used.has(path)) {
        used.add(path);
        root.file(path, asset.file);
      }
    }

    for (const deck of await this.decks.getAll()) {
      const folder = `decks/${StringUtils.toKebabCase(deck.name)}/`;
      const [cardFields, cardLookups, cardRecords] = await Promise.all([
        this.cards.getFields({ deckId: deck.id }),
        this.cards.getLookups({ deckId: deck.id }),
        this.cards.getAll({ deckId: deck.id }),
      ]);
      root.file(folder + 'cards.csv', XlsxUtils.entityExport(cardFields, cardLookups, cardRecords));
      const [attributeFields, attributeLookups, attributeRecords] = await Promise.all([
        this.attributes.getFields({ deckId: deck.id }),
        this.attributes.getLookups({ deckId: deck.id }),
        this.attributes.getAll({ deckId: deck.id }),
      ]);
      root.file(folder + 'attributes.csv', XlsxUtils.entityExport(attributeFields, attributeLookups, attributeRecords));
      for (const template of await this.templates.getAll({ deckId: deck.id })) {
        const name = StringUtils.toKebabCase(template.name);
        root.file(`${folder}${name}.html`, template.html ?? '');
        root.file(`${folder}${name}.css`, template.css ?? '');
      }
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }
}
