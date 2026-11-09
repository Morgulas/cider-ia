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
import { foilFromValue } from '../card-binder/foil';

export interface CollectorSetSettings {
  code: string;
  nom: string;
  univers: string;
  publication: number;
}

/** Ce qu'apporte un booster du projet choisi à la publication */
export interface CollectorBooster {
  /** image du sachet dans le ZIP (ex. pack.png) */
  image?: string;
  /** image du verso du sachet dans le ZIP (ex. pack-back.png) */
  imageBack?: string;
  /** finition de l'emballage : mat, brillant ou un effet foil */
  finition: string;
  /** bords dentelés en haut et en bas */
  dentele: boolean;
  /** tirages repris du booster : cartes par booster et poids de chaque carte (même ordre que les cartes) */
  tirage?: { cardsPerPack: number; weights: number[] };
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
/** noms d'attribut d'effet foil (comme dans le classeur de cider-ia) */
const FOIL_KEYS = ['foil', 'brillance', 'effetfoil', 'holo'];

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
export function buildCollectorSet(exportJson: string, settings: CollectorSetSettings,
  booster?: CollectorBooster): CollectorSetPlan {
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

  const tirage = booster?.tirage;
  const cartes = rows.map((row, index) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const k = headerKey(key);
      if (DROPPED.includes(k) || value === '' || value === null || value === undefined) {
        continue;
      }
      if (FOIL_KEYS.includes(k)) {
        // effet foil sous sa forme canonique (holo, galaxie, or…), rien si la carte n'est pas foil
        const effect = foilFromValue(value);
        if (effect) {
          out['Foil'] = effect;
        }
        continue;
      }
      out[key] = value;
    }
    if (tirage) {
      out['Poids'] = Math.max(0, Number(tirage.weights[index] ?? 0));
    }
    return out;
  });

  // tirages du booster : un seul emplacement, chaque rareté pesant la somme des poids de ses cartes ;
  // dans une rareté, une carte sort selon son poids (même loi que le simulateur de cider-ia)
  let rules: unknown;
  if (tirage && rarityKey) {
    const totals: Record<string, number> = {};
    cartes.forEach((carte, index) => {
      const rarity = String(rows[index][rarityKey] ?? '').trim();
      totals[rarity] = (totals[rarity] ?? 0) + Number(carte['Poids'] ?? 0);
    });
    const raretes = Object.fromEntries(Object.entries(totals).filter(([, w]) => w > 0));
    if (Object.keys(raretes).length === 0) {
      errors.push('Le booster choisi donne un poids nul à toutes les cartes.');
    }
    rules = { slots: [{ nom: 'Cartes', nombre: Math.max(1, tirage.cardsPerPack), raretes }] };
  }

  const content = {
    format: CARD_FILE_FORMAT,
    version: CARD_FILE_VERSION,
    jeu: doc.jeu,
    set: {
      code: settings.code,
      nom: settings.nom || doc.jeu || settings.code,
      univers: settings.univers ?? '',
      publication: settings.publication,
      ...(booster?.image ? { paquet: booster.image } : {}),
      ...(booster?.imageBack ? { paquet_dos: booster.imageBack } : {}),
      ...(booster ? { paquet_style: { finition: booster.finition, dentele: booster.dentele } } : {}),
      ...(rules ? { booster: rules } : {}),
    },
    champs,
    cartes,
  };
  return { setJson: JSON.stringify(content, null, 2) + '\n', cardIds, errors };
}
