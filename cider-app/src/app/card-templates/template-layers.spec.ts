import { absentTags, analyzeCard, compareSnapshots, findCssDuplicates, findSourceTag, inheritedFromContainer, LayerNode, paintTopFirst, setTagAttributes,
  snapshotCard, sourceTags } from './template-layers';
import { annotateLines } from './template-tools';

/** Renders a template the way the preview does (lines annotated, CSS in a <style>), in a container of the page */
function render(html: string, css = '', containerTag = 'div'): { container: HTMLElement; cardElement: HTMLElement } {
  const container = document.createElement(containerTag);
  const cardElement = document.createElement('div');
  cardElement.className = 'card-element';
  cardElement.innerHTML = annotateLines(html) + (css ? `<style>${css}</style>` : '');
  container.appendChild(cardElement);
  document.body.appendChild(container);
  return { container, cardElement };
}

function labels(nodes: { node: LayerNode }[]): string[] {
  return nodes.map(entry => entry.node.label);
}

describe('template layers', () => {
  const containers: HTMLElement[] = [];
  const use = (html: string, css = '', tag = 'div') => {
    const rendered = render(html, css, tag);
    containers.push(rendered.container);
    return rendered.cardElement;
  };
  afterEach(() => containers.splice(0).forEach(container => container.remove()));

  it('builds the element tree with lines, layers, foils and kinds', () => {
    const card = use(
      '<div id="c">\n  <div class="art" data-calque="illustration" data-foil="soleil"></div>\n  <p class="t">Titre</p>\n</div>',
      '#c { width: 100px; height: 100px; position: relative; } .art { width: 10px; height: 10px; background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=); }');
    const { roots } = analyzeCard(card);
    expect(roots.length).toBe(1);
    const [art, title] = roots[0].children;
    expect(roots[0].label).toBe('div#c');
    expect(roots[0].kind).toBe('group');
    expect(art.line).toBe(2);
    expect(art.calque).toBe('illustration');
    expect(art.foil).toBe('soleil');
    expect(art.kind).toBe('image');
    expect(title.kind).toBe('text');
    expect(title.text).toBe('Titre');
    expect(title.key).toBe('3:p:0');
  });

  it('paints a non-positioned element with a transform above the positioned elements before it', () => {
    // the Flocongers template: the text box came above the frame only because of transform: translateX(0%)
    const card = use(
      '<div id="c">\n<div class="art"></div>\n<div class="frame"></div>\n<div class="text"></div>\n</div>',
      '#c { position: relative; width: 100px; height: 100px; } .art, .frame { position: absolute; inset: 0; }'
      + ' .frame { z-index: 0; } .text { transform: translateX(0%); z-index: 10; height: 50px; }');
    const analysis = analyzeCard(card);
    // bottom to top
    expect(labels(analysis.paint)).toEqual(['div#c', 'div.art', 'div.frame', 'div.text']);
    const text = analysis.nodes.find(node => node.label === 'div.text')!;
    expect(text.context).toBe('transform');
    expect(text.issues.map(issue => issue.code)).toContain('z-index-ignored');
    expect(text.issues.map(issue => issue.code)).toContain('identity-transform');
  });

  it('paints negative z-index first, then positioned ones in code order, then positive z-index', () => {
    const card = use(
      '<div id="c">\n<div class="top"></div>\n<div class="flow"></div>\n<div class="under"></div>\n<div class="abs"></div>\n</div>',
      '#c { position: relative; width: 100px; height: 100px; } .top { position: absolute; z-index: 5; }'
      + ' .under { position: absolute; z-index: -1; } .abs { position: absolute; } .flow { height: 10px; }');
    // .flow is in-flow content of the positioned #c: painted with it
    expect(labels(analyzeCard(card).paint)).toEqual(['div.under', 'div#c', 'div.abs', 'div.top']);
  });

  it('keeps the children of a stacking context together', () => {
    const card = use(
      '<div id="c">\n<div class="a"><div class="a-high"></div></div>\n<div class="b"></div>\n</div>',
      '#c { position: relative; } .a { position: relative; z-index: 1; } .a-high { position: absolute; z-index: 99; }'
      + ' .b { position: relative; z-index: 2; }');
    const paint = analyzeCard(card).paint;
    expect(labels(paint)).toEqual(['div#c', 'div.a', 'div.a-high', 'div.b']);
    expect(paint.find(entry => entry.node.label === 'div.a-high')!.depth).toBe(1);
    // from the top: each context stays above what is painted inside it
    expect(labels(paintTopFirst(paint))).toEqual(['div.b', 'div.a', 'div.a-high', 'div#c']);
  });

  it('accepts z-index on flex items', () => {
    const card = use('<div id="c">\n<div class="item"></div>\n</div>',
      '#c { display: flex; } .item { z-index: 3; height: 5px; width: 5px; }');
    const item = analyzeCard(card).nodes.find(node => node.label === 'div.item')!;
    expect(item.context).toBe('z-index');
    expect(item.issues.length).toBe(0);
  });

  it('finds the text styles the card takes from the page around it', () => {
    const card = use('<div id="c">x</div>', '#c { font-size: 20px; text-align: left; }');
    const root = card.querySelector<HTMLElement>('#c')!;
    const inherited = inheritedFromContainer(card, root);
    expect(inherited).not.toContain('text-align');
    expect(inherited).not.toContain('font-size');
    expect(inherited).toContain('letter-spacing');
    // the probe leaves nothing behind
    expect(card.getAttribute('style')).toBeNull();
  });

  it('reports text overflow, invalid layer names and the layers beyond the export limit', () => {
    const many = Array.from({ length: 7 }, (_, i) => `<i data-calque="l${i}"></i>`).join('\n');
    const card = use(`<div id="c">\n<p class="small">Un texte bien trop long pour sa boîte</p>\n<b data-calque="Pas bon!"></b>\n${many}\n</div>`,
      '.small { width: 20px; height: 10px; overflow: hidden; white-space: nowrap; }');
    const nodes = analyzeCard(card).nodes;
    expect(nodes.find(node => node.label === 'p.small')!.issues.map(issue => issue.code)).toContain('overflow');
    expect(nodes.find(node => node.tag === 'b')!.issues.map(issue => issue.code)).toContain('invalid-calque');
    expect(nodes.find(node => node.calque === 'l6')!.issues.map(issue => issue.code)).toContain('export-limit');
    expect(nodes.find(node => node.calque === 'l0')!.issues.length).toBe(0);
  });

  it('lists the tags this card does not render, with their condition', () => {
    const html = '<div id="c">\n{{#if card.badge}}\n<div class="badge"></div>\n{{else}}\n<span class="none"></span>\n{{/if}}\n'
      + '{{!--\n<div class="old"></div>\n--}}\n</div>';
    const tags = sourceTags(html);
    expect(tags.map(tag => [tag.label, tag.line])).toEqual([['div#c', 1], ['div.badge', 3], ['span.none', 5], ['div.old', 8]]);
    expect(tags[1].condition).toBe('{{#if card.badge}}');
    expect(tags[2].inElse).toBeTrue();
    expect(tags[3].commented).toBeTrue();
    expect(sourceTags('<p class="a {{#if (gt card.x 3)}}long{{/if}} {{card.y}}"></p>')[0].label).toBe('p.a');

    const card = use('<div id="c">\n\n<div class="badge"></div>\n</div>');
    const absent = absentTags(html, analyzeCard(card).nodes);
    expect(absent.map(tag => tag.label)).toEqual(['span.none', 'div.old']);
  });

  it('finds rules and properties written twice, but not conditional overrides', () => {
    const css = '.a { color: red; }\n.b {\n  font-size: 3px;\n  {{#if card.x}}\n  font-size: 2px;\n  {{/if}}\n  gap: 1px; gap: 2px;\n}\n'
      + '.a { margin: 0; }\n@media print { .a { color: blue; } }\n.c { --x: 1px; }\n.c { width: var(--x); }';
    const duplicates = findCssDuplicates(css);
    expect(duplicates).toEqual([
      { kind: 'property', selector: '.b', property: 'gap', line: 7, repeatLine: 7 },
      { kind: 'rule', selector: '.a', line: 1, repeatLine: 9 },
    ]);
  });

  it('compares two renders of a template (variant)', () => {
    const html = '<div id="c" class="{{v}}">\n<div class="crown" data-foil="{{f}}"></div>\n{{#if x}}\n<b class="extra"></b>\n{{/if}}\n</div>';
    const css = '#c { --haut: 10px; }\n#c.leg { --haut: 0px; }\n.leg .crown { color: red; }';
    const base = use('<div id="c" class="">\n<div class="crown" data-foil=""></div>\n\n\n\n</div>', css);
    const leg = use('<div id="c" class="leg">\n<div class="crown" data-foil="or"></div>\n\n<b class="extra"></b>\n\n</div>', css);
    const diff = compareSnapshots(snapshotCard(base, css), snapshotCard(leg, css));
    expect(diff.shown).toEqual(['b.extra']);
    expect(diff.hidden).toEqual([]);
    expect(diff.variables).toEqual([{ name: '--haut', from: '10px', to: '0px' }]);
    expect(diff.rulesOn.map(rule => rule.line)).toEqual([2, 3]);
    expect(diff.foils).toEqual([{ label: 'div.crown', from: '', to: 'or' }]);
    expect(diff.size).toBe(5);
    expect(html).toContain('{{#if x}}');
  });

  it('finds an opening tag of the source and changes its attributes', () => {
    const html = '<div id="c">\n  <div class="a" data-foil="{{selon card.raret "Légendaire" "or" ""}}">x</div><img src="{{u}}" />\n</div>';
    const tag = findSourceTag(html, 2, 'div')!;
    expect(tag.attributes.map(attribute => [attribute.name, attribute.value])).toEqual([
      ['class', 'a'], ['data-foil', '{{selon card.raret "Légendaire" "or" ""}}']]);
    expect(setTagAttributes(html, tag, { 'data-foil': 'holo', 'data-foil-force': '0.5' }))
      .toBe('<div class="a" data-foil="holo" data-foil-force="0.5">');
    expect(setTagAttributes(html, tag, { 'data-foil': null })).toBe('<div class="a">');
    // a value with quotes inside {{ }} keeps double quotes
    expect(setTagAttributes(html, tag, { 'data-foil': '{{selon card.x "a" "b"}}' }))
      .toBe('<div class="a" data-foil="{{selon card.x "a" "b"}}">');
    const img = findSourceTag(html, 2, 'img')!;
    expect(setTagAttributes(html, img, { 'data-foil': 'argent' })).toBe('<img src="{{u}}" data-foil="argent" />');
    expect(findSourceTag(html, 3, 'div')).toBeNull();
  });
});

