import { layerGroups } from './card-preview.component';
import { clearFoilZones, drawFoilZones, foilGroups } from './foil-zones';

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
});
