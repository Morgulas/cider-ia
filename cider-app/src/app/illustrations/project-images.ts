import { BlobRef, isBlobRef } from '../data-services/indexed-db/project-blobs';

/** An image of another project, read from its saved data (its file stays on the server) */
export interface SourceImage {
  /** id in the other project */
  id: number;
  name: string;
  /** folder, '' at the root of its library */
  path: string;
  /** deck of the other project whose library holds it; null: common library */
  deckId: number | null;
  file: BlobRef;
}

/** A library of the other project with its images, sorted by folder then name */
export interface SourceLibrary {
  deckId: number | null;
  /** deck name; empty for the common library */
  name: string;
  images: SourceImage[];
}

interface DexieExport {
  data?: { data?: { tableName: string; rows?: Record<string, unknown>[] }[] };
}

/**
 * The images of a project from its saved data (dexie export, files as references
 * to the server), by library: the common library first, then the decks by name.
 * Rows whose file is not a reference (should not happen on the server) are left out.
 */
export function readProjectImages(json: string): SourceLibrary[] {
  const parsed = JSON.parse(json) as DexieExport;
  const tables = parsed.data?.data ?? [];
  const rows = (name: string) => tables.find(t => t.tableName === name)?.rows ?? [];

  const deckNames = new Map<number, string>();
  for (const deck of [...rows('games'), ...rows('decks')]) {
    if (typeof deck['id'] === 'number') {
      deckNames.set(deck['id'], String(deck['name'] ?? deck['id']));
    }
  }

  const libraries = new Map<number | null, SourceLibrary>();
  for (const row of rows('assets')) {
    const file = isBlobRef(row['buffer']) ? row['buffer'] : isBlobRef(row['file']) ? row['file'] : null;
    if (!file || typeof row['id'] !== 'number') {
      continue;
    }
    const rawDeck = row['deckId'];
    const deckId = typeof rawDeck === 'number' && deckNames.has(rawDeck) ? rawDeck : null;
    const type = typeof row['type'] === 'string' && row['type'] ? row['type'] : file.type;
    let library = libraries.get(deckId);
    if (!library) {
      library = { deckId, name: deckId === null ? '' : deckNames.get(deckId)!, images: [] };
      libraries.set(deckId, library);
    }
    library.images.push({
      id: row['id'], name: String(row['name'] ?? ''), path: String(row['path'] ?? ''), deckId,
      file: { ...file, type },
    });
  }

  const byFolderThenName = (a: SourceImage, b: SourceImage) =>
    a.path.localeCompare(b.path) || a.name.localeCompare(b.name, undefined, { numeric: true });
  return [...libraries.values()]
    .map(library => ({ ...library, images: library.images.sort(byFolderThenName) }))
    .sort((a, b) => a.deckId === null ? -1 : b.deckId === null ? 1 : a.name.localeCompare(b.name));
}

/** Where an imported image goes: under the folder shown, its own folder kept or not */
export function targetPath(baseFolder: string, sourcePath: string, keepFolders: boolean): string {
  return [baseFolder, keepFolders ? sourcePath : ''].filter(part => part).join('/');
}
