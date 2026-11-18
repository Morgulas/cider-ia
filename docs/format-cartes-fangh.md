# Format d'échange des cartes (`cartes-fangh`)

Ce document décrit les fichiers que CIDEr IA sait importer dans un deck (page **Cartes** du deck > **Importer des cartes**) et qu'il produit à l'export. Il sert de consigne à l'outil, ou à l'IA, qui prépare les cartes à partir des données brutes.

## Principe de l'import

- Une ligne, ou un objet, par carte.
- Les colonnes sont associées aux **attributs du deck par leur nom**. La casse, les accents, les espaces et la ponctuation sont ignorés, mais le nom exact est préféré.
- Une **colonne d'identification** reconnaît les cartes déjà présentes. Par défaut, c'est `CardID` :
  - une carte du deck qui a le même `CardID` est **mise à jour** ;
  - les autres cartes du fichier sont **créées** ;
  - les cartes du deck absentes du fichier ne sont **pas touchées** (celles venues d'un import précédent sont signalées, voir plus bas).
- Seules les colonnes présentes dans le fichier sont écrites. Une colonne absente (par exemple `Lore`) garde sa valeur dans le deck.
- Une colonne inconnue du deck peut devenir un nouvel attribut, avec le type indiqué dans `champs` (JSON) ou deviné à partir des valeurs (CSV).
- Rien n'est modifié avant validation : l'import affiche d'abord ce qui sera créé, modifié, ainsi que les valeurs hors liste et les modèles introuvables.

## Format JSON (recommandé)

```json
{
  "format": "cartes-fangh",
  "version": 1,
  "jeu": "Livres",
  "source": "equipement/materiel/livres.md",
  "champs": [
    { "nom": "Classe", "type": "dropdown", "options": ["Tous", "Mage", "Prêtre", "Guerrier", "Voleur"] },
    { "nom": "Niveau", "type": "numeric", "options": [] }
  ],
  "cartes": [
    {
      "CardID": "LDF001",
      "Name": "Grimoire des Ordres Néfastes niveau 1",
      "Count": 1,
      "Front Template": "Test",
      "Back Template": "Modèle Verso",
      "Classe": "Mage",
      "Niveau": 1,
      "Description": "Première ligne.\nDeuxième ligne."
    }
  ]
}
```

- `champs` est facultatif. Il décrit les attributs à créer s'ils n'existent pas encore. `type` vaut `text`, `numeric`, `dropdown` ou `checkbox` ; `options` ne sert que pour `dropdown`.
- Les autres clés de premier niveau (`jeu`, `source`…) sont informatives.

## Format CSV

- Première ligne : les noms des colonnes. Les lignes suivantes : une carte par ligne.
- Séparateur `;` (ou `,`), encodage **UTF-8**. Le BOM est accepté et conseillé pour Excel.
- Une cellule qui contient `;`, des guillemets ou un retour à la ligne est entourée de guillemets, et ses guillemets sont doublés : `"Bonus aux ""Premiers soins""."`.

## Colonnes réservées

| Colonne | Contenu |
| --- | --- |
| `CardID` | Identifiant **unique et stable** de la carte (ex. `LDF001`). Ne jamais le réutiliser pour une autre carte, ni le changer. |
| `Name` | Nom affiché de la carte. |
| `Count` | Nombre d'exemplaires (entier, 1 par défaut). |
| `Front Template` / `Back Template` | Nom exact d'un modèle de carte du deck (ex. `Test`, `Modèle Verso`). |

## Règles pour l'outil qui génère les fichiers

1. **`CardID` obligatoire, unique dans le fichier, stable d'une génération à l'autre.** C'est grâce à lui que les cartes sont mises à jour au lieu d'être dupliquées.
2. **Valeurs de liste** : pour un attribut `dropdown`, n'utiliser que les valeurs de `options`. Sinon, ajouter la valeur à `options` dans `champs`. Une valeur hors liste est signalée à l'import, qui propose de l'ajouter.
3. **Nombres** : mettre un nombre (`13`, pas `"13"` ni `"13 PO"`) dans une colonne de type `numeric`. Pour une plage (« niveau 10 à 12 »), utiliser deux colonnes, par exemple `Niveau min` (nombre) et `Niveaux` (texte « 10 à 12 »), plutôt que de ramener la plage à son premier nombre.
4. **Valeur absente** : laisser la cellule vide plutôt que d'écrire « N/A » ou « - ».
5. **Texte** : texte brut. Les retours à la ligne sont conservés (`\n` en JSON). L'import peut les convertir en `<br>` pour les modèles HTML ; sinon, le modèle utilise `white-space: pre-line`.
6. **Pas de phrase commune répétée** dans toutes les cartes (ex. « À garder à portée de main pour conserver ses effets. ») : la mettre dans le modèle de carte, ou dans un attribut dédié.
7. **Noms de colonnes** : identiques aux attributs du deck, avec une seule langue pour tous (éviter `Rarity` au milieu de colonnes en français).
8. **Ne pas inclure** les colonnes qu'on ne veut pas modifier (`Lore` saisi à la main, par exemple) : elles seraient écrasées.
9. **Relire les coquilles** de la source : l'import n'en corrige aucune.

## Synchronisation avec la source (réimports)

Chaque import mémorise, carte par carte, les valeurs reçues de la source (le « dernier import »). Au réimport, chaque champ est comparé sur trois états : dernier import, application, nouveau fichier.

| Situation | Résultat |
| --- | --- |
| Seule la source a changé | La nouvelle valeur est appliquée. |
| Seule l'application a changé (retouche à la main) | La retouche est **gardée**, la carte n'est pas marquée modifiée. |
| Les deux ont changé, différemment | **Conflit** affiché avant validation ; par défaut la valeur de l'application est gardée, au choix champ par champ (« Tout garder » / « Tout prendre »). |

- **Champs gérés dans l'application** : dans l'écran d'import, une colonne peut être cochée « géré dans l'application ». Elle n'est alors plus jamais écrite par l'import, même si le fichier la contient. Ce choix et la colonne d'identification sont mémorisés par deck.
- **Cartes absentes du fichier** : une carte venue d'un import précédent qui n'est plus dans le fichier est signalée. Par défaut elle est gardée ; on peut choisir de la supprimer.
- **Identifiant figé** : `CardID` ne devrait jamais changer. Si on le change quand même dans l'application (par exemple avec « Renuméroter »), l'ancien identifiant est conservé dans la carte, et un fichier qui utilise encore l'ancien identifiant met à jour la bonne carte au lieu d'en créer une nouvelle.

## Historique et retour arrière

- **Journal des cartes** (bouton **Historique** de la page Cartes) : chaque création, modification et suppression est notée avec la date, l'auteur et l'opération (import, action groupée, saisie…). Une opération entière peut être annulée ; les champs modifiés depuis ne sont pas touchés.
- **Versions du projet** (menu du projet > **Historique des versions**, ou page Projets) : le serveur garde les sauvegardes successives du projet : les 20 dernières, la dernière de chaque heure pendant 2 jours, de chaque jour pendant 60 jours, et l'état d'avant chaque import ou action groupée pendant 90 jours. Une version peut être téléchargée, restaurée, ou restaurée comme nouveau projet.

## Export

Dans la page **Cartes** d'un deck :
- **Exporter en CSV** produit un fichier `;` en UTF-8 avec BOM, qui s'ouvre directement dans Excel ;
- **Exporter en JSON** produit le format `cartes-fangh`, avec `champs` rempli d'après les attributs du deck.

Les deux fichiers se réimportent tels quels. C'est le point de départ conseillé pour faire compléter un deck par un autre outil : il voit les valeurs actuelles et les identifiants.

## Publier pour l'appli de collection

Page **Exporter les cartes** d'un deck > **Set pour l'appli de collection**. Le bouton Exporter produit `<code>_p<publication>.zip`, à importer dans l'appli de collection ([card-collector](https://github.com/Morgulas/card-collector), Admin > Importer un set) :

```
set.json                  ce format, avec un bloc "set" : code, nom, univers, publication
cards/<CardID>_front.png  recto rendu de chaque carte
cards/<CardID>_back.png   verso (sauf si « Exclure les versos » est coché)
cards/<CardID>_front_<calque>.png   option « Exporter aussi les calques » : un calque seul
```

- Le deck doit avoir un attribut **CardID** (ou « Card ID ») unique par carte, fait de lettres, chiffres, `-` et `_`, et un attribut **Rareté**. Les valeurs de la liste de Rareté donnent l'ordre des raretés, de la plus commune à la plus rare : elles doivent correspondre aux règles de booster de l'appli (Commune, Peu commune, Rare, Légendaire par défaut).
- Les erreurs (CardID vide ou en double, rareté vide ou hors liste) s'affichent avant tout rendu.
- **Univers** : c'est le **nom du projet**, imposé (un projet = un univers). Dans l'appli, chaque univers a sa propre réserve de boosters rechargés. Pour changer d'univers, renommer le projet (l'appli verra alors un nouvel univers).
- **Code du set** : ne plus le changer une fois le set importé, sinon l'appli le voit comme un nouveau set.
- **Numéro de publication** : il augmente tout seul après chaque publication. L'appli refuse un numéro déjà importé.
- **Sachet du booster** : choisis un booster du simulateur de boosters. Son recto et son verso (onglet Design > Recto / Verso) sont rendus en images (`pack.png` et `pack-back.png`, 500 × 800 px) ; sa finition (mat, brillant ou effet foil) et ses bords dentelés sont transmis à l'appli, qui les affiche en relief.
- **Reprendre les tirages du booster** (option) : le nombre de cartes par booster et le poids de chaque carte remplacent les règles de l'appli (un seul emplacement, comme dans le simulateur).
- L'attribut **Foil** des cartes est transmis sous sa forme canonique (holo, galaxie, or…), comme dans le classeur.
- **Exporter aussi les calques** (option, décochée par défaut : image seule, comme avant). Voir ci-dessous.
- Les réglages (code, nom, univers, publication, booster) sont enregistrés dans le deck.
- Pour publier seulement une partie du deck : bouton **Sélectionner les cartes** de la page, ou sélection dans la liste des cartes puis Exporter.

### Calques

Avec l'option **Exporter aussi les calques**, chaque élément d'un modèle de recto marqué `data-calque="nom"` devient un calque. Pour la carte, l'export produit alors :

- **son image seule** : `cards/<CardID>_front_<nom>.png`. L'image est à la taille de la carte et transparente partout ailleurs. Les éléments posés par-dessus, comme un cadre, n'y apparaissent pas.
- **sa position** : la zone `[x, y, largeur, hauteur]`, en % de la carte, dans `set.json` :

```json
"Calques": { "illustration": { "zone": [0, 15.29, 100, 54.13], "image": "cards/A001_front_illustration.png" } }
```

Exemple de modèle :

```html
<div class="image" data-calque="illustration"></div>
```

- Un nom de calque compte de 1 à 20 caractères : minuscules, chiffres, `-` ou `_`. Une carte a au plus 6 calques. Plusieurs éléments du même nom forment un seul calque, et leur zone est l'union de leurs rectangles.
- L'appli de collection se sert aujourd'hui du calque **`illustration`** : le foil ne brille que sur l'illustration (le foil « cadre », partout sauf sur elle), et l'encre manquante d'une erreur d'impression ne touche que l'illustration. Les autres noms sont exportés et gardés, pour de futurs effets.
- Les calques sont rendus dans un second passage, sans le cache d'images. L'export est donc plus long. Une carte dont le modèle n'a aucun `data-calque` n'a pas de calque.

### Attribut Foil

Chaque deck a un attribut système **Foil** (comme Name, Count et les modèles : impossible à supprimer ou à renommer) : une liste déroulante des 12 effets `holo`, `galaxie`, `or`, `argent`, `prisme`, `paillettes`, `cadre`, `glace`, `ecailles`, `hexagones`, `vernis`, `soleil`. Vide : la carte n'est pas foil. Un attribut foil qui existait déjà (Foil, Brillance, Effet foil ou Holo, en texte ou en liste) devient cet attribut système, avec ses valeurs ; s'il est d'un autre type (case à cocher), il est laissé tel quel. Dans un modèle : `{{card.foil}}`.

### Zones foil

Un modèle peut dire **où** la carte brille : tout élément marqué `data-foil="<effet>"` devient une zone foil. Les effets sont ceux de l'attribut Foil : `holo`, `galaxie`, `or`, `argent`, `prisme`, `paillettes`, `cadre` (ou leurs synonymes, comme `gold` ou `holographique`). Une valeur vide ou inconnue veut dire « pas de foil ».

```html
<div class="titre" data-foil="or">{{card.name}}</div>          <!-- titre toujours doré -->
<div class="image" data-foil="{{card.foil}}"></div>             <!-- l'attribut Foil de la carte décide -->
<div class="bordure" data-foil="prisme"></div>
```

- **À l'export vers l'appli de collection**, chaque effet donne un calque `foil-<effet>` (par exemple `foil-or`), **même sans** « Exporter aussi les calques ». L'appli fait briller chaque zone à la forme exacte de ses éléments (le contour des lettres, la transparence d'une image). Les zones foil passent avant les `data-calque` dans la limite de 6 calques par carte.
- **Ce qui est posé par-dessus la zone la recouvre** : un foil sur l'illustration ne brille pas sous le bandeau du titre ni sous la boîte de texte (à l'export, le masque ne garde que la part de la zone qui se voit sur la carte ; un élément à moitié transparent laisse passer la moitié du foil).
- **La forme d'une zone, c'est ce qui est dessiné** : un élément avec un fond opaque donne un rectangle. Pour que seul un texte brille, mettre `data-foil` sur un élément sans fond.
- **Dans cider-ia** (éditeur de modèles, vignettes, classeur, boosters, simulateur), le reflet est posé sur le rectangle de chaque élément ; pour une image, il suit sa transparence. C'est un aperçu : la forme exacte n'apparaît que dans l'appli de collection.
- **Une carte dont le modèle a des zones foil** brille seulement sur ces zones, dans cider-ia comme dans l'appli de collection : l'effet de l'attribut Foil ne couvre plus toute la carte. Les zones ne rendent pas la carte « foil » pour autant : sa valeur, son poids sur la balance et le badge FOIL suivent toujours l'attribut Foil.

#### Masque peint et force

- **`data-foil-masque="{{assets.mon-masque}}"`** : une image en niveaux de gris de la bibliothèque, étirée sur l'élément. Blanc : le foil brille pleinement ; noir (ou transparent) : rien ; gris : à moitié. C'est la façon des « etched foils » : peindre le ciel et les fleurs en blanc, les visages en noir.
- **`data-foil-force="0.4"`** (ou `40%`) : force de la zone, de 0 à 1.
- Les deux valent pour les reflets et les dorures, dans l'aperçu comme à l'export.

#### Foil texturé (tiré de l'illustration)

**`data-foil-texture="contours"`** sur l'élément qui porte l'illustration (une `<img>` ou un fond `background-image`) : le masque du foil est calculé à partir de l'image elle-même, comme les cartes « texturées » :

- `contours` : le foil suit les traits du dessin ;
- `lumieres` : seules les zones claires brillent (ciel, reflets) ;
- `ombres` : le foil se loge dans les zones sombres.

Une **finesse** de 0 à 1 peut suivre (0,5 par défaut) : `data-foil-texture="contours 0.3"` garde les traits forts seulement, `contours 0.9` presque tous les détails. Avec **`data-gaufrage`** sur le même élément, ce sont les traits qui ressortent en relief (`data-gaufrage="creux"` : en creux), et non l'élément entier.

```html
<div class="image" data-foil="holo" data-foil-texture="contours 0.6" data-gaufrage></div>
```

Le masque suit le cadrage de l'image (cover, contain, position) et se combine avec `data-foil-masque` et `data-foil-force`. Il est recalculé quand l'image ou la taille change ; à l'export, il est inclus dans le calque comme un masque peint (rien à faire côté appli de collection).

#### Effets à motif

`glace` (glace craquelée), `ecailles`, `hexagones` (nid d'abeille) : une texture gravée dans la brillance, en plus des sept effets. Ils sont aussi proposés dans l'attribut Foil et pour les sachets.

#### Vernis sélectif

`vernis` (synonymes : `spot uv`, `vernis selectif`) : un vernis transparent, sans couleur. Il ne se voit qu'en renvoyant la lumière (un éclat blanc), presque pas hors du reflet, et marche aussi sur une encre noire. Avec un masque peint, on obtient un motif brillant qui n'apparaît qu'à la lumière :

```html
<div class="fond" data-foil="vernis" data-foil-masque="{{assets.motif}}"></div>
```

Il est proposé dans l'attribut Foil et pour les sachets. Export : calque `foil-vernis`, compté dans la plaque foil. Valeur dans l'appli de collection : ×0,8 de la prime d'un holo (réglable).

#### Soleil (métal brossé radial)

`soleil` (synonymes `sunburst`, `brosse`, `radial`) : de fines stries de métal qui partent du centre de la zone, et deux traits de lumière opposés qui tournent autour du centre selon la direction du reflet, comme les fonds « sunburst » derrière un personnage. Mettre la zone sur l'élément dont le centre doit être celui des rayons (l'illustration, un médaillon). Calque `foil-soleil` ; dans l'appli de collection, les rayons partent du centre de la zone exportée. Valeur ×1,4 d'un holo (réglable).

#### Paillettes qui scintillent

L'effet `paillettes` ne montre plus un nuage fixe qui suit la lumière : seule une partie des paillettes s'allume à la fois, et elles s'allument et s'éteignent une à une quand on penche la carte. Rien à changer dans les modèles.

#### Éclat de lumière

Chaque zone foil et chaque dorure reçoit une petite étoile (un cœur et deux traits en croix) au point du reflet, au moment où la carte passe pile dans l'axe de la lumière : dans la vue 3D quand la lumière se reflète droit vers l'œil, dans le classeur et l'appli de collection quand on incline la carte (elle passe, puis s'éteint). Rien à changer dans les modèles.

#### Parallaxe

**`data-parallaxe`** sur un élément (un personnage détouré, un logo, un numéro) : il se décale selon l'angle de vue, comme s'il flottait au-dessus de la carte. Niveaux : `1`, `2` (par défaut, valeur vide), `3` (le plus en avant) ; **`fond`** : en arrière (un fond qui s'éloigne, légèrement agrandi pour ne pas montrer ses bords).

```html
<img class="heros" src="{{assets.heros-detoure}}" data-parallaxe="3">
```

- Le décalage n'existe que dans la vue 3D et le classeur (jusqu'à ~3 % de la largeur au niveau 3) ; dans l'éditeur et à l'export, l'élément reste à sa place.
- Il remplace le `translate` et le `scale` propres de l'élément : pour un élément déjà décalé (centré par `translate: -50%`…), mettre `data-parallaxe` sur un élément qui l'enveloppe.
- Export : un calque `parallaxe-1`, `-2` ou `-3` (l'élément seul, comme un `data-calque`), dans la limite de 6 calques. Pas de calque pour `fond` : l'appli de collection fait déjà reculer l'illustration (calque `illustration`).
- Dans l'appli de collection (vue de la carte, révélation), le calque se décale au-dessus de la carte. L'élément reste aussi imprimé à sa place sur le recto : s'il sort de l'illustration (un personnage qui déborde du cadre), sa copie fixe se devine derrière quand on penche fort. À l'intérieur de l'illustration, le relief de l'illustration la recouvre.

#### Image cachée

**`data-foil-cache="{{assets.rune}}"`** : une image en niveaux de gris, étirée sur l'élément (blanc = motif), qui n'apparaît **que sous un angle**, en reflet irisé, comme un hologramme de sécurité. **`data-foil-cache-angle`** : `droite` (par défaut), `gauche`, `haut`, `bas` (la carte penchée de ~12° de ce côté) ou `face` (visible à plat, disparaît dès qu'on penche).

```html
<div class="footer" data-foil-cache="{{assets.rune}}" data-foil-cache-angle="gauche">…</div>
```

Elle se combine avec une zone foil ou une dorure sur le même élément. À plat dans l'éditeur, elle ne se voit pas : l'essayer dans la vue 3D. Export : calque `cache-<angle>` (le motif, découpé à la part visible de l'élément), compté dans la plaque foil.

#### Lenticulaire

**`data-lenticulaire="{{assets.attaque}}"`** sur une image (`<img>`) ou un élément à image de fond : la **seconde image** remplace la première quand on penche la carte de plus de ~6° (complètement à ~12°), d'un côté comme de l'autre. Même cadrage que la première (`object-fit` d'une image, taille et position du fond). De fines lignes de lentilles se voient par-dessus. **`data-lenticulaire-sens="vertical"`** : la carte bascule vers le haut ou le bas.

```html
<div class="image" data-lenticulaire="{{assets.monstre-attaque}}"></div>
```

Les zones foil, dorures et images cachées restent par-dessus. Export : calque `lenticulaire` (ou `lenticulaire-v`), la seconde image en couleurs à sa place exacte, découpée à la part visible de l'élément (ce qui la recouvre reste devant). Pas dans la plaque foil.

#### Foil selon une valeur

Le helper **`selon`** choisit une valeur d'après une autre, sans accents ni majuscules ; un dernier argument seul sert par défaut :

```html
<div class="image" data-foil="{{selon card.rarete 'Légendaire' 'galaxie' 'Épique' 'glace' 'Rare' 'holo'}}"></div>
```

#### Gaufrage

**`data-gaufrage`** (en relief) ou **`data-gaufrage="creux"`** (`"non"` ou `"aucun"` : pas de gaufrage, pratique quand la valeur vient d'un attribut de la carte) : l'élément ressort (ou s'enfonce), avec un liseré clair du côté de la lumière et sombre de l'autre. Il se combine avec une dorure (`data-gaufrage data-foil="dorure-or"` : un titre doré en relief). Dans la vue 3D, le liseré suit la direction de la lumière. À l'export : un calque `gaufrage-relief` ou `gaufrage-creux`.

#### Plaque foil pour l'impression

Export **Images** › **Plaque foil pour l'impression** : avec chaque recto qui a un foil ou une dorure, une image `foil-<carte>.png`, noire là où va le foil (ce qui se voit vraiment, masques peints compris), blanche ailleurs. C'est le calque séparé que demandent les imprimeurs pour la dorure à chaud ou le vernis sélectif. Une plaque n'a pas de demi-teinte : ce qui dépasse la moitié devient noir.

#### Dorure

Un effet foil est un **reflet** : il éclaircit ce qui est dessous. Sur une encre noire, il ne montre rien. Pour un texte en métal, comme une dorure à chaud, utiliser **`data-foil="dorure-or"`**, `dorure-argent`, `dorure-holo` ou **`dorure-noir`** (encre noire brillante : seul l'éclat se voit, très chic sur un fond mat) : le métal **remplace** l'encre des lettres, et son éclat suit la lumière. Suffixe **`-mat`** (`dorure-or-mat`, `dorure-argent-mat`…) : métal satiné, sans l'éclat qui balaie les lettres, qui bouge à peine. Calques `dorure-noir`, `dorure-or-mat`…

```html
<h1 class="card-title" data-foil="dorure-or">{{card.name}}</h1>
```

- L'ombre du texte (`text-shadow`) reste dessous, comme un relief ; seules les lettres sont dorées.
- Sur une image (icône détourée), la dorure prend sa forme. Sur un autre élément sans texte, l'aperçu montre un reflet à la place.
- Export : un calque `dorure-<effet>` (lettres seules, sans leur ombre). Dans l'aperçu de cider-ia (vue 3D comprise), les lettres sont dorées à leur forme exacte.
- Une dorure n'empêche pas le foil de l'attribut Foil sur toute la carte : elle s'y ajoute.
