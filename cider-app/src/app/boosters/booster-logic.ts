import { Booster, BoosterDesign } from '../data-services/types/booster.type';
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
