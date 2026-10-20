import { firstValueFrom } from 'rxjs';
import { DecksService } from '../services/decks.service';
import { EntityField } from '../types/entity-field.type';
import { SearchParameters } from '../types/search-parameters.type';
import { AppDB } from './db';
import { IndexedDbService } from './indexed-db.service';
import { EqualityCriteria } from '../types/equality-criteria.type';

export class DecksChildService<Entity, Identity extends string | number> extends IndexedDbService<Entity, Identity> {
  private static readonly DECK_ID: string = 'deckId';
  decksService: DecksService;

  constructor(decksService: DecksService, db: AppDB, tableName: string, fields?: EntityField<Entity>[]) {
    super(db, tableName, fields);
    this.decksService = decksService;
  }

  override search(searchParameters: SearchParameters, equalityCriterias?: EqualityCriteria) {
    return firstValueFrom(this.decksService.getSelectedDeck())
      .then(deck => super.search(searchParameters, 
        {...{deckId: (deck || {}).id}, ...equalityCriterias}));
  }

  override getAll(equalityCriterias?: EqualityCriteria) {
    return firstValueFrom(this.decksService.getSelectedDeck())
      .then(deck => super.getAll(
        {...{deckId: (deck || {}).id}, ...equalityCriterias}));
  }

  getAllUnfiltered(equalityCriterias?: EqualityCriteria) {
    return super.getAll(equalityCriterias);
  }

  override get(id: Identity) {
    return firstValueFrom(this.decksService.getSelectedDeck())
      .then(deck => super.get(id));
  }

  override create(entity: Entity, overrideParent?: boolean) {
    if (overrideParent) {
      return super.create(entity);
    } else {
      return firstValueFrom(this.decksService.getSelectedDeck())
        .then(deck => {
          (entity as unknown as Record<string, unknown>)[DecksChildService.DECK_ID] = deck?.id;
          return super.create(entity);
        });
    }
  }

  override update(id: Identity, entity: Entity, overrideParent?: boolean) {
    if (overrideParent) {
      return super.update(id, entity);
    } else {
      return firstValueFrom(this.decksService.getSelectedDeck())
        .then(deck => {
          (entity as unknown as Record<string, unknown>)[DecksChildService.DECK_ID] = deck?.id;
          return super.update(id, entity);
        });
    }
  }

  override delete(id: Identity): Promise<boolean> {
    return super.delete(id);
  }

  override deleteAll(equalityCriterias?: EqualityCriteria): Promise<boolean> {
    return firstValueFrom(this.decksService.getSelectedDeck())
      .then(deck => super.deleteAll(
        {...{deckId: (deck || {}).id}, ...equalityCriterias}));
  }

}
