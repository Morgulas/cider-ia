import { Pipe, PipeTransform } from '@angular/core';
import { AnyEntityService, EntityService } from '../types/entity-service.type';

@Pipe({ name: 'entityListCached' })
export class EntityListCachedPipe implements PipeTransform {

  async transform<E, I extends string | number>(service: EntityService<E, I>, cache: Map<AnyEntityService, unknown[]>): Promise<E[] | undefined> {
    if (!cache) {
      return service.getAll();
    }

    const options = cache.get(service) as E[] | undefined;
    if (!options && service) {
      const takenOptions = await service.getAll();
      cache.set(service, takenOptions);
      return takenOptions;
    }
    return options;
  }

}
