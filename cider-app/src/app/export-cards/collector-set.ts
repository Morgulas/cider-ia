/**
 * "Publier le set" : paquet ZIP lu par l'appli de collection (card-collector).
 *
 *   set.json                     format cartes-fangh + bloc "set" (code, nom, univers, publication)
 *   cards/<CardID>_front.png     recto rendu
 *   cards/<CardID>_back.png      verso rendu (facultatif)
 *
 * Ce fichier ne contient que la partie sans rendu : vérification des cartes et
 * construction de set.json à partir de l'export JSON du deck.
 */
import { CARD_FILE_FORMAT, CARD_FILE_VERSION, headerKey } from '../cards-transfer/card-transfer';

export interface CollectorSetSettings {
  code: string;
  nom: string;
  univers: string;
  publication: number;
}

export interface CollectorSetPlan {
  /** contenu de set.json */
  setJson: string;
  /** CardID de chaque carte, dans l'ordre des cartes exportées */
  cardIds: string[];
  errors: string[];
}

const CODE_RE = /^[A-Za-z0-9_-]{2,40}$/;
const CARD_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** colonnes des modèles : inutiles à l'appli de collection */
const DROPPED = ['fronttemplate', 'backtemplate'];

function findKey(row: Record<string, unknown>, keys: string[]): string | undefined {
  return Object.keys(row).find(k => keys.includes(headerKey(k)));
}

/** Code de set proposé à partir du nom du deck : « Livres de Fangh » → LIVRES-DE-FANGH */
export function suggestSetCode(deckName: string): string {
  const code = deckName.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return code.length >= 2 ? code : 'SET-1';
}

/**
 * @param exportJson texte produit par exportJson() pour les cartes à publier
 * @param settings   réglages de publication du deck
 */
export function buildCollectorSet(exportJson: string, settings: CollectorSetSettings): CollectorSetPlan {
  const errors: string[] = [];
  const doc = JSON.parse(exportJson) as {
    jeu?: string;
    champs?: { nom: string; type: string; options: string[] }[];
    cartes?: Record<string, unknown>[];
  };
  const rows = doc.cartes ?? [];
  const champs = doc.champs ?? [];

  if (!CODE_RE.test(settings.code ?? '')) {
    errors.push('Code du set invalide : 2 à 40 caractères, lettres, chiffres, - et _.');
  }
  if (!Number.isInteger(settings.publication) || settings.publication < 1) {
    errors.push('Le numéro de publication doit être un entier supérieur ou égal à 1.');
  }
  if (rows.length === 0) {
    errors.push('Aucune carte à publier.');
  }

  const sample = rows[0] ?? {};
  const idKey = findKey(sample, ['cardid']);
  const rarityKey = findKey(sample, ['rarete', 'rarity']);
  if (rows.length && !idKey) {
    errors.push('Le deck n\'a pas d\'attribut « CardID ».');
  }
  if (rows.length && !rarityKey) {
    errors.push('Le deck n\'a pas d\'attribut « Rareté ».');
  }
  const rarityDef = champs.find(c => ['rarete', 'rarity'].includes(headerKey(c.nom)));
  const rarities = rarityDef?.options ?? [];

  const cardIds: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const name = String(row['Name'] ?? row['name'] ?? `ligne ${index + 1}`);
    const id = idKey ? String(row[idKey] ?? '').trim() : '';
    cardIds.push(id);
    if (!idKey || !rarityKey) {
      return;
    }
    if (!id) {
      errors.push(`« ${name} » : CardID vide.`);
    } else if (!CARD_ID_RE.test(id)) {
      errors.push(`« ${name} » : CardID « ${id} » invalide (lettres, chiffres, - et _ seulement).`);
    } else if (seen.has(id)) {
      errors.push(`« ${name} » : CardID « ${id} » en double.`);
    }
    seen.add(id);
    const rarity = String(row[rarityKey] ?? '').trim();
    if (!rarity) {
      errors.push(`« ${name} » (${id}) : rareté vide.`);
    } else if (rarities.length && !rarities.includes(rarity)) {
      errors.push(`« ${name} » (${id}) : rareté « ${rarity} » absente de la liste de l'attribut.`);
    }
  });

  const cartes = rows.map(row => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!DROPPED.includes(headerKey(key)) && value !== '' && value !== null && value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  });

  const content = {
    format: CARD_FILE_FORMAT,
    version: CARD_FILE_VERSION,
    jeu: doc.jeu,
    set: {
      code: settings.code,
      nom: settings.nom || doc.jeu || settings.code,
      univers: settings.univers ?? '',
      publication: settings.publication,
    },
    champs,
    cartes,
  };
  return { setJson: JSON.stringify(content, null, 2) + '\n', cardIds, errors };
}
