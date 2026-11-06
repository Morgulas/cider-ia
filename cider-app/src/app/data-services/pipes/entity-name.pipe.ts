import { Pipe, PipeTransform } from '@angular/core';
import { EntityService } from '../types/entity-service.type';

/**
 * Given an entity ID and a service, pipe to a promise of
 * a pretty string representing that entity.
 */
@Pipe({ name: 'entityName' })
export class EntityNamePipe implements PipeTransform {

  transform<E, I extends string | number>(entityId: unknown, service: EntityService<E, I>): Promise<string> {
    if (!entityId || !service) {
      return Promise.resolve('');
    }
    return service.get(entityId as I).then(entity => service.getEntityName(entity));
  }

}
