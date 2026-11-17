import { computed, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, AfterViewInit,
  ViewChild, ViewChildren, QueryList, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CardFitComponent } from '../../card-binder/card-fit.component';
import { Card } from '../../data-services/types/card.type';
import { CardTemplate } from '../../data-services/types/card-template.type';
import { LightSettings, lighting } from './light';
import { FoilEffect, foilFromValue } from '../../card-binder/foil';

type Background = 'sombre' | 'clair' | 'damier';

interface ViewerSettings extends LightSettings {
  followPointer: boolean;
  background: Background;
}

const STORAGE_KEY = 'cider.viewer3d';
const DEFAULTS: ViewerSettings = { intensity: 1, azimuth: -35, elevation: 55, ambient: 0.35, followPointer: false, background: 'sombre' };
/** degrés par pixel glissé */
const DRAG_GAIN = 0.4;
/** vitesse de la rotation automatique, degrés par seconde */
const SPIN_SPEED = 30;

/**
 * Vue 3D d'une carte pour l'éditeur de modèles : on la tourne dans tous les sens (recto et verso),
 * on règle la lumière (intensité, direction, ambiance) pour juger les foils, en plein écran
 * ou dans une fenêtre séparée (second écran). Les modifications du modèle s'y voient en direct.
 *
 * Dans une fenêtre séparée, l'élément de la vue est déplacé dans le document de la fenêtre : tout
 * y est natif (pas de composant qui écoute le document principal).
 */
@Component({
  selector: 'app-card-viewer-3d',
  templateUrl: './card-viewer-3d.component.html',
  styleUrls: ['./card-viewer-3d.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardFitComponent, TranslatePipe]
})
export class CardViewer3dComponent implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly translate = inject(TranslateService);

  readonly card = input<Card | null>(null);
  readonly front = input<CardTemplate | null>(null);
  readonly back = input<CardTemplate | null>(null);
  readonly title = input('');
  readonly closed = output<void>();

  /** Foil de l'attribut de la carte, sur toute la carte (caché si le modèle a ses zones foil) */
  readonly cardFoil = computed<FoilEffect | null>(() => {
    const card = this.card() as unknown as Record<string, unknown> | null;
    if (!card) {
      return null;
    }
    for (const key of ['foil', 'brillance', 'effet-foil', 'holo']) {
      const effect = foilFromValue(card[key]);
      if (effect) {
        return effect;
      }
    }
    return null;
  });

  @ViewChild('viewer', { static: true }) viewer!: ElementRef<HTMLElement>;
  @ViewChild('home', { static: true }) home!: ElementRef<HTMLElement>;
  @ViewChild('stage', { static: true }) stage!: ElementRef<HTMLElement>;
  @ViewChild('card3d', { static: true }) card3d!: ElementRef<HTMLElement>;
  @ViewChild('scene', { static: true }) scene!: ElementRef<HTMLElement>;
  @ViewChildren(CardFitComponent) fits!: QueryList<CardFitComponent>;

  settings: ViewerSettings = { ...DEFAULTS };
  rx = 0;
  ry = 0;
  zoom = 1;
  /** déplacement de la carte dans la scène (px) */
  panX = 0;
  panY = 0;
  spinning = false;
  /** taille d'une face à l'écran (px) */
  faceW = 0;
  faceH = 0;
  inWindow = false;
  panelOpen = true;

  private aspect = 0.714;
  private popup: Window | null = null;
  private resize?: ResizeObserver;
  private drag: { id: number; x: number; y: number; mode: 'turn' | 'light' | 'move' } | null = null;
  private frame = 0;
  private spinFrom = 0;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved && typeof saved === 'object') {
        this.settings = { ...DEFAULTS, ...saved };
      }
    } catch { /* pas de stockage */ }
  }

  ngAfterViewInit(): void {
    this.observeStage();
    this.render();
  }

  ngOnDestroy(): void {
    this.resize?.disconnect();
    this.win().cancelAnimationFrame(this.frame);
    if (this.popup && !this.popup.closed) {
      this.popup.close();
    }
  }

  /** La fenêtre où se trouve la vue (principale ou séparée) */
  private win(): Window {
    return this.viewer?.nativeElement.ownerDocument.defaultView ?? window;
  }

  // ----- Taille -----

  private observeStage(): void {
    this.resize?.disconnect();
    const Observer = (this.win() as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver;
    this.resize = new Observer(() => this.zone.run(() => this.layout()));
    this.resize.observe(this.stage.nativeElement);
  }

  onMeasured(size: { width: number; height: number }): void {
    if (size.width && size.height && Math.abs(size.width / size.height - this.aspect) > 0.001) {
      this.aspect = size.width / size.height;
      this.layout();
    }
  }

  private layout(): void {
    const stage = this.stage.nativeElement;
    const w = stage.clientWidth * 0.82;
    const h = stage.clientHeight * 0.82;
    if (!w || !h) {
      return;
    }
    const height = Math.min(h, w / this.aspect) * this.zoom;
    this.faceH = Math.round(height);
    this.faceW = Math.round(height * this.aspect);
    this.cdr.markForCheck();
    // une fois la nouvelle taille posée : les cartes s'y ajustent
    this.win().setTimeout(() => this.fits?.forEach(fit => fit.refit()), 0);
  }

  // ----- Rotation, lumière -----

  /** Applique l'orientation et l'éclairage (variables CSS, sans détection de changements) */
  private render(): void {
    const el = this.card3d.nativeElement;
    const light = lighting(this.rx, this.ry, this.settings);
    el.style.transform = `rotateX(${this.rx}deg) rotateY(${this.ry}deg)`;
    el.style.setProperty('--glare-x', `${light.glareX}%`);
    el.style.setProperty('--glare-y', `${light.glareY}%`);
    el.style.setProperty('--glare-o', String(light.glareO));
    el.style.setProperty('--shade', String(light.shade));
    el.style.setProperty('--spec', String(light.specular));
    el.style.setProperty('--relief-x', light.reliefX.toFixed(3));
    el.style.setProperty('--relief-y', light.reliefY.toFixed(3));
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button > 2) {
      return;
    }
    // bouton du milieu, Ctrl ou Alt : déplacer ; clic droit ou Maj : la lumière ; sinon : tourner
    const mode = event.button === 1 || event.ctrlKey || event.altKey || event.metaKey ? 'move'
      : event.button === 2 || event.shiftKey ? 'light' : 'turn';
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, mode };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.stopSpin();
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.drag) {
      if (this.settings.followPointer) {
        this.lightFromPointer(event);
      }
      return;
    }
    if (event.pointerId !== this.drag.id) {
      return;
    }
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    if (this.drag.mode === 'light') {
      this.lightFromPointer(event);
      return;
    }
    if (this.drag.mode === 'move') {
      this.moveBy(dx, dy);
      return;
    }
    // la carte suit la main : horizontale autour de Y ; verticale autour de X (sens inversé à l'envers)
    this.ry = wrap(this.ry + dx * DRAG_GAIN);
    this.rx = wrap(this.rx - dy * DRAG_GAIN);
    this.render();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.drag?.id === event.pointerId) {
      this.drag = null;
      this.save();
    }
  }

  /** Lumière placée sous le pointeur : centre de la scène = de face, bords = rasante */
  private lightFromPointer(event: PointerEvent): void {
    const box = this.stage.nativeElement.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * 2 - 1;
    const y = (event.clientY - box.top) / box.height * 2 - 1;
    const r = Math.min(1, Math.hypot(x, y));
    this.settings.azimuth = Math.round(Math.atan2(x, -y) * 180 / Math.PI);
    this.settings.elevation = Math.round(90 - r * 85);
    this.render();
    this.cdr.markForCheck();
  }

  /** Zoom vers le pointeur : le point de la carte sous la souris reste sous la souris */
  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const box = this.stage.nativeElement.getBoundingClientRect();
    this.setZoom(this.zoom * (event.deltaY > 0 ? 0.9 : 1.1),
      { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 });
  }

  /** Zoom autour d'un point de la scène (par rapport à son centre) ; par défaut, le centre de la carte */
  setZoom(zoom: number, around?: { x: number; y: number }): void {
    const next = Math.min(8, Math.max(0.3, zoom));
    const factor = next / this.zoom;
    if (around) {
      // le point visé, mesuré depuis le centre de la carte, s'éloigne de `factor` : la carte suit
      this.panX += (around.x - this.panX) * (1 - factor);
      this.panY += (around.y - this.panY) * (1 - factor);
    } else {
      this.panX *= factor;
      this.panY *= factor;
    }
    this.zoom = next;
    this.applyPan();
    this.layout();
  }

  /** Déplace la carte dans la scène */
  moveBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.applyPan();
  }

  /** Carte recentrée, à sa taille de départ */
  recenter(): void {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.applyPan();
    this.layout();
  }

  private applyPan(): void {
    this.scene.nativeElement.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
  }

  /** Flèches : déplacer (Maj : plus vite) ; + et - : zoom ; 0 : recentrer */
  onKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 60 : 15;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      this.moveBy(...moves[event.key]);
    } else if (event.key === '+' || event.key === '=') {
      this.setZoom(this.zoom * 1.2);
    } else if (event.key === '-') {
      this.setZoom(this.zoom / 1.2);
    } else if (event.key === '0') {
      this.recenter();
    } else {
      return;
    }
    event.preventDefault();
  }

  /** Remet la carte de face (ou de dos) */
  face(side: 'front' | 'back'): void {
    this.stopSpin();
    this.animateTo(0, side === 'front' ? 0 : 180);
  }

  turn(): void {
    this.stopSpin();
    this.animateTo(this.rx, this.ry + 180);
  }

  reset(): void {
    this.settings = { ...DEFAULTS, background: this.settings.background };
    this.recenter();
    this.face('front');
    this.save();
  }

  /** Rotation douce vers une orientation */
  private animateTo(rx: number, ry: number): void {
    const win = this.win();
    win.cancelAnimationFrame(this.frame);
    const from = { rx: this.rx, ry: this.ry };
    // chemin le plus court
    const target = { rx: from.rx + shortest(rx - from.rx), ry: from.ry + shortest(ry - from.ry) };
    const start = win.performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 450);
      const e = 1 - Math.pow(1 - t, 3);
      this.rx = from.rx + (target.rx - from.rx) * e;
      this.ry = from.ry + (target.ry - from.ry) * e;
      this.render();
      if (t < 1) {
        this.frame = win.requestAnimationFrame(step);
      } else {
        this.rx = wrap(this.rx);
        this.ry = wrap(this.ry);
      }
    };
    this.zone.runOutsideAngular(() => this.frame = win.requestAnimationFrame(step));
  }

  toggleSpin(): void {
    if (this.spinning) {
      this.stopSpin();
      return;
    }
    this.spinning = true;
    const win = this.win();
    this.spinFrom = win.performance.now();
    const step = (now: number) => {
      if (!this.spinning) {
        return;
      }
      this.ry = wrap(this.ry + (now - this.spinFrom) / 1000 * SPIN_SPEED);
      this.spinFrom = now;
      this.render();
      this.frame = win.requestAnimationFrame(step);
    };
    this.zone.runOutsideAngular(() => this.frame = win.requestAnimationFrame(step));
  }

  private stopSpin(): void {
    if (this.spinning) {
      this.spinning = false;
      this.win().cancelAnimationFrame(this.frame);
      this.cdr.markForCheck();
    }
  }

  // ----- Réglages -----

  setLight(key: 'intensity' | 'azimuth' | 'elevation' | 'ambient', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.settings = { ...this.settings, [key]: key === 'intensity' || key === 'ambient' ? value / 100 : value };
    this.render();
    this.save();
  }

  setFollow(event: Event): void {
    this.settings = { ...this.settings, followPointer: (event.target as HTMLInputElement).checked };
    this.save();
  }

  setBackground(background: Background): void {
    this.settings = { ...this.settings, background };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch { /* pas de stockage */ }
  }

  // ----- Plein écran, fenêtre séparée -----

  fullscreen(): void {
    const doc = this.viewer.nativeElement.ownerDocument;
    if (doc.fullscreenElement) {
      void doc.exitFullscreen();
    } else {
      void this.viewer.nativeElement.requestFullscreen?.();
    }
  }

  openWindow(): void {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return;
    }
    const popup = window.open('', 'cider-card-3d', 'width=1100,height=850');
    if (!popup) {
      alert(this.translate.instant('template-editor.popout-blocked'));
      return;
    }
    this.popup = popup;
    const doc = popup.document;
    doc.title = this.translate.instant('viewer3d.window-title', { name: this.title() });
    doc.head.replaceChildren();
    doc.body.replaceChildren();
    // mêmes styles que l'application (thème, cartes, foils, cette vue)
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => doc.head.appendChild(node.cloneNode(true)));
    doc.documentElement.className = document.documentElement.className;
    Object.assign(doc.body.style, { margin: '0', height: '100vh', overflow: 'hidden' });
    doc.body.appendChild(this.viewer.nativeElement);
    this.inWindow = true;
    popup.addEventListener('pagehide', () => this.zone.run(() => this.bringBack()));
    this.observeStage();
    this.layout();
    this.cdr.markForCheck();
  }

  /** La vue revient dans la page (fenêtre fermée ou bouton « Ramener ») */
  bringBack(): void {
    const popup = this.popup;
    this.popup = null;
    this.stopSpin();
    this.home.nativeElement.appendChild(this.viewer.nativeElement);
    this.inWindow = false;
    if (popup && !popup.closed) {
      popup.close();
    }
    this.observeStage();
    this.layout();
    this.cdr.markForCheck();
  }

  close(): void {
    this.closed.emit();
  }

  percent(value: number): number {
    return Math.round(value * 100);
  }
}

/** Angle ramené entre -180 et 180 */
function wrap(deg: number): number {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

function shortest(delta: number): number {
  return wrap(delta);
}
