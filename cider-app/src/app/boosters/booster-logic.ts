import { Booster, BoosterBackDesign, BoosterDesign, BoosterEdge, BoosterFont } from '../data-services/types/booster.type';
import { Card } from '../data-services/types/card.type';
import { FoilEffect, foilOf } from '../card-binder/foil';

/** Une carte tirée d'un booster. */
export interface PulledCard {
  card: Card;
  /** Effet foil de la carte (attribut « Foil » ou chance du booster), sinon null. */
  foil: FoilEffect | null;
}

/** Une carte du pool et son poids effectif. */
export interface PoolEntry {
  card: Card;
  weight: number;
}

export const DEFAULT_DESIGN: BoosterDesign = {
  mode: 'form',
  title: 'Booster',
  subtitle: '',
  colorA: '#2b1d5c',
  colorB: '#c2410c',
  textColor: '#fff7e6',
  background: 'degrade',
  finish: 'holo',
  crimped: true,
};

/** Polices proposées pour les textes du sachet (polices du système : rien à télécharger). */
export const BOOSTER_FONTS: Record<BoosterFont, string> = {
  classique: "Georgia, 'Times New Roman', serif",
  moderne: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  impact: "Impact, 'Arial Black', 'Franklin Gothic Heavy', sans-serif",
  manuscrite: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive",
};

/** Bords effectifs d'un design (les designs d'avant n'ont que « crimped »). */
export function edgeOf(design: Pick<BoosterDesign, 'edge' | 'crimped'>): BoosterEdge {
  return design.edge ?? (design.crimped ? 'dentele' : 'lisse');
}

/** Bords à dents (pour l'appli de collection, qui ne connaît que « dentelé ou non »). */
export function isToothed(edge: BoosterEdge): boolean {
  return edge !== 'lisse' && edge !== 'droit';
}

const pct = (n: number) => `${+n.toFixed(3)}%`;

/**
 * Contour du sachet en clip-path (polygon), d'après ses bords et ses encoches de déchirure ; null : pas de découpe
 * (bords lisses ou droits sans encoche). Hauteurs en cqw : le sachet est un conteneur (container-type: size).
 * Découpe par clip-path et non par mask : un masque met le sachet sur un calque à part et, une fois incliné en 3D,
 * Chrome dessine les calques foil/reflet à plat, décalés du sachet.
 */
export function edgeClipPath(edge: BoosterEdge, notches = false): string | null {
  // profil d'un bord, de gauche à droite : [x en %, profondeur en cqw depuis le bord du sachet]
  const profile: [number, number][] = [];
  if (edge === 'dentele' || edge === 'dentele-fin') {
    const n = edge === 'dentele' ? 19 : 34, t = edge === 'dentele' ? 2.6 : 1.6, w = 100 / n;
    profile.push([0, t]);
    for (let i = 0; i < n; i++) profile.push([w * i + w / 2, 0], [w * (i + 1), t]);
  } else if (edge === 'crenele') {
    const n = 14, t = 2.2, w = 100 / n;
    for (let i = 0; i < n; i++) profile.push([w * i, t], [w * i, 0], [w * i + w / 2, 0], [w * i + w / 2, t]);
    profile.push([100, t]);
  } else if (edge === 'vague') {
    const n = 9, t = 2.4, steps = 10, w = 100 / n;
    for (let i = 0; i <= n * steps; i++) {
      const x = (i / steps) * w;
      profile.push([x, (t / 2) * (1 + Math.cos((2 * Math.PI * i) / steps))]);
    }
  } else if (!notches) {
    return null;
  } else {
    profile.push([0, 0], [100, 0]);
  }
  const top = profile.map(([x, d]) => `${pct(x)} ${+d.toFixed(3)}cqw`);
  const bottom = [...profile].reverse().map(([x, d]) => `${pct(x)} calc(100% - ${+d.toFixed(3)}cqw)`);
  // encoches : un V sur chaque côté, sous la soudure du haut
  const depth = 2.4, half = 1.6, at = 9;
  const right = notches ? [`100% calc(${at}% - ${half}cqw)`, `calc(100% - ${depth}cqw) ${at}%`, `100% calc(${at}% + ${half}cqw)`] : [];
  const left = notches ? [`0% calc(${at}% + ${half}cqw)`, `${depth}cqw ${at}%`, `0% calc(${at}% - ${half}cqw)`] : [];
  return `polygon(${[...top, ...right, ...bottom, ...left].join(', ')})`;
}

/** Verso tiré du recto : couleurs inversées, illustration estompée. */
export function autoBack(design: BoosterDesign): BoosterBackDesign {
  return {
    mode: 'auto',
    background: design.background,
    colorA: design.colorB,
    colorB: design.colorA,
    textColor: design.textColor,
    art: design.art,
    artOpacity: 25,
    artFit: design.artFit,
    artPos: design.artPos,
    logo: design.logo,
    title: '',
    text: '',
    showCount: true,
    barcode: true,
  };
}

/** Verso effectif d'un design : le verso réglé, ou le verso automatique (tiré du recto). */
export function backOf(design: BoosterDesign): BoosterBackDesign {
  const back = design.back;
  if (!back || back.mode === 'auto') {
    return autoBack(design);
  }
  return { ...autoBack(design), ...back };
}

/** Un booster neuf : tout le pool à poids 1. */
export function newBooster(name: string, deckIds: number[]): Omit<Booster, 'id'> {
  return {
    name,
    deckIds,
    cardsPerPack: 10,
    allowDuplicates: false,
    weights: {},
    defaultWeight: 1,
    foilChance: 0,
    foilEffect: 'holo',
    design: { ...DEFAULT_DESIGN, title: name },
  };
}

/** Poids d'une carte dans le booster : réglé, ou poids par défaut. */
export function weightOf(booster: Booster, card: Card): number {
  const weight = booster.weights[card.id];
  return Math.max(0, weight ?? booster.defaultWeight);
}

/** Les cartes du pool qui peuvent sortir (poids > 0). */
export function poolOf(booster: Booster, cards: Card[]): PoolEntry[] {
  return cards
    .filter(card => booster.deckIds.includes(card.deckId))
    .map(card => ({ card, weight: weightOf(booster, card) }))
    .filter(entry => entry.weight > 0);
}

/** Chance (0 à 1) qu'une carte soit choisie à un tirage. */
export function pickChance(entry: PoolEntry, pool: PoolEntry[]): number {
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  return total ? entry.weight / total : 0;
}

/**
 * Tire les cartes d'un booster. Sans doublons, une carte sortie est retirée pour la
 * suite du booster (s'il ne reste plus de carte, le tirage repart du pool complet).
 */
export function openBooster(booster: Booster, pool: PoolEntry[], foilField?: string,
  random: () => number = Math.random): PulledCard[] {
  const pulled: PulledCard[] = [];
  let available = pool.slice();
  for (let i = 0; i < booster.cardsPerPack && pool.length; i++) {
    if (!available.length) {
      available = pool.slice();
    }
    const index = pickIndex(available, random);
    const entry = available[index];
    if (!booster.allowDuplicates) {
      available.splice(index, 1);
    }
    const cardFoil = foilOf(entry.card, foilField);
    const luckyFoil = booster.foilChance > 0 && random() * 100 < booster.foilChance;
    pulled.push({ card: entry.card, foil: cardFoil ?? (luckyFoil ? booster.foilEffect : null) });
  }
  return pulled;
}

function pickIndex(pool: PoolEntry[], random: () => number): number {
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let target = random() * total;
  for (let i = 0; i < pool.length; i++) {
    target -= pool[i].weight;
    if (target < 0) {
      return i;
    }
  }
  return pool.length - 1;
}

/** Résultat d'une simulation de nombreux boosters. */
export interface BoosterStats {
  packs: number;
  /** Par carte : nombre d'exemplaires sortis, et part des boosters qui en contenaient. */
  perCard: Map<number, { copies: number; packsWithCard: number }>;
  /** Par valeur d'un attribut (ex. rareté) : cartes par booster en moyenne. */
  perGroup: Map<string, number>;
  foilsPerPack: number;
}

/** Ouvre `packs` boosters pour mesurer ce qui sort en pratique. */
export function simulate(booster: Booster, pool: PoolEntry[], packs: number,
  groupOf?: (card: Card) => string, foilField?: string, random: () => number = Math.random): BoosterStats {
  const perCard = new Map<number, { copies: number; packsWithCard: number }>();
  const perGroup = new Map<string, number>();
  let foils = 0;
  for (let p = 0; p < packs; p++) {
    const seen = new Set<number>();
    for (const pull of openBooster(booster, pool, foilField, random)) {
      const stat = perCard.get(pull.card.id) ?? { copies: 0, packsWithCard: 0 };
      stat.copies++;
      if (!seen.has(pull.card.id)) {
        stat.packsWithCard++;
        seen.add(pull.card.id);
      }
      perCard.set(pull.card.id, stat);
      if (groupOf) {
        const group = groupOf(pull.card);
        perGroup.set(group, (perGroup.get(group) ?? 0) + 1);
      }
      if (pull.foil) {
        foils++;
      }
    }
  }
  perGroup.forEach((count, group) => perGroup.set(group, count / packs));
  return { packs, perCard, perGroup, foilsPerPack: foils / packs };
}

/** Texte d'une valeur d'attribut (option de liste déroulante comprise). */
export function valueText(value: unknown): string {
  if (value && typeof value === 'object' && 'value' in value) {
    return String((value as { value: unknown }).value ?? '');
  }
  return value === undefined || value === null ? '' : String(value);
}
