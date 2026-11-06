#!/usr/bin/env bash
# Runs every chapter's demo and saves its output next to it (chapters/<slug>/output.txt).
# The site shows these files, so run this after changing any chapter code.
set -euo pipefail
cd "$(dirname "$0")/../chapters"
for dir in */; do
  dir=${dir%/}
  if [ -f "$dir/composer.json" ]; then
    (cd "$dir" && composer dump-autoload --quiet && php bin/evaluations.php > output.txt)
  else
    (cd "$dir" && php evaluations.php > output.txt)
  fi
  echo "ran $dir"
done
