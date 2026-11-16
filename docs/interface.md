# Se repérer dans l'interface

Une fois un projet ouvert, l'écran se découpe en quatre zones :

```
┌──────────────────────────────────────────────────────────────────────┐
│ Barre du haut : logo, Mes projets, Utilisateurs, Paramètres IA,      │
│ Mon compte, projet ouvert ▾, fil d'Ariane, compte, déconnexion       │
├────┬───────────────┬─────────────────────────────────────────────────┤
│ ▣  │ Panneau       │ Onglets du deck (pages d'un deck)               │
│ ▣  │ latéral       ├─────────────────────────────────────────────────┤
│    │ (Explorateur) │                                                 │
│    │               │ Page ouverte                                    │
│    │               │                                                 │
│ ⚙  │               │                                                 │
├────┴───────────────┴─────────────────────────────────────────────────┤
│ Barre du bas : version, état de l'enregistrement, liens              │
└──────────────────────────────────────────────────────────────────────┘
```

La séparation entre le panneau latéral et la page se déplace à la souris.

## Barre d'activité (à gauche)

| Icône | Rôle |
| :--- | :--- |
| Dossier | **Explorateur** : le projet et le deck choisi. Un second clic replie le panneau pour donner toute la largeur à la page. |
| Couronne | **Simulateur de partie** ([simulateur.md](simulateur.md)). |
| Roue dentée (en bas) | **Paramètres** de l'application (langue et thème). |

Le panneau affiché est marqué d'un trait coloré. Les libellés et infobulles suivent la langue choisie.

## Explorateur

### Le projet

En haut, le nom du projet (sa page d'accueil : nombre de ressources, documents, decks, cartes, modèles et attributs) et, en dessous, ses documents : `global-styles` (CSS commun à toutes les cartes) et les documents Markdown. Survoler le nom du projet fait apparaître le bouton **nouveau document** ; le clic droit propose aussi **nouveau deck**.

### Le sélecteur de deck

Sous le projet, la liste déroulante **Deck** choisit le deck sur lequel on travaille. Tout ce qui est en dessous appartient à ce deck. Chaque deck y est listé avec son nombre de cartes (une recherche apparaît au-delà de six decks).

- La liste **suit le deck ouvert** : en arrivant sur une page d'un autre deck (lien, fil d'Ariane, historique du navigateur), elle se met d'elle-même sur ce deck.
- Elle **retient le dernier deck choisi**, pour chaque projet : on le retrouve en rouvrant le projet.
- **Changer de deck garde la page** : depuis les Vignettes du deck A, choisir le deck B ouvre les Vignettes du deck B. Depuis un modèle de carte (qui n'existe que dans le deck A), on arrive sur la liste des cartes du deck B.

Le bouton **⋮** à côté du sélecteur ouvre les actions du deck : nouveau deck, nouveau modèle de carte, modifier / renommer le deck, tous les decks (page de gestion des decks), supprimer le deck.

### Les pages du deck

| Entrée | Contenu | Compteur |
| :--- | :--- | :--- |
| **Cartes** | Liste des cartes, en tableau modifiable ; import et export CSV/JSON ([format-cartes-fangh.md](format-cartes-fangh.md)). | nombre de cartes |
| **Vignettes** | Les cartes rendues, en classeur ; bouton ✨ d'illustration sur chaque carte. | |
| **Attributs** | Les champs des cartes (texte, nombre, liste, case à cocher). | |
| **Prompt d'illustration** | Le prompt commun aux illustrations du deck ([docker/README.md](../docker/README.md#ia--illustrations-de-cartes)). | |
| **Exporter les cartes** | Planches PDF, images, Tabletop Simulator, ou **set pour l'appli de collection**. | |
| **Boosters** | Les boosters de ce deck ([boosters.md](boosters.md)) ; les boosters communs (plusieurs decks) sont sous le projet. | boosters de ce deck (qui ne piochent que dans lui) |
| **Modèles de carte** | Les modèles HTML/CSS du deck ([editeur-de-modeles.md](editeur-de-modeles.md)). Le bouton **+** au survol crée un modèle. | nombre de modèles |

La page affichée est surlignée. Le champ **Rechercher** filtre les pages et modèles du deck.

Le **clic droit sur un modèle** propose : nouveau modèle, modifier / renommer, dupliquer, **déplacer vers le deck…** (sous-menu des autres decks), supprimer.

## Onglets du deck

En haut de chaque page d'un deck, une barre d'onglets reprend ses pages : **Cartes, Vignettes, Attributs, Modèles de carte, Prompt d'illustration, Exporter les cartes**. Elle permet de passer d'une page à l'autre sans le panneau latéral, par exemple quand on l'a replié pour avoir plus de place. L'onglet **Modèles de carte** ouvre le premier modèle du deck (ou l'assistant de création s'il n'y en a pas).

## Illustrations

Les ressources du projet (images, polices…) sont rangées en **bibliothèques** : une par deck, plus une **bibliothèque commune** à tout le projet. Chacune a sa page, en grand dans la zone principale :

- **Illustrations** sous le projet (Explorateur, à côté de `global-styles`) : la bibliothèque commune.
- **Illustrations** dans les pages du deck (et l'onglet du même nom en haut des pages du deck) : la bibliothèque du deck.

La page montre les dossiers et les images en grandes vignettes (taille réglable avec le curseur, retenue ; le damier rend visibles les zones transparentes), avec le fil d'Ariane, la recherche (dans tous les dossiers), **nouveau dossier**, **générer** ✨ et **Ajouter des images** (plusieurs fichiers à la fois, ou glissés depuis l'ordinateur sur la page : ils vont dans le dossier affiché, un nom déjà pris reçoit un suffixe -2, -3…). Un clic ouvre l'image ; le clic droit donne : ouvrir, copier l'appel pour les modèles (`{{assets.dossier.nom}}`), renommer, déplacer vers une autre bibliothèque, supprimer. Glisser une vignette sur un dossier ou une étape du fil d'Ariane la range.

### Bibliothèques

- Les **modèles de carte** d'un deck voient ses images **et** celles de la bibliothèque commune. Si les deux ont une image au même chemin (`{{assets.dos}}`), celle du deck l'emporte : chaque deck peut avoir son propre dos, son propre logo… Les images des autres decks ne sont pas visibles.
- Les feuilles de style communes (`global-styles`) ne voient que la bibliothèque commune.
- Le générateur ✨ range l'image dans la bibliothèque de la page d'où il a été ouvert. La fenêtre d'**illustration IA** d'une carte la range par défaut dans le deck de la carte (au choix : le deck ou la bibliothèque commune).
- **Changer de bibliothèque** : clic droit sur une image ou un dossier › *Déplacer vers la bibliothèque*. L'image garde son dossier ; c'est refusé si une image du même nom s'y trouve déjà.
- **Supprimer un deck** ne supprime pas ses images : elles reviennent dans la bibliothèque commune, dans un dossier au nom du deck.
- Les images d'avant cette organisation sont dans la bibliothèque commune : rien ne change pour les modèles existants tant qu'on ne les déplace pas.

> Ranger une image dans un dossier ne casse pas les modèles qui l'appellent par son seul nom (`{{assets.fire-apple}}`) : l'image reste joignable sous ce nom tant qu'aucune image de premier niveau ne le porte. Le chemin complet (`{{assets.pommes.fire-apple}}`) marche aussi.

## Barre du bas

L'état de l'enregistrement automatique (« Enregistré à 14:31 », « Enregistrement… », erreur). Le survol donne le détail du dernier enregistrement (ce qui a été envoyé).
