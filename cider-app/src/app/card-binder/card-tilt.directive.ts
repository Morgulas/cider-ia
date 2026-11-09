import { Directive, ElementRef, Input, NgZone, OnDestroy, OnInit } from '@angular/core';

/** Inclinaison maximale au survol (degrés). */
const HOVER_MAX = 10;
/** Inclinaison maximale en faisant glisser la carte (degrés). */
const DRAG_MAX = 32;
/** Degrés par pixel glissé. */
const DRAG_GAIN = 0.22;
/** Au-delà de ce déplacement (px), le geste est une inclinaison et non un clic. */
const CLICK_SLOP = 6;

/**
 * Fait pivoter une carte comme dans les jeux de cartes sur mobile : elle suit la souris
 * au survol, se tourne franchement quand on la fait glisser (souris ou doigt), puis
 * revient à plat avec un léger rebond. Un reflet suit l'inclinaison.
 *
 * L'élément reçoit les variables CSS :
 *  --tilt-x, --tilt-y   rotation en degrés (rotateX / rotateY)
 *  --glare-x, --glare-y position du reflet (%)
 *  --glare-o            intensité du reflet (0 à 1)
 * et la classe `tilt-settling` pendant le retour à plat.
 *
 * Les événements sont traités hors d'Angular : aucun cycle de détection par mouvement.
 * Un glissé ne déclenche pas le clic (retournement) de la carte.
 */
@Directive({
  selector: '[appCardTilt]',
  standalone: true
})
export class CardTiltDirective implements OnInit, OnDestroy {
  /** Désactive l'effet (mouvements réduits demandés par le système…). */
  @Input() appCardTiltDisabled = false;

  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;
  private frame = 0;
  private pending: { x: number; y: number } | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(private el: ElementRef<HTMLElement>, private zone: NgZone) { }

  ngOnInit(): void {
    const el = this.el.nativeElement;
    this.zone.runOutsideAngular(() => {
      this.listen(el, 'pointerenter', e => this.onHover(e as PointerEvent));
      this.listen(el, 'pointermove', e => this.onMove(e as PointerEvent));
      this.listen(el, 'pointerdown', e => this.onDown(e as PointerEvent));
      this.listen(el, 'pointerup', e => this.onUp(e as PointerEvent));
      this.listen(el, 'pointercancel', e => this.onUp(e as PointerEvent));
      this.listen(el, 'pointerleave', e => this.onLeave(e as PointerEvent));
      // fenêtre, phase de capture : le clic qui suit un glissé est arrêté avant tout le
      // reste, même relâché hors de la carte (il ne doit ni la retourner, ni fermer l'agrandissement)
      this.listen(window, 'click', e => this.onClick(e), true);
    });
    this.apply(0, 0, 50, 50, 0);
  }

  ngOnDestroy(): void {
    this.cleanup.forEach(off => off());
    cancelAnimationFrame(this.frame);
  }

  private listen(el: HTMLElement | Window, type: string, handler: (e: Event) => void, capture = false): void {
    el.addEventListener(type, handler, capture);
    this.cleanup.push(() => el.removeEventListener(type, handler, capture));
  }

  private get disabled(): boolean {
    return this.appCardTiltDisabled;
  }

  private onHover(e: PointerEvent): void {
    if (this.disabled || this.drag || e.pointerType !== 'mouse') {
      return;
    }
    this.el.nativeElement.classList.remove('tilt-settling');
    this.schedule(e.clientX, e.clientY);
  }

  private onMove(e: PointerEvent): void {
    if (this.disabled) {
      return;
    }
    if (this.drag && e.pointerId === this.drag.id) {
      if (!this.drag.moved && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > CLICK_SLOP) {
        this.drag.moved = true;
      }
      this.schedule(e.clientX, e.clientY);
    } else if (!this.drag && e.pointerType === 'mouse') {
      this.schedule(e.clientX, e.clientY);
    }
  }

  private onDown(e: PointerEvent): void {
    if (this.disabled || e.button !== 0) {
      return;
    }
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    this.suppressClick = false;
    this.el.nativeElement.classList.remove('tilt-settling');
    this.el.nativeElement.classList.add('tilt-dragging');
    try {
      this.el.nativeElement.setPointerCapture(e.pointerId);
    } catch {
      // pointeur déjà relâché : rien à capturer
    }
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) {
      return;
    }
    this.suppressClick = this.drag.moved;
    if (this.suppressClick) {
      // le clic éventuel suit tout de suite le relâchement : au-delà, plus rien à arrêter
      setTimeout(() => this.suppressClick = false);
    }
    this.drag = null;
    this.el.nativeElement.classList.remove('tilt-dragging');
    const rect = this.el.nativeElement.getBoundingClientRect();
    const inside = e.pointerType === 'mouse' && e.type === 'pointerup'
      && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inside) {
      // la souris est encore sur la carte : retour à l'inclinaison de survol
      this.settle();
      this.schedule(e.clientX, e.clientY);
    } else {
      this.reset();
    }
  }

  private onLeave(e: PointerEvent): void {
    if (this.drag && e.pointerId === this.drag.id) {
      return; // capture : le glissé continue hors de la carte
    }
    this.reset();
  }

  private onClick(e: Event): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }

  private reset(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending = null;
    this.settle();
    this.apply(0, 0, 50, 50, 0);
  }

  private settle(): void {
    this.el.nativeElement.classList.add('tilt-settling');
  }

  /** Un calcul par image affichée, quel que soit le nombre d'événements. */
  private schedule(x: number, y: number): void {
    this.pending = { x, y };
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const point = this.pending;
        this.pending = null;
        if (point) {
          this.update(point.x, point.y);
        }
      });
    }
  }

  private update(x: number, y: number): void {
    const rect = this.el.nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    // position relative dans la carte, de -1 à 1
    const px = Math.max(-1, Math.min(1, ((x - rect.left) / rect.width) * 2 - 1));
    const py = Math.max(-1, Math.min(1, ((y - rect.top) / rect.height) * 2 - 1));
    let rx: number;
    let ry: number;
    if (this.drag) {
      // glissé : la carte suit le doigt, comme si on la poussait par le bord
      ry = clamp((x - this.drag.x) * DRAG_GAIN, DRAG_MAX);
      rx = clamp(-(y - this.drag.y) * DRAG_GAIN, DRAG_MAX);
    } else {
      // survol : le coin sous la souris s'enfonce légèrement
      ry = px * HOVER_MAX;
      rx = -py * HOVER_MAX;
    }
    const strength = Math.min(1, Math.hypot(rx, ry) / DRAG_MAX * 1.6);
    // le reflet glisse à l'opposé de l'inclinaison, comme une lumière fixe au-dessus
    // bornée à 0–100 % : au-delà, les dégradés des foils montrent le bord de leur motif
    const gx = Math.min(100, Math.max(0, 50 + (ry / DRAG_MAX) * 60));
    const gy = Math.min(100, Math.max(0, 50 - (rx / DRAG_MAX) * 60));
    this.apply(rx, ry, gx, gy, strength);
  }

  private apply(rx: number, ry: number, gx: number, gy: number, glare: number): void {
    const style = this.el.nativeElement.style;
    style.setProperty('--tilt-x', `${rx.toFixed(2)}deg`);
    style.setProperty('--tilt-y', `${ry.toFixed(2)}deg`);
    style.setProperty('--glare-x', `${gx.toFixed(1)}%`);
    style.setProperty('--glare-y', `${gy.toFixed(1)}%`);
    style.setProperty('--glare-o', glare.toFixed(3));
  }
}

function clamp(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value));
}
