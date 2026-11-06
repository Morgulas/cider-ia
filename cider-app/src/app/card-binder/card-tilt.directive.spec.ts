import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CardTiltDirective } from './card-tilt.directive';

@Component({
  template: `<div appCardTilt style="position:fixed;left:0;top:0;width:200px;height:300px">
    <button type="button" (click)="clicks = clicks + 1">carte</button></div>`,
  imports: [CardTiltDirective]
})
class HostComponent {
  clicks = 0;
}

function pointer(el: Element, type: string, x: number, y: number, pointerType = 'mouse'): void {
  el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType, button: 0, bubbles: true }));
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)));

describe('CardTiltDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let tilt: HTMLElement;
  let button: HTMLButtonElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    tilt = fixture.nativeElement.querySelector('[appCardTilt]');
    button = fixture.nativeElement.querySelector('button');
  });

  const deg = (name: string) => parseFloat(tilt.style.getPropertyValue(name));

  it('incline la carte vers la souris au survol, puis la remet à plat', async () => {
    pointer(tilt, 'pointerenter', 200, 0);
    await nextFrame();
    expect(deg('--tilt-y')).toBeGreaterThan(0);
    expect(deg('--tilt-x')).toBeGreaterThan(0);
    pointer(tilt, 'pointerleave', 300, 0);
    expect(deg('--tilt-y')).toBe(0);
    expect(tilt.classList).toContain('tilt-settling');
  });

  it('suit un glissé du doigt, limité à 32°, sans retourner la carte', async () => {
    pointer(button, 'pointerdown', 100, 150, 'touch');
    pointer(button, 'pointermove', 600, 150, 'touch');
    await nextFrame();
    expect(deg('--tilt-y')).toBe(32);
    pointer(button, 'pointerup', 600, 150, 'touch');
    button.click();
    expect(fixture.componentInstance.clicks).toBe(0);
    expect(deg('--tilt-y')).toBe(0);
  });

  it('laisse passer un simple clic', () => {
    pointer(button, 'pointerdown', 100, 150);
    pointer(button, 'pointerup', 102, 151);
    button.click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });
});
