# Se repérer dans l'interface

Une fois un projet ouvert, l'écran se découpe en quatre zones :

```
┌──────────────────────────────────────────────────────────────────────┐
│ Barre du haut : logo, Mes projets, Utilisateurs, Paramètres IA,      │
│ Mon compte, projet ouvert ▾, fil d'Ariane, compte, déconnexion       │
├────┬───────────────┬─────────────────────────────────────────────────┤
│ ▣  │ Panneau       │ Onglets du deck (pages d'un deck)               │
│ ▣  │ latéral       ├─────────────────────────────────────────────────┤
│ ▣  │ (Explorateur  │                                                 │
│    │  ou           │ Page ouverte                                    │
│    │  Illustrations│                                                 │
│ ⚙  │  )            │                                                 │
├────┴───────────────┴─────────────────────────────────────────────────┤
│ Barre du bas : version, état de l'enregistrement, liens              │
└──────────────────────────────────────────────────────────────────────┘
```

La séparation entre le panneau latéral et la page se déplace à la souris.

## Barre d'activité (à gauche)

| Icône | Rôle |
| :--- | :--- |
| Dossier | **Explorateur** : le projet et le deck choisi. Un second clic replie le panneau pour donner toute la largeur à la page. |
| Images | **Illustrations** : les images et polices du projet, sur toute la hauteur du panneau. |
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
| **Boosters** | Le simulateur de boosters ([boosters.md](boosters.md)). Un booster peut piocher dans plusieurs decks : la page est commune au projet. | boosters qui piochent dans ce deck |
| **Modèles de carte** | Les modèles HTML/CSS du deck ([editeur-de-modeles.md](editeur-de-modeles.md)). Le bouton **+** au survol crée un modèle. | nombre de modèles |

La page affichée est surlignée. Le champ **Rechercher** filtre les pages et modèles du deck.

Le **clic droit sur un modèle** propose : nouveau modèle, modifier / renommer, dupliquer, **déplacer vers le deck…** (sous-menu des autres decks), supprimer.

## Onglets du deck

En haut de chaque page d'un deck, une barre d'onglets reprend ses pages : **Cartes, Vignettes, Attributs, Modèles de carte, Prompt d'illustration, Exporter les cartes**. Elle permet de passer d'une page à l'autre sans le panneau latéral, par exemple quand on l'a replié pour avoir plus de place. L'onglet **Modèles de carte** ouvre le premier modèle du deck (ou l'assistant de création s'il n'y en a pas).

## Illustrations

Le panneau **Illustrations** montre les ressources du projet (images, polices…). Deux vues, au choix avec les boutons en haut du panneau (le choix est retenu) :

### Vignettes (par défaut)

- **Dossiers** en tête, avec leur nombre d'éléments ; un clic entre dans le dossier.
- **Fil d'Ariane** (« Toutes › Personnages › Héros ») : un clic remonte. À droite, **nouveau dossier** et **nouvelle ressource** dans le dossier affiché.
- **Rechercher** cherche dans tous les dossiers à la fois.
- Un clic sur une image l'ouvre ; le **clic droit** donne ses actions (renommer, générer, supprimer). Le damier derrière les images rend visibles les zones transparentes.
- **Ranger** : glisser une vignette sur un dossier, ou sur une étape du fil d'Ariane pour la remonter.

### Liste

L'arborescence complète, avec glisser-déposer des ressources et des dossiers, et menus au clic droit (comme avant).

Le bouton ✨ en haut du panneau ouvre le **générateur de ressources**.

> Ranger une image dans un dossier ne casse pas les modèles qui l'appellent par son seul nom (`{{assets.fire-apple}}`) : l'image reste joignable sous ce nom tant qu'aucune image de premier niveau ne le porte. Le chemin complet (`{{assets.pommes.fire-apple}}`) marche aussi.

## Barre du bas

L'état de l'enregistrement automatique (« Enregistré à 14:31 », « Enregistrement… », erreur). Le survol donne le détail du dernier enregistrement (ce qui a été envoyé).
