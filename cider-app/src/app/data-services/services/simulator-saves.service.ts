import { Injectable } from '@angular/core';
import { IndexedDbService } from '../indexed-db/indexed-db.service';
import { AppDB } from '../indexed-db/db';
import { FieldType } from '../types/field-type.type';
import { SimulatorSave } from '../../game-simulator/game-simulator.types';

/** Parties du simulateur enregistrées dans le projet. */
@Injectable({
  providedIn: 'root'
})
export class SimulatorSavesService extends IndexedDbService<SimulatorSave, number> {

  constructor(db: AppDB) {
    super(db, AppDB.SIMULATOR_SAVES_TABLE, [
      { field: 'id', header: 'ID', type: FieldType.numeric, hidden: true },
      { field: 'name', header: 'Name', type: FieldType.text }
    ]);
  }

  override getEntityName(entity: SimulatorSave) {
    return entity.name;
  }
}
