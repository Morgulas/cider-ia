import { EntityField } from "./entity-field.type";
import { SearchParameters } from "./search-parameters.type";
import { SearchResult } from "./search-result.type";
import { EqualityCriteria } from './equality-criteria.type';

/**
 * Represents a service that implements CRUD
 * Create/Read/Update/Delete
 * 
 * E - Entity Type
 * I - ID Type
 */
export interface EntityService<Entity, Identity extends string | number> {
    getTableName: () => string;
    getEntityName: (entity: Entity) => string;
    getFields: (equalityCriterias?: EqualityCriteria) => Promise<EntityField<Entity>[]>;
    getIdField: () => string;
    getIdToNameMap: (equalityCriterias?: EqualityCriteria) => Promise<Map<Identity, string>>;
    getLookups: (equalityCriterias?: EqualityCriteria) => Promise<Map<AnyEntityService, Map<string | number, string>>>;
    search: (searchParameters: SearchParameters) => Promise<SearchResult<Entity>>;
    getAll: () => Promise<Entity[]>;
    get: (id: Identity) => Promise<Entity>;
    create: (entity: Entity, overrideParent?: boolean) => Promise<Entity>;
    update: (id: Identity, entity: Entity, overrideParent?: boolean) => Promise<Entity>;
    delete: (id: Identity) => Promise<boolean>;
    deleteAll: () => Promise<boolean>;
    emptyTable: () => Promise<boolean>;
}

/**
 * A service of any table, for the code that works on every kind of entity
 * (tables, dialogs, pipes, imports): the entity type is not known there.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEntityService = EntityService<any, any>;

/** An entity read or written field by field (field names come from the column definitions) */
export type EntityRecord = Record<PropertyKey, unknown>;

/**
 * Value of a field of an entity of any type. The type parameter states what
 * the caller expects there (an id, a text...): it is not checked.
 */
export function fieldOf<T = unknown>(entity: unknown, field: PropertyKey): T {
    return (entity as EntityRecord | null | undefined)?.[field] as T;
}

/** Sets a field of an entity of any type */
export function setField(entity: unknown, field: PropertyKey, value: unknown): void {
    (entity as EntityRecord)[field] = value;
}
