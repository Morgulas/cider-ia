import { AnyEntityService, fieldOf, setField } from '../../data-services/types/entity-service.type';

import { EntityField } from 'src/app/data-services/types/entity-field.type';
import { FieldType } from 'src/app/data-services/types/field-type.type';
import * as XLSX from 'xlsx';
import FileUtils from './file-utils';
import StringUtils from './string-utils';

export default class XlsxUtils {

    /**
     * Export the provided records to a CSV file
     * 
     * @param columns 
     * @param records 
     * @param lookups 
     */
    static entityExport<Entity>(columns: EntityField<Entity>[],
        lookups: Map<AnyEntityService, Map<string | number, string>>, records: Entity[]) {
        const headers = columns.filter(column => !column.hidden);
        const headerNames = headers.map(column => column.header);
        const worksheet: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet([headerNames]);
        records.forEach(record => {
            const values = headers.map(header => {
                if (header.service) {
                    return lookups.get(header.service)?.get(record[header.field] as string | number);
                }

                if (header.type === FieldType.dropdown || header.type === FieldType.dropdownOptions) {
                    const value = record[header.field];
                    if (typeof value === 'object') {
                        return JSON.stringify(value);
                    }
                    return value;
                }

                return record[header.field];
            });
            XLSX.utils.sheet_add_aoa(worksheet, [values], { origin: -1 });
        });
        const csv = XLSX.utils.sheet_to_csv(worksheet, { forceQuotes: true });
        return csv;
    }

    /**
     * Export the provided records to a CSV file
     * 
     * @param columns 
     * @param records 
     * @param lookups 
     */
    static entityExportToFile<Entity>(columns: EntityField<Entity>[],
        lookups: Map<AnyEntityService, Map<string | number, string>>, records: Entity[]) {
        const csv = XlsxUtils.entityExport(columns, lookups, records);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        FileUtils.saveAs(blob, 'data.csv');
    }


    /**
     * Import entities from a CSV file
     * 
     * @param columns 
     * @param lookups 
     * @param file 
     */
    static entityImport<Entity>(columns: EntityField<Entity>[],
        lookups: Map<AnyEntityService, Map<string | number, string>>,
        file: File): Promise<Entity[]> {
        const headers = columns.filter(column => !column.hidden);
        return file.arrayBuffer().then(buffer => {
            const workbook: XLSX.WorkBook = XLSX.read(buffer, { type: "buffer", codepage: 65001, raw: true });
            const worksheet: XLSX.WorkSheet = workbook.Sheets[workbook.SheetNames[0]];
            const parsedObjects = XLSX.utils.sheet_to_json(worksheet);
            const convertedObjects = parsedObjects.map(object => {
                const converted = {} as Entity;
                headers.forEach(header => {
                    if (header.service) {
                        let foundValue = false;
                        lookups.get(header.service)?.forEach((value, key) => {
                            const dbValue = String(value).trim();
                            const csvValue = String(fieldOf(object, header.header) || '').trim();
                            if (dbValue === csvValue) {
                                setField(converted, header.field, key);
                                foundValue = true;
                            } else {
                                // Fallback: try kebab-case comparison
                                // This handles cases where template names are "My Template" (DB) but "my-template" (CSV)
                                if (StringUtils.toKebabCase(dbValue) === StringUtils.toKebabCase(csvValue)) {
                                    setField(converted, header.field, key);
                                    foundValue = true;
                                }
                            }
                        });
                        if (!foundValue) {
                            console.warn(`Could not find value (${fieldOf(object, header.header)}) for column: ${header.header}. Available keys:`, [...(lookups.get(header.service)?.values() || [])]);
                        }

                    } else if (header.type === FieldType.dropdown) {
                        const val = fieldOf(object, header.header);
                        if (header.options && header.options.length > 0) {
                            const valid = header.options.some(o => o.value === val);
                            if (!valid) {
                                console.warn(`Value "${val}" for column "${header.header}" is not in the allowed options: ${header.options.map(o => o.value).join(', ')}`);
                            }
                        }
                        setField(converted, header.field, val);
                    } else if (header.type === FieldType.checkbox) {
                        const val = fieldOf(object, header.header);
                        if (typeof val === 'boolean') {
                            setField(converted, header.field, val);
                        } else if (typeof val === 'string') {
                            const lower = val.toLowerCase().trim();
                            setField(converted, header.field, lower === 'true' || lower === '1' || lower === 'yes');
                        } else if (typeof val === 'number') {
                            setField(converted, header.field, val !== 0);
                        } else {
                            setField(converted, header.field, false);
                        }
                    } else {
                        setField(converted, header.field, fieldOf(object, header.header));
                    }
                });
                return converted;
            });
            return convertedObjects;
        });
    }

}