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
```

- Le deck doit avoir un attribut **CardID** (ou « Card ID ») unique par carte, fait de lettres, chiffres, `-` et `_`, et un attribut **Rareté**. Les valeurs de la liste de Rareté donnent l'ordre des raretés, de la plus commune à la plus rare : elles doivent correspondre aux règles de booster de l'appli (Commune, Peu commune, Rare, Légendaire par défaut).
- Les erreurs (CardID vide ou en double, rareté vide ou hors liste) s'affichent avant tout rendu.
- **Code du set** : ne plus le changer une fois le set importé, sinon l'appli le voit comme un nouveau set.
- **Numéro de publication** : il augmente tout seul après chaque publication. L'appli refuse un numéro déjà importé.
- **Sachet du booster** : choisis un booster du simulateur de boosters. Son recto et son verso (onglet Design > Recto / Verso) sont rendus en images (`pack.png` et `pack-back.png`, 500 × 800 px) ; sa finition (mat, brillant ou effet foil) et ses bords dentelés sont transmis à l'appli, qui les affiche en relief.
- **Reprendre les tirages du booster** (option) : le nombre de cartes par booster et le poids de chaque carte remplacent les règles de l'appli (un seul emplacement, comme dans le simulateur).
- L'attribut **Foil** des cartes est transmis sous sa forme canonique (holo, galaxie, or…), comme dans le classeur.
- Les réglages (code, nom, univers, publication, booster) sont enregistrés dans le deck.
- Pour publier seulement une partie du deck : bouton **Sélectionner les cartes** de la page, ou sélection dans la liste des cartes puis Exporter.
