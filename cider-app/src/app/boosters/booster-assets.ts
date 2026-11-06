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

/** Les images du projet, pour les listes de choix. */
export async function assetChoices(assets: AssetsService): Promise<AssetChoice[]> {
  const all = await assets.getAllMetadata();
  return all
    .filter(asset => asset?.name)
    .map(asset => {
      const folders = (asset.path || '').split('/').filter(Boolean);
      return {
        path: [...folders, asset.name].map(part => StringUtils.toKebabCase(part)).join('.'),
        label: [...folders, asset.name].join('/'),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
