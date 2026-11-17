import Handlebars from 'handlebars';
import { registerHandlebarsHelpers } from './handlebars-helpers';

describe('helper selon', () => {
  beforeAll(() => registerHandlebarsHelpers());
  const render = (rarete: string) =>
    Handlebars.compile('{{selon card.rarete "Légendaire" "galaxie" "Rare" "holo" "aucun"}}')({ card: { rarete } });

  it('choisit selon la valeur, sans tenir compte des accents ni des majuscules', () => {
    expect(render('Légendaire')).toBe('galaxie');
    expect(render('legendaire')).toBe('galaxie');
    expect(render('RARE')).toBe('holo');
  });

  it('valeur par défaut, ou vide sans défaut', () => {
    expect(render('Commune')).toBe('aucun');
    expect(Handlebars.compile('{{selon x "a" "1"}}')({ x: 'b' })).toBe('');
  });
});
