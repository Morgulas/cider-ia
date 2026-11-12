import { Injectable } from '@angular/core';
import { CardTemplate } from '../types/card-template.type';
import { AppDB } from '../indexed-db/db';
import { FieldType } from '../types/field-type.type';
import { DecksChildService } from '../indexed-db/decks-child.service';
import { DecksService } from './decks.service';

@Injectable({
  providedIn: 'root'
})
export class CardTemplatesService extends DecksChildService<CardTemplate, number> {

  constructor(decksService: DecksService, db: AppDB) {
    super(decksService, db, AppDB.CARD_TEMPLATES_TABLE, [
      { field: 'id', header: 'ID', type: FieldType.numeric, hidden: true },
      { field: 'deckId', header: 'Deck ID', type: FieldType.numeric, hidden: true },
      { field: 'name', header: 'Name', type: FieldType.text },
      { field: 'description', header: 'Description', type: FieldType.text },
      { field: 'html', header: 'HTML', type: FieldType.text, hidden: true },
      { field: 'css', header: 'CSS', type: FieldType.text, hidden: true }
    ]);
  }

  override getEntityName(entity: CardTemplate) {
    return entity.name;
  }

  /**
   * Saves the code of a template (HTML and CSS) and nothing else: its name and deck,
   * changed meanwhile elsewhere (sidebar), are kept, and a template deleted meanwhile
   * is not created again. Returns false when the template no longer exists.
   */
  saveCode(id: number, code: Pick<CardTemplate, 'html' | 'css'>): Promise<boolean> {
    return this.db.table(this.tableName).update(id, { html: code.html, css: code.css }).then(updated => updated > 0);
  }
}
