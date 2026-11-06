import { Pipe, PipeTransform } from '@angular/core';
import { EntityService } from '../types/entity-service.type';

/**
 * Pipe an entity ID into that entity given a service
 */
@Pipe({ name: 'entity' })
export class EntityPipe implements PipeTransform {

  transform<E, I extends string | number>(entityId: unknown, service: EntityService<E, I>): Promise<E> {
    if (!entityId || !service) {
      // no entity: an empty object, as the templates expect one
      return Promise.resolve({} as E);
    }
    return service.get(entityId as I);
  }

}
