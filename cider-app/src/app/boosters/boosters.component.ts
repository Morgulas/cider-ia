import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, debounceTime } from 'rxjs';
import { Button } from 'primeng/button';
import { SelectButton } from 'primeng/selectbutton';
import { Select } from 'primeng/select';
import { MultiSelect } from 'primeng/multiselect';
import { InputNumber } from 'primeng/inputnumber';
import { Textarea } from 'primeng/textarea';
import { InputText } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { Tooltip } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { EditorComponent } from 'ngx-monaco-editor-v2';
import { BoostersService } from '../data-services/services/boosters.service';
import { CardsService } from '../data-services/services/cards.service';
import { DecksService } from '../data-services/services/decks.service';
import { AssetsService } from '../data-services/services/assets.service';
import { CardTemplatesService } from '../data-services/services/card-templates.service';
import { LocalStorageService } from '../data-services/local-storage/local-storage.service';
import { Booster, BoosterArtFit, BoosterBackground, BoosterDesign, BoosterEdge, BoosterFinish, BoosterFont } from '../data-services/types/booster.type';
import { Card } from '../data-services/types/card.type';
import { Deck } from '../data-services/types/deck.type';
import { AssetUrls } from '../data-services/types/asset.type';
import { EntityField } from '../data-services/types/entity-field.type';
import { fieldOf } from '../data-services/types/entity-service.type';
import { FOIL_EFFECTS, findFoilField } from '../card-binder/foil';
import { CardTiltDirective } from '../card-binder/card-tilt.directive';
import { BoosterPackComponent } from './booster-pack.component';
import { BoosterOpeningComponent } from './booster-opening.component';
import { AssetChoice, assetChoices } from './booster-assets';
import { BOOSTER_FONTS, BoosterStats, PoolEntry, PulledCard, autoBack, edgeOf, isToothed, newBooster, openBooster, pickChance, poolOf, simulate, valueText, weightOf } from './booster-logic';
import { backToTemplate, designToTemplate } from './booster-template';

type Section = 'open' | 'pool' | 'design' | 'stats';

/** Une ligne du tableau des poids. */
interface PoolRow {
  card: Card;
  deckName: string;
  group: string;
  weight: number;
  chance: number;
  perPack: number;
}

/** Ce qui est sorti pendant la session, par carte. */
interface CollectedCard {
  card: Card;
  copies: number;
  foils: number;
}

@Component({
  selector: 'app-boosters',
  templateUrl: './boosters.component.html',
  styleUrls: ['./boosters.component.scss'],
  providers: [ConfirmationService],
  imports: [FormsModule, TranslatePipe, Button, SelectButton, Select, MultiSelect, InputNumber, InputText, Textarea,
    ToggleSwitch, Tooltip, ConfirmDialog, EditorComponent, BoosterPackComponent, BoosterOpeningComponent, CardTiltDirective]
})
export class BoostersComponent implements OnInit, OnDestroy {
  private readonly boostersService = inject(BoostersService);
  private readonly cardsService = inject(CardsService);
  private readonly decksService = inject(DecksService);
  private readonly assetsService = inject(AssetsService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly destroyRef = inject(DestroyRef);
  readonly templatesService = inject(CardTemplatesService);

  boosters: Booster[] = [];
  booster: Booster | null = null;
  decks: Deck[] = [];
  cards: Card[] = [];
  fields: EntityField<Card>[] = [];
  foilField: string | undefined;
  assetUrls: AssetUrls = {};
  assets: AssetChoice[] = [];

  section: Section = 'open';
  readonly sectionOptions: { value: Section; key: string; icon: string }[] = [
    { value: 'open', key: 'boosters.section.open', icon: 'pi pi-gift' },
    { value: 'pool', key: 'boosters.section.pool', icon: 'pi pi-percentage' },
    { value: 'design', key: 'boosters.section.design', icon: 'pi pi-palette' },
    { value: 'stats', key: 'boosters.section.stats', icon: 'pi pi-chart-bar' },
  ];
  readonly finishes: BoosterFinish[] = ['mat', 'brillant', ...FOIL_EFFECTS];
  readonly backgrounds: BoosterBackground[] = ['degrade', 'radial', 'rayures', 'uni', 'aucun'];
  readonly edges: BoosterEdge[] = ['lisse', 'droit', 'dentele', 'dentele-fin', 'crenele', 'vague'];
  readonly fonts = Object.keys(BOOSTER_FONTS) as BoosterFont[];
  readonly textPositions = [{ v: 'haut', k: 'boosters.design.pos-haut' }, { v: 'milieu', k: 'boosters.design.pos-milieu' },
    { v: 'bas', k: 'boosters.design.pos-bas' }];
  readonly artFits: { v: BoosterArtFit; k: string }[] = [{ v: 'cover', k: 'boosters.design.fit-cover' },
    { v: 'contain', k: 'boosters.design.fit-contain' }];
  /** Calques du recto qu'on peut masquer (absents du design : affichés). */
  readonly frontToggles: { key: 'showTitle' | 'showCount' | 'band' | 'seals'; label: string }[] = [
    { key: 'showTitle', label: 'boosters.design.show-title' }, { key: 'showCount', label: 'boosters.design.show-count' },
    { key: 'band', label: 'boosters.design.band' }, { key: 'seals', label: 'boosters.design.seals' }];
  readonly foilEffects: string[] = [...FOIL_EFFECTS];

  // pool et poids
  pool: PoolEntry[] = [];
  rows: PoolRow[] = [];
  poolFilter = '';
  groupField = '';
  /** Poids à appliquer par valeur de l'attribut de regroupement. */
  groupWeights: { value: string; count: number; weight: number | null }[] = [];

  // statistiques
  stats: BoosterStats | null = null;
  /** Boosters pour avoir toutes les cartes : estimation, puis mesure par la simulation. */
  fullSetEstimate = 0;
  fullSetMeasured: number | null = null;
  statsPacks = 10000;
  statsRunning = false;

  // session d'ouverture
  openedPacks = 0;
  collected: CollectedCard[] = [];
  collectedIds = new Set<number>();

  /** Face du sachet éditée et montrée dans l'onglet Design. */
  designSide: 'front' | 'back' = 'front';
  editorOptions = { theme: 'vs-dark-extended', language: 'handlebars', automaticLayout: true, minimap: { enabled: false } };
  cssEditorOptions = { theme: 'vs-dark-extended', language: 'css-handlebars', automaticLayout: true, minimap: { enabled: false } };

  /** Signale une modification : l'enregistrement part peu après la dernière */
  private readonly saves = new Subject<void>();
  /**
   * Boosters modifiés pas encore enregistrés, par id : un par booster, pour qu'une
   * modification d'un booster ne fasse pas oublier celle d'un autre.
   */
  private readonly pendingSaves = new Map<number, Booster>();

  ngOnInit(): void {
    if (!this.localStorage.getDarkMode()) {
      this.editorOptions.theme = 'vs';
      this.cssEditorOptions.theme = 'vs';
    }
    this.saves.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.flushSaves());
    this.assetsService.assetUrls.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(urls => this.assetUrls = urls);
    void this.load();
  }

  ngOnDestroy(): void {
    // dernières modifications pas encore enregistrées
    void this.flushSaves();
  }

  /** Enregistre tout de suite les modifications en attente */
  flushSaves(): Promise<unknown> {
    const boosters = [...this.pendingSaves.values()];
    this.pendingSaves.clear();
    return Promise.all(boosters.map(booster => this.boostersService.update(booster.id, booster)));
  }

  private async load(): Promise<void> {
    const [boosters, decks, cards, fields, assets] = await Promise.all([
      this.boostersService.getAll(),
      this.decksService.getAll(),
      this.cardsService.getAllUnfiltered(),
      this.cardsService.getFieldsUnfiltered(),
      assetChoices(this.assetsService),
    ]);
    this.boosters = boosters.map(normalize);
    this.decks = decks;
    this.cards = cards;
    const seen = new Set<string>();
    this.fields = fields.filter(field => {
      const key = String(field.field);
      const keep = !['id', 'deckId', 'name', 'count', 'frontCardTemplateId', 'backCardTemplateId'].includes(key) && !seen.has(key);
      seen.add(key);
      return keep;
    });
    this.foilField = findFoilField(fields);
    this.groupField = String(this.fields.find(field => /rar/i.test(field.header))?.field ?? '');
    this.assets = assets;
    this.select(this.boosters[0] ?? null);
  }

  select(booster: Booster | null): void {
    // le booster quitté garde ses dernières modifications
    void this.flushSaves();
    this.booster = booster;
    this.stats = null;
    this.refreshPool();
  }

  async create(): Promise<void> {
    const name = this.translate.instant('boosters.new-name', { n: this.boosters.length + 1 });
    const deckIds = this.decks.map(deck => deck.id);
    const created = await this.boostersService.create(newBooster(name, deckIds) as Booster);
    this.boosters = [...this.boosters, normalize(created)];
    this.select(this.boosters[this.boosters.length - 1]);
    this.section = 'pool';
  }

  async duplicate(): Promise<void> {
    if (!this.booster) {
      return;
    }
    const copy = structuredClone(this.booster) as Partial<Booster>;
    delete copy.id;
    copy.name = `${this.booster.name} (2)`;
    const created = await this.boostersService.create(copy as Booster);
    this.boosters = [...this.boosters, normalize(created)];
    this.select(this.boosters[this.boosters.length - 1]);
  }

  remove(): void {
    const booster = this.booster;
    if (!booster) {
      return;
    }
    this.confirmation.confirm({
      header: this.translate.instant('boosters.delete'),
      message: this.translate.instant('boosters.delete-confirm', { name: booster.name }),
      accept: async () => {
        // un enregistrement en attente le recréerait (l'enregistrement remplace tout le booster)
        this.pendingSaves.delete(booster.id);
        await this.boostersService.delete(booster.id);
        this.boosters = this.boosters.filter(b => b.id !== booster.id);
        this.select(this.boosters[0] ?? null);
      }
    });
  }

  /** Une modification : enregistrée peu après, pool et aperçu mis à jour. */
  changed(refreshPool = false): void {
    if (!this.booster) {
      return;
    }
    // nouvel objet : les composants OnPush (aperçu du booster) voient le changement
    this.booster = { ...this.booster, design: { ...this.booster.design } };
    this.boosters = this.boosters.map(b => b.id === this.booster!.id ? this.booster! : b);
    if (refreshPool) {
      this.refreshPool();
    }
    this.pendingSaves.set(this.booster.id, this.booster);
    this.saves.next();
  }

  // ----- Pool et poids -----

  refreshPool(): void {
    const booster = this.booster;
    if (!booster) {
      this.pool = [];
      this.rows = [];
      return;
    }
    this.pool = poolOf(booster, this.cards);
    const deckNames = new Map(this.decks.map(deck => [deck.id, deck.name]));
    const draws = booster.cardsPerPack;
    this.rows = this.cards
      .filter(card => booster.deckIds.includes(card.deckId))
      .map(card => {
        const weight = weightOf(booster, card);
        const chance = weight > 0 ? pickChance({ card, weight }, this.pool) : 0;
        return {
          card, weight, chance,
          deckName: deckNames.get(card.deckId) ?? '',
          group: this.groupOf(card),
          // avec doublons : exemplaires moyens par booster ; sans : chance d'en avoir un (approchée)
          perPack: booster.allowDuplicates ? chance * draws : 1 - Math.pow(1 - chance, draws),
        };
      });
    this.refreshGroupWeights();
    this.fullSetEstimate = this.packsForFullSet();
    this.fullSetMeasured = null;
  }

  filteredRows(): PoolRow[] {
    const filter = this.poolFilter.trim().toLowerCase();
    return filter
      ? this.rows.filter(row => row.card.name?.toLowerCase().includes(filter) || row.group.toLowerCase().includes(filter))
      : this.rows;
  }

  setWeight(row: PoolRow, weight: number | null): void {
    if (!this.booster) {
      return;
    }
    const value = Math.max(0, weight ?? 0);
    this.booster.weights = { ...this.booster.weights, [row.card.id]: value };
    this.changed(true);
  }

  resetWeights(): void {
    if (!this.booster) {
      return;
    }
    this.booster.weights = {};
    this.changed(true);
  }

  groupOf(card: Card): string {
    return this.groupField ? valueText(fieldOf(card, this.groupField)) || '—' : '';
  }

  groupLabel(): string {
    return this.fields.find(field => String(field.field) === this.groupField)?.header ?? '';
  }

  onGroupFieldChange(): void {
    this.stats = null;
    this.refreshPool();
  }

  private refreshGroupWeights(): void {
    if (!this.groupField) {
      this.groupWeights = [];
      return;
    }
    const counts = new Map<string, { count: number; weights: Set<number> }>();
    for (const row of this.rows) {
      const entry = counts.get(row.group) ?? { count: 0, weights: new Set<number>() };
      entry.count++;
      entry.weights.add(row.weight);
      counts.set(row.group, entry);
    }
    this.groupWeights = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, entry]) => ({ value, count: entry.count, weight: entry.weights.size === 1 ? [...entry.weights][0] : null }));
  }

  /** Donne le même poids à toutes les cartes d'une valeur (ex. toutes les rares). */
  applyGroupWeight(group: { value: string; weight: number | null }): void {
    if (!this.booster || group.weight === null) {
      return;
    }
    const weights = { ...this.booster.weights };
    for (const row of this.rows) {
      if (row.group === group.value) {
        weights[row.card.id] = Math.max(0, group.weight);
      }
    }
    this.booster.weights = weights;
    this.changed(true);
  }

  groupShare(value: string): number {
    const total = this.pool.reduce((sum, e) => sum + e.weight, 0);
    const inGroup = this.rows.filter(row => row.group === value).reduce((sum, row) => sum + row.weight, 0);
    return total ? inGroup / total : 0;
  }

  // ----- Statistiques -----

  runStats(): void {
    if (!this.booster) {
      return;
    }
    this.statsRunning = true;
    // laisse l'indicateur s'afficher avant le calcul
    setTimeout(() => {
      const booster = this.booster!;
      this.stats = simulate(booster, this.pool, this.statsPacks,
        this.groupField ? card => this.groupOf(card) : undefined, this.foilField);
      this.fullSetMeasured = measureFullSet(booster, this.pool);
      this.statsRunning = false;
    }, 30);
  }

  statsGroups(): { value: string; perPack: number }[] {
    return this.stats ? [...this.stats.perGroup.entries()]
      .map(([value, perPack]) => ({ value, perPack }))
      .sort((a, b) => b.perPack - a.perPack) : [];
  }

  statsCards(): { card: Card; group: string; packsWithCard: number; copies: number }[] {
    if (!this.stats) {
      return [];
    }
    const byId = new Map(this.cards.map(card => [card.id, card]));
    return [...this.stats.perCard.entries()]
      .map(([id, stat]) => ({ card: byId.get(id)!, group: this.groupOf(byId.get(id)!), ...stat }))
      .filter(row => row.card)
      .sort((a, b) => a.packsWithCard - b.packsWithCard);
  }

  /** Boosters à ouvrir, en moyenne, pour avoir au moins une fois chaque carte du pool. */
  private packsForFullSet(): number {
    if (!this.booster || !this.pool.length) {
      return 0;
    }
    // collectionneur de vignettes à probabilités inégales (tirages avec remise) :
    // E = ∫ (1 - Π(1 - e^(-p·t))) dt, intégré avec un pas qui grandit avec t
    const total = this.pool.reduce((sum, e) => sum + e.weight, 0);
    const probabilities = this.pool.map(e => e.weight / total);
    let expected = 0;
    let t = 0;
    for (let i = 0; i < 200000; i++) {
      const step = Math.max(0.01, t * 0.002);
      const all = probabilities.reduce((product, p) => product * (1 - Math.exp(-p * (t + step / 2))), 1);
      expected += (1 - all) * step;
      t += step;
      if (1 - all < 1e-7) {
        break;
      }
    }
    return expected / this.booster.cardsPerPack;
  }

  // ----- Design -----

  /** Bords du sachet (« crimped » suit, pour les designs d'avant et l'export). */
  get edge(): BoosterEdge {
    return this.booster ? edgeOf(this.booster.design) : 'lisse';
  }

  setEdge(edge: BoosterEdge): void {
    if (!this.booster) {
      return;
    }
    this.booster.design.edge = edge;
    this.booster.design.crimped = isToothed(edge);
    this.changed();
  }

  setFrontToggle(key: keyof Pick<BoosterDesign, 'showTitle' | 'showCount' | 'band' | 'seals'>, on: boolean): void {
    if (!this.booster) {
      return;
    }
    this.booster.design[key] = on;
    this.changed();
  }

  fontFamily(font: BoosterFont): string {
    return BOOSTER_FONTS[font];
  }

  setDesignMode(mode: 'form' | 'template'): void {
    if (!this.booster) {
      return;
    }
    if (mode === 'template' && !this.booster.design.html) {
      Object.assign(this.booster.design, designToTemplate(this.booster.design));
    }
    this.booster.design.mode = mode;
    this.changed();
  }

  /** Verso : automatique (tiré du recto), réglages ou modèle HTML/CSS. */
  setBackMode(mode: 'auto' | 'form' | 'template'): void {
    if (!this.booster) {
      return;
    }
    const design = this.booster.design;
    // en quittant l'automatique, on part du verso automatique actuel
    const back = design.back && design.back.mode !== 'auto' ? design.back : { ...autoBack(design), ...(design.back ?? {}) };
    if (mode === 'template' && !back.html) {
      Object.assign(back, backToTemplate({ ...back, mode: 'form' }, this.booster.design.font));
    }
    design.back = { ...back, mode };
    this.changed();
  }

  /** Remplace le modèle du verso par une traduction de ses réglages. */
  backTemplateFromForm(): void {
    if (!this.booster?.design.back) {
      return;
    }
    Object.assign(this.booster.design.back, backToTemplate(this.booster.design.back, this.booster.design.font));
    this.changed();
  }

  /** Remplace le modèle par une traduction des réglages du formulaire. */
  templateFromForm(): void {
    if (!this.booster) {
      return;
    }
    Object.assign(this.booster.design, designToTemplate(this.booster.design));
    this.changed();
  }

  // ----- Session d'ouverture -----

  onPackOpened(pulled: PulledCard[]): void {
    this.openedPacks++;
    const byId = new Map(this.collected.map(entry => [entry.card.id, entry]));
    for (const pull of pulled) {
      const entry = byId.get(pull.card.id) ?? { card: pull.card, copies: 0, foils: 0 };
      entry.copies++;
      if (pull.foil) {
        entry.foils++;
      }
      byId.set(pull.card.id, entry);
    }
    this.collected = [...byId.values()].sort((a, b) => (a.card.name ?? '').localeCompare(b.card.name ?? ''));
    this.collectedIds = new Set(byId.keys());
  }

  resetSession(): void {
    this.openedPacks = 0;
    this.collected = [];
    this.collectedIds = new Set();
  }

  collectedProgress(): number {
    return this.pool.length ? this.collected.filter(entry => this.pool.some(e => e.card.id === entry.card.id)).length / this.pool.length : 0;
  }

  percent(value: number): string {
    if (value > 0 && value < 0.001) {
      return '< 0,1 %';
    }
    return `${(value * 100).toLocaleString(this.translate.currentLang || 'fr', { maximumFractionDigits: 1 })} %`;
  }

  decimal(value: number, digits = 2): string {
    return value.toLocaleString(this.translate.currentLang || 'fr', { maximumFractionDigits: digits });
  }
}

/**
 * Boosters ouverts en moyenne avant d'avoir toutes les cartes, mesurés en ouvrant
 * réellement des boosters (tient compte des doublons interdits) ; null si trop long.
 */
function measureFullSet(booster: Booster, pool: PoolEntry[]): number | null {
  const runs = 200;
  const budget = 300000;
  let total = 0;
  let opened = 0;
  for (let run = 0; run < runs; run++) {
    const missing = new Set(pool.map(entry => entry.card.id));
    let packs = 0;
    while (missing.size && opened < budget) {
      for (const pull of openBooster(booster, pool)) {
        missing.delete(pull.card.id);
      }
      packs++;
      opened++;
    }
    if (missing.size) {
      return null;
    }
    total += packs;
  }
  return total / runs;
}

/** Complète un booster enregistré par une version précédente. */
function normalize(booster: Booster): Booster {
  const base = newBooster(booster.name ?? 'Booster', booster.deckIds ?? []);
  return { ...base, ...booster, weights: booster.weights ?? {}, design: { ...base.design, ...(booster.design ?? {}) } };
}
