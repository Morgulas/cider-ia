import { Injectable } from '@angular/core';
import { IndexedDbService } from '../indexed-db/indexed-db.service';
import { AppDB } from '../indexed-db/db';
import { Booster } from '../types/booster.type';
import { FieldType } from '../types/field-type.type';

@Injectable({
  providedIn: 'root'
})
export class BoostersService extends IndexedDbService<Booster, number> {

  constructor(db: AppDB) {
    super(db, AppDB.BOOSTERS_TABLE, [
      { field: 'id', header: 'ID', type: FieldType.numeric, hidden: true },
      { field: 'name', header: 'Name', type: FieldType.text }
    ]);
  }

  override getEntityName(entity: Booster) {
    return entity.name;
  }
}
