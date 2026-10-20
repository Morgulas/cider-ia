
import { EntityField } from 'src/app/data-services/types/entity-field.type';
import { EntityService } from 'src/app/data-services/types/entity-service.type';
import { FieldType } from 'src/app/data-services/types/field-type.type';
import XlsxUtils from './xlsx-utils';

describe('XlsxUtils', () => {

    it('should serialize objects to JSON for dropdown and dropdownOptions types during export', () => {
        const columns: EntityField<any>[] = [
            { field: 'name', header: 'Name', type: FieldType.text },
            { field: 'options', header: 'Options', type: FieldType.dropdownOptions },
            { field: 'type', header: 'Type', type: FieldType.dropdown }
        ];

        const records = [
            {
                name: 'Test',
                options: [{ value: 'A', color: '#FFF' }, { value: 'B', color: '#000' }],
                type: { value: 'some-type', color: '#111' }
            }
        ];

        const lookups = new Map<EntityService<any, string | number>, Map<string | number, string>>();

        // Spy on sheet_add_aoa to verify data passed to it
        // Note: XlsxUtils uses XLSX.utils.aoa_to_sheet and then sheet_add_aoa.
        // However, it's a static utility class. It might be easier to check the returned CSV.

        // Stub XLSX methods to avoid full library execution and rely on checking logic??
        // Actually, checking the returned CSV string is better if we can rely on sheet_to_csv.
        // But sheet_to_csv output depends on full XLSX lib. 

        // Let's run it with actual XLSX lib since it's imported.
        const csv = XlsxUtils.entityExport(columns, lookups, records);

        // Expected CSV content roughly:
        // "Name","Options","Type"
        // "Test","[{""value"":""A"",""color"":""#FFF""},{""value"":""B"",""color"":""#000""}]","{""value"":""some-type"",""color"":""#111""}"

        expect(csv).toContain('Name');
        expect(csv).toContain('Options');
        expect(csv).toContain('Type');

        // Check that JSON string is present and escaped properly for CSV (usually double quotes)
        // CSV output from XLSX: "Test","[{""value"":""A"",""color"":""#FFF""},{""value"":""B"",""color"":""#000""}]",...

        // We just want to ensure it is NOT [object Object]
        expect(csv).not.toContain('[object Object]');
        // Expect escaped quotes for CSV
        expect(csv).toContain('""value"":""A""');
        expect(csv).toContain('""color"":""#FFF""');
    });


    it('should export and re-import entities, keeping accents and numbers', async () => {
        const columns: EntityField<any>[] = [
            { field: 'name', header: 'Name', type: FieldType.text },
            { field: 'cost', header: 'Cost', type: FieldType.numeric },
            { field: 'text', header: 'Text', type: FieldType.text }
        ];
        const records = [
            { name: 'Pomme dorée', cost: 3, text: 'Piochez une carte, "deux" si été' },
            { name: 'Château', cost: 12, text: 'Défaussez ; gagnez 2 €' }
        ];
        const lookups = new Map<EntityService<any, string | number>, Map<string | number, string>>();

        const csv = XlsxUtils.entityExport(columns, lookups, records);
        const file = new File([csv], 'cards.csv', { type: 'text/csv' });
        const imported: any[] = await XlsxUtils.entityImport(columns, lookups, file);

        expect(imported.length).toBe(2);
        expect(imported[0].name).toBe('Pomme dorée');
        expect(imported[0].text).toBe('Piochez une carte, "deux" si été');
        expect(Number(imported[1].cost)).toBe(12);
        expect(imported[1].name).toBe('Château');
        expect(imported[1].text).toBe('Défaussez ; gagnez 2 €');
    });

});
