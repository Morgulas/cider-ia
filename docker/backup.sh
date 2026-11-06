#!/bin/sh
# Sauvegarde du dossier de données de cider-ia dans une archive datée.
#
#   ./backup.sh <dossier de données> <dossier des archives>
#
# Variables facultatives :
#   KEEP_DAYS=14   nombre de jours pendant lesquels les archives sont gardées (0 = toutes)
#
# Les conteneurs peuvent rester démarrés : chaque fichier du serveur est écrit
# d'un bloc (fichier temporaire puis renommage), et l'archive prend tout le reste
# AVANT blobs/. Une image est toujours envoyée avant le projet qui l'utilise :
# chaque projet copié trouve donc ses images dans la copie de blobs/ faite après lui.
set -eu

DATA_DIR=${1:?"usage : $0 <dossier de données> <dossier des archives>"}
DEST_DIR=${2:?"usage : $0 <dossier de données> <dossier des archives>"}
KEEP_DAYS=${KEEP_DAYS:-14}

if [ ! -d "$DATA_DIR/projects" ] && [ ! -f "$DATA_DIR/users.json" ]; then
  echo "$DATA_DIR ne ressemble pas à un dossier de données cider-ia (ni projects/ ni users.json)" >&2
  exit 1
fi
mkdir -p "$DEST_DIR"
DEST_DIR=$(cd "$DEST_DIR" && pwd)

stamp=$(date +%Y-%m-%d_%H%M%S)
archive="$DEST_DIR/cider-data_$stamp.tar.gz"
partial="$archive.partial"
trap 'rm -f "$partial"' EXIT

# tout sauf blobs/ d'abord, blobs/ en dernier (voir plus haut)
cd "$DATA_DIR"
set --
for entry in * .[!.]*; do
  [ -e "$entry" ] || continue
  [ "$entry" = blobs ] && continue
  set -- "$@" "$entry"
done
[ -d blobs ] && set -- "$@" blobs

tar -czf "$partial" "$@"
# relecture complète : une archive illisible n'est jamais gardée
tar -tzf "$partial" > /dev/null
mv "$partial" "$archive"
trap - EXIT

echo "Sauvegarde : $archive ($(du -h "$archive" | cut -f1))"

if [ "$KEEP_DAYS" -gt 0 ]; then
  find "$DEST_DIR" -maxdepth 1 -name 'cider-data_*.tar.gz' -mtime +"$KEEP_DAYS" -print -delete \
    | sed 's/^/Supprimée (plus de '"$KEEP_DAYS"' jours) : /'
fi
