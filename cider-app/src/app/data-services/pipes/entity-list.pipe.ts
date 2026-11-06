import { Pipe, PipeTransform } from '@angular/core';
import { EntityService } from '../types/entity-service.type';

/**
 * Get a list of all the entities
 */
@Pipe({ name: 'entityList' })
export class EntityListPipe implements PipeTransform {

  transform<E, I extends string | number>(service: EntityService<E, I>): Promise<E[]> {
    if (!service) {
      return Promise.resolve([]);
    }
    return service.getAll();
  }

}
