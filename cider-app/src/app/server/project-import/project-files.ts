import JSZip from 'jszip';

/** A file of a project folder of the desktop version, path relative to the project folder */
export interface ProjectFile {
  path: string;
  file: Blob;
}

/** Files the operating system adds to folders, never part of a project */
const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX(\/.*)?|\.[^/]*)$/i;

function clean(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Files chosen with a folder picker (input webkitdirectory) */
export function filesFromFolder(files: FileList | File[]): ProjectFile[] {
  return Array.from(files)
    .map(file => ({ path: clean(file.webkitRelativePath || file.name), file: file as Blob }))
    .filter(entry => !IGNORED.test(entry.path));
}

/** Files of a .zip archive of the project folder */
export async function filesFromZip(archive: Blob): Promise<ProjectFile[]> {
  const zip = await JSZip.loadAsync(archive);
  const entries = Object.values(zip.files).filter(entry => !entry.dir && !IGNORED.test(clean(entry.name)));
  return Promise.all(entries.map(async entry => ({ path: clean(entry.name), file: await entry.async('blob') })));
}

/**
 * Finds the project folder among the files (the folder holding "decks" or
 * "assets"; it may be the top of the selection or a folder inside it) and
 * returns its files with paths relative to it, plus its name.
 * Returns null when the files are not a project of the desktop version.
 */
export function projectRoot(files: ProjectFile[]): { name: string; files: ProjectFile[] } | null {
  let root: string | null = null;
  for (const { path } of files) {
    const match = /^(.*?)(?:^|\/)(decks|assets)\/[^/]/.exec(path);
    if (match) {
      const candidate = match[1];
      if (root === null || candidate.length < root.length) {
        root = candidate;
      }
    }
  }
  if (root === null) {
    return null;
  }
  const prefix = root ? root + '/' : '';
  const name = root.split('/').filter(part => part !== '').pop() ?? '';
  return {
    name,
    files: files
      .filter(entry => entry.path.startsWith(prefix))
      .map(entry => ({ path: entry.path.slice(prefix.length), file: entry.file })),
  };
}
