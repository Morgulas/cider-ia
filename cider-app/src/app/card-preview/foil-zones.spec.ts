import { layerGroups } from './card-preview.component';
import { clearFoilZones, drawFoilZones, foilGroups, zoneKind } from './foil-zones';

describe('foil-zones', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.style.position = 'relative';
    root.innerHTML = `
      <div class="titre" data-foil="gold" style="position:absolute;left:10px;top:20px;width:100px;height:30px">Titre</div>
      <div class="art" data-foil="Holographique" data-calque="illustration" style="width:50px;height:40px"></div>
      <div class="cadre" data-foil="" style="width:10px;height:10px"></div>
      <div class="texte" data-foil="inconnu" style="width:10px;height:10px"></div>`;
    document.body.appendChild(root);
  });

  afterEach(() => root.remove());

  it('regroupe les éléments par effet (synonymes compris, vide ou inconnu ignoré)', () => {
    const groups = foilGroups(root);
    expect([...groups.keys()]).toEqual(['or', 'holo']);
    expect(groups.get('or')![0].className).toBe('titre');
  });

  it('donne un calque foil-<effet> par effet, avant les data-calque (seulement si demandés)', () => {
    expect([...layerGroups(root, true).keys()]).toEqual(['foil-or', 'foil-holo', 'illustration']);
    expect([...layerGroups(root, false).keys()]).toEqual(['foil-or', 'foil-holo']);
  });

  it('pose un reflet par élément, à sa place, et le retire', () => {
    expect(drawFoilZones(root)).toBe(2);
    const zone = root.querySelector<HTMLElement>('.cc-foil-zone.foil-or')!;
    expect(zone.style.left).toBe('10px');
    expect(zone.style.top).toBe('20px');
    expect(zone.style.width).toBe('100px');
    // les reflets ne sont pas eux-mêmes des zones
    expect(foilGroups(root).size).toBe(2);
    clearFoilZones(root);
    expect(root.querySelector('.cc-foil-layer')).toBeNull();
  });

  it('reconnaît la dorure (or, argent, holo) et l\'exporte en calque dorure-<effet>', () => {
    expect(zoneKind('dorure-or')).toEqual({ kind: 'dorure', effect: 'or' });
    expect(zoneKind('Dorure gold')).toEqual({ kind: 'dorure', effect: 'or' });
    expect(zoneKind('dorure-galaxie')).toBeNull();
    expect(zoneKind('or')).toEqual({ kind: 'foil', effect: 'or' });
    root.querySelector('.titre')!.setAttribute('data-foil', 'dorure-or');
    expect([...layerGroups(root, false).keys()]).toEqual(['dorure-or', 'foil-holo']);
  });

  it('dore les lettres : une copie du texte remplie de métal, à la place de l\'élément', () => {
    root.querySelector('.titre')!.setAttribute('data-foil', 'dorure-or');
    expect(drawFoilZones(root)).toBe(2);
    const gilded = root.querySelector<HTMLElement>('.cc-foil-layer .cc-dorure')!;
    expect(gilded.textContent).toBe('Titre');
    expect(gilded.style.left).toBe('10px');
    expect(gilded.style.backgroundImage).toContain('linear-gradient');
    expect(gilded.style.getPropertyValue('-webkit-text-fill-color')).toBe('transparent');
    expect(gilded.hasAttribute('data-foil')).toBeFalse();
    // une dorure ne compte pas comme zone foil : le foil de la carte reste possible
    expect(gilded.classList.contains('cc-foil-zone')).toBeFalse();
  });
});
