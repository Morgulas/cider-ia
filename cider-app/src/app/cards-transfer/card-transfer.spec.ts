import { FieldType } from '../data-services/types/field-type.type';
import {
  CardFile, DeckColumn, defaultKeyColumn, exportCsv, exportJson, headerKey, parseCardFile, planImport
} from './card-transfer';

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

const deckColumns: DeckColumn[] = [
  { field: 'name', header: 'Name', type: FieldType.text },
  { field: 'count', header: 'Count', type: FieldType.numeric },
  { field: 'frontCardTemplateId', header: 'Front Template', type: FieldType.dropdown, template: true },
  { field: 'backCardTemplateId', header: 'Back Template', type: FieldType.dropdown, template: true },
  { field: 'cardid', header: 'CardID', type: FieldType.text },
  { field: 'lore', header: 'Lore', type: FieldType.text },
  { field: 'classe', header: 'Classe', type: FieldType.dropdown, options: ['Mage', 'Prêtre'] },
  { field: 'niveau', header: 'Niveau', type: FieldType.numeric },
];
const templates = [{ id: 7, name: 'Test' }, { id: 8, name: 'Modèle Verso' }];

const csv = '﻿CardID;Name;Count;Front Template;Back Template;Classe;Niveau;Rareté;Description\r\n'
  + 'LDF001;Grimoire niveau 1;1;Test;Modèle Verso;Mage;1;Commune;"Ligne 1.\nLigne ""2""."\r\n'
  + 'LDF002;Grimoire niveau 2;2;test;Inconnu;Voleur;;Rare;Simple\r\n'
  + 'LDF001;Doublon;1;Test;Modèle Verso;Mage;1;Commune;x\r\n';

describe('card transfer', () => {
  it('reads a CSV with ";", BOM, quotes and multi-line cells', () => {
    const file = parseCardFile(encode(csv), 'livres.csv');
    expect(file.format).toBe('csv');
    expect(file.columns).toEqual(['CardID', 'Name', 'Count', 'Front Template', 'Back Template', 'Classe', 'Niveau',
      'Rareté', 'Description']);
    expect(file.rows.length).toBe(3);
    expect(file.rows[0]['Description']).toBe('Ligne 1.\nLigne "2".');
    expect(file.rows[1]['Niveau']).toBe('');
  });

  it('reads the cartes-fangh JSON with its field definitions', () => {
    const json = JSON.stringify({ format: 'cartes-fangh', version: 1, jeu: 'Livres',
      champs: [{ nom: 'Rareté', type: 'dropdown', options: ['Commune', 'Rare'] }],
      cartes: [{ CardID: 'A', Name: 'Un', Count: 1 }, { CardID: 'B', Name: 'Deux', Rareté: 'Rare' }] });
    const file = parseCardFile(encode(json), 'livres.json');
    expect(file.format).toBe('json');
    expect(file.deckName).toBe('Livres');
    expect(file.columns).toEqual(['CardID', 'Name', 'Count', 'Rareté']);
    expect(file.definitions).toEqual([{ name: 'Rareté', type: 'dropdown', options: ['Commune', 'Rare'] }]);
  });

  it('ignores case and accents in column names', () => {
    expect(headerKey('Sous Type')).toBe(headerKey('sous-type'));
    expect(headerKey('Rareté')).toBe(headerKey('RARETE'));
  });

  it('plans updates by key, creations, unknown columns, options and templates', () => {
    const file = parseCardFile(encode(csv), 'livres.csv');
    expect(defaultKeyColumn(file, deckColumns)).toBe('CardID');
    const cards = [{ id: 1, name: 'Grimoire Niv:1', count: 1, frontCardTemplateId: 7, backCardTemplateId: 8,
      cardid: 'LDF001', lore: 'Ta magie !', classe: 'Mage', niveau: 1 }];
    const plan = planImport(file, deckColumns, templates, cards, { keyColumn: 'CardID', lineBreaksAsHtml: false });

    expect(plan.counts).toEqual({ create: 1, update: 1, unchanged: 0, error: 1 });
    const update = plan.rows[0];
    expect(update.action).toBe('update');
    expect(update.cardId).toBe(1);
    expect(update.changes.map(c => c.header)).toEqual(['Name']);
    expect(update.values['lore']).toBeUndefined();   // not in the file: kept

    const create = plan.rows[1];
    expect(create.action).toBe('create');
    expect(create.values['frontCardTemplateId']).toBe(7);  // "test": case ignored
    expect(create.values['backCardTemplateId']).toBeUndefined();
    expect(create.values['niveau']).toBeNull();
    expect(create.values['count']).toBe(2);
    expect(plan.rows[2].error).toBe('duplicate-key');

    expect(plan.unknownTemplates).toEqual(['Inconnu']);
    expect(plan.missingOptions).toEqual([{ field: 'classe', header: 'Classe', values: ['Voleur'] }]);
    expect(plan.columns.filter(c => c.proposal).map(c => c.proposal)).toEqual([
      { name: 'Rareté', type: 'text', options: [] },
      { name: 'Description', type: 'text', options: [] },
    ]);
  });

  it('writes line breaks as <br> on request, and sees an identical card as unchanged', () => {
    const file: CardFile = { format: 'json', columns: ['CardID', 'Lore'], definitions: [],
      rows: [{ CardID: 'X', Lore: 'a\nb' }, { CardID: 'Y', Lore: 'same' }] };
    const cards = [{ id: 1, cardid: 'X', lore: '' }, { id: 2, cardid: 'Y', lore: 'same' }];
    const plan = planImport(file, deckColumns, templates, cards, { keyColumn: 'CardID', lineBreaksAsHtml: true });
    expect(plan.rows[0].values['lore']).toBe('a<br>b');
    expect(plan.rows[1].action).toBe('unchanged');
  });

  it('exports CSV and JSON that read back the same', () => {
    const cards = [{ id: 1, name: 'Grimoire; "1"', count: 2, frontCardTemplateId: 7, backCardTemplateId: 8,
      cardid: 'LDF001', lore: 'a\nb', classe: 'Mage', niveau: 3 }];
    const text = exportCsv(deckColumns, cards, templates);
    expect(text.startsWith('﻿Name;Count;Front Template;Back Template;CardID')).toBeTrue();
    const back = parseCardFile(encode(text), 'x.csv');
    expect(back.rows[0]).toEqual(jasmine.objectContaining({ Name: 'Grimoire; "1"', 'Front Template': 'Test', Lore: 'a\nb' }));

    const json = JSON.parse(exportJson('Livres', deckColumns, cards, templates));
    expect(json.format).toBe('cartes-fangh');
    expect(json.champs.map((c: { nom: string }) => c.nom)).toEqual(['CardID', 'Lore', 'Classe', 'Niveau']);
    expect(json.champs[2]).toEqual({ nom: 'Classe', type: 'dropdown', options: ['Mage', 'Prêtre'] });
    expect(json.cartes[0]).toEqual({ Name: 'Grimoire; "1"', Count: 2, 'Front Template': 'Test',
      'Back Template': 'Modèle Verso', CardID: 'LDF001', Lore: 'a\nb', Classe: 'Mage', Niveau: 3 });
  });
});
