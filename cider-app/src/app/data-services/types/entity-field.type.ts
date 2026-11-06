import { AnyEntityService } from './entity-service.type';
import { DropdownOption } from "./dropdown-option.type";
import { FieldType } from "./field-type.type";

/**
 * Defines an entity field
 */
export interface EntityField<Entity> {
    field: keyof Entity;
    header: string;
    type: FieldType;
    description?: string;
    hidden?: boolean;
    required?: boolean;
    service?: AnyEntityService;
    conversion?: (entity: Entity) => unknown;
    visible?: (entity: Entity) => boolean;
    options?: DropdownOption[];
    width?: number;
}