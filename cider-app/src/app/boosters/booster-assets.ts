import { AssetUrls } from '../data-services/types/asset.type';
import { AssetsService } from '../data-services/services/assets.service';
import StringUtils from '../shared/utils/string-utils';

/** Une image du projet, telle qu'un booster la référence (chemin « dossier.nom »). */
export interface AssetChoice {
  path: string;
  label: string;
}

/** L'URL d'une image du projet d'après son chemin « dossier.nom ». */
export function resolveAsset(urls: AssetUrls | undefined, path: string | undefined): string | undefined {
  if (!urls || !path) {
    return undefined;
  }
  let level: string | AssetUrls | undefined = urls;
  for (const part of path.split('.')) {
    if (!level || typeof level === 'string') {
      return undefined;
    }
    level = level[part];
  }
  return typeof level === 'string' ? level : undefined;
}

/**
 * Les images qu'un deck peut utiliser, pour les listes de choix : la bibliothèque commune et
 * celle du deck (qui l'emporte sur un même chemin). Sans deck : la bibliothèque commune.
 */
export async function assetChoices(assets: AssetsService, deckId?: number | null): Promise<AssetChoice[]> {
  const all = await assets.getAllMetadata();
  const library = deckId ?? null;
  const choices = new Map<string, AssetChoice & { own: boolean }>();
  all
    .filter(asset => asset?.name)
    .map(asset => ({ asset, own: assets.libraryOf(asset) }))
    .filter(({ own }) => own === null || own === library)
    .forEach(({ asset, own }) => {
      const folders = (asset.path || '').split('/').filter(Boolean);
      const path = [...folders, asset.name].map(part => StringUtils.toKebabCase(part)).join('.');
      const choice = { path, label: [...folders, asset.name].join('/'), own: own !== null };
      const existing = choices.get(path);
      if (!existing || (choice.own && !existing.own)) {
        choices.set(path, choice);
      }
    });
  return [...choices.values()]
    .map(({ path, label }) => ({ path, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
