import Dexie, { Table } from "dexie";
import { Card } from "../types/card.type";
import { Asset } from "../types/asset.type";
import { CardTemplate } from "../types/card-template.type";
import { FieldType } from "../types/field-type.type";
import { Deck } from "../types/deck.type";
import { exportDB, importInto } from "dexie-export-import";
import { ReplaySubject, Subject } from "rxjs";
import { Injectable } from "@angular/core";
import { cardHistory, describeCard, IDENTIFIER_FIELDS, isInternalField } from "./card-history";

/** User and project a local working copy belongs to */
export interface ProjectOwner {
    userId: string;
    projectId: string;
}

@Injectable({
    providedIn: 'root'
})
export class AppDB extends Dexie {
    private static readonly DB_NAME: string = 'cider-db';
    public static readonly GAMES_TABLE: string = 'games';
    public static readonly DECKS_TABLE: string = 'decks';
    public static readonly CARDS_TABLE: string = 'cards';
    public static readonly ASSETS_TABLE: string = 'assets';
    public static readonly CARD_TEMPLATES_TABLE: string = 'cardTemplates'
    public static readonly PRINT_TEMPLATES_TABLE: string = 'printTemplates';
    public static readonly CARD_ATTRIBUTES_TABLE: string = 'cardAttributes';
    public static readonly DOCUMENTS_TABLE: string = 'documents';
    public static readonly ASSET_FOLDERS_TABLE: string = 'assetFolders';
    public static readonly META_TABLE: string = 'meta';
    public static readonly CARD_HISTORY_TABLE: string = 'cardHistory';
    private static readonly ALL_TABLES = [
        AppDB.GAMES_TABLE, AppDB.DECKS_TABLE, AppDB.CARDS_TABLE, AppDB.ASSETS_TABLE,
        AppDB.CARD_TEMPLATES_TABLE, AppDB.CARD_ATTRIBUTES_TABLE, AppDB.DOCUMENTS_TABLE, AppDB.ASSET_FOLDERS_TABLE];

    games!: Table<Deck, number>;
    cards!: Table<Card, number>;
    assets!: Table<Asset, number>;
    cardTemplates!: Table<CardTemplate, number>;
    private changeSubject: Subject<any>;
    private loadSubject: ReplaySubject<null>;
    private isPopulating = false;

    constructor() {
        super(AppDB.DB_NAME);
        this.changeSubject = new Subject<any>();
        // replayed: a subscriber that arrives after the database is ready still gets the event
        this.loadSubject = new ReplaySubject<null>(1);
        /**
         * Dexie Versioning Documentation:
         * 
         * https://dexie.org/docs/Tutorial/Design#database-versioning
         */
        this.version(1).stores({
            games: '++id, name',
            cards: '++id, gameId, count, frontCardTemplateId, backCardTemplateId',
            assets: '++id, gameId, name',
            cardTemplates: '++id, gameId, name, description, html, css',
            printTemplates: '++id, gameId, name, description, html, css',
            cardAttributes: '++id, gameId, name, type, options, description',
        });
        this.version(2).stores({
            games: null,
            decks: '++id, name',
            assets: '++id, name',
            cards: '++id, deckId, count, frontCardTemplateId, backCardTemplateId',
            cardTemplates: '++id, deckId, name, description, html, css',
            printTemplates: null,
            cardAttributes: '++id, deckId, name, type, options, description',
        }).upgrade(transaction => {
            // upgrade to version 2
            return transaction.table(AppDB.GAMES_TABLE).toArray().then(games => {
                transaction.table(AppDB.DECKS_TABLE).bulkAdd(games);
            }).then(result => {
                return transaction.table(AppDB.CARDS_TABLE).toCollection().modify(card => {
                    card.deckId = card.gameId;
                    delete card.gameId;
                });
            }).then(result => {
                return transaction.table(AppDB.CARD_TEMPLATES_TABLE).toCollection().modify(template => {
                    template.deckId = template.gameId;
                    delete template.gameId;
                });
            }).then(result => {
                return transaction.table(AppDB.CARD_ATTRIBUTES_TABLE).toCollection().modify(attribute => {
                    attribute.deckId = attribute.gameId;
                    delete attribute.gameId;
                });
            }).then(result => {
                return transaction.table(AppDB.ASSETS_TABLE).toCollection().modify(asset => {
                    delete asset.gameId;
                });
            });
        });
        this.version(3).stores({
            // other tables are inherited from previous versions
            documents: '++id, name, content',
        });
        this.version(4).stores({
            // other tables are inherited from previous versions
            // add mime field to documents
            documents: '++id, name, mime, content',
        }).upgrade(transaction => {
            return transaction.table(AppDB.DOCUMENTS_TABLE).toCollection().modify(document => {
                document.mime = 'text/markdown'; // only markdown documents exist at this point
            });
        });
        this.version(5).stores({
            cardAttributes: '++id, deckId, name, type, options, description, width',
        }).upgrade(transaction => {
            return transaction.table(AppDB.CARD_ATTRIBUTES_TABLE).toCollection().modify(attribute => {
                attribute.width = 'auto';
            });
        });
        this.version(6).stores({
            cardAttributes: '++id, deckId, name, type, options, description, width',
        }).upgrade(transaction => {
            return transaction.table(AppDB.CARD_ATTRIBUTES_TABLE).toCollection().modify(attribute => {
                // Map old types to new types
                if ((attribute.type as any) === 'number') attribute.type = 'numeric';
                if ((attribute.type as any) === 'option') attribute.type = 'dropdown';
                if ((attribute.type as any) === 'text-area') attribute.type = 'text';
            });
        });
        this.version(7).stores({
            cardAttributes: '++id, deckId, name, type, options, description, width, order',
        }).upgrade(transaction => {
            return transaction.table(AppDB.CARD_ATTRIBUTES_TABLE).toCollection().modify(attribute => {
                attribute.order = attribute.id; // Default order to ID
            });
        });
        this.version(8).stores({
            cardAttributes: '++id, deckId, name, [deckId+name], type, options, description, width, order',
        });
        this.version(9).stores({
            assets: '++id, name, path',
        }).upgrade(transaction => {
            return transaction.table(AppDB.ASSETS_TABLE).toCollection().modify(asset => {
                if (!asset.path) {
                    asset.path = '';
                }
            });
        });
        this.version(10).stores({
            assetFolders: '++id, path',
        });
        this.version(11).stores({
            // owner of the local working copy (user and project), never exported
            meta: 'key',
        });
        this.version(12).stores({
            // journal of the changes made to cards (see card-history.ts)
            cardHistory: '++id, cardId, deckId, batch, at',
        });

        // The local database is a working copy of the project opened from the server
        // (see CurrentProjectService): it is filled by loadProject(), never with the sample.
        this.on('ready', () => this.initializeData().then(() => {
            // database ready: refresh asset urls and the sidebar
            this.loadSubject.next(null);
        }));

        // trigger changeSubject when change emitted to db
        Dexie.on('storagemutated', (event) => {
            // We still use this for general "unsaved" flag if needed, 
            // but rely on hooks for granular updates.
            // this.changeSubject.next(event); 
        });

        this.on('populate', () => {
            // populate
        });

        // Add hooks for granular dirty tracking
        const trackChange = (tableName: string, type: string, key: any) => {
            if (!this.isPopulating) {
                this.changeSubject.next({ tableName, type, key });
            }
        };

        // We need to wait for tables to be initialized or just access them via this.table()
        // But hook must be on the specific table instance.
        // It's safer to loop strictly over known tables.

        const tablesToWatch = [
            { name: AppDB.DECKS_TABLE },
            { name: AppDB.CARDS_TABLE },
            { name: AppDB.ASSETS_TABLE },
            { name: AppDB.CARD_TEMPLATES_TABLE },
            { name: AppDB.CARD_ATTRIBUTES_TABLE },
            { name: AppDB.DOCUMENTS_TABLE },
            { name: AppDB.ASSET_FOLDERS_TABLE },
            { name: AppDB.CARD_HISTORY_TABLE }
        ];

        tablesToWatch.forEach(t => {
            this.table(t.name).hook('creating', function (primKey, obj, trans) {
                // For auto-incremented keys, primKey is undefined here.
                // We must assign onsuccess to capture the generated key.
                this.onsuccess = function (id) {
                    trackChange(t.name, 'create', id);
                };
            });
            this.table(t.name).hook('updating', (mods, primKey, obj, trans) => {
                trackChange(t.name, 'update', primKey);
            });
            this.table(t.name).hook('deleting', (primKey, obj, trans) => {
                trackChange(t.name, 'delete', primKey);
            });
        });

        this.setupCardHistory();
    }

    /**
     * Journal of card changes: hooks on the cards table record each creation,
     * field change and deletion (not while a project is loaded). Former values
     * of identifier fields (CardID...) are kept in the card (__previousIds), so
     * an import from the data source still recognizes a renumbered card.
     */
    private setupCardHistory(): void {
        // hooks are plain functions (Dexie binds their own "this")
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const db = this;
        cardHistory.setWriter(async entries => {
            const table = db.table(AppDB.CARD_HISTORY_TABLE);
            await table.bulkAdd(entries);
            const count = await table.count();
            if (count > cardHistory.maxEntries * 1.1) {
                const oldest = await table.orderBy('id').limit(count - cardHistory.maxEntries).primaryKeys();
                await table.bulkDelete(oldest);
            }
        });
        const cards = this.table(AppDB.CARDS_TABLE);
        cards.hook('creating', function (primKey, obj) {
            if (db.isPopulating) {
                return;
            }
            this.onsuccess = (id) => cardHistory.record({
                op: 'create', cardId: id as number, deckId: obj.deckId, ...describeCard(obj),
                snapshot: { ...obj, id },
            });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cards.hook('updating', function (modifications: any, primKey: any, value: any) {
            const mods = modifications as Record<string, unknown>;
            const obj = value as Record<string, unknown>;
            if (db.isPopulating) {
                return undefined;
            }
            const fields = Object.keys(mods).filter(field => !isInternalField(field) && !field.includes('.'));
            const changed = fields.filter(field => JSON.stringify(mods[field] ?? '') !== JSON.stringify(obj[field] ?? ''));
            this.onsuccess = () => {
                const after = { ...obj, ...mods };
                for (const field of changed) {
                    cardHistory.record({
                        op: 'update', cardId: primKey as number, deckId: obj['deckId'] as number, ...describeCard(after),
                        field, before: obj[field], after: mods[field],
                    });
                }
            };
            const renamed = IDENTIFIER_FIELDS.filter(field => field in mods && obj[field] !== undefined
                && obj[field] !== null && obj[field] !== '' && obj[field] !== mods[field]);
            if (renamed.length === 0) {
                return undefined;
            }
            const previous = Array.isArray(obj['__previousIds']) ? obj['__previousIds'] as string[] : [];
            const added = renamed.map(field => String(obj[field])).filter(value => !previous.includes(value));
            return added.length ? { __previousIds: [...previous, ...added] } : undefined;
        });
        cards.hook('deleting', function (primKey, value) {
            const obj = value as Record<string, unknown>;
            if (db.isPopulating || !obj) {
                return;
            }
            this.onsuccess = () => cardHistory.record({
                op: 'delete', cardId: primKey as number, deckId: obj['deckId'] as number, ...describeCard(obj),
                snapshot: { ...obj },
            });
        });
    }

    public onChange() {
        return this.changeSubject.asObservable();
    }

    public onLoad() {
        return this.loadSubject.asObservable();
    }

    /**
     * Initialize data in the database if there are missing
     * mandatory entries. This is run on project open.
     */
    /**
     * Replaces the whole local working copy with a project saved on the server,
     * or empties it (data null: new project, or closing a project). The owner
     * (user and project) is recorded in the "meta" table, so a save can check
     * that the copy still holds the project it is about to overwrite on the server.
     * No change events are emitted for the rows written here: they are not user
     * edits to save back.
     */
    public async loadProject(data: Blob | null, owner?: ProjectOwner): Promise<void> {
        if (!this.isOpen()) {
            await this.open();
        }
        this.isPopulating = true;
        cardHistory.discard();
        try {
            await this.transaction('rw', this.tables, async () => {
                await Promise.all(this.tables.map(table => table.clear()));
            });
            if (data) {
                await importInto(this, data, {
                    clearTablesBeforeImport: true,
                    acceptVersionDiff: true,
                    overwriteValues: true,
                    skipTables: [AppDB.META_TABLE]
                });
            }
            if (owner) {
                await this.table(AppDB.META_TABLE).put({ key: 'owner', ...owner });
            }
        } finally {
            this.isPopulating = false;
        }
        await this.initializeData();
        this.changeSubject.next({ tableName: 'all', type: 'reset', key: null });
        this.loadSubject.next(null);
    }

    /** The user and project the local working copy belongs to, if any */
    public async getOwner(): Promise<ProjectOwner | undefined> {
        if (!this.isOpen()) {
            await this.open();
        }
        const record = await this.table(AppDB.META_TABLE).get('owner');
        return record ? { userId: record.userId, projectId: record.projectId } : undefined;
    }

    /** The whole local working copy as a Dexie export, as saved on the server */
    public exportProject(): Promise<Blob> {
        return exportDB(this, { prettyJson: false, skipTables: [AppDB.META_TABLE] });
    }

    public async initializeData(): Promise<void> {
        this.isPopulating = true;
        try {
            // make sure the global-styles css document exists
            const documentsTable = this.table(AppDB.DOCUMENTS_TABLE);
            const count = await documentsTable.where('name').equals('global-styles').count();
            if (count === 0) {
                await documentsTable.add({
                    name: 'global-styles',
                    mime: 'text/css',
                    content: `/* Global Styles and Font Declarations */\n`
                });
            }

        // Upgrade legacy dropdown options to DropdownOption json structure
        const attributesTable = this.table(AppDB.CARD_ATTRIBUTES_TABLE);
        await attributesTable.toCollection().modify(attribute => {
            // Map old types to new types
            if ((attribute.type as any) === 'number') attribute.type = FieldType.numeric;
            if ((attribute.type as any) === 'option') attribute.type = FieldType.dropdown;
            if ((attribute.type as any) === 'text-area') attribute.type = FieldType.text;

            // Set default width
            if (!attribute.width) {
                attribute.width = 135;
            }

            // Set default order
            if (attribute.order === undefined) {
                attribute.order = attribute.id;
            }

            if (attribute.type === 'dropdown' && attribute.options) {
                let options: any[] = [];
                let changed = false;
                const usedColors = new Set<string>();

                const getRandomColor = () => {
                    let color: string;
                    let attempts = 0;
                    do {
                        color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
                        attempts++;
                    } while (usedColors.has(color) && attempts < 100);
                    usedColors.add(color);
                    return color;
                };

                if (Array.isArray(attribute.options)) {
                    // Check if it's string[] (Legacy format)
                    if (attribute.options.length > 0 && typeof attribute.options[0] === 'string') {
                        options = attribute.options.map((o: string) => ({ value: o, color: getRandomColor() }));
                        changed = true;
                    }
                } else if (typeof attribute.options === 'string') {
                    // Check if it's a JSON string or comma separated
                    const optsStr = attribute.options.trim();
                    if (optsStr.startsWith('[')) {
                        try {
                            const parsed = JSON.parse(optsStr);
                            // If parsed is string[], migrate it.
                            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
                                options = parsed.map((o: string) => ({ value: o, color: getRandomColor() }));
                                changed = true;
                            }
                        } catch (e) {
                            // ignore
                        }
                    } else {
                        // Comma separated string
                        const parts = optsStr.split(',');
                        if (parts.length > 0) {
                            options = parts.map((o: string) => ({ value: o.trim(), color: getRandomColor() }));
                            changed = true;
                        }
                    }
                }

                if (changed) {
                    attribute.options = options;
                }
            }
        });

        // add other mandatory entries here as needed
        const decks = await this.table(AppDB.DECKS_TABLE).toArray();
        for (const deck of decks) {
            const inherent = [
                { name: 'Name', type: 'text', description: 'The name of the card', isSystem: true, order: -4 },
                { name: 'Count', type: 'numeric', description: 'How many of this card appear in the deck', isSystem: true, order: -3 },
                { name: 'Front Template', type: 'dropdown', description: "The card's front template", isSystem: true, order: -2 },
                { name: 'Back Template', type: 'dropdown', description: "The card's back template", isSystem: true, order: -1 }
            ];

            for (const attr of inherent) {
                const count = await attributesTable.where({ deckId: deck.id, name: attr.name }).count();
                if (count === 0) {
                    await attributesTable.add({
                        deckId: deck.id,
                        name: attr.name,
                        type: attr.type as any,
                        description: attr.description,
                        options: [],
                        width: 135,
                        order: attr.order,
                        isSystem: true
                    });
                } else {
                    await attributesTable.where({ deckId: deck.id, name: attr.name }).modify({ isSystem: true });
                }
            }
        }

        } finally {
            this.isPopulating = false;
        }
        return;
    }
}
