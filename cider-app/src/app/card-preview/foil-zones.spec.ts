import { differenceMask, layerGroups, maskToPlate, withAlpha } from './card-preview.component';
import { clearFoilZones, drawFoilZones, embossKind, foilGroups, hiddenKind, lenticularKind, zoneKind, zoneOptions } from './foil-zones';

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
    const zone = root.querySelector<HTMLElement>('.cc-foil-zone.foil-or')!.parentElement!;
    expect(zone.style.left).toBe('10px');
    expect(zone.style.top).toBe('20px');
    expect(zone.style.width).toBe('100px');
    // les reflets ne sont pas eux-mêmes des zones
    expect(foilGroups(root).size).toBe(2);
    clearFoilZones(root);
    expect(root.querySelector('.cc-foil-piece')).toBeNull();
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
    const gilded = root.querySelector<HTMLElement>('.cc-foil-piece.cc-dorure')!;
    expect(gilded.textContent).toBe('Titre');
    // boîte agrandie de sa marge (jambages, accents) tout autour du titre
    const pad = Number(gilded.dataset['pad']);
    expect(pad).toBeGreaterThan(0);
    const title = root.querySelector('.titre')!.getBoundingClientRect();
    expect(Math.abs(gilded.getBoundingClientRect().left + pad - title.left)).toBeLessThan(1);
    expect(Math.abs(gilded.getBoundingClientRect().top + pad - title.top)).toBeLessThan(1);
    // la lumière reste héritée (pas figée par la copie du style)
    expect(gilded.style.getPropertyValue('--glare-x')).toBe('');
    expect(gilded.style.backgroundImage).toContain('linear-gradient');
    expect(gilded.style.getPropertyValue('-webkit-text-fill-color')).toBe('transparent');
    expect(gilded.hasAttribute('data-foil')).toBeFalse();
    // une dorure ne compte pas comme zone foil : le foil de la carte reste possible
    expect(gilded.classList.contains('cc-foil-zone')).toBeFalse();
  });

  it('suit les transformations du modèle (bandeau centré par translateX(-50%))', () => {
    root.innerHTML = `<div class="band" style="position:absolute;left:50%;top:10px;width:200px;height:40px;transform:translateX(-50%)">
      <h1 data-foil="dorure-or" style="margin:0;font-size:20px">Le Mariage</h1></div>`;
    root.style.width = '400px';
    drawFoilZones(root);
    const title = root.querySelector('h1')!.getBoundingClientRect();
    const gilded = root.querySelector('.cc-dorure')!.getBoundingClientRect();
    const pad = Number((root.querySelector('.cc-dorure') as HTMLElement).dataset['pad']);
    expect(Math.abs(gilded.left + pad - title.left)).toBeLessThan(1);
    expect(Math.abs(gilded.top + pad - title.top)).toBeLessThan(1);
    expect(Math.abs(gilded.width - 2 * pad - title.width)).toBeLessThan(2);
  });

  it('reste sous ce qui recouvre l\'élément (un bandeau posé sur l\'illustration)', () => {
    root.innerHTML = `<div style="position:relative;width:200px;height:200px">
      <div class="art" data-foil="galaxie" style="position:absolute;inset:0;background:#36c"></div>
      <div class="band" style="position:absolute;left:0;top:0;width:200px;height:40px;background:#fcc"></div></div>`;
    drawFoilZones(root);
    const band = root.querySelector('.band')!;
    const piece = root.querySelector('.cc-foil-piece')!;
    // le reflet passe avant le bandeau dans l'ordre d'affichage (même niveau, plus tôt dans la page)
    expect(piece.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(root.querySelector('.cc-foil-zone')!).zIndex).toBe('auto');
    // au centre du bandeau, c'est le bandeau qui est dessus
    const r = band.getBoundingClientRect();
    expect(document.elementFromPoint(r.left + 100, r.top + 20)).toBe(band);
  });

  it('masque de la part visible : écart entre deux rendus', async () => {
    const png = (color: string) => {
      const c = document.createElement('canvas');
      c.width = 2; c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = '#808080'; ctx.fillRect(1, 0, 1, 1);
      return c.toDataURL();
    };
    const mask = await differenceMask(png('#ffffff'), png('#000000'));
    const img = new Image();
    await new Promise(resolve => { img.onload = resolve; img.src = mask; });
    const c = document.createElement('canvas');
    c.width = 2; c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, 2, 1).data;
    expect(d[3]).toBe(255); // visible
    expect(d[7]).toBe(0);   // recouvert : identique dans les deux rendus
  });

  it('lit le masque peint et la force (0 à 1 ou en %)', () => {
    const el = document.createElement('div');
    expect(zoneOptions(el)).toEqual({ masque: null, texture: null, masques: [], force: 1 });
    el.setAttribute('data-foil-force', '40%');
    el.setAttribute('data-foil-masque', 'masque.png');
    expect(zoneOptions(el)).toEqual({ masque: 'masque.png', texture: null, masques: ['masque.png'], force: 0.4 });
    el.setAttribute('data-foil-force', '0,25');
    expect(zoneOptions(el).force).toBe(0.25);
  });

  it('reflet : force et masque peint en masques combinés, avec ceux de l\'effet', () => {
    const art = root.querySelector<HTMLElement>('.art')!;
    art.setAttribute('data-foil', 'paillettes');
    art.setAttribute('data-foil-force', '0.5');
    art.setAttribute('data-foil-masque', 'm.png');
    drawFoilZones(root);
    const zone = root.querySelector<HTMLElement>('.foil-paillettes')!;
    const mask = zone.style.getPropertyValue('mask');
    expect(mask).toContain('m.png');
    expect(mask).toContain('luminance');
    expect(mask).toContain('radial-gradient');
    expect(mask).toContain('intersect');
  });

  it('gaufrage : en relief ou en creux, une copie de l\'élément posée en premier', () => {
    expect(embossKind(null)).toBeNull();
    expect(embossKind('')).toEqual({ kind: 'gaufrage', effect: 'relief' });
    expect(embossKind('creux')).toEqual({ kind: 'gaufrage', effect: 'creux' });
    expect(embossKind('relief')).toEqual({ kind: 'gaufrage', effect: 'relief' });
    expect(embossKind('non')).toBeNull();
    expect(embossKind(' Aucun ')).toBeNull();
    const titre = root.querySelector<HTMLElement>('.titre')!;
    titre.setAttribute('data-gaufrage', '');
    titre.setAttribute('data-foil', 'dorure-or');
    expect([...layerGroups(root, false).keys()]).toContain('gaufrage-relief');
    drawFoilZones(root);
    // gaufrage en premier enfant, dorure en dernier : la dorure est par-dessus
    expect(titre.firstElementChild!.classList.contains('cc-gaufrage')).toBeTrue();
    expect(titre.lastElementChild!.classList.contains('cc-dorure')).toBeTrue();
    expect((titre.firstElementChild as HTMLElement).style.filter).toContain('drop-shadow');
  });

  it('masque d\'export : force et masque peint appliqués sur la zone de l\'élément', async () => {
    const solid = (color: string, w = 4, h = 1) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
      return c.toDataURL();
    };
    // masque peint : moitié gauche blanche, moitié droite noire
    const c = document.createElement('canvas');
    c.width = 2; c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = '#000'; ctx.fillRect(1, 0, 1, 1);
    const mask = await differenceMask(solid('#fff'), solid('#000'), [
      { masques: [c.toDataURL()], force: 1, rect: [0, 0, 0.5, 1] },
      { masques: [], force: 0.5, rect: [0.5, 0, 0.5, 1] },
    ]);
    const img = new Image();
    await new Promise(resolve => { img.onload = resolve; img.src = mask; });
    const out = document.createElement('canvas');
    out.width = 4; out.height = 1;
    const o = out.getContext('2d')!;
    o.drawImage(img, 0, 0);
    const d = o.getImageData(0, 0, 4, 1).data;
    expect([d[3], d[7], d[11], d[15]]).toEqual([255, 0, 128, 128]);
  });

  it('plaque d\'impression : noir là où le masque est au moins à moitié opaque', async () => {
    const c = document.createElement('canvas');
    c.width = 3; c.height = 1;
    const ctx = c.getContext('2d')!;
    ['rgba(255,255,255,1)', 'rgba(255,255,255,0.4)', 'rgba(255,255,255,0)'].forEach((f, i) => { ctx.fillStyle = f; ctx.fillRect(i, 0, 1, 1); });
    const plate = await maskToPlate(c.toDataURL());
    const img = new Image();
    await new Promise(resolve => { img.onload = resolve; img.src = plate; });
    ctx.clearRect(0, 0, 3, 1);
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, 3, 1).data;
    expect([d[0], d[4], d[8]]).toEqual([0, 255, 255]);
    expect([d[3], d[7], d[11]]).toEqual([255, 255, 255]);
  });

  it('ne double pas une transformation individuelle (translate) de l\'élément', () => {
    root.innerHTML = `<div style="position:absolute;left:0;top:10px;width:400px;height:40px">
      <h1 data-foil="dorure-or" style="margin:0;font-size:20px;width:200px;translate:50px 0">Le Mariage</h1></div>`;
    root.style.width = '400px';
    drawFoilZones(root);
    const title = root.querySelector('h1')!.getBoundingClientRect();
    const gilded = root.querySelector<HTMLElement>('.cc-dorure')!;
    const pad = Number(gilded.dataset['pad']);
    expect(Math.abs(gilded.getBoundingClientRect().left + pad - title.left)).toBeLessThan(1);
  });

  it('vernis sélectif : un effet foil comme les autres (calque foil-vernis)', () => {
    expect(zoneKind('Spot UV')).toEqual({ kind: 'foil', effect: 'vernis' });
    root.querySelector('.titre')!.setAttribute('data-foil', 'vernis');
    expect([...layerGroups(root, false).keys()]).toEqual(['foil-vernis', 'foil-holo']);
  });

  it('image cachée : angle (droite par défaut, synonymes), calque cache-<angle>, pièce irisée masquée par le motif', () => {
    const el = root.querySelector<HTMLElement>('.art')!;
    expect(hiddenKind(el)).toBeNull();
    el.setAttribute('data-foil-cache', 'data:image/png;base64,AAAA');
    expect(hiddenKind(el)).toEqual({ kind: 'cache', effect: 'droite' });
    el.setAttribute('data-foil-cache-angle', 'Left');
    expect(hiddenKind(el)).toEqual({ kind: 'cache', effect: 'gauche' });
    expect([...layerGroups(root, false).keys()]).toEqual(['foil-or', 'foil-holo', 'cache-gauche']);
    expect(drawFoilZones(root)).toBe(3);
    const hidden = root.querySelector<HTMLElement>('.cc-foil-piece .cc-cache')!;
    expect(hidden.style.getPropertyValue('--cx')).toBe('-0.75');
    expect(hidden.style.getPropertyValue('mask')).toContain('luminance');
    // à plat (vue 2D) : invisible ; inclinée à gauche de 12° : nette
    expect(Number(getComputedStyle(hidden).opacity)).toBe(0);
    root.style.setProperty('--par-x', '-0.75');
    root.style.setProperty('--glare-o', '1');
    expect(Number(getComputedStyle(hidden).opacity)).toBeCloseTo(1, 2);
  });

  it('lenticulaire : seconde image au même cadrage, visible quand la carte penche, sous le reflet foil', () => {
    const el = root.querySelector<HTMLElement>('.art')!;
    el.style.backgroundImage = 'linear-gradient(red, red), url("a.png")';
    el.style.backgroundSize = 'auto, 80% 60%';
    el.setAttribute('data-lenticulaire', 'b.png');
    expect(lenticularKind(el)).toEqual({ kind: 'lenticulaire', effect: 'h' });
    el.setAttribute('data-lenticulaire-sens', 'Vertical');
    expect(lenticularKind(el)).toEqual({ kind: 'lenticulaire', effect: 'v' });
    expect([...layerGroups(root, false).keys()]).toContain('lenticulaire-v');
    el.removeAttribute('data-lenticulaire-sens');
    drawFoilZones(root);
    const image = root.querySelector<HTMLElement>('.cc-lenticulaire')!;
    expect(image.style.backgroundImage).toContain('linear-gradient');
    expect(image.style.backgroundImage).toContain('b.png');
    expect(image.style.backgroundImage).not.toContain('a.png');
    expect(image.style.backgroundSize).toBe('auto, 80% 60%');
    // juste après l'élément : sous son reflet holo (posé après lui dans le document)
    const pieces = [...root.querySelectorAll('.cc-foil-piece')];
    expect(pieces.indexOf(image.parentElement!)).toBeLessThan(pieces.indexOf(root.querySelector('.foil-holo')!.parentElement!));
    expect(el.nextElementSibling).toBe(image.parentElement);
    expect(Number(getComputedStyle(image).opacity)).toBe(0);
    root.style.setProperty('--par-x', '1');
    expect(Number(getComputedStyle(image).opacity)).toBe(1);
  });

  it('withAlpha : garde les couleurs du rendu, l\'opacité du masque', async () => {
    const png = (draw: (c: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      draw(c.getContext('2d')!);
      return c.toDataURL('image/png');
    };
    const render = png(c => { c.fillStyle = 'rgb(0, 0, 255)'; c.fillRect(0, 0, 2, 2); });
    const mask = png(c => { c.fillStyle = 'white'; c.fillRect(0, 0, 1, 2); });
    const out = await withAlpha(render, mask);
    const img = new Image();
    img.src = out;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    expect([...ctx.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255]);
    expect(ctx.getImageData(1, 0, 1, 1).data[3]).toBe(0);
  });
});
