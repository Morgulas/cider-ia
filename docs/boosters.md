# Simulateur de boosters

Entrée **Boosters** dans les pages du deck (panneau Explorateur). Un booster décrit un paquet scellé : les cartes qui peuvent en sortir, avec quelle fréquence, et à quoi ressemble le sachet. Les boosters sont enregistrés dans le projet.

## Pool et poids

- **Decks du pool** : les cartes de ces decks peuvent sortir.
- **Poids** : une carte de poids 10 sort en moyenne 10 fois plus souvent qu'une carte de poids 1. Poids 0 : elle ne sort jamais. Les cartes non réglées prennent le **poids par défaut**, y compris les cartes ajoutées plus tard.
- **Regrouper par** un attribut (par exemple « Rareté ») : chaque valeur reçoit son poids en une fois (toutes les communes à 10, toutes les rares à 1…). La part de chaque valeur dans les tirages s'affiche à côté.
- **Cartes par booster** et **doublons** : sans doublons, une carte ne sort qu'une fois par booster (tant que le pool est assez grand).
- **Chance de foil** : chaque carte tirée a cette chance de sortir foil, avec l'effet choisi. Une carte qui a un effet dans son attribut « Foil » est toujours foil.

Le tableau donne pour chaque carte sa chance à chaque tirage, et sa chance d'être dans un booster (ou le nombre moyen d'exemplaires avec doublons).

## Design

- **Réglages** : titre, sous-titre, fond (dégradé, halo, rayures, uni), trois couleurs, illustration et logo pris dans les images du projet, finition (mat, brillant ou un des effets foil) et bords dentelés.
- **Modèle HTML/CSS** : le sachet est un modèle Handlebars, comme une carte. Variables : `{{booster.title}}`, `{{booster.subtitle}}`, `{{booster.cardsPerPack}}`, `{{assets.nom}}`. Les unités `cqw` / `cqh` valent 1 % de la largeur / hauteur du sachet. Le premier passage en mode modèle traduit les réglages en code ; « Repartir des réglages » recommence.

Le sélecteur **Recto / Verso** en tête de l'onglet Design choisit la face à régler ; le bouton sous l'aperçu (« Voir le verso » / « Voir le recto ») montre l'autre face.

### Verso du sachet

Trois modes :

- **Automatique** (par défaut) : verso tiré du recto, couleurs inversées, illustration estompée, nom du booster, nombre de cartes et code-barres.
- **Réglages** : fond et couleurs, couleur du texte, illustration (avec son opacité) et logo pris dans les images du projet, titre (vide : celui du recto), texte libre (contenu, règles, mentions…), nombre de cartes et code-barres à afficher ou non.
- **Modèle HTML/CSS** : comme pour le recto, avec en plus `{{booster.backTitle}}` et `{{booster.backText}}`. Le premier passage part des réglages.

La finition et les bords dentelés sont ceux du recto.

L'aperçu s'incline au survol, comme la carte agrandie du classeur.

## Ouvrir

Le bouton **Retourner**, sous le sachet, le fait pivoter pour voir son verso ; un clic sur le sachet retourné le remet de face, sans l'ouvrir. Un clic sur le sachet de face le déchire, puis chaque clic (ou Espace, ou →) retourne la carte suivante et la range en bas. « Tout révéler » montre tout le booster. Les cartes encore jamais sorties pendant la session portent l'étiquette **Nouvelle**. « Ouvrir 10 boosters » montre directement tout le contenu, foils en premier.

Le panneau **Session** compte les boosters ouverts et les cartes obtenues (exemplaires, foils) ; il n'est pas enregistré.

## Statistiques

- **Boosters pour avoir toutes les cartes** : estimation tout de suite, puis valeur mesurée après une simulation.
- **Simuler** l'ouverture de milliers de boosters : cartes par booster pour chaque valeur de l'attribut de regroupement, et pour chaque carte la part des boosters qui la contiennent (« 1 booster sur… »). Utile pour vérifier qu'une rare est vraiment rare.
