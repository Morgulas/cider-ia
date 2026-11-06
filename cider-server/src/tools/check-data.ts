/**
 * Checks a data folder before deploying a new version, without changing it.
 *
 * For every project (and every kept version): the data is read, the images are
 * taken out as the server does when it opens the project, then put back in;
 * the result must be identical to the original. The report gives, for each
 * project, its size before and after, the number of images and the share of
 * the card journal.
 *
 *   node dist/tools/check-data.js /data
 *
 * Nothing is written: the folder can (and should) be mounted read-only.
 * Exit code 1 if a project could not be checked or would not come back identical.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BLOB_HASH_PATTERN, extractBlobs, findBlobRefs, hasInlineBlobs, inlineBlobs } from '../store/project-blobs.js';

interface ProjectEntry {
  id: string;
  name: string;
}

interface TableData {
  tableName?: string;
  rows?: unknown[];
}

interface CheckResult {
  ok: boolean;
  /** what went wrong */
  problem?: string;
  sizeBefore: number;
  sizeAfter: number;
  images: number;
  imageBytes: number;
  /** references to images that are not in the blobs folder */
  missing: number;
  tables: Record<string, number>;
  journalBytes: number;
}

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} Mo`;

/** Same JSON content, whatever the order of the keys */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, i) => sameJson(value, other[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => key in right && sameJson(left[key], right[key]));
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Checks one project file (current state or kept version) */
export async function checkProjectData(data: Buffer, blobDir: string): Promise<CheckResult> {
  const result: CheckResult = {
    ok: true, sizeBefore: data.length, sizeAfter: data.length, images: 0, imageBytes: 0, missing: 0, tables: {}, journalBytes: 0,
  };
  let dump: { data?: { data?: TableData[] } };
  try {
    dump = JSON.parse(data.toString('utf8'));
  } catch (error) {
    return { ...result, ok: false, problem: `JSON illisible (${(error as Error).message})` };
  }
  for (const table of dump.data?.data ?? []) {
    const name = table.tableName ?? '?';
    result.tables[name] = table.rows?.length ?? 0;
    if (name === 'cardHistory') {
      result.journalBytes = Buffer.byteLength(JSON.stringify(table.rows ?? []));
    }
  }

  let converted = data;
  let extracted = new Map<string, Buffer>();
  if (hasInlineBlobs(data)) {
    try {
      ({ data: converted, blobs: extracted } = extractBlobs(data));
    } catch (error) {
      return { ...result, ok: false, problem: `conversion impossible (${(error as Error).message})` };
    }
  }
  result.sizeAfter = converted.length;
  result.images = extracted.size;
  result.imageBytes = [...extracted.values()].reduce((sum, bytes) => sum + bytes.length, 0);

  // every referenced image must be found: taken out now, or already in the blobs folder
  const refs = findBlobRefs(converted);
  for (const hash of refs) {
    if (!extracted.has(hash)) {
      if (BLOB_HASH_PATTERN.test(hash) && await exists(path.join(blobDir, hash.slice(0, 2), hash))) {
        result.images++;
      } else {
        result.missing++;
      }
    }
  }
  if (result.missing > 0) {
    return { ...result, ok: false, problem: `${result.missing} image(s) référencée(s) introuvable(s) dans blobs/` };
  }

  // put the images back: the project must be exactly the original one
  // (images already stored apart before are put back on both sides)
  const read = async (hash: string) => extracted.get(hash) ?? fs.readFile(path.join(blobDir, hash.slice(0, 2), hash));
  const expected = JSON.parse((await inlineBlobs(data, read)).toString('utf8'));
  const roundTrip = JSON.parse((await inlineBlobs(converted, read)).toString('utf8'));
  if (!sameJson(expected, roundTrip)) {
    return { ...result, ok: false, problem: 'le projet reconverti diffère de l\'original' };
  }
  return result;
}

async function main(): Promise<void> {
  const dataDir = path.resolve(process.argv[2] ?? process.env['CIDER_DATA_DIR'] ?? '/data');
  const projectsDir = path.join(dataDir, 'projects');
  if (!(await exists(projectsDir))) {
    console.error(`Pas de dossier projects/ dans ${dataDir}`);
    process.exit(2);
  }
  console.log(`Vérification de ${dataDir} (lecture seule)\n`);
  let failures = 0;
  let checked = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const userId of (await fs.readdir(projectsDir)).sort()) {
    const userDir = path.join(projectsDir, userId);
    const indexFile = path.join(userDir, 'index.json');
    if (!(await exists(indexFile))) {
      continue;
    }
    const index = JSON.parse(await fs.readFile(indexFile, 'utf8')) as { projects?: ProjectEntry[] };
    const blobDir = path.join(dataDir, 'blobs', userId);
    for (const project of index.projects ?? []) {
      const dataFile = path.join(userDir, `${project.id}.json`);
      if (!(await exists(dataFile))) {
        console.log(`• ${project.name} : jamais enregistré, rien à vérifier`);
        continue;
      }
      const started = Date.now();
      const data = await fs.readFile(dataFile);
      const current = await checkProjectData(data, blobDir);
      checked++;
      totalBefore += current.sizeBefore;
      totalAfter += current.sizeAfter;
      const journalShare = current.sizeAfter > 0 ? Math.round(current.journalBytes / current.sizeAfter * 100) : 0;
      const status = current.ok ? 'OK' : `ÉCHEC — ${current.problem}`;
      if (!current.ok) {
        failures++;
      }
      console.log(`• ${project.name} : ${status}`);
      console.log(`    fichier ${mb(current.sizeBefore)} → ${mb(current.sizeAfter)} après conversion, `
        + `${current.images} image(s) (${mb(current.imageBytes)} sorties du fichier), ${Date.now() - started} ms`);
      console.log(`    ${current.tables['cards'] ?? 0} carte(s), ${current.tables['assets'] ?? 0} ressource(s), `
        + `journal : ${current.tables['cardHistory'] ?? 0} entrée(s), ${mb(current.journalBytes)} (${journalShare} % du fichier converti)`);

      // kept versions
      const versionsDir = path.join(userDir, 'versions', project.id);
      const versions = (await exists(versionsDir))
        ? (await fs.readdir(versionsDir)).filter(name => /^\d+\.json$/.test(name)) : [];
      let versionFailures = 0;
      for (const name of versions) {
        const version = await checkProjectData(await fs.readFile(path.join(versionsDir, name)), blobDir);
        if (!version.ok) {
          versionFailures++;
          console.log(`    version ${name.replace('.json', '')} : ÉCHEC — ${version.problem}`);
        }
      }
      if (versions.length > 0) {
        console.log(`    ${versions.length} version(s) conservée(s) : ${versionFailures === 0 ? 'toutes OK' : `${versionFailures} en échec`}`);
      }
      failures += versionFailures;
    }
  }
  console.log(`\n${checked} projet(s) vérifié(s) : ${mb(totalBefore)} → ${mb(totalAfter)} de données de projet.`);
  console.log(failures === 0 ? 'Tout est bon : la nouvelle version peut être déployée.' : `${failures} problème(s) : ne pas déployer, me transmettre ce rapport.`);
  process.exit(failures === 0 ? 0 : 1);
}

// run only as a script (not when imported by the tests)
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch(error => {
    console.error(error);
    process.exit(2);
  });
}
